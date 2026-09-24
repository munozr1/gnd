import { boundsOf, type Rect } from '@/model/geometry';
import { indexProject } from '@/model/query';
import { rackCenter, rackFloorRect, routePath3d } from '@/model/routing';
import type { Project, SelectionItem, Vec2 } from '@/model/types';
import { unionRects } from './viewport';

export function floorBounds(project: Project): Rect {
  return unionRects([boundsOf(project.room.outline), ...project.racks.map(rackFloorRect), ...project.trays.filter((t) => t.points.length).map((t) => boundsOf(t.points))]) ?? { x: 0, y: 0, width: 12000, height: 8000 };
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
  }
  return [...ids];
}
export function physicalSelectionBounds(project: Project, selection: readonly SelectionItem[]): Rect | null {
  const idx = indexProject(project);
  const rects = selectedRackIds(project, selection).flatMap((id) => { const rack = idx.rack(id); return rack ? [rackFloorRect(rack)] : []; });
  for (const item of selection) {
    if (item.kind === 'tray') { const tray = project.trays.find((t) => t.id === item.id); if (tray?.points.length) rects.push(boundsOf(tray.points)); }
    if (item.kind === 'link') { const path = routePath3d(project, item.id); if (path) rects.push(boundsOf(path.points.map((p) => ({ x: p.x, y: p.z })))); }
  }
  return unionRects(rects);
}
export function floorLinks(project: Project) {
  const idx = indexProject(project);
  return project.links.flatMap((link) => {
    const a = idx.rackOfComponent(link.a.componentId), b = idx.rackOfComponent(link.b.componentId);
    if (!a || !b) return [];
    const route = idx.route(link.id), path = route && routePath3d(project, link.id);
    const points: Vec2[] = path ? path.points.map((p) => ({ x: p.x, y: p.z })) : [rackCenter(a), rackCenter(b)];
    return [{ link, points, routed: !!path, color: idx.cableOf(link)?.color ?? '#80b9c9', layers: route ? [...new Set(route.segments.map((s) => s.layer))] : [] }];
  });
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
