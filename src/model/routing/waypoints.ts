/**
 * Waypoint editing on `Route.segments` (floor plan, mm). Functions that take
 * a `Route` mutate it in place (call them on an Immer draft); readers take a
 * `Project`. Anchors are not maintained by the low-level edits: call
 * `anchorWaypointsInRacks` after editing to refresh them.
 */
import { current, isDraft } from 'immer';
import { createWaypoint } from '../factories';
import {
  add,
  closestPointOnPolyline,
  dist,
  dot,
  rectContains,
  scale,
  snapVec,
  sub,
  type Rect,
} from '../geometry';
import { indexProject } from '../query';
import type { Id, Project, Route, RouteSegment, RoutingLayer, Tray, Vec2, Waypoint } from '../types';
import { autoInRackPath } from './dressing';
import { routeEndFloorPos } from './path3d';
import { managerFloorRect, rackFloorRect } from './positions';

const EPS = 1e-6;

/** Read-safe view of a project that may be an Immer draft (fresh index when the draft was modified). */
const snapshot = (project: Project): Project => (isDraft(project) ? (current(project) as Project) : project);

export interface WaypointRef {
  segIdx: number;
  idx: number;
  wp: Waypoint;
}

export function findWaypoint(route: Route, wpId: Id): WaypointRef | null {
  for (let segIdx = 0; segIdx < route.segments.length; segIdx++) {
    const idx = route.segments[segIdx]!.points.findIndex((w) => w.id === wpId);
    if (idx >= 0) return { segIdx, idx, wp: route.segments[segIdx]!.points[idx]! };
  }
  return null;
}

/** Insert a waypoint after index `afterIdx` (-1 inserts at the start). */
export function insertWaypoint(route: Route, segIdx: number, afterIdx: number, pos: Vec2, pinned = false): Waypoint | null {
  const seg = route.segments[segIdx];
  if (!seg) return null;
  const wp = createWaypoint(pos, pinned);
  const at = Math.max(0, Math.min(seg.points.length, afterIdx + 1));
  seg.points.splice(at, 0, wp);
  return wp;
}

export function deleteWaypoint(route: Route, segIdx: number, wpId: Id): boolean {
  const seg = route.segments[segIdx];
  if (!seg) return false;
  const idx = seg.points.findIndex((w) => w.id === wpId);
  if (idx < 0) return false;
  seg.points.splice(idx, 1);
  return true;
}

/**
 * Move a waypoint. With `keepOrthogonal`, each UNPINNED neighbour slides
 * perpendicular to its shared segment so the segment stays horizontal or
 * vertical; pinned neighbours never move (the segment goes diagonal instead).
 */
export function moveWaypoint(
  route: Route,
  segIdx: number,
  wpId: Id,
  pos: Vec2,
  opts: { keepOrthogonal?: boolean } = {},
): boolean {
  const seg = route.segments[segIdx];
  if (!seg) return false;
  const idx = seg.points.findIndex((w) => w.id === wpId);
  const wp = seg.points[idx];
  if (!wp) return false;
  const old = { ...wp.pos };
  wp.pos = { ...pos };
  if (opts.keepOrthogonal) {
    for (const n of [seg.points[idx - 1], seg.points[idx + 1]]) {
      if (!n || n.pinned) continue;
      const wasHorizontal = Math.abs(old.y - n.pos.y) < EPS;
      const wasVertical = Math.abs(old.x - n.pos.x) < EPS;
      if (wasHorizontal && !wasVertical) n.pos.y = pos.y;
      else if (wasVertical && !wasHorizontal) n.pos.x = pos.x;
    }
  }
  return true;
}

/**
 * Drag the segment between points i and i+1 perpendicular to itself (the
 * parallel component of `delta` is discarded). Adjacent orthogonal segments
 * stretch naturally. Returns false when either endpoint is pinned or missing.
 */
export function dragSegment(route: Route, segIdx: number, i: number, delta: Vec2): boolean {
  const seg = route.segments[segIdx];
  const p0 = seg?.points[i];
  const p1 = seg?.points[i + 1];
  if (!p0 || !p1 || p0.pinned || p1.pinned) return false;
  const d = sub(p1.pos, p0.pos);
  const l = Math.hypot(d.x, d.y);
  let move: Vec2;
  if (l < EPS) {
    move = { ...delta };
  } else {
    const n = { x: -d.y / l, y: d.x / l };
    move = scale(n, dot(delta, n));
  }
  p0.pos = add(p0.pos, move);
  p1.pos = add(p1.pos, move);
  return true;
}

/** Pin or unpin one waypoint in a segment, or all waypoints in that segment. */
export function setPinned(route: Route, segIdx: number, wpId: Id | 'all', pinned: boolean): number {
  const seg = route.segments[segIdx];
  if (!seg) return 0;
  let n = 0;
  for (const wp of seg.points) {
    if (wpId === 'all' || wp.id === wpId) {
      wp.pinned = pinned;
      n++;
    }
  }
  return n;
}

/** Pin or unpin every waypoint of the route and both in-rack ends. */
export function setAllPinned(route: Route, pinned: boolean): void {
  for (const seg of route.segments) for (const wp of seg.points) wp.pinned = pinned;
  route.aRack.pinned = pinned;
  route.bRack.pinned = pinned;
}

const collinear = (a: Vec2, b: Vec2, c: Vec2): boolean => {
  const ab = sub(b, a);
  const bc = sub(c, b);
  const cross = ab.x * bc.y - ab.y * bc.x;
  const scaleLen = Math.max(1, dist(a, b) * dist(b, c));
  return Math.abs(cross) / scaleLen < 1e-6 && dot(ab, bc) >= -EPS;
};

/** Drop unpinned interior waypoints that are collinear with (or duplicate) their neighbours. */
export function straighten(route: Route): number {
  let removed = 0;
  for (const seg of route.segments) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 1; i < seg.points.length - 1; i++) {
        const wp = seg.points[i]!;
        if (wp.pinned) continue;
        const prev = seg.points[i - 1]!.pos;
        const next = seg.points[i + 1]!.pos;
        if (dist(prev, wp.pos) < EPS || dist(wp.pos, next) < EPS || collinear(prev, wp.pos, next)) {
          seg.points.splice(i, 1);
          removed++;
          changed = true;
          break;
        }
      }
    }
  }
  return removed;
}

export interface SnapOptions {
  gridMm: number;
  trays: readonly Tray[];
  otherRoutePoints: readonly Vec2[];
  toleranceMm: number;
}

export interface SnapResult {
  pos: Vec2;
  snappedTo: 'cable' | 'tray' | 'grid' | 'none';
  trayId?: Id;
}

/** Snap a floor position: existing cable points first, then tray centrelines, then the grid. */
export function snapWaypoint(pos: Vec2, opts: SnapOptions): SnapResult {
  let best: SnapResult | null = null;
  let bestDist = opts.toleranceMm;
  for (const p of opts.otherRoutePoints) {
    const d = dist(pos, p);
    if (d <= bestDist) {
      bestDist = d;
      best = { pos: { ...p }, snappedTo: 'cable' };
    }
  }
  if (best) return best;
  for (const tray of opts.trays) {
    const c = closestPointOnPolyline(pos, tray.points);
    if (c && c.dist <= bestDist) {
      bestDist = c.dist;
      best = { pos: c.point, snappedTo: 'tray', trayId: tray.id };
    }
  }
  if (best) return best;
  if (opts.gridMm > 0) return { pos: snapVec(pos, opts.gridMm), snappedTo: 'grid' };
  return { pos: { ...pos }, snappedTo: 'none' };
}

/** Rects that count as "inside the rack" for anchoring: the frame plus fitted vertical managers. */
function rackAnchorRects(project: Project, rackId: Id): Rect[] {
  const rack = indexProject(project).rack(rackId);
  if (!rack) return [];
  const rects = [rackFloorRect(rack)];
  for (const side of ['left', 'right'] as const) {
    const r = managerFloorRect(project, rackId, side);
    if (r) rects.push(r);
  }
  return rects;
}

/**
 * Anchor every waypoint lying inside a rack (or its managers) to that rack by
 * offset from the rack position; clear anchors on waypoints outside any rack.
 */
export function anchorWaypointsInRacks(project: Project, route: Route): void {
  const view = snapshot(project);
  const rects = view.racks.map((rack) => ({ rack, rects: rackAnchorRects(view, rack.id) }));
  for (const seg of route.segments) {
    for (const wp of seg.points) {
      const hit = rects.find((r) => r.rects.some((rect) => rectContains(rect, wp.pos)));
      if (hit) wp.anchor = { rackId: hit.rack.id, offset: sub(wp.pos, hit.rack.pos) };
      else delete wp.anchor;
    }
  }
}

/** Translate every waypoint anchored to the rack (pinned or not) by `delta`. Returns the count moved. */
export function onRackMoved(draft: Project, rackId: Id, delta: Vec2): number {
  let moved = 0;
  for (const route of Object.values(draft.routes)) {
    for (const seg of route.segments) {
      for (const wp of seg.points) {
        if (wp.anchor?.rackId !== rackId) continue;
        wp.pos = add(wp.pos, delta);
        moved++;
      }
    }
  }
  return moved;
}

/** Move `wp` onto the axis of `ref` that costs the least, keeping the other coordinate. */
function squareToRef(wp: Waypoint, ref: Vec2, inward: Waypoint | undefined): void {
  if (inward) {
    const horizontal = Math.abs(inward.pos.y - wp.pos.y) < EPS;
    const vertical = Math.abs(inward.pos.x - wp.pos.x) < EPS;
    if (horizontal && !vertical) {
      wp.pos.x = ref.x; // slide along the horizontal run → end segment is vertical
      return;
    }
    if (vertical && !horizontal) {
      wp.pos.y = ref.y;
      return;
    }
  }
  if (Math.abs(ref.x - wp.pos.x) <= Math.abs(ref.y - wp.pos.y)) wp.pos.x = ref.x;
  else wp.pos.y = ref.y;
}

/**
 * After a link end moved (device re-placed, port swapped): re-dress the
 * in-rack path unless pinned, and re-square the UNPINNED waypoint adjacent to
 * that end so the end segment stays orthogonal to the rack entry point.
 * Pinned waypoints are never touched; when the adjacent waypoint is pinned
 * nothing is inserted.
 */
export function onEndpointMoved(draft: Project, linkId: Id, end: 'a' | 'b'): boolean {
  const route = draft.routes[linkId];
  const link = draft.links.find((l) => l.id === linkId);
  if (!route || !link) return false;
  const endRef = end === 'a' ? link.a : link.b;
  const key = end === 'a' ? 'aRack' : 'bRack';
  if (!route[key].pinned) route[key] = autoInRackPath(snapshot(draft), endRef.componentId, endRef.portId);

  const segIdx =
    end === 'a'
      ? route.segments.findIndex((s) => s.points.length > 0)
      : route.segments.length - 1 - [...route.segments].reverse().findIndex((s) => s.points.length > 0);
  const seg = route.segments[segIdx];
  if (!seg || seg.points.length === 0) return true;
  const wpIdx = end === 'a' ? 0 : seg.points.length - 1;
  const wp = seg.points[wpIdx]!;
  if (wp.pinned) return true;
  const ref = routeEndFloorPos(snapshot(draft), route, end);
  if (!ref) return true;
  squareToRef(wp, ref, seg.points[end === 'a' ? wpIdx + 1 : wpIdx - 1]);
  anchorWaypointsInRacks(draft, route);
  return true;
}

export interface LayerPoints {
  layer: RoutingLayer;
  trayId?: Id | null;
  points: Vec2[];
}

/** Build a route from hand-routed floor points per layer, auto-dressing both in-rack ends. */
export function newRouteFromPoints(
  project: Project,
  linkId: Id,
  layerPoints: readonly LayerPoints[],
  pinByDefault: boolean = project.settings.pinWaypointsByDefault,
): Route | null {
  const view = snapshot(project);
  const link = indexProject(view).link(linkId);
  if (!link) return null;
  const segments: RouteSegment[] = layerPoints.map((lp) => ({
    layer: lp.layer,
    trayId: lp.trayId ?? null,
    points: lp.points.map((p) => createWaypoint(p, pinByDefault)),
  }));
  const route: Route = {
    linkId,
    aRack: autoInRackPath(view, link.a.componentId, link.a.portId),
    bRack: autoInRackPath(view, link.b.componentId, link.b.portId),
    segments,
  };
  anchorWaypointsInRacks(view, route);
  return route;
}

export interface Drop {
  pos: Vec2;
  fromLayer: RoutingLayer;
  toLayer: RoutingLayer;
  /** Index of the segment the drop leaves. */
  segmentIndex: number;
}

/**
 * Positions where consecutive segments change layer (the vias): the last
 * waypoint of the segment being left. Empty segments carry no path, so they
 * are skipped, matching `routePath3d`.
 */
export function dropsOf(route: Route): Drop[] {
  const drops: Drop[] = [];
  let prev: { seg: RouteSegment; index: number } | undefined;
  for (let i = 0; i < route.segments.length; i++) {
    const seg = route.segments[i]!;
    if (seg.points.length === 0) continue;
    if (prev && prev.seg.layer !== seg.layer) {
      const at = prev.seg.points[prev.seg.points.length - 1]!.pos;
      drops.push({ pos: { ...at }, fromLayer: prev.seg.layer, toLayer: seg.layer, segmentIndex: prev.index });
    }
    prev = { seg, index: i };
  }
  return drops;
}
