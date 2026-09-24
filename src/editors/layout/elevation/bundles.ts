/**
 * In-rack cable dressing for the elevation view, following the spec's
 * auto-dressing rules: from the port, run horizontally to the vertical
 * manager, then vertically in the manager to the top entry (or to the
 * partner device's level for an intra-rack link). Cables from the same
 * device and manager side merge into one bundle; the bundle gets a velcro
 * tick every 300 mm and fans out to the individual ports over the last
 * 150 mm. Pure: takes cable ends already resolved to world positions.
 */
import type { Id, Side, Vec2 } from '@/model/types';
import { BUNDLE_PITCH_MM, EXIT_MM, FAN_OUT_MM, VELCRO_PITCH_MM } from './constants';

export interface CableEnd {
  linkId: Id;
  componentId: Id;
  portId: string;
  rackId: Id;
  /** Manager side (rack naming) this end uses, from the route's InRackPath. */
  side: Side;
  /** World position of the port. */
  port: Vec2;
  color: string;
  /** Where the cable goes after the manager: out of the roof, or to a level inside the same rack. */
  target: { kind: 'exit' } | { kind: 'level'; y: number };
}

export interface ManagerGeom {
  /** Centre x of the manager column. */
  x: number;
  /** Inner edge x (where horizontal runs meet the manager). */
  innerX: number;
  /** y of the top of the U stack (the manager's top) and of the roof. */
  stackTopY: number;
  roofY: number;
  /** x of the top entry the bundle exits through (defaults to the manager x). */
  exitX: number;
}

export interface BundleCable {
  linkId: Id;
  portId: string;
  port: Vec2;
  color: string;
  /** Full path of this cable for highlighting: port → fan point → manager → target. */
  path: Vec2[];
}

export interface Bundle {
  key: string;
  rackId: Id;
  componentId: Id;
  side: Side;
  linkIds: Id[];
  count: number;
  color: string;
  /** x of the vertical run (manager x plus lateral offset). */
  x: number;
  /** Level of the horizontal run (mean port y). */
  y: number;
  /** Vertical extent of the run in the manager (y0 above y1, since y is down). */
  runY0: number;
  runY1: number;
  /** Where the fan-out begins. */
  fanX: number;
  cables: BundleCable[];
  /** y of each velcro tie along the vertical run. */
  ticks: number[];
  /** Polyline from the top of the run to outside the roof when at least one cable leaves the rack. */
  exit: Vec2[] | null;
  /** Bundle thickness in mm. */
  widthMm: number;
}

export const bundleKeyOf = (rackId: Id, side: Side, componentId: Id): string => `${rackId}:${side}:${componentId}`;

export const bundleWidthMm = (count: number): number => Math.min(16, 3 + Math.sqrt(Math.max(0, count - 1)) * 2.4);

/** Velcro tie positions: from the horizontal run's level toward each end of the vertical run, every `pitch`. */
export function velcroTicks(level: number, y0: number, y1: number, pitch = VELCRO_PITCH_MM): number[] {
  const out: number[] = [];
  for (let y = level - pitch; y > y0; y -= pitch) out.push(y);
  for (let y = level + pitch; y < y1; y += pitch) out.push(y);
  return out.sort((a, b) => a - b);
}

/**
 * Fan-out start: the port nearest the manager, `fan` mm further toward the
 * manager, never past the manager's inner edge.
 */
export function fanPoint(ports: readonly Vec2[], managerInnerX: number, fan = FAN_OUT_MM): number {
  if (ports.length === 0) return managerInnerX;
  const xs = ports.map((p) => p.x);
  const managerOnLeft = managerInnerX <= Math.min(...xs);
  if (managerOnLeft) return Math.max(managerInnerX, Math.min(...xs) - fan);
  return Math.min(managerInnerX, Math.max(...xs) + fan);
}

/** Most common colour among the cables (first one on ties). */
function dominantColor(ends: readonly CableEnd[]): string {
  const counts = new Map<string, number>();
  let best = ends[0]?.color ?? '#ffffff';
  let bestN = 0;
  for (const e of ends) {
    const n = (counts.get(e.color) ?? 0) + 1;
    counts.set(e.color, n);
    if (n > bestN) {
      bestN = n;
      best = e.color;
    }
  }
  return best;
}

/**
 * Group cable ends into bundles per (rack, manager side, device) and lay
 * each one out. Bundles sharing a manager are offset side by side.
 */
export function groupBundles(ends: readonly CableEnd[], managerOf: (rackId: Id, side: Side) => ManagerGeom | null): Bundle[] {
  const groups = new Map<string, CableEnd[]>();
  for (const e of ends) {
    const key = bundleKeyOf(e.rackId, e.side, e.componentId);
    const g = groups.get(key);
    if (g) g.push(e);
    else groups.set(key, [e]);
  }

  const bundles: Bundle[] = [];
  for (const [key, group] of groups) {
    const first = group[0]!;
    const geom = managerOf(first.rackId, first.side);
    if (!geom) continue;
    const ports = group.map((e) => e.port);
    const level = ports.reduce((s, p) => s + p.y, 0) / ports.length;
    const fanX = fanPoint(ports, geom.innerX);
    const exits = group.some((e) => e.target.kind === 'exit');
    let y0 = level;
    let y1 = level;
    for (const e of group) {
      const ty = e.target.kind === 'exit' ? geom.stackTopY : e.target.y;
      y0 = Math.min(y0, ty);
      y1 = Math.max(y1, ty);
    }
    bundles.push({
      key,
      rackId: first.rackId,
      componentId: first.componentId,
      side: first.side,
      linkIds: group.map((e) => e.linkId),
      count: group.length,
      color: dominantColor(group),
      x: geom.x,
      y: level,
      runY0: y0,
      runY1: y1,
      fanX,
      cables: group.map((e) => ({ linkId: e.linkId, portId: e.portId, port: e.port, color: e.color, path: [] })),
      ticks: velcroTicks(level, y0, y1),
      exit: exits ? [{ x: geom.x, y: geom.stackTopY }, { x: geom.exitX, y: geom.roofY }, { x: geom.exitX, y: geom.roofY - EXIT_MM }] : null,
      widthMm: bundleWidthMm(group.length),
    });
  }

  // Lateral offsets: bundles on the same manager sit side by side, ordered by level (highest device first).
  const byManager = new Map<string, Bundle[]>();
  for (const b of bundles) {
    const k = `${b.rackId}:${b.side}`;
    const arr = byManager.get(k);
    if (arr) arr.push(b);
    else byManager.set(k, [b]);
  }
  for (const arr of byManager.values()) {
    arr.sort((a, b) => a.y - b.y || a.componentId.localeCompare(b.componentId));
    const n = arr.length;
    arr.forEach((b, i) => {
      const offset = (i - (n - 1) / 2) * BUNDLE_PITCH_MM;
      b.x += offset;
      if (b.exit) b.exit[0] = { x: b.x, y: b.exit[0]!.y };
    });
  }

  // Per-cable highlight paths (after offsets are final).
  for (const b of bundles) {
    for (const c of b.cables) {
      const end = ends.find((e) => e.linkId === c.linkId && e.componentId === b.componentId && e.portId === c.portId);
      const targetY = !end || end.target.kind === 'exit' ? b.runY0 : end.target.y;
      const path: Vec2[] = [c.port, { x: b.fanX, y: b.y }, { x: b.x, y: b.y }];
      if (targetY !== b.y) path.push({ x: b.x, y: targetY });
      if (end?.target.kind === 'exit' && b.exit) path.push(...b.exit.slice(1));
      c.path = path;
    }
  }

  return bundles.sort((a, b) => a.rackId.localeCompare(b.rackId) || a.y - b.y);
}
