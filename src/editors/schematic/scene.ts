import { cableSchematicDrawing, legsLinkedTo, type CableSchematicDrawing, type CableSide } from '@/model/cables';
import { boundsOf, closestPointOnSegment, type Rect } from '@/model/geometry';
import { indexProject } from '@/model/query';
import { childSheets, componentLayout, crossSheetLinks, pinEndpoint, sheetWires, symbolBoundsWithPins } from '@/model/schematic';
import type { Component, Link, LinkEnd, Project, SelectionItem, Sheet, Vec2 } from '@/model/types';
import type { SymbolLayout } from '@/model/schematic';
import { bboxOfPoint, bboxOfPoints, bboxOfRect, createSpatialIndex, type BBox } from './spatial';
import { padRect, unionRect } from './viewport';

export interface DeviceDrawing { component: Component; layout: SymbolLayout }
export interface SheetDrawing { sheet: Sheet; rect: Rect; pins: string[] }
export interface WireDrawing { link: Link; points: Vec2[]; offSheetLabel?: string }
/**
 * Every part of a cable (jacket, fan glyph, each leg) hits the whole cable
 * ({ kind: 'cable', id }); the part is kept so hover can light one leg's
 * fiber path.
 */
export type CableHit =
  | { kind: 'cable'; id: string; part: 'jacket' }
  | { kind: 'cable'; id: string; part: 'glyph'; side: CableSide }
  | { kind: 'cable'; id: string; part: 'leg'; side: CableSide; leg: number };
export type Hit =
  | { kind: 'pin'; end: LinkEnd; pos: Vec2; dir: Vec2 }
  | { kind: 'stub'; id: string }
  | { kind: 'component' | 'sheet'; id: string }
  | { kind: 'link'; id: string; segment: number }
  | CableHit;
/** Segment hits carry `a`/`b` and are picked by distance; the rest are bodies picked by containment. */
interface IndexedHit extends BBox { hit: Hit; a?: Vec2; b?: Vec2 }

/** Half-size of the furcation glyph's hit box. */
const GLYPH_HIT = 6;
/** Half-size of the 'NF · Mch' badge's hit box (an 11-unit-high rounded label, about 40 wide). */
const BADGE_HIT = { x: 20, y: 5.5 };

/** Key of one leg for highlight sets: 'B:2'. */
export const legKey = (side: CableSide, leg: number): string => `${side}:${leg}`;

/**
 * Legs to light for a hovered cable part: a leg lights itself plus the legs
 * on the other side that carry its fibers (through the strand map; the
 * jacket always lights too); the jacket or a glyph lights the whole cable.
 */
export function hoverLegs(d: CableSchematicDrawing, hit: CableHit): 'all' | Set<string> {
  if (hit.part !== 'leg') return 'all';
  const other = hit.side === 'A' ? 'B' : 'A';
  return new Set([legKey(hit.side, hit.leg), ...legsLinkedTo(d.resolved, hit.side, hit.leg).map((leg) => legKey(other, leg))]);
}

export function buildScene(project: Project, sheetId: string) {
  const idx = indexProject(project);
  const entries: IndexedHit[] = [];
  const devices: DeviceDrawing[] = [];
  const sheets: SheetDrawing[] = [];
  // Links a cable owns are drawn as part of that cable (jacket + fan), never as plain wires.
  const wires: WireDrawing[] = sheetWires(project, sheetId).filter((w) => !w.link.cableId);
  const cables: CableSchematicDrawing[] = [];
  /** Link id → id of the cable drawn on this sheet that owns it (a selected / revealed link then lights its cable). */
  const cableOfLink = new Map<string, string>();
  const itemBounds = new Map<string, Rect>();
  let bounds: Rect | null = null;
  const remember = (kind: string, id: string, rect: Rect) => {
    itemBounds.set(`${kind}:${id}`, rect);
    bounds = unionRect(bounds, rect);
  };
  const segments = (points: readonly Vec2[], hit: (segment: number) => Hit) => {
    for (let i = 0; i < points.length - 1; i++) entries.push({ ...bboxOfPoints(points[i]!, points[i + 1]!), hit: hit(i), a: points[i]!, b: points[i + 1]! });
  };
  for (const component of idx.componentsBySheet.get(sheetId) ?? []) {
    const layout = componentLayout(project, component.id);
    if (!layout) continue;
    devices.push({ component, layout });
    remember('component', component.id, padRect(symbolBoundsWithPins(layout), 18));
    entries.push({ ...bboxOfRect(layout.bounds), hit: { kind: 'component', id: component.id } });
    for (const pin of layout.pins.values()) entries.push({
      ...bboxOfPoint(pin.pos, 0),
      hit: { kind: 'pin', end: { componentId: component.id, portId: pin.portId }, pos: pin.pos, dir: pin.dir },
    });
    for (const stub of layout.stubs) entries.push({
      ...bboxOfRect({ x: stub.pos.x - 22, y: stub.pos.y - 4, width: 44, height: 8 }),
      hit: { kind: 'stub', id: component.id },
    });
  }
  for (const sheet of childSheets(project, sheetId)) {
    const pins = crossSheetLinks(project, sheet.id).map(({ insideEnd }) => idx.endLabel(insideEnd));
    const rect = { ...(sheet.sch?.pos ?? { x: 0, y: 0 }), width: sheet.sch?.width ?? 160, height: sheet.sch?.height ?? 100 };
    sheets.push({ sheet, rect, pins });
    remember('sheet', sheet.id, rect);
    entries.push({ ...bboxOfRect(rect), hit: { kind: 'sheet', id: sheet.id } });
  }
  // Only draw the endpoint that lives directly on this sheet. Subtree boundary
  // helpers alone omit parent-to-child links, which still need an off-sheet stub.
  for (const link of project.links) {
    if (link.cableId) continue;
    const a = idx.component(link.a.componentId);
    const b = idx.component(link.b.componentId);
    if (!a || !b || (a.sch.sheetId === sheetId) === (b.sch.sheetId === sheetId)) continue;
    const inside = a.sch.sheetId === sheetId ? link.a : link.b;
    const outside = inside === link.a ? link.b : link.a;
    const layout = componentLayout(project, inside.componentId);
    const pin = layout && pinEndpoint(layout, inside.portId);
    if (!pin) continue;
    const end = { x: pin.pos.x + pin.dir.x * 60, y: pin.pos.y + pin.dir.y * 60 };
    const name = project.sheets.find((s) => s.id === idx.component(outside.componentId)?.sch.sheetId)?.name ?? 'Sheet';
    wires.push({ link, points: [pin.pos, end], offSheetLabel: `${idx.endLabel(outside)} ▸ ${name}` });
  }
  for (const wire of wires) {
    if (!wire.points.length) continue;
    remember('link', wire.link.id, padRect(boundsOf(wire.points), 10));
    segments(wire.points, (segment) => ({ kind: 'link', id: wire.link.id, segment }));
  }
  for (const cable of project.cables) {
    const drawing = cableSchematicDrawing(project, cable, sheetId);
    if (!drawing) continue;
    cables.push(drawing);
    const id = cable.id;
    const points: Vec2[] = [...drawing.jacket, drawing.badge.pos];
    segments(drawing.jacket, () => ({ kind: 'cable', id, part: 'jacket' }));
    // The badge is a body hit so that it still picks the cable where the jacket crosses a symbol (bodies beat segments).
    entries.push({ ...bboxOfRect({ x: drawing.badge.pos.x - BADGE_HIT.x, y: drawing.badge.pos.y - BADGE_HIT.y, width: 2 * BADGE_HIT.x, height: 2 * BADGE_HIT.y }), hit: { kind: 'cable', id, part: 'jacket' } });
    for (const end of [drawing.ends.A, drawing.ends.B]) {
      if (end.kind !== 'fan') continue;
      entries.push({ ...bboxOfPoint(end.anchor, GLYPH_HIT), hit: { kind: 'cable', id, part: 'glyph', side: end.side } });
      for (const leg of end.legs) {
        points.push(...leg.points);
        segments(leg.points, () => ({ kind: 'cable', id, part: 'leg', side: end.side, leg: leg.leg }));
      }
    }
    remember('cable', id, padRect(boundsOf(points), 10));
    for (const link of idx.linksOfCable(id)) cableOfLink.set(link.id, id);
  }
  return { devices, sheets, wires, cables, cableOfLink, itemBounds, bounds, index: createSpatialIndex(entries) };
}
export type Scene = ReturnType<typeof buildScene>;

export function hitScene(scene: Scene, point: Vec2, tolerance: number): Hit | null {
  const hits = scene.index.search(bboxOfPoint(point, tolerance));
  const pins = hits.filter((h) => h.hit.kind === 'pin').sort((a, b) =>
    Math.hypot(a.minX - point.x, a.minY - point.y) - Math.hypot(b.minX - point.x, b.minY - point.y));
  const pin = pins.find((h) => Math.hypot(h.minX - point.x, h.minY - point.y) <= tolerance);
  if (pin) return pin.hit;
  const bodies = hits.filter((h) => h.hit.kind !== 'pin' && !h.a
    && point.x >= h.minX && point.x <= h.maxX && point.y >= h.minY && point.y <= h.maxY);
  const body = bodies.find((h) => h.hit.kind === 'stub') ?? bodies.at(-1);
  if (body) return body.hit;
  let best: { hit: Hit; dist: number } | null = null;
  for (const h of hits) {
    if (!h.a || !h.b) continue;
    const dist = closestPointOnSegment(point, h.a, h.b).dist;
    if (dist <= tolerance && (!best || dist < best.dist)) best = { hit: h.hit, dist };
  }
  return best?.hit ?? null;
}

export function hitItem(hit: Hit): SelectionItem {
  if (hit.kind === 'pin') return { kind: 'component', id: hit.end.componentId };
  if (hit.kind === 'stub') return { kind: 'component', id: hit.id };
  return { kind: hit.kind, id: hit.id };
}

/** Scene key of a selection item; a link a cable owns resolves to that cable, which is what the scene draws for it. */
function sceneKey(scene: Scene, item: SelectionItem): string {
  if (item.kind === 'waypoint') return `link:${item.routeId}`;
  if (item.kind === 'link') {
    const cableId = scene.cableOfLink.get(item.id);
    if (cableId !== undefined) return `cable:${cableId}`;
  }
  return `${item.kind}:${item.id}`;
}

/** Ids of the cables the selection lights: selected cables plus the owners of selected links. */
export function selectedCables(scene: Scene, items: readonly SelectionItem[]): Set<string> {
  const out = new Set<string>();
  for (const item of items) {
    const key = sceneKey(scene, item);
    if (key.startsWith('cable:')) out.add(key.slice('cable:'.length));
  }
  return out;
}

export function selectionBounds(scene: Scene, items: readonly SelectionItem[]): Rect | null {
  return items.reduce<Rect | null>((b, item) => unionRect(b, scene.itemBounds.get(sceneKey(scene, item)) ?? null), null);
}

export function selectionSheet(project: Project, items: readonly SelectionItem[]): string | undefined {
  const idx = indexProject(project);
  for (const item of items) {
    if (item.kind === 'component') return idx.component(item.id)?.sch.sheetId;
    if (item.kind === 'link') {
      const link = idx.link(item.id);
      if (link) return idx.component(link.a.componentId)?.sch.sheetId;
    }
    if (item.kind === 'cable') {
      // A cable lives wherever its first plugged leg is; an unplugged one has no sheet.
      const plug = idx.cable(item.id)?.plugs.find((p) => p.componentId !== null);
      if (plug?.componentId) return idx.component(plug.componentId)?.sch.sheetId;
    }
    if (item.kind === 'sheet') {
      const sheet = project.sheets.find((s) => s.id === item.id);
      return sheet?.parentId ?? sheet?.id;
    }
  }
  return undefined;
}

export function boxSelection(scene: Scene, rect: Rect): SelectionItem[] {
  return [...scene.itemBounds].flatMap(([key, b]) => {
    if (b.x < rect.x || b.y < rect.y || b.x + b.width > rect.x + rect.width || b.y + b.height > rect.y + rect.height) return [];
    const split = key.indexOf(':');
    return [{ kind: key.slice(0, split) as 'component' | 'sheet' | 'link' | 'cable', id: key.slice(split + 1) }];
  });
}
