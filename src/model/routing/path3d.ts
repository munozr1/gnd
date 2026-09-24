/**
 * Full 3D pathway of a routed link: A in-rack polyline, tray waypoints at
 * their layer elevation with a vertical drop at each layer change, and the B
 * in-rack polyline reversed. Empty segments contribute no points and no
 * drop; when every segment is empty the ends still dress to the first and
 * last segment's elevation, joined by a single vertical step if they differ.
 */
import { indexProject } from '../query';
import type { Id, Project, Room, Route, RouteSegment, RoutingLayer, Side, Vec2, Vec3 } from '../types';
import { inRackPolyline3dDetailed, same3 } from './dressing';
import { floorToWorld, managerFloorCenter, portPlacement, rackEntryPoints, rackTopMm } from './positions';

/** Default elevation of a routing layer when a segment rides no specific tray. */
export function defaultLayerElevationMm(room: Room, layer: RoutingLayer): number {
  switch (layer) {
    case 'overhead':
      return room.ceilingMm - 600;
    case 'underfloor':
      return -room.raisedFloorMm / 2;
    case 'in-rack':
      return 0;
  }
}

/** Elevation a route segment runs at: its tray's elevation, else the layer default. */
export function segmentElevationMm(project: Project, segment: Pick<RouteSegment, 'layer' | 'trayId'>): number {
  if (segment.trayId) {
    const tray = project.trays.find((t) => t.id === segment.trayId);
    if (tray) return tray.elevationMm;
  }
  return defaultLayerElevationMm(project.room, segment.layer);
}

/** Inclusive index range into `RoutePath3d.points`. */
export type IndexRange = [from: number, to: number];

export interface LayerRange {
  layer: RoutingLayer;
  from: number;
  to: number;
}

export interface RoutePath3d {
  points: Vec3[];
  /** Contiguous index ranges by routing layer, in path order. */
  segmentsByLayer: LayerRange[];
  /** Index ranges of the pathway stages (for the length breakdown). */
  parts: {
    inRackA: IndexRange;
    rise: IndexRange;
    tray: IndexRange;
    drop: IndexRange;
    inRackB: IndexRange;
  };
}

const firstNonEmpty = (segments: readonly RouteSegment[]): RouteSegment | undefined =>
  segments.find((s) => s.points.length > 0) ?? segments[0];
const lastNonEmpty = (segments: readonly RouteSegment[]): RouteSegment | undefined => {
  for (let i = segments.length - 1; i >= 0; i--) if (segments[i]!.points.length > 0) return segments[i];
  return segments[segments.length - 1];
};

export function routePath3d(project: Project, linkId: Id): RoutePath3d | null {
  const idx = indexProject(project);
  const route = idx.route(linkId);
  const link = idx.link(linkId);
  if (!route || !link) return null;

  const firstSeg = firstNonEmpty(route.segments);
  const lastSeg = lastNonEmpty(route.segments);
  const elevA = firstSeg ? segmentElevationMm(project, firstSeg) : defaultLayerElevationMm(project.room, 'in-rack');
  const elevB = lastSeg ? segmentElevationMm(project, lastSeg) : elevA;
  const a = inRackPolyline3dDetailed(project, link.a.componentId, link.a.portId, route.aRack, elevA);
  const b = inRackPolyline3dDetailed(project, link.b.componentId, link.b.portId, route.bRack, elevB);
  if (!a || !b) return null;

  const points: Vec3[] = [];
  const push = (p: Vec3): number => {
    const last = points[points.length - 1];
    if (!last || !same3(last, p)) points.push({ ...p });
    return points.length - 1;
  };
  const layers: LayerRange[] = [];
  const addLayer = (layer: RoutingLayer, from: number, to: number): void => {
    if (to <= from) return;
    const prev = layers[layers.length - 1];
    if (prev && prev.layer === layer && prev.to === from) prev.to = to;
    else layers.push({ layer, from, to });
  };

  // A: port → manager → rack top → entry → tray elevation.
  let riseStart = 0;
  a.points.forEach((p, i) => {
    const k = push(p);
    if (i === a.riseStart) riseStart = k;
  });
  const aEnd = points.length - 1;
  addLayer('in-rack', 0, aEnd);

  // Tray waypoints, with a vertical drop where the elevation changes.
  let prevElev = elevA;
  for (const seg of route.segments) {
    if (seg.points.length === 0) continue;
    const elev = segmentElevationMm(project, seg);
    const from = points.length - 1;
    if (elev !== prevElev) {
      const last = points[from]!;
      push({ x: last.x, y: elev, z: last.z });
    }
    for (const wp of seg.points) push(floorToWorld(wp.pos, elev));
    addLayer(seg.layer, from, points.length - 1);
    prevElev = elev;
  }

  // B reversed: tray elevation → entry → rack top → manager → port. When no
  // waypoint carried the path to B's elevation (every segment empty), step
  // vertically at the last point so the join is never a slope.
  const beforeB = points.length - 1;
  if (elevB !== prevElev) {
    const last = points[beforeB]!;
    push({ x: last.x, y: elevB, z: last.z });
  }
  const bRev = [...b.points].reverse();
  const bDropEndRev = b.points.length - 1 - b.riseStart;
  let dropStart = beforeB;
  let dropEnd = beforeB;
  bRev.forEach((p, i) => {
    const k = push(p);
    if (i === 0) dropStart = k;
    if (i === bDropEndRev) dropEnd = k;
  });
  const end = points.length - 1;
  addLayer(lastSeg?.layer ?? 'in-rack', beforeB, dropStart);
  addLayer('in-rack', dropStart, end);

  return {
    points,
    segmentsByLayer: layers,
    parts: {
      inRackA: [0, riseStart],
      rise: [riseStart, aEnd],
      tray: [aEnd, dropStart],
      drop: [dropStart, dropEnd],
      inRackB: [dropEnd, end],
    },
  };
}

/**
 * Floor-plan point where a route's hand-routed path meets the rack at one
 * end: the top entry on the route's side for overhead runs, the bottom entry
 * for underfloor runs, and the manager column for in-rack runs.
 */
export function routeEndFloorPos(project: Project, route: Route, end: 'a' | 'b'): Vec2 | null {
  const link = indexProject(project).link(route.linkId);
  if (!link) return null;
  const endRef = end === 'a' ? link.a : link.b;
  const info = portPlacement(project, endRef.componentId, endRef.portId);
  if (!info) return null;
  const seg = end === 'a' ? firstNonEmpty(route.segments) : lastNonEmpty(route.segments);
  const elev = seg ? segmentElevationMm(project, seg) : defaultLayerElevationMm(project.room, 'in-rack');
  const side = end === 'a' ? route.aRack.side : route.bRack.side;
  const entries = rackEntryPoints(project, info.rack);
  if (elev < 0) return entries.bottom;
  if (elev >= rackTopMm(info.rack)) return side === 'left' ? entries.topLeft : entries.topRight;
  return managerFloorCenter(project, info.rack.id, side) ?? entries.bottom;
}

export const bundleKey = (rackId: Id, side: Side): string => `${rackId}:${side}`;

/** Routes grouped by the (rack, manager side) they pass through, for bundle rendering. */
export function bundles(project: Project): Map<string, Id[]> {
  const idx = indexProject(project);
  const out = new Map<string, Id[]>();
  for (const route of Object.values(project.routes)) {
    const link = idx.link(route.linkId);
    if (!link) continue;
    const ends: [typeof link.a, Side][] = [
      [link.a, route.aRack.side],
      [link.b, route.bRack.side],
    ];
    const seen = new Set<string>();
    for (const [endRef, side] of ends) {
      const rack = idx.rackOfComponent(endRef.componentId);
      if (!rack) continue;
      const key = bundleKey(rack.id, side);
      if (seen.has(key)) continue;
      seen.add(key);
      const arr = out.get(key);
      if (arr) arr.push(route.linkId);
      else out.set(key, [route.linkId]);
    }
  }
  return out;
}
