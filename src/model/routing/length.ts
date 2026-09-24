/**
 * Cable lengths: routed (from the full 3D pathway) or estimated (Manhattan +
 * vertical), plus slack and rounding to standard lengths.
 */
import { manhattan } from '../geometry';
import { indexProject } from '../query';
import type { Id, Project, Vec3 } from '../types';
import { defaultLayerElevationMm, routePath3d, type IndexRange } from './path3d';
import { dist3, polyline3dLength, portElevationMm, portFloorPos } from './positions';

export const STANDARD_LENGTHS_M: readonly number[] = [1, 2, 3, 5, 7, 10, 15, 20, 30];

/** Ceil to the next standard length; above the longest standard, to the next 5 m multiple. */
export function roundToStandard(m: number): number {
  const eps = 1e-6;
  const shortest = STANDARD_LENGTHS_M[0]!;
  if (!(m > 0)) return shortest;
  for (const s of STANDARD_LENGTHS_M) if (m <= s + eps) return s;
  return Math.ceil(m / 5 - eps) * 5;
}

/** Metres. */
export interface LengthBreakdown {
  inRackA: number;
  rise: number;
  tray: number;
  drop: number;
  inRackB: number;
  /** Sum of all vertical travel along the path. */
  verticalTotal: number;
}

export interface LinkLength {
  /** Geometric path length, m. */
  rawM: number;
  /** rawM × (1 + slackFraction) + 2 × slackPerEndM + service loops. */
  withSlackM: number;
  /** withSlackM rounded up to a standard length. */
  standardM: number;
  serviceLoopM: number;
  /** true when no route exists and the length is a Manhattan estimate. */
  est: boolean;
  breakdown: LengthBreakdown;
}

function rangeLengthMm(points: readonly Vec3[], [from, to]: IndexRange): number {
  let total = 0;
  for (let i = from + 1; i <= to; i++) total += dist3(points[i - 1]!, points[i]!);
  return total;
}

function verticalTravelMm(points: readonly Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.abs(points[i]!.y - points[i - 1]!.y);
  return total;
}

function withSlack(project: Project, rawM: number, serviceLoopM: number, est: boolean, breakdown: LengthBreakdown): LinkLength {
  const s = project.settings;
  const withSlackM = rawM * (1 + s.slackFraction) + 2 * s.slackPerEndM + serviceLoopM;
  return { rawM, withSlackM, standardM: roundToStandard(withSlackM), serviceLoopM, est, breakdown };
}

/** Length along the full 3D pathway. Null when the link has no route or an end is unplaced. */
export function routedLengthM(project: Project, linkId: Id): LinkLength | null {
  const path = routePath3d(project, linkId);
  const route = project.routes[linkId];
  if (!path || !route) return null;
  const { points, parts } = path;
  const m = (r: IndexRange): number => rangeLengthMm(points, r) / 1000;
  const breakdown: LengthBreakdown = {
    inRackA: m(parts.inRackA),
    rise: m(parts.rise),
    tray: m(parts.tray),
    drop: m(parts.drop),
    inRackB: m(parts.inRackB),
    verticalTotal: verticalTravelMm(points) / 1000,
  };
  let serviceLoopM = 0;
  for (const seg of route.segments) for (const wp of seg.points) serviceLoopM += wp.serviceLoopM ?? 0;
  return withSlack(project, polyline3dLength(points) / 1000, serviceLoopM, false, breakdown);
}

/**
 * Estimate for an unrouted link: Manhattan floor distance between the port
 * positions plus the vertical from each port to the default overhead tray
 * elevation. Null when an end is unplaced.
 */
export function estimatedLengthM(project: Project, linkId: Id): LinkLength | null {
  const link = indexProject(project).link(linkId);
  if (!link) return null;
  const pa = portFloorPos(project, link.a.componentId, link.a.portId);
  const pb = portFloorPos(project, link.b.componentId, link.b.portId);
  const ea = portElevationMm(project, link.a.componentId, link.a.portId);
  const eb = portElevationMm(project, link.b.componentId, link.b.portId);
  if (!pa || !pb || ea === null || eb === null) return null;
  const trayElev = defaultLayerElevationMm(project.room, 'overhead');
  const rise = Math.abs(trayElev - ea) / 1000;
  const drop = Math.abs(trayElev - eb) / 1000;
  const tray = manhattan(pa, pb) / 1000;
  const breakdown: LengthBreakdown = { inRackA: 0, rise, tray, drop, inRackB: 0, verticalTotal: rise + drop };
  return withSlack(project, tray + rise + drop, 0, true, breakdown);
}

/** Routed length when a route exists, else the estimate. */
export function linkLengthM(project: Project, linkId: Id): LinkLength | null {
  return (project.routes[linkId] ? routedLengthM(project, linkId) : null) ?? estimatedLengthM(project, linkId);
}
