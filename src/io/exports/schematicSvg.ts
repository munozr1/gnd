/**
 * Schematic plots: one sheet per page using the editor's own symbol geometry
 * (`componentLayout`) and wire routing (`sheetWires`), so the plot matches
 * the canvas: symbol bodies, pins with names, '+N unused' stubs, ref / value
 * labels, wires with labels, hierarchical sheet symbols listing their pins,
 * and off-sheet flags where a wire leaves the sheet. Monochrome, with a
 * KiCad-style frame and title block.
 *
 * `schematicSheetsHtml` is the PDF path (see print.ts).
 */
import { boundsOf, type Rect } from '@/model/geometry';
import { indexProject } from '@/model/query';
import { childSheets, sheetOrder, sheetPath, sheetSubtreeIds } from '@/model/schematic/hierarchy';
import { componentLayout, symbolBoundsWithPins, type PinPlacement } from '@/model/schematic/symbolGeometry';
import { sheetWires, wireLabelAnchor } from '@/model/schematic/wires';
import { crossSheetLinks } from '@/model/schematic/sheets';
import type { Component, Id, Project, Sheet, Vec2 } from '@/model/types';
import { fileSlug, isoDate } from './common';
import { printableHtml } from './print';
import { A4_LANDSCAPE, esc, fitTransform, group, line, num, plotFrame, polyline, rect, svgDocument, svgPlotSet, text, type Box } from './svg';

export interface SchematicPlotOptions {
  date?: string;
  sheet?: { n: number; of: number };
}

export interface SchematicSetOptions {
  /** Sheets to plot (hierarchy order when omitted: all sheets). */
  sheetIds?: readonly Id[];
  date?: string;
}

const PAD = 40;
const MAX_SCALE = 1.6;
const WIRE_W = 1.2;
const BODY_W = 1.2;
const PIN_W = 0.9;
const FONT_REF = 8;
const FONT_VALUE = 7;
const FONT_PIN = 5.5;
const FONT_WIRE = 6;
const FONT_SHEET = 9;
const FONT_SHEET_PIN = 5.5;
const SHEET_PIN_LH = 7;

function sheetOrThrow(project: Project, sheetId: Id): Sheet {
  const sheet = project.sheets.find((s) => s.id === sheetId);
  if (!sheet) throw new Error(`Unknown sheet "${sheetId}"`);
  return sheet;
}

export function sheetsInOrder(project: Project, sheetIds?: readonly Id[]): Sheet[] {
  const order = sheetOrder(project);
  const wanted = sheetIds ? new Set(sheetIds) : null;
  return order.map((id) => project.sheets.find((s) => s.id === id)).filter((s): s is Sheet => s !== undefined && (wanted === null || wanted.has(s.id)));
}

interface PinText {
  x: number;
  y: number;
  anchor: 'start' | 'end';
  rotate: number;
}

/** Where a pin's name sits: just inside the body edge, reading away from the edge. */
function pinNamePos(bodyPos: Vec2, dir: Vec2, gap: number): PinText {
  if (Math.abs(dir.x) >= Math.abs(dir.y)) {
    return dir.x < 0 ? { x: bodyPos.x + gap, y: bodyPos.y, anchor: 'start', rotate: 0 } : { x: bodyPos.x - gap, y: bodyPos.y, anchor: 'end', rotate: 0 };
  }
  return dir.y < 0 ? { x: bodyPos.x, y: bodyPos.y + gap, anchor: 'end', rotate: -90 } : { x: bodyPos.x, y: bodyPos.y - gap, anchor: 'start', rotate: -90 };
}

/** Where an off-sheet flag sits: past the pin end, reading outward. */
function flagPos(pos: Vec2, dir: Vec2, gap: number): PinText {
  if (Math.abs(dir.x) >= Math.abs(dir.y)) {
    return dir.x < 0 ? { x: pos.x - gap, y: pos.y, anchor: 'end', rotate: 0 } : { x: pos.x + gap, y: pos.y, anchor: 'start', rotate: 0 };
  }
  return dir.y < 0 ? { x: pos.x, y: pos.y - gap, anchor: 'start', rotate: -90 } : { x: pos.x, y: pos.y + gap, anchor: 'end', rotate: -90 };
}

interface SheetScene {
  components: { c: Component; layout: NonNullable<ReturnType<typeof componentLayout>> }[];
  wires: ReturnType<typeof sheetWires>;
  children: Sheet[];
  /** Link ends on this sheet whose other end is elsewhere. */
  flags: { pin: PinPlacement | undefined; stub: Vec2 | undefined; dir: Vec2 | undefined; label: string; sheet: string }[];
  world: Rect | null;
}

function buildScene(project: Project, sheetId: Id): SheetScene {
  const idx = indexProject(project);
  const comps = idx.componentsBySheet.get(sheetId) ?? [];
  const components: SheetScene['components'] = [];
  for (const c of comps) {
    const layout = componentLayout(project, c.id);
    if (layout) components.push({ c, layout });
  }
  const wires = sheetWires(project, sheetId);
  const children = childSheets(project, sheetId).filter((s) => s.sch !== undefined);

  const flags: SheetScene['flags'] = [];
  for (const link of project.links) {
    const ca = idx.component(link.a.componentId);
    const cb = idx.component(link.b.componentId);
    if (!ca || !cb) continue;
    const aHere = ca.sch.sheetId === sheetId;
    const bHere = cb.sch.sheetId === sheetId;
    if (aHere === bHere) continue;
    const here = aHere ? link.a : link.b;
    const there = aHere ? link.b : link.a;
    const thereC = aHere ? cb : ca;
    const layout = componentLayout(project, here.componentId);
    if (!layout) continue;
    const pin = layout.pins.get(here.portId);
    const stub = pin ? undefined : layout.stubs.find((s) => s.hiddenPortIds.includes(here.portId));
    const label = link.label ?? idx.endLabel(there);
    flags.push({ pin, stub: stub?.pos, dir: pin?.dir ?? stub?.dir, label, sheet: thereC.sch.sheetId === sheetId ? '' : (project.sheets.find((s) => s.id === thereC.sch.sheetId)?.name ?? '') });
  }

  const pts: Vec2[] = [];
  for (const { layout } of components) {
    const b = symbolBoundsWithPins(layout);
    pts.push({ x: b.x, y: b.y - 14 }, { x: b.x + b.width, y: b.y + b.height + 14 });
  }
  for (const w of wires) pts.push(...w.points);
  for (const s of children) if (s.sch) pts.push(s.sch.pos, { x: s.sch.pos.x + s.sch.width, y: s.sch.pos.y + s.sch.height });
  for (const f of flags) {
    const p = f.pin?.pos ?? f.stub;
    const d = f.dir;
    if (p && d) pts.push({ x: p.x + d.x * (f.label.length * 3.5 + 12), y: p.y + d.y * (f.label.length * 3.5 + 12) });
  }
  return { components, wires, children, flags, world: pts.length ? boundsOf(pts) : null };
}

/** Draw one sheet into `box` (page units). */
export function drawSheet(project: Project, sheetId: Id, box: Box): string {
  const idx = indexProject(project);
  const scene = buildScene(project, sheetId);
  if (!scene.world) {
    return text(box.x + box.w / 2, box.y + box.h / 2, 'Empty sheet', { size: 12, anchor: 'middle', fill: '#888', italic: true });
  }
  const world = { x: scene.world.x - PAD, y: scene.world.y - PAD, w: scene.world.width + 2 * PAD, h: scene.world.height + 2 * PAD };
  const { s, tx, ty } = fitTransform(world, box, MAX_SCALE);
  const out: string[] = [];

  // Sheet symbols with their hierarchical pins.
  for (const child of scene.children) {
    const g = child.sch!;
    out.push(rect(g.pos.x, g.pos.y, g.width, g.height, `fill="none" stroke="#000" stroke-width="${BODY_W}"`));
    out.push(text(g.pos.x + 4, g.pos.y + FONT_SHEET + 3, child.name, { size: FONT_SHEET, bold: true }));
    const subtree = sheetSubtreeIds(project, child.id);
    const count = subtree.reduce((n, id) => n + (idx.componentsBySheet.get(id)?.length ?? 0), 0);
    out.push(text(g.pos.x + g.width - 4, g.pos.y + FONT_SHEET + 3, `${count} component${count === 1 ? '' : 's'}`, { size: FONT_SHEET_PIN, anchor: 'end', fill: '#444' }));
    const pins = crossSheetLinks(project, child.id).map((x) => x.link.label ?? idx.endLabel(x.insideEnd));
    const maxRows = Math.max(0, Math.floor((g.height - FONT_SHEET - 10) / SHEET_PIN_LH));
    const shown = pins.length > maxRows ? pins.slice(0, Math.max(0, maxRows - 1)) : pins;
    shown.forEach((label, i) => {
      out.push(text(g.pos.x + 6, g.pos.y + FONT_SHEET + 8 + (i + 1) * SHEET_PIN_LH, `▹ ${label}`, { size: FONT_SHEET_PIN }));
    });
    if (shown.length < pins.length) {
      out.push(text(g.pos.x + 6, g.pos.y + FONT_SHEET + 8 + (shown.length + 1) * SHEET_PIN_LH, `+${pins.length - shown.length} more`, { size: FONT_SHEET_PIN, italic: true, fill: '#444' }));
    }
  }

  // Wires first so symbols sit on top.
  for (const w of scene.wires) {
    if (w.points.length < 2) continue;
    out.push(polyline(w.points, `fill="none" stroke="#000" stroke-width="${WIRE_W}" stroke-linejoin="round"`));
    if (w.link.label) {
      const a = wireLabelAnchor(w.points);
      out.push(a.horizontal ? text(a.pos.x, a.pos.y - 3, w.link.label, { size: FONT_WIRE, anchor: 'middle' }) : text(a.pos.x - 3, a.pos.y, w.link.label, { size: FONT_WIRE, anchor: 'middle', rotate: -90 }));
    }
  }

  // Symbols.
  for (const { c, layout } of scene.components) {
    const b = layout.bounds;
    const parts: string[] = [];
    parts.push(rect(b.x, b.y, b.width, b.height, `fill="#fff" stroke="#000" stroke-width="${BODY_W}"`));
    for (const pin of layout.pins.values()) {
      parts.push(line(pin.bodyPos.x, pin.bodyPos.y, pin.pos.x, pin.pos.y, `stroke="#000" stroke-width="${PIN_W}"`));
      const t = pinNamePos(pin.bodyPos, pin.dir, 2.5);
      parts.push(text(t.x, t.y, pin.portId, { size: FONT_PIN, anchor: t.anchor, baseline: 'middle', rotate: t.rotate }));
    }
    for (const stub of layout.stubs) {
      parts.push(line(stub.bodyPos.x, stub.bodyPos.y, stub.pos.x, stub.pos.y, `stroke="#000" stroke-width="${PIN_W}" stroke-dasharray="2 1.5"`));
      const t = pinNamePos(stub.bodyPos, stub.dir, 2.5);
      parts.push(text(t.x, t.y, `+${stub.count} unused`, { size: FONT_PIN, anchor: t.anchor, baseline: 'middle', rotate: t.rotate, italic: true, fill: '#444' }));
    }
    parts.push(text(b.x, b.y - 4, c.ref, { size: FONT_REF, bold: true }));
    const value = c.value ?? idx.symbolOf(c)?.name ?? '';
    if (value) parts.push(text(b.x, b.y + b.height + FONT_VALUE + 3, value, { size: FONT_VALUE, fill: '#222' }));
    const fp = idx.footprintOf(c);
    if (fp) parts.push(text(b.x, b.y + b.height + FONT_VALUE * 2 + 5, fp.model, { size: FONT_PIN, fill: '#555' }));
    out.push(group(parts.join(''), `data-ref="${esc(c.ref)}"`));
  }

  // Off-sheet flags where a wire leaves the sheet.
  for (const f of scene.flags) {
    const p = f.pin?.pos ?? f.stub;
    const d = f.dir;
    if (!p || !d) continue;
    const t = flagPos(p, d, 4);
    const label = f.sheet ? `${f.label} › ${f.sheet}` : f.label;
    out.push(text(t.x, t.y, label, { size: FONT_PIN, anchor: t.anchor, baseline: 'middle', rotate: t.rotate, italic: true }));
    out.push(line(p.x, p.y, p.x + d.x * 3, p.y + d.y * 3, `stroke="#000" stroke-width="${PIN_W}"`));
  }

  return group(out.join(''), `transform="translate(${num(tx)} ${num(ty)}) scale(${num(s)})" data-sheet="${esc(sheetPath(project, sheetId))}"`);
}

function fields(project: Project, sheet: Sheet, date: string) {
  const idx = indexProject(project);
  const comps = idx.componentsBySheet.get(sheet.id)?.length ?? 0;
  const links = sheetWires(project, sheet.id).length;
  return [
    { label: 'Project', value: project.name },
    { label: 'Sheet', value: sheetPath(project, sheet.id) },
    { label: 'Rev', value: project.rev },
    { label: 'Date', value: date },
    { label: 'Items', value: `${comps} components, ${links} wires` },
    { label: 'Tool', value: 'Datacenter EDA' },
  ];
}

/** Page-sized fragment (frame + drawing) for one sheet. */
export function schematicSheetFragment(project: Project, sheetId: Id, opts: SchematicPlotOptions = {}): string {
  const sheet = sheetOrThrow(project, sheetId);
  const date = opts.date ?? isoDate();
  const frame = plotFrame(A4_LANDSCAPE, { title: 'Schematic', fields: fields(project, sheet, date), sheet: opts.sheet, note: `Datacenter EDA · ${project.name} rev ${project.rev}` });
  return frame.markup + drawSheet(project, sheetId, frame.drawArea);
}

/** One sheet on a landscape page. */
export function schematicSvg(project: Project, sheetId: Id, opts: SchematicPlotOptions = {}): string {
  const sheet = sheetOrThrow(project, sheetId);
  return svgDocument(A4_LANDSCAPE, schematicSheetFragment(project, sheetId, opts), { title: `${project.name} — ${sheetPath(project, sheet.id)}` });
}

/** Every sheet (hierarchy order) as a stack of pages in one SVG. */
export function schematicSheetsSvg(project: Project, opts: SchematicSetOptions = {}): string {
  const sheets = sheetsInOrder(project, opts.sheetIds);
  const date = opts.date ?? isoDate();
  const pages = sheets.map((s, i) => schematicSheetFragment(project, s.id, { date, sheet: { n: i + 1, of: sheets.length } }));
  return svgPlotSet(A4_LANDSCAPE, pages, { title: `${project.name} — schematic` });
}

/** The PDF path: printable HTML, one landscape page per sheet (see print.ts). */
export function schematicSheetsHtml(project: Project, opts: SchematicSetOptions = {}): string {
  const sheets = sheetsInOrder(project, opts.sheetIds);
  const date = opts.date ?? isoDate();
  return printableHtml({
    title: `${project.name} — schematic`,
    pages: sheets.map((s, i) => ({ svg: schematicSvg(project, s.id, { date, sheet: { n: i + 1, of: sheets.length } }), orientation: 'landscape' })),
  });
}

export const schematicFileName = (project: Project, sheet?: Sheet): string =>
  `${fileSlug(project.name)}-schematic${sheet ? `-${fileSlug(sheetPath(project, sheet.id, '-'))}` : ''}.svg`;
