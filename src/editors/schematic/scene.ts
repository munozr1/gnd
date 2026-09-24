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
export type Hit =
  | { kind: 'pin'; end: LinkEnd; pos: Vec2; dir: Vec2 }
  | { kind: 'stub'; id: string }
  | { kind: 'component' | 'sheet'; id: string }
  | { kind: 'link'; id: string; segment: number };
interface IndexedHit extends BBox { hit: Hit; a?: Vec2; b?: Vec2 }

export function buildScene(project: Project, sheetId: string) {
  const idx = indexProject(project);
  const entries: IndexedHit[] = [];
  const devices: DeviceDrawing[] = [];
  const sheets: SheetDrawing[] = [];
  const wires: WireDrawing[] = sheetWires(project, sheetId);
  const itemBounds = new Map<string, Rect>();
  let bounds: Rect | null = null;
  const remember = (kind: string, id: string, rect: Rect) => {
    itemBounds.set(`${kind}:${id}`, rect);
    bounds = unionRect(bounds, rect);
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
    for (let i = 0; i < wire.points.length - 1; i++) entries.push({
      ...bboxOfPoints(wire.points[i]!, wire.points[i + 1]!),
      hit: { kind: 'link', id: wire.link.id, segment: i }, a: wire.points[i]!, b: wire.points[i + 1]!,
    });
  }
  return { devices, sheets, wires, itemBounds, bounds, index: createSpatialIndex(entries) };
}
export type Scene = ReturnType<typeof buildScene>;

export function hitScene(scene: Scene, point: Vec2, tolerance: number): Hit | null {
  const hits = scene.index.search(bboxOfPoint(point, tolerance));
  const pins = hits.filter((h) => h.hit.kind === 'pin').sort((a, b) =>
    Math.hypot(a.minX - point.x, a.minY - point.y) - Math.hypot(b.minX - point.x, b.minY - point.y));
  const pin = pins.find((h) => Math.hypot(h.minX - point.x, h.minY - point.y) <= tolerance);
  if (pin) return pin.hit;
  const bodies = hits.filter((h) => h.hit.kind !== 'link' && h.hit.kind !== 'pin'
    && point.x >= h.minX && point.x <= h.maxX && point.y >= h.minY && point.y <= h.maxY);
  const body = bodies.find((h) => h.hit.kind === 'stub') ?? bodies.at(-1);
  if (body) return body.hit;
  let best: { hit: Hit; dist: number } | null = null;
  for (const h of hits) {
    if (h.hit.kind !== 'link' || !h.a || !h.b) continue;
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

export function selectionBounds(scene: Scene, items: readonly SelectionItem[]): Rect | null {
  return items.reduce<Rect | null>((b, item) => unionRect(b, scene.itemBounds.get(item.kind === 'waypoint' ? `link:${item.routeId}` : `${item.kind}:${item.id}`) ?? null), null);
}

export function selectionSheet(project: Project, items: readonly SelectionItem[]): string | undefined {
  const idx = indexProject(project);
  for (const item of items) {
    if (item.kind === 'component') return idx.component(item.id)?.sch.sheetId;
    if (item.kind === 'link') {
      const link = idx.link(item.id);
      if (link) return idx.component(link.a.componentId)?.sch.sheetId;
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
    return [{ kind: key.slice(0, split) as 'component' | 'sheet' | 'link', id: key.slice(split + 1) }];
  });
}
