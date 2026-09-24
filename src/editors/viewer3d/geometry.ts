import { isPatchFrame } from '@/commands/placement';
import { boundsOf } from '@/model/geometry';
import { indexProject } from '@/model/query';
import { portPlacement, portWorldPos, rackCenter, rackFloorRect, rackLocalToFloor, rackTopMm, routePath3d, U_MM } from '@/model/routing';
import type { Project, RoutingLayer, SelectionItem, Vec3 } from '@/model/types';
import { unionRects } from '@/editors/layout/viewport';

export type V3 = [number, number, number];
export interface BoxPart { target: SelectionItem; position: V3; size: V3; rotation: number; color: string }
export interface CablePart { id: string; points: V3[]; radius: number; bendRadius: number; color: string; layers: RoutingLayer[]; routed: boolean }
export const metres = (p: Vec3): V3 => [p.x / 1000, p.y / 1000, p.z / 1000];
/** Thickness of a patch-panel faceplate standing proud of each face of a patch-frame wall, mm. */
const PLATE_MM = 10;

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
    const frame = isPatchFrame(rack);
    if (frame) {
      // A patch frame is a patch-panel wall: a thin slab under a cap, standing on a foot at each end, with no posts and no door so
      // both faces stay visible. The feet sit outside the 19" panel width because U1 starts at the floor: a full-width plinth
      // would bury the bottom panel and its ports.
      // The slab sits in the rack-post range of the palette: a vertical face gets 60% of the floor's key light, so a darker slab
      // reads as a black void next to the #283747 floor rather than as a wall.
      frames.push(part(rack.widthMm / 2, top / 2, rack.depthMm / 2, rack.widthMm, top, rack.depthMm, '#4b6074'));
      for (const x of [25, rack.widthMm - 25]) frames.push(part(x, 20, rack.depthMm / 2, 50, 40, rack.depthMm + 120, '#2f3d4b'));
      frames.push(part(rack.widthMm / 2, top - 10, rack.depthMm / 2, rack.widthMm + 20, 20, rack.depthMm + 20, '#5d7488'));
    } else {
      for (const x of [20, rack.widthMm - 20]) for (const z of [20, rack.depthMm - 20]) frames.push(part(x, top / 2, z, 35, top, 35, '#52687b'));
      for (const y of [15, top - 15]) frames.push(part(rack.widthMm / 2, y, rack.depthMm / 2, rack.widthMm, 30, rack.depthMm, '#344a5c'));
      doors.push(part(rack.widthMm / 2, top / 2, rack.depthMm + 4, rack.widthMm - 30, top - 70, 8, '#6d8f9e'));
    }
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
      const device: SelectionItem = { kind: 'component', id: c.id }, kind = idx.symbolOf(c)?.kind;
      const height = (fp?.heightU ?? 1) * U_MM, uCentre = (placement.uPosition - 1) * U_MM + height / 2, width = fp?.widthMm ?? 482.6, color = kind === 'switch' ? '#4b889e' : '#597080';
      if (frame) {
        // On a wall a panel is a faceplate proud of each face rather than a box inside the frame; the fibers arrive from both sides.
        const plate = fp?.kind === 'patch-panel' || kind === 'patch-panel' ? '#7d8ea3' : color;
        for (const depth of [rack.depthMm + PLATE_MM / 2, -PLATE_MM / 2]) devices.push({ ...part(rack.widthMm / 2, uCentre, depth, width, height - 4, PLATE_MM, plate), target: device });
      } else {
        const depth = Math.min(fp?.depthMm ?? 600, rack.depthMm);
        const centerDepth = placement.face === 'front' ? rack.depthMm - depth / 2 : depth / 2;
        devices.push({ ...part(rack.widthMm / 2, uCentre, centerDepth, width, height - 2, depth, color), target: device });
      }
      for (const port of fp?.ports ?? []) {
        const p = portWorldPos(project, c.id, port.id), info = frame ? portPlacement(project, c.id, port.id) : null;
        if (!p) continue;
        const used = !idx.isPortFree(c.id, port.id), optic = !!c.optics[port.id], studColor = used ? '#66ead3' : '#162934';
        const studW = port.type === 'RJ45' ? 13 : 9, studL = optic ? 32 : 8;
        if (!info) { ports.push({ target: device, position: metres(p), size: [studW / 1000, 0.009, studL / 1000], rotation, color: studColor }); continue; }
        // On a wall the port sits on the outer surface of the faceplate; at the wall face itself it would be buried inside the plate.
        const front = info.face === 'front', across = front ? info.acrossFromViewerLeft : rack.widthMm - info.acrossFromViewerLeft;
        const out = (mm: number) => (front ? rack.depthMm + mm : -mm);
        ports.push({ ...part(across, info.elevationMm, out(PLATE_MM), studW, 9, studL, studColor), target: device });
        if (!used) continue;
        // The "fiber in" cue: a 70 mm pigtail stub in the cable colour, leaving the faceplate and pointing away from its face.
        const link = idx.linksOf(c.id).find((l) => (l.a.componentId === c.id && l.a.portId === port.id) || (l.b.componentId === c.id && l.b.portId === port.id));
        ports.push({ ...part(across, info.elevationMm, out(PLATE_MM + 35), 6, 6, 70, (link && idx.cableOf(link)?.color) ?? '#66ead3'), target: device });
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
