/**
 * Who a route belongs to. `Project.routes` is keyed by the owner's id: a
 * link id for an ordinary cable, or a cable id when the route is the
 * JACKET of an installed `Cable` (`Route.owner === 'cable'`). The jacket
 * runs from side A's port (or side A's furcation point when that side fans
 * out into several legs) to side B's furcation point (or port). The legs
 * are derived, never stored: they run from the furcation to their ports.
 *
 * Every consumer that used to do `idx.link(route.linkId)` resolves the
 * route's ends here instead, so link and cable routes share one code path.
 */
import { cableEnds, cableLegsFloor, furcationFloorPos, sideIsFanned } from '../cables/geometry';
import type { CableSide, PortRef } from '../cables/instances';
import { indexProject, type ProjectIndex } from '../query';
import type { Cable, CableDef, Id, Link, Project, Route, Vec2, Vec3 } from '../types';
import { floorToWorld, portElevationMm, portFloorPos, portWorldPos } from './positions';

export type RouteOwner = 'link' | 'cable';

export const routeOwner = (route: Pick<Route, 'owner'>): RouteOwner => route.owner ?? 'link';

export interface RouteEnds {
  owner: RouteOwner;
  /** Port the in-rack dressing of each end starts from (for a cable: the first plugged leg of that side). */
  a: PortRef;
  b: PortRef;
  cableDef?: CableDef;
  link?: Link;
  cable?: Cable;
  /** Set when that end of a cable jacket is a furcation point rather than the port itself (floor mm). */
  furcationA?: Vec2;
  furcationB?: Vec2;
}

/**
 * Ends of the object a route key names: the link, or the cable's jacket.
 * Without `owner` the id is looked up as a link first, then as a cable (ids
 * never collide). Null when it does not exist or a cable side is unplugged.
 */
export function resolveEndsOf(idx: ProjectIndex, id: Id, owner?: RouteOwner): RouteEnds | null {
  const link = owner === 'cable' ? undefined : idx.link(id);
  if (link) {
    const cableDef = idx.cableOf(link);
    return { owner: 'link', a: link.a, b: link.b, link, ...(cableDef ? { cableDef } : {}) };
  }
  if (owner === 'link') return null;
  const cable = idx.cable(id);
  if (!cable) return null;
  const ends = cableEnds(idx.project, cable);
  const a = ends.A[0];
  const b = ends.B[0];
  if (!a || !b) return null;
  const out: RouteEnds = { owner: 'cable', a, b, cable };
  const def = idx.catalog.cable(cable.cableDefId);
  if (def) out.cableDef = def;
  const fa = furcationFloorPos(idx.project, cable, 'A');
  if (fa) out.furcationA = fa.pos;
  const fb = furcationFloorPos(idx.project, cable, 'B');
  if (fb) out.furcationB = fb.pos;
  return out;
}

/** The two ends a route dresses, or null when its owner no longer exists (or a cable side is unplugged). */
export function resolveRouteEnds(idx: ProjectIndex, route: Route): RouteEnds | null {
  return resolveEndsOf(idx, route.linkId, routeOwner(route));
}

/** Label of a route's owner for messages: the link label ('SW1:eth1/49 — SW2:eth1/1') or the cable label ('CBL1'). */
export function routeLabel(idx: ProjectIndex, ends: RouteEnds): string {
  return ends.link ? idx.linkLabel(ends.link) : (ends.cable?.label ?? ends.a.componentId);
}

/** The item that highlights a route (a SelectionItem and an IssueTarget alike): its link, or its cable. */
export const routeSelection = (route: Pick<Route, 'linkId' | 'owner'>): { kind: RouteOwner; id: Id } => ({ kind: routeOwner(route), id: route.linkId });

/** Whether a link is realised by a cable whose jacket has a route (the link then counts as routed). */
export function linkRoutedByCable(project: Project, link: Pick<Link, 'cableId'>): boolean {
  return link.cableId !== undefined && project.routes[link.cableId] !== undefined;
}

export interface RouteFloorEndpoints {
  /** Where the hand-routed path starts: A's furcation point, else A's port. */
  start: Vec2;
  /** Where it must finish: B's furcation point, else B's port. */
  end: Vec2;
  ends: RouteEnds;
}

/** Floor-plan endpoints the route tool draws between, or null when an end is unplaced. */
export function routeFloorEndpoints(project: Project, id: Id, owner?: RouteOwner): RouteFloorEndpoints | null {
  const ends = resolveEndsOf(indexProject(project), id, owner);
  if (!ends) return null;
  const start = ends.furcationA ?? portFloorPos(project, ends.a.componentId, ends.a.portId);
  const end = ends.furcationB ?? portFloorPos(project, ends.b.componentId, ends.b.portId);
  return start && end ? { start, end, ends } : null;
}

/** Mean elevation of a side's plugged, placed ports; null when none is placed. */
function sideElevationMm(project: Project, cable: Cable, side: CableSide): number | null {
  const legs = cableLegsFloor(project, cable, side);
  const elevations = legs.map((l) => portElevationMm(project, l.ref.componentId, l.ref.portId)).filter((e): e is number => e !== null);
  if (elevations.length === 0) return null;
  return elevations.reduce((s, e) => s + e, 0) / elevations.length;
}

/** 3D position of a side's furcation point (mm, y up): its floor position at the mean elevation of the side's ports. */
export function furcationWorldPos(project: Project, cable: Cable, side: CableSide): Vec3 | null {
  const f = furcationFloorPos(project, cable, side);
  const elevation = f && sideElevationMm(project, cable, side);
  return f && elevation !== null ? floorToWorld(f.pos, elevation) : null;
}

export interface CableLeg3d {
  side: CableSide;
  leg: number;
  ref: PortRef;
  /** Furcation point → port (mm, y up). */
  points: Vec3[];
}

/** The legs of every fanned side: a straight run from the furcation point to each plugged, placed port. */
export function cableLegs3d(project: Project, cable: Cable): CableLeg3d[] {
  const out: CableLeg3d[] = [];
  for (const side of ['A', 'B'] as const) {
    if (!sideIsFanned(project, cable, side)) continue;
    const from = furcationWorldPos(project, cable, side);
    if (!from) continue;
    for (const leg of cableLegsFloor(project, cable, side)) {
      const port = portWorldPos(project, leg.ref.componentId, leg.ref.portId);
      if (port) out.push({ side, leg: leg.leg, ref: leg.ref, points: [from, port] });
    }
  }
  return out;
}
