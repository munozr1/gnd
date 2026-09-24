/**
 * Rack elevation plots, KiCad-plot style: double frame, title block
 * (project, rev, date, rack, face), U rails with numbers, device faceplates
 * with their ports (filled when connected), vertical cable managers, in-rack
 * accessories and top entries.
 *
 * `rackElevationSvg` is one face on a portrait page; `rackElevationSheetSvg`
 * is front + rear side by side on a landscape page; `rackSheetsHtml` is the
 * PDF path: a printable HTML document with one page per rack (front + rear)
 * that opens in a new tab and calls window.print() so the user saves it as a
 * PDF from the browser's print dialog (see print.ts).
 */
import { indexProject, type ProjectIndex } from '@/model/query';
import { effectiveFace, RACK_BASE_MM, U_MM, DEFAULT_DEVICE_WIDTH_MM, DEFAULT_MANAGER_WIDTH_MM } from '@/model/routing/positions';
import type { Face, Id, PortType, Project, Rack, RackAccessory } from '@/model/types';
import { fileSlug, isoDate, naturalCompare } from './common';
import { printableHtml } from './print';
import { A4_LANDSCAPE, A4_PORTRAIT, esc, group, line, num, plotFrame, rect, svgDocument, svgPlotSet, text, type Box } from './svg';

export interface ElevationOptions {
  /** Title-block date (yyyy-mm-dd); defaults to today. */
  date?: string;
  sheet?: { n: number; of: number };
}

export interface ElevationSetOptions {
  /** Racks to plot (natural order by name when omitted: all racks). */
  rackIds?: readonly Id[];
  date?: string;
}

const RAIL_W = 16;
/** Gap between the rack frame and a manager (also holds the U numbers). */
const GUTTER = 44;
/** Roof clearance drawn above the rack for top entries. */
const ROOF_H = 70;
const TOP_ENTRY_W = 120;
const TOP_ENTRY_H = 40;

const PORT_SIZE: Record<PortType, { w: number; h: number }> = {
  SFP: { w: 14, h: 9 },
  'SFP+': { w: 14, h: 9 },
  SFP28: { w: 14, h: 9 },
  'QSFP+': { w: 19, h: 9 },
  QSFP28: { w: 19, h: 9 },
  QSFP56: { w: 19, h: 9 },
  'QSFP-DD': { w: 19, h: 9 },
  OSFP: { w: 21, h: 11 },
  RJ45: { w: 12, h: 11 },
  LC: { w: 13, h: 8 },
  'MPO-12': { w: 15, h: 8 },
};

const faceTitle = (face: Face): string => (face === 'front' ? 'Front' : 'Rear');

function rackOrThrow(idx: ProjectIndex, rackId: Id): Rack {
  const rack = idx.rack(rackId);
  if (!rack) throw new Error(`Unknown rack "${rackId}"`);
  return rack;
}

export function racksInOrder(project: Project, rackIds?: readonly Id[]): Rack[] {
  const idx = indexProject(project);
  const racks = rackIds ? rackIds.map((id) => idx.rack(id)).filter((r): r is Rack => r !== undefined) : [...project.racks];
  return racks.sort((a, b) => naturalCompare(a.name, b.name));
}

/**
 * Draw one rack face into `box` (page units). Pure markup; the caller adds
 * the frame. Sides are as seen by the viewer: the rack's left manager shows
 * on the right when looking at the rear.
 */
export function drawElevation(project: Project, rack: Rack, face: Face, box: Box): string {
  const idx = indexProject(project);
  const accessories = project.accessories.filter((a) => a.rackId === rack.id);
  const mirrored = face === 'rear';
  const viewerSide = (side: RackAccessory['side']): 'left' | 'right' | 'center' => {
    if (side === 'center' || side === undefined) return 'center';
    return mirrored ? (side === 'left' ? 'right' : 'left') : side;
  };
  const vcm = (s: 'left' | 'right') => accessories.find((a) => a.type === 'vcm' && viewerSide(a.side) === s);
  const leftVcm = vcm('left');
  const rightVcm = vcm('right');
  const mgrW = (a: RackAccessory | undefined) => (a ? (a.widthMm ?? DEFAULT_MANAGER_WIDTH_MM) : 0);
  const leftW = mgrW(leftVcm);
  const rightW = mgrW(rightVcm);
  const rackTop = rack.heightU * U_MM + RACK_BASE_MM;
  const totalW = leftW + GUTTER + rack.widthMm + GUTTER + rightW;
  const totalH = rackTop + ROOF_H;

  const headerH = 26;
  const footerH = 10;
  const avail = { w: box.w, h: box.h - headerH - footerH };
  const s = Math.min(avail.w / totalW, avail.h / totalH);
  const ox = box.x + (box.w - totalW * s) / 2;
  const oy = box.y + headerH + (avail.h - totalH * s) / 2;
  const X = (mm: number) => ox + mm * s;
  const Y = (mm: number) => oy + (totalH - mm) * s;
  const rackX0 = leftW + GUTTER;
  const rackX1 = rackX0 + rack.widthMm;
  const inset = (rack.widthMm - DEFAULT_DEVICE_WIDTH_MM) / 2;

  const out: string[] = [];
  const devices = idx.componentsInRack(rack.id);

  // Header.
  out.push(text(box.x, box.y + 12, `${rack.name} — ${faceTitle(face)}`, { size: 12, bold: true }));
  out.push(
    text(box.x, box.y + 22, `${rack.heightU}U · ${num(rack.widthMm)} × ${num(rack.depthMm)} mm · ${devices.length} device${devices.length === 1 ? '' : 's'}${rack.row ? ` · row ${rack.row}` : ''}`, {
      size: 7,
      fill: '#444',
    }),
  );

  // Managers.
  const drawManager = (a: RackAccessory | undefined, x0: number, w: number): void => {
    if (!a) return;
    out.push(rect(X(x0), Y(rackTop), w * s, rackTop * s, 'fill="#f0f0f0" stroke="#000" stroke-width="0.8"'));
    const every = U_MM * s >= 4 ? 1 : 2;
    for (let u = 1; u <= rack.heightU; u += every) {
      const y = Y(RACK_BASE_MM + (u - 1) * U_MM);
      out.push(line(X(x0) + 2, y, X(x0 + w) - 2, y, 'stroke="#bbb" stroke-width="0.4"'));
    }
    const cx = X(x0 + w / 2);
    const cy = Y(rackTop / 2);
    out.push(text(cx, cy, `VCM ${num(w)} mm`, { size: Math.min(7, Math.max(4, w * s * 0.5)), anchor: 'middle', rotate: -90, baseline: 'middle', fill: '#333' }));
  };
  drawManager(leftVcm, 0, leftW);
  drawManager(rightVcm, rackX1 + GUTTER, rightW);

  // Rack frame, plinth, rails.
  out.push(rect(X(rackX0), Y(rackTop), rack.widthMm * s, rackTop * s, 'fill="#fff" stroke="#000" stroke-width="1"'));
  out.push(rect(X(rackX0), Y(RACK_BASE_MM), rack.widthMm * s, RACK_BASE_MM * s, 'fill="#ddd" stroke="#000" stroke-width="0.8"'));
  const railL = rackX0 + inset - RAIL_W;
  const railR = rackX0 + inset + DEFAULT_DEVICE_WIDTH_MM;
  for (const rx of [railL, railR]) {
    out.push(rect(X(rx), Y(rackTop), RAIL_W * s, (rackTop - RACK_BASE_MM) * s, 'fill="#c8c8c8" stroke="#000" stroke-width="0.5"'));
  }
  // U ticks and numbers in the left gutter.
  const uPx = U_MM * s;
  const labelEvery = uPx >= 7 ? 1 : uPx >= 3.5 ? 2 : 5;
  const fontU = Math.min(6, Math.max(3.5, uPx * 0.8));
  for (let u = 1; u <= rack.heightU; u++) {
    const y0 = Y(RACK_BASE_MM + (u - 1) * U_MM);
    out.push(line(X(railL), y0, X(railL + RAIL_W), y0, 'stroke="#000" stroke-width="0.4"'));
    out.push(line(X(railR), y0, X(railR + RAIL_W), y0, 'stroke="#000" stroke-width="0.4"'));
    if (u === 1 || u % labelEvery === 0) {
      out.push(text(X(rackX0) - 3, y0 - uPx / 2, String(u), { size: fontU, anchor: 'end', baseline: 'middle', fill: '#333' }));
    }
  }

  // In-rack accessories (horizontal managers, fiber enclosures) at their U.
  for (const a of accessories) {
    if ((a.type !== 'hcm' && a.type !== 'fiber-enclosure') || a.uPosition === undefined) continue;
    if (a.face !== undefined && a.face !== face) continue;
    const h = (a.heightU ?? 1) * U_MM;
    const y0 = RACK_BASE_MM + (a.uPosition - 1) * U_MM;
    out.push(rect(X(rackX0 + inset), Y(y0 + h), DEFAULT_DEVICE_WIDTH_MM * s, h * s, 'fill="#e8e8e8" stroke="#000" stroke-width="0.6"'));
    const label = a.type === 'hcm' ? 'Horizontal cable manager' : 'Fiber enclosure';
    out.push(text(X(rackX0 + inset + 6), Y(y0 + h / 2), label, { size: Math.min(6.5, h * s * 0.5), baseline: 'middle', fill: '#333', italic: true }));
  }

  // Devices.
  for (const c of devices) {
    const p = idx.placement(c.id);
    if (!p || p.uPosition === null) continue;
    const fp = idx.footprintOf(c);
    const heightU = idx.heightUOf(c);
    const w = fp?.widthMm ?? DEFAULT_DEVICE_WIDTH_MM;
    const dx0 = rackX0 + (rack.widthMm - w) / 2;
    const y0 = RACK_BASE_MM + (p.uPosition - 1) * U_MM;
    const h = heightU * U_MM;
    const facing = p.face === face;
    out.push(
      rect(X(dx0), Y(y0 + h), w * s, h * s, facing ? 'fill="#fafafa" stroke="#000" stroke-width="0.8"' : 'fill="#dcdcdc" stroke="#000" stroke-width="0.8" stroke-dasharray="2 1"'),
    );
    const hPx = h * s;
    const fontRef = Math.min(8, Math.max(4, hPx * 0.55));
    out.push(text(X(dx0 + 6), Y(y0 + h / 2), c.ref, { size: fontRef, bold: true, baseline: 'middle' }));
    const model = fp ? fp.model : 'no model';
    const modelText = facing ? model : `${model} (rear of device)`;
    if (hPx >= 7) out.push(text(X(dx0 + w - 6), Y(y0 + h / 2), modelText, { size: Math.min(6.5, fontRef * 0.85), anchor: 'end', baseline: 'middle', fill: '#333' }));

    if (!fp) continue;
    for (const port of fp.ports) {
      if (effectiveFace(port.face, p.face) !== face) continue;
      const size = PORT_SIZE[port.type] ?? { w: 12, h: 8 };
      const px = dx0 + (facing ? port.pos.x : w - port.pos.x);
      const py = y0 + port.pos.y;
      const occupied = !idx.isPortFree(c.id, port.id);
      const optic = c.optics[port.id] !== undefined;
      const fill = occupied ? (optic ? '#111' : '#666') : '#fff';
      const stroke = occupied ? '#000' : '#777';
      out.push(rect(X(px - size.w / 2), Y(py + size.h / 2), size.w * s, size.h * s, `fill="${fill}" stroke="${stroke}" stroke-width="0.4"`));
    }
  }

  // Roof line and top entries.
  out.push(line(X(rackX0 - 10), Y(rackTop), X(rackX1 + 10), Y(rackTop), 'stroke="#000" stroke-width="1"'));
  for (const a of accessories) {
    if (a.type !== 'top-entry') continue;
    const vs = viewerSide(a.side);
    const cx = rackX0 + rack.widthMm * (vs === 'left' ? 0.22 : vs === 'right' ? 0.78 : 0.5);
    out.push(rect(X(cx - TOP_ENTRY_W / 2), Y(rackTop + TOP_ENTRY_H), TOP_ENTRY_W * s, TOP_ENTRY_H * s, 'fill="#bbb" stroke="#000" stroke-width="0.6"'));
    out.push(text(X(cx), Y(rackTop + TOP_ENTRY_H / 2), 'top entry', { size: Math.min(5.5, TOP_ENTRY_W * s * 0.14), anchor: 'middle', baseline: 'middle', fill: '#fff' }));
  }

  // Legend.
  out.push(text(box.x, box.y + box.h - 2, 'Ports: filled = connected (black with optic, grey without); outline = free. Dashed faceplate = device faces the other way.', { size: 5.5, fill: '#444' }));
  return group(out.join(''), `data-rack="${esc(rack.name)}" data-face="${face}"`);
}

function fields(project: Project, rack: Rack, face: Face | 'both', date: string) {
  return [
    { label: 'Project', value: project.name },
    { label: 'Rack', value: face === 'both' ? `${rack.name} (front / rear)` : `${rack.name} (${faceTitle(face)})` },
    { label: 'Rev', value: project.rev },
    { label: 'Date', value: date },
    { label: 'Height', value: `${rack.heightU}U` },
    { label: 'Row', value: rack.row ?? '—' },
  ];
}

/** One rack face on a portrait page. */
export function rackElevationSvg(project: Project, rackId: Id, face: Face, opts: ElevationOptions = {}): string {
  const rack = rackOrThrow(indexProject(project), rackId);
  const date = opts.date ?? isoDate();
  const frame = plotFrame(A4_PORTRAIT, { title: 'Rack elevation', fields: fields(project, rack, face, date), sheet: opts.sheet, note: `Datacenter EDA · ${project.name} rev ${project.rev}` });
  const body = drawElevation(project, rack, face, frame.drawArea);
  return svgDocument(A4_PORTRAIT, frame.markup + body, { title: `${project.name} — ${rack.name} ${faceTitle(face)} elevation` });
}

/** Page-sized fragment: front and rear side by side on a landscape page. */
export function rackElevationSheetFragment(project: Project, rackId: Id, opts: ElevationOptions = {}): string {
  const rack = rackOrThrow(indexProject(project), rackId);
  const date = opts.date ?? isoDate();
  const frame = plotFrame(A4_LANDSCAPE, { title: 'Rack elevation', fields: fields(project, rack, 'both', date), sheet: opts.sheet, note: `Datacenter EDA · ${project.name} rev ${project.rev}` });
  const a = frame.drawArea;
  const gap = 16;
  const half = (a.w - gap) / 2;
  const front = drawElevation(project, rack, 'front', { x: a.x, y: a.y, w: half, h: a.h });
  const rear = drawElevation(project, rack, 'rear', { x: a.x + half + gap, y: a.y, w: half, h: a.h });
  const divider = line(a.x + half + gap / 2, a.y, a.x + half + gap / 2, a.y + a.h, 'stroke="#999" stroke-width="0.5" stroke-dasharray="3 3"');
  return frame.markup + front + divider + rear;
}

/** Front + rear of one rack on a landscape page. */
export function rackElevationSheetSvg(project: Project, rackId: Id, opts: ElevationOptions = {}): string {
  const rack = rackOrThrow(indexProject(project), rackId);
  return svgDocument(A4_LANDSCAPE, rackElevationSheetFragment(project, rackId, opts), { title: `${project.name} — ${rack.name} elevation` });
}

/** Every rack (or the given ones) as a stack of landscape pages in one SVG. */
export function rackElevationSheetsSvg(project: Project, opts: ElevationSetOptions = {}): string {
  const racks = racksInOrder(project, opts.rackIds);
  const date = opts.date ?? isoDate();
  const pages = racks.map((r, i) => rackElevationSheetFragment(project, r.id, { date, sheet: { n: i + 1, of: racks.length } }));
  return svgPlotSet(A4_LANDSCAPE, pages, { title: `${project.name} — rack elevations` });
}

/**
 * The PDF path: a printable HTML document, one landscape page per rack with
 * front and rear elevations. Open it in a new tab; it calls window.print()
 * and the user chooses "Save as PDF".
 */
export function rackSheetsHtml(project: Project, opts: ElevationSetOptions = {}): string {
  const racks = racksInOrder(project, opts.rackIds);
  const date = opts.date ?? isoDate();
  return printableHtml({
    title: `${project.name} — rack elevations`,
    pages: racks.map((r, i) => ({ svg: rackElevationSheetSvg(project, r.id, { date, sheet: { n: i + 1, of: racks.length } }), orientation: 'landscape' })),
  });
}

export const rackElevationFileName = (project: Project, rack: Rack, face?: Face): string =>
  `${fileSlug(project.name)}-rack-${fileSlug(rack.name)}${face ? `-${face}` : ''}.svg`;
