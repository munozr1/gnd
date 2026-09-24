import { isPatchFrame } from '@/commands/placement';
import { boundsOf } from '@/model/geometry';
import { indexProject } from '@/model/query';
import { portWorldPos, rackCenter, rackFloorRect, rackLocalToFloor, rackTopMm, routePath3d, U_MM } from '@/model/routing';
import type { Project, RoutingLayer, SelectionItem, Vec3 } from '@/model/types';
import { unionRects } from '@/editors/layout/viewport';

export type V3 = [number, number, number];
export interface BoxPart { target: SelectionItem; position: V3; size: V3; rotation: number; color: string }
export interface CablePart { id: string; points: V3[]; radius: number; bendRadius: number; color: string; layers: RoutingLayer[]; routed: boolean }
export const metres = (p: Vec3): V3 => [p.x / 1000, p.y / 1000, p.z / 1000];

/** Scene data is independent of React/WebGL and shares the model's port/path math. */
export function buildPhysicalScene(project: Project) {
  const idx = indexProject(project);
  const frames: BoxPart[] = [], devices: BoxPart[] = [], ports: BoxPart[] = [], doors: BoxPart[] = [], accessories: BoxPart[] = [];
  const labels: { id: string; text: string; position: V3 }[] = [];
  for (const rack of project.racks) {
    const target: SelectionItem = { kind: 'rack', id: rack.id }, top = rackTopMm(rack), rotation = -rack.rotationDeg * Math.PI / 180;
    const part = (across: number, y: number, depth: number, width: number, height: number, length: number, color = '#52687b'): BoxPart => {
      const p = rackLocalToFloor(rack, { across, depth });
      return { target, position: [p.x / 1000, y / 1000, p.y / 1000], size: [width / 1000, height / 1000, length / 1000], rotation, color };
    };
    // A patch frame is an open frame: warm posts and bars, and no door to hide the panels.
    const frame = isPatchFrame(rack);
    for (const x of [20, rack.widthMm - 20]) for (const z of [20, rack.depthMm - 20]) frames.push(part(x, top / 2, z, 35, top, 35, frame ? '#8a7440' : '#52687b'));
    for (const y of [15, top - 15]) frames.push(part(rack.widthMm / 2, y, rack.depthMm / 2, rack.widthMm, 30, rack.depthMm, frame ? '#5c4d2c' : '#344a5c'));
    if (!frame) doors.push(part(rack.widthMm / 2, top / 2, rack.depthMm + 4, rack.widthMm - 30, top - 70, 8, '#6d8f9e'));
    const center = rackCenter(rack);
    labels.push({ id: rack.id, text: rack.name, position: [center.x / 1000, top / 1000 + 0.14, center.y / 1000] });
    for (const acc of project.accessories.filter((a) => a.rackId === rack.id)) {
      const sideX = acc.side === 'left' ? -(acc.widthMm ?? 152) / 2 : acc.side === 'right' ? rack.widthMm + (acc.widthMm ?? 152) / 2 : rack.widthMm / 2;
      const isVcm = acc.type === 'vcm', height = isVcm ? top : (acc.heightU ?? 1) * U_MM;
      const box = part(isVcm ? sideX : rack.widthMm / 2, isVcm ? top / 2 : acc.type === 'top-entry' ? top + 8 : ((acc.uPosition ?? 1) - 1) * U_MM + height / 2, rack.depthMm - 65, isVcm ? acc.widthMm ?? 152 : acc.type === 'top-entry' ? 120 : 482.6, acc.type === 'top-entry' ? 16 : height, 110, '#8f7543');
      accessories.push({ ...box, target: { kind: 'accessory', id: acc.id } });
    }
    for (const c of idx.componentsInRack(rack.id)) {
      const placement = idx.placement(c.id), fp = idx.footprintOf(c);
      if (placement?.uPosition == null) continue;
      const height = (fp?.heightU ?? 1) * U_MM, depth = Math.min(fp?.depthMm ?? 600, rack.depthMm);
      const centerDepth = placement.face === 'front' ? rack.depthMm - depth / 2 : depth / 2;
      devices.push({ ...part(rack.widthMm / 2, (placement.uPosition - 1) * U_MM + height / 2, centerDepth, fp?.widthMm ?? 482.6, height - 2, depth, idx.symbolOf(c)?.kind === 'switch' ? '#4b889e' : '#597080'), target: { kind: 'component', id: c.id } });
      for (const port of fp?.ports ?? []) {
        const p = portWorldPos(project, c.id, port.id);
        if (!p) continue;
        const used = !idx.isPortFree(c.id, port.id), optic = !!c.optics[port.id];
        ports.push({ target: { kind: 'component', id: c.id }, position: metres(p), size: [port.type === 'RJ45' ? 0.013 : 0.009, 0.009, optic ? 0.032 : 0.008], rotation, color: used ? '#66ead3' : '#162934' });
      }
    }
  }
  const cables: CablePart[] = project.links.flatMap((link) => {
    const route = project.routes[link.id], path = route && routePath3d(project, link.id), cable = idx.cableOf(link);
    const a = portWorldPos(project, link.a.componentId, link.a.portId), b = portWorldPos(project, link.b.componentId, link.b.portId);
    if (!a || !b) return [];
    return [{ id: link.id, points: (path?.points ?? [a, b]).map(metres), radius: Math.max(0.002, (cable?.diameterMm ?? 3) / 2000), bendRadius: (cable?.bendRadiusMm ?? 20) / 1000, color: cable?.color ?? '#8bbfcd', layers: route ? [...new Set(route.segments.map((s) => s.layer))] : [], routed: !!path }];
  });
  const rect = unionRects([...project.racks.map(rackFloorRect), ...project.trays.filter((t) => t.points.length).map((t) => boundsOf(t.points))]) ?? boundsOf(project.room.outline);
  const center: V3 = [(rect.x + rect.width / 2) / 1000, 1, (rect.y + rect.height / 2) / 1000];
  const span = Math.max(2.5, rect.width / 1000, rect.height / 1000, project.room.ceilingMm / 1000);
  return { frames, devices, ports, doors, accessories, labels, cables, center, span };
}

/** Clip each grid line to the room polygon, including concave outlines. */
export function roomGrid(project: Project): number[] {
  const outline = project.room.outline, b = boundsOf(outline), vertices: number[] = [];
  const step = Math.max(100, project.room.gridMm, Math.max(b.width, b.height) / 200);
  for (const axis of ['x', 'y'] as const) {
    const other = axis === 'x' ? 'y' : 'x', start = axis === 'x' ? b.x : b.y, length = axis === 'x' ? b.width : b.height;
    for (let v = Math.ceil(start / step) * step; v < start + length; v += step) {
      const hits: number[] = [];
      outline.forEach((p, i) => {
        const q = outline[(i + 1) % outline.length]!;
        if ((p[axis] <= v && q[axis] > v) || (q[axis] <= v && p[axis] > v)) hits.push(p[other] + (v - p[axis]) / (q[axis] - p[axis]) * (q[other] - p[other]));
      });
      hits.sort((a, b) => a - b);
      for (let i = 1; i < hits.length; i += 2) {
        for (const w of [hits[i - 1]!, hits[i]!]) vertices.push(...(axis === 'x' ? [v / 1000, 0, w / 1000] : [w / 1000, 0, v / 1000]));
      }
    }
  }
  return vertices;
}

/** World-space corners used to frame the entire selected object, not just its centre. */
export function boxCorners(part: BoxPart): V3[] {
  const points: V3[] = [], c = Math.cos(part.rotation), s = Math.sin(part.rotation);
  for (const x of [-part.size[0] / 2, part.size[0] / 2]) for (const y of [-part.size[1] / 2, part.size[1] / 2]) for (const z of [-part.size[2] / 2, part.size[2] / 2]) {
    points.push([part.position[0] + x * c + z * s, part.position[1] + y, part.position[2] - x * s + z * c]);
  }
  return points;
}
