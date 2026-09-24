/**
 * Pure helpers for the routing and drawing tools: angle constraints, entry
 * point snapping, tray detection and layer cycling.
 */
import { closestPointOnPolyline, dist } from '@/model/geometry';
import type { Id, RoutingLayer, Tray, Vec2 } from '@/model/types';

export type AngleMode = 'ortho' | 'diag' | 'free';

/** Snap distance for drops onto rack entry points. */
export const ENTRY_SNAP_MM = 600;
/** Waypoint snap tolerance (grid / tray centreline / existing cable points). */
export const WAYPOINT_SNAP_MM = 150;

/**
 * Constrain `p` relative to `anchor`: 'ortho' keeps the segment horizontal
 * or vertical (whichever is closer), 'diag' allows multiples of 45° (the
 * point projects onto the nearest direction), 'free' returns `p`.
 */
export function constrainPoint(anchor: Vec2, p: Vec2, mode: AngleMode): Vec2 {
  if (mode === 'free') return { x: p.x, y: p.y };
  const dx = p.x - anchor.x;
  const dy = p.y - anchor.y;
  if (mode === 'ortho') return Math.abs(dx) >= Math.abs(dy) ? { x: p.x, y: anchor.y } : { x: anchor.x, y: p.y };
  const len = Math.hypot(dx, dy);
  if (len === 0) return { x: anchor.x, y: anchor.y };
  const step = Math.PI / 4;
  const ang = Math.atan2(dy, dx);
  const snapped = Math.round(ang / step) * step;
  const l = len * Math.cos(ang - snapped);
  const x = anchor.x + Math.cos(snapped) * l;
  const y = anchor.y + Math.sin(snapped) * l;
  return { x: Math.abs(x) < 1e-9 ? 0 : x, y: Math.abs(y) < 1e-9 ? 0 : y };
}

/** Angle mode for a pointer event: Shift → 45°, else the tool's mode. */
export const angleModeFor = (base: AngleMode, shift: boolean): AngleMode => (base === 'free' ? 'free' : shift ? 'diag' : base);

export const toggleFreeAngle = (mode: AngleMode): AngleMode => (mode === 'free' ? 'ortho' : 'free');

export const LAYER_ORDER: readonly RoutingLayer[] = ['overhead', 'in-rack', 'underfloor'];

/** Layer V switches to: overhead → in-rack → underfloor → overhead. */
export function nextLayer(layer: RoutingLayer): RoutingLayer {
  const i = LAYER_ORDER.indexOf(layer);
  return LAYER_ORDER[(i + 1) % LAYER_ORDER.length] ?? 'overhead';
}

export interface EntryPoint {
  rackId: Id;
  kind: 'topLeft' | 'topRight' | 'bottom';
  pos: Vec2;
}

/** Nearest rack entry point within `maxDist` (mm), or null. Ties resolve to the first in list order. */
export function nearestEntryPoint(p: Vec2, entries: readonly EntryPoint[], maxDist = ENTRY_SNAP_MM): EntryPoint | null {
  let best: EntryPoint | null = null;
  let bestD = maxDist;
  for (const e of entries) {
    const d = dist(p, e.pos);
    if (d <= bestD && (best === null || d < bestD)) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** Entry points that make sense for a drop between two layers (top entries for overhead, bottom for underfloor). */
export function entryKindsFor(from: RoutingLayer, to: RoutingLayer): ReadonlySet<EntryPoint['kind']> {
  const layers = [from, to];
  if (layers.includes('underfloor') && !layers.includes('overhead')) return new Set(['bottom']);
  if (layers.includes('overhead') && !layers.includes('underfloor')) return new Set(['topLeft', 'topRight']);
  return new Set(['topLeft', 'topRight', 'bottom']);
}

/** Id of the nearest tray (on `layer`, when given) whose centreline passes within `toleranceMm` of `p`. */
export function nearestTray(p: Vec2, trays: readonly Tray[], toleranceMm: number, layer?: RoutingLayer): Id | null {
  let best: Id | null = null;
  let bestD = toleranceMm;
  for (const t of trays) {
    if (layer && t.layer !== layer) continue;
    const c = closestPointOnPolyline(p, t.points);
    if (c && c.dist <= bestD) {
      bestD = c.dist;
      best = t.id;
    }
  }
  return best;
}

/**
 * The tray a hand-routed run lies along: every point must be within
 * `toleranceMm` of the same tray's centreline (on the run's layer). Returns
 * null when the points do not all follow one tray.
 */
export function trayAlongPolyline(points: readonly Vec2[], trays: readonly Tray[], toleranceMm: number, layer?: RoutingLayer): Id | null {
  if (points.length === 0) return null;
  for (const t of trays) {
    if (layer && t.layer !== layer) continue;
    if (t.points.length < 2) continue;
    let ok = true;
    for (const p of points) {
      const c = closestPointOnPolyline(p, t.points);
      if (!c || c.dist > toleranceMm) {
        ok = false;
        break;
      }
    }
    if (ok) return t.id;
  }
  return null;
}

/** Whether a tray already has a waterfall fitting serving `rackId`. */
export function hasWaterfallFor(tray: Pick<Tray, 'fittings'>, rackId: Id): boolean {
  return tray.fittings.some((f) => f.type === 'waterfall' && f.rackId === rackId);
}
