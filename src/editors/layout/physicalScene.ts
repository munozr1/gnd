import { cableLegsFloor, furcationFloorPos, resolveCableOf, type CableSide, type PortRef } from '@/model/cables';
import { boundsOf, type Rect } from '@/model/geometry';
import { indexProject, type ProjectIndex } from '@/model/query';
import { rackCenter, rackFloorRect, routeFloorEndpoints, routePath3d } from '@/model/routing';
import type { Cable, Project, RoutingLayer, SelectionItem, Vec2 } from '@/model/types';
import { unionRects } from './viewport';

export function floorBounds(project: Project): Rect {
  return unionRects([boundsOf(project.room.outline), ...project.racks.map(rackFloorRect), ...project.trays.filter((t) => t.points.length).map((t) => boundsOf(t.points))]) ?? { x: 0, y: 0, width: 12000, height: 8000 };
}
/** Racks holding the plugged legs of an installed cable. */
function cableRackIds(idx: ProjectIndex, cable: Cable): string[] {
  const ids = new Set<string>();
  for (const plug of cable.plugs) {
    if (plug.componentId === null) continue;
    const rack = idx.rackOfComponent(plug.componentId);
    if (rack) ids.add(rack.id);
  }
  return [...ids];
}
export function selectedRackIds(project: Project, selection: readonly SelectionItem[]): string[] {
  const idx = indexProject(project), ids = new Set<string>();
  for (const item of selection) {
    if (item.kind === 'rack' && idx.rack(item.id)) ids.add(item.id);
    if (item.kind === 'component') { const rack = idx.rackOfComponent(item.id); if (rack) ids.add(rack.id); }
    if (item.kind === 'link') {
      const link = idx.link(item.id);
      if (link) for (const end of [link.a, link.b]) { const rack = idx.rackOfComponent(end.componentId); if (rack) ids.add(rack.id); }
    }
    if (item.kind === 'cable') { const cable = idx.cable(item.id); if (cable) for (const id of cableRackIds(idx, cable)) ids.add(id); }
  }
  return [...ids];
}
export function physicalSelectionBounds(project: Project, selection: readonly SelectionItem[]): Rect | null {
  const idx = indexProject(project);
  const rects = selectedRackIds(project, selection).flatMap((id) => { const rack = idx.rack(id); return rack ? [rackFloorRect(rack)] : []; });
  for (const item of selection) {
    if (item.kind === 'tray') { const tray = project.trays.find((t) => t.id === item.id); if (tray?.points.length) rects.push(boundsOf(tray.points)); }
    if (item.kind === 'link') { const path = routePath3d(project, item.id); if (path) rects.push(boundsOf(path.points.map((p) => ({ x: p.x, y: p.z })))); }
    if (item.kind === 'cable') {
      const cable = idx.cable(item.id), entry = cable && floorCable(project, idx, cable);
      const points = entry ? [...entry.jacket, ...entry.legs.flatMap((l) => l.points), ...entry.furcations.map((f) => f.pos)] : [];
      if (points.length) rects.push(boundsOf(points));
    }
  }
  return unionRects(rects);
}
/** Plan links between racked devices. Links a cable owns are left out: the cable draws them as its jacket and legs (see `floorCables`). */
export function floorLinks(project: Project) {
  const idx = indexProject(project);
  return project.links.flatMap((link) => {
    if (link.cableId !== undefined && idx.cable(link.cableId)) return [];
    const a = idx.rackOfComponent(link.a.componentId), b = idx.rackOfComponent(link.b.componentId);
    if (!a || !b) return [];
    const route = idx.route(link.id), path = route && routePath3d(project, link.id);
    const points: Vec2[] = path ? path.points.map((p) => ({ x: p.x, y: p.z })) : [rackCenter(a), rackCenter(b)];
    return [{ link, points, routed: !!path, color: idx.cableOf(link)?.color ?? '#80b9c9', layers: route ? [...new Set(route.segments.map((s) => s.layer))] : [] }];
  });
}

export interface FloorFurcation {
  side: CableSide;
  pos: Vec2;
  /** true when the user placed it (`Cable.furcation`); false when it follows the ports at the breakout length. */
  pinned: boolean;
}
export interface FloorCableLeg {
  side: CableSide;
  leg: number;
  ref: PortRef;
  /** Furcation point → the leg's port. */
  points: Vec2[];
}
export interface FloorCable {
  cable: Cable;
  label: string;
  fiberCount: number;
  color: string;
  /** The jacket follows a route (`Project.routes[cable.id]`) rather than a straight airwire. */
  routed: boolean;
  layers: RoutingLayer[];
  /** Jacket polyline from side A's port (or furcation) to side B's furcation (or port): the route's floor projection when routed, else one airwire. Empty when a side has no placed port. */
  jacket: Vec2[];
  legs: FloorCableLeg[];
  furcations: FloorFurcation[];
  /** Racks the plugged legs sit in (for the 'selection' ratsnest mode). */
  rackIds: string[];
}

/** Floor-plan drawing of one installed cable, or null when nothing of it can be placed on the floor. */
export function floorCable(project: Project, idx: ProjectIndex, cable: Cable): FloorCable | null {
  const resolved = resolveCableOf(project, cable);
  if (!resolved) return null;
  const furcations: FloorFurcation[] = [], legs: FloorCableLeg[] = [];
  for (const side of ['A', 'B'] as const) {
    const f = furcationFloorPos(project, cable, side);
    if (!f) continue;
    furcations.push({ side, pos: f.pos, pinned: f.pinned });
    for (const leg of cableLegsFloor(project, cable, side)) legs.push({ side, leg: leg.leg, ref: leg.ref, points: [f.pos, leg.pos] });
  }
  const route = idx.route(cable.id), path = route && routePath3d(project, cable.id);
  let jacket: Vec2[] = [];
  if (path) jacket = path.points.map((p) => ({ x: p.x, y: p.z }));
  else { const ends = routeFloorEndpoints(project, cable.id, 'cable'); if (ends) jacket = [ends.start, ends.end]; }
  if (!jacket.length && !legs.length && !furcations.length) return null;
  return { cable, label: cable.label, fiberCount: resolved.fiberCount, color: resolved.color, routed: !!path, layers: route ? [...new Set(route.segments.map((s) => s.layer))] : [], jacket, legs, furcations, rackIds: cableRackIds(idx, cable) };
}
/** Every installed cable with something to draw on the floor: jacket, legs and furcation nodes. */
export function floorCables(project: Project): FloorCable[] {
  const idx = indexProject(project);
  return (project.cables ?? []).flatMap((cable) => { const entry = floorCable(project, idx, cable); return entry ? [entry] : []; });
}
export function stroke(ctx: CanvasRenderingContext2D, points: readonly Vec2[], color: string, width: number, closed = false) {
  if (!points.length) return;
  ctx.beginPath(); ctx.moveTo(points[0]!.x, points[0]!.y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  if (closed) ctx.closePath();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}
export function caption(ctx: CanvasRenderingContext2D, text: string, p: Vec2, size: number, color = '#d9e4ef') {
  ctx.fillStyle = color; ctx.font = `${size}px ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, p.x, p.y);
}
/** A furcation node: a hollow circle while it follows the ports, a filled square once pinned. `r` is the half-size in world units. */
export function furcationGlyph(ctx: CanvasRenderingContext2D, p: Vec2, pinned: boolean, r: number, color: string, lineWidth: number) {
  ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
  if (pinned) { ctx.fillStyle = color; ctx.fillRect(p.x - r, p.y - r, 2 * r, 2 * r); return; }
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = '#141e28'; ctx.fill(); ctx.stroke();
}
/** A one-line label box whose bottom-left corner sits at `p` (sizes in screen pixels via `zoom`). */
export function tooltip(ctx: CanvasRenderingContext2D, text: string, p: Vec2, zoom: number) {
  const size = 11 / zoom, padX = 6 / zoom, padY = 4 / zoom;
  ctx.font = `${size}px ui-monospace, monospace`;
  const w = ctx.measureText(text).width + 2 * padX, h = size + 2 * padY;
  ctx.fillStyle = '#0f1720ee'; ctx.fillRect(p.x, p.y - h, w, h);
  ctx.strokeStyle = '#44566a'; ctx.lineWidth = 1 / zoom; ctx.strokeRect(p.x, p.y - h, w, h);
  ctx.fillStyle = '#d9e4ef'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, p.x + padX, p.y - h / 2);
}
