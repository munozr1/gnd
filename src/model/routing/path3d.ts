/**
 * Full 3D pathway of a routed link: A in-rack polyline, tray waypoints at
 * their layer elevation with a vertical drop at each layer change, and the B
 * in-rack polyline reversed. Empty segments contribute no points and no
 * drop; when every segment is empty the ends still dress to the first and
 * last segment's elevation, joined by a single vertical step if they differ.
 */
import { indexProject } from '../query';
import type { Id, Project, Room, Route, RouteSegment, RoutingLayer, Side, Vec2, Vec3 } from '../types';
import { inRackPolyline3dDetailed, same3, type InRackPolyline } from './dressing';
import { furcationWorldPos, resolveRouteEnds, type RouteEnds } from './owner';
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

/**
 * A cable jacket ends at the side's furcation point instead of the port. The
 * furcation is a free floor point (by default in front of the ports, at the
 * breakout length), so the jacket never enters that side's rack: it drops
 * vertically from the tray elevation to the furcation at the ports' mean
 * elevation, and the legs are dressed from there. The rack-dressed polyline
 * of the side's first leg is only used as an elevation fallback when no port
 * of the side is placed.
 */
function jacketEnd(project: Project, ends: RouteEnds, side: 'A' | 'B', polyline: InRackPolyline, trayElevationMm: number): InRackPolyline {
  const furcation = side === 'A' ? ends.furcationA : ends.furcationB;
  if (!furcation || !ends.cable) return polyline;
  const at = furcationWorldPos(project, ends.cable, side) ?? floorToWorld(furcation, polyline.points[0]!.y);
  return { points: [at, floorToWorld(furcation, trayElevationMm)], riseStart: 0 };
}

/** Full 3D pathway of a route by its key (a link id, or a cable id for a jacket route). */
export function routePath3d(project: Project, linkId: Id): RoutePath3d | null {
  const idx = indexProject(project);
  const route = idx.route(linkId);
  const ends = route && resolveRouteEnds(idx, route);
  if (!route || !ends) return null;

  const firstSeg = firstNonEmpty(route.segments);
  const lastSeg = lastNonEmpty(route.segments);
  const elevA = firstSeg ? segmentElevationMm(project, firstSeg) : defaultLayerElevationMm(project.room, 'in-rack');
  const elevB = lastSeg ? segmentElevationMm(project, lastSeg) : elevA;
  const aRaw = inRackPolyline3dDetailed(project, ends.a.componentId, ends.a.portId, route.aRack, elevA);
  const bRaw = inRackPolyline3dDetailed(project, ends.b.componentId, ends.b.portId, route.bRack, elevB);
  if (!aRaw || !bRaw) return null;
  const a = jacketEnd(project, ends, 'A', aRaw, elevA);
  const b = jacketEnd(project, ends, 'B', bRaw, elevB);

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
 * for underfloor runs, and the manager column for in-rack runs. A cable
 * jacket end that fans out meets its furcation point instead (see `jacketEnd`).
 */
export function routeEndFloorPos(project: Project, route: Route, end: 'a' | 'b'): Vec2 | null {
  const ends = resolveRouteEnds(indexProject(project), route);
  if (!ends) return null;
  const furcation = end === 'a' ? ends.furcationA : ends.furcationB;
  if (furcation) return furcation;
  const endRef = end === 'a' ? ends.a : ends.b;
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
    const resolved = resolveRouteEnds(idx, route);
    if (!resolved) continue;
    const ends: [typeof resolved.a, Side, Vec2 | undefined][] = [
      [resolved.a, route.aRack.side, resolved.furcationA],
      [resolved.b, route.bRack.side, resolved.furcationB],
    ];
    const seen = new Set<string>();
    for (const [endRef, side, furcation] of ends) {
      // A jacket end at a furcation point never rides the rack's manager; its legs are dressed from the furcation.
      if (furcation) continue;
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
