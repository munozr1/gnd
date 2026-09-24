/**
 * Wire (link) geometry on the schematic: auto-elbow routing between pins, the
 * full polyline of a link, segment dragging, label anchoring and hit-testing.
 * A link stores only its intermediate points (`link.sch.wirePoints`); the pin
 * ends are always derived from the current symbol layout.
 */
import { add, closestPointOnPolyline, dist, dot, orthogonalZ, polylineLength, scale, simplifyOrthogonal } from '../geometry';
import { indexProject } from '../query';
import type { Link, Project, Vec2 } from '../types';
import { componentLayout, pinEndpoint } from './symbolGeometry';

/** Clearance a wire keeps in the pin direction before turning. */
export const WIRE_STUB = 20;

const EPS = 1e-6;

/**
 * Intermediate elbow points (excluding the pin ends) of an orthogonal wire
 * between two pins. The wire leaves each pin along its `dir` for `stub` before
 * turning, so its first leg exits a pin (or a '+N unused' stub) in the pin's
 * own direction rather than through the body. The midpoint Z-jog of
 * `orthogonalZ` is used whenever it honours both exits; when it would run back
 * over a pin (both pins facing the same way, or one behind the other) the
 * shortest elbow / detour that honours them is used instead.
 */
export function autoWirePoints(aPos: Vec2, aDir: Vec2, bPos: Vec2, bDir: Vec2, stub = WIRE_STUB): Vec2[] {
  const natural = orthogonalZ(aPos, aDir, bPos, bDir, stub);
  const route = doublesBack([aPos, ...natural, bPos]) ? (cleanRoute(aPos, aDir, bPos, bDir, stub) ?? natural) : natural;
  // Drop points that collapse onto the ends; squash -0 so consumers can compare with ===.
  return simplifyOrthogonal([aPos, ...route, bPos])
    .slice(1, -1)
    .map((p) => ({ x: p.x + 0, y: p.y + 0 }));
}

/** True when two consecutive non-empty legs reverse direction, i.e. the wire runs back over itself (through a pin). */
function doublesBack(points: readonly Vec2[]): boolean {
  let prev: Vec2 | undefined;
  for (let i = 1; i < points.length; i++) {
    const d = { x: points[i]!.x - points[i - 1]!.x, y: points[i]!.y - points[i - 1]!.y };
    if (Math.abs(d.x) < EPS && Math.abs(d.y) < EPS) continue;
    if (prev && dot(prev, d) < 0) return true;
    prev = d;
  }
  return false;
}

/**
 * Elbow route from the end of pin a's lead to the end of pin b's lead that never
 * doubles back over either pin: the two L routes, the two Z routes and the four
 * U detours (one `stub` beyond the leads) are tried; the winner has the fewest
 * bends, then the shortest length. Undefined when none is clean.
 */
function cleanRoute(aPos: Vec2, aDir: Vec2, bPos: Vec2, bDir: Vec2, stub: number): Vec2[] | undefined {
  const a1 = add(aPos, scale(aDir, stub));
  const b1 = add(bPos, scale(bDir, stub));
  const midX = (a1.x + b1.x) / 2;
  const midY = (a1.y + b1.y) / 2;
  const candidates: Vec2[][] = [
    [{ x: b1.x, y: a1.y }],
    [{ x: a1.x, y: b1.y }],
    [
      { x: midX, y: a1.y },
      { x: midX, y: b1.y },
    ],
    [
      { x: a1.x, y: midY },
      { x: b1.x, y: midY },
    ],
    ...[Math.min(a1.x, b1.x) - stub, Math.max(a1.x, b1.x) + stub].map((x) => [
      { x, y: a1.y },
      { x, y: b1.y },
    ]),
    ...[Math.min(a1.y, b1.y) - stub, Math.max(a1.y, b1.y) + stub].map((y) => [
      { x: a1.x, y },
      { x: b1.x, y },
    ]),
  ];
  let best: { route: Vec2[]; bends: number; length: number } | undefined;
  for (const elbows of candidates) {
    const full = [aPos, a1, ...elbows, b1, bPos];
    if (doublesBack(full)) continue;
    const simplified = simplifyOrthogonal(full);
    const bends = simplified.length - 2;
    const length = polylineLength(simplified);
    if (!best || bends < best.bends || (bends === best.bends && length < best.length - EPS)) {
      best = { route: [a1, ...elbows, b1], bends, length };
    }
  }
  return best?.route;
}

export interface WireEnd {
  pos: Vec2;
  dir: Vec2;
  /** True when the port is hidden behind a '+N unused' stub and the wire attaches to that stub. */
  hidden: boolean;
}

/** Attachment points of both link ends, or undefined when a component / port is missing. */
export function wireEndpoints(link: Link, project: Project): { a: WireEnd; b: WireEnd } | undefined {
  const la = componentLayout(project, link.a.componentId);
  const lb = componentLayout(project, link.b.componentId);
  if (!la || !lb) return undefined;
  const a = pinEndpoint(la, link.a.portId);
  const b = pinEndpoint(lb, link.b.portId);
  if (!a || !b) return undefined;
  return { a, b };
}

/**
 * Complete polyline of a link including both pin ends. Uses the stored elbow
 * points when present, otherwise auto-routes. Empty when an end cannot be resolved.
 */
export function fullWirePolyline(link: Link, project: Project): Vec2[] {
  const ends = wireEndpoints(link, project);
  if (!ends) return [];
  const mid = link.sch.wirePoints.length
    ? link.sch.wirePoints
    : autoWirePoints(ends.a.pos, ends.a.dir, ends.b.pos, ends.b.dir);
  return simplifyOrthogonal([ends.a.pos, ...mid, ends.b.pos]);
}

/** The stored form of a full polyline: everything but the pin ends. */
export function wirePointsFromPolyline(points: readonly Vec2[]): Vec2[] {
  return points.length <= 2 ? [] : points.slice(1, -1).map((p) => ({ ...p }));
}

/** Remove zero-length and collinear runs; call after a drag is finished. */
export const simplifyWire = (points: readonly Vec2[]): Vec2[] => simplifyOrthogonal(points);

const isHorizontal = (a: Vec2, b: Vec2): boolean => Math.abs(a.y - b.y) < EPS;
const isVertical = (a: Vec2, b: Vec2): boolean => Math.abs(a.x - b.x) < EPS;

/**
 * Move segment `segmentIndex` (points[i] -> points[i+1]) perpendicular to
 * itself by the matching component of `delta`, keeping neighbouring segments
 * orthogonal. The first / last point are pin ends and never move: dragging an
 * end segment inserts a new corner so the pin keeps a short lead. Returns a
 * new array; the input is not mutated.
 */
export function dragWireSegment(points: readonly Vec2[], segmentIndex: number, delta: Vec2): Vec2[] {
  const pts = points.map((p) => ({ ...p }));
  if (pts.length < 2 || segmentIndex < 0 || segmentIndex >= pts.length - 1) return pts;
  let i = segmentIndex;
  // Protect the pin ends by splitting off a zero-length lead that becomes the connector.
  if (i === 0) {
    pts.splice(1, 0, { ...pts[0]! });
    i = 1;
  }
  if (i === pts.length - 2) {
    pts.splice(pts.length - 1, 0, { ...pts[pts.length - 1]! });
  }
  const p = pts[i]!;
  const q = pts[i + 1]!;
  if (isHorizontal(p, q) && !isVertical(p, q)) {
    p.y += delta.y;
    q.y += delta.y;
  } else if (isVertical(p, q)) {
    p.x += delta.x;
    q.x += delta.x;
  } else {
    // Diagonal (stale after a move): translate freely.
    p.x += delta.x;
    p.y += delta.y;
    q.x += delta.x;
    q.y += delta.y;
  }
  return pts;
}

/** Point half-way along the polyline (by length). */
export function wireMidpoint(points: readonly Vec2[]): Vec2 {
  return wireLabelAnchor(points).pos;
}

/** Midpoint plus the orientation of the segment it lies on, for label placement. */
export function wireLabelAnchor(points: readonly Vec2[]): { pos: Vec2; horizontal: boolean; segmentIndex: number } {
  if (points.length === 0) return { pos: { x: 0, y: 0 }, horizontal: true, segmentIndex: 0 };
  if (points.length === 1) return { pos: { ...points[0]! }, horizontal: true, segmentIndex: 0 };
  const half = polylineLength(points) / 2;
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const d = dist(a, b);
    if (acc + d >= half || i === points.length - 1) {
      const t = d === 0 ? 0 : (half - acc) / d;
      return {
        pos: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        horizontal: Math.abs(b.x - a.x) >= Math.abs(b.y - a.y),
        segmentIndex: i - 1,
      };
    }
    acc += d;
  }
  return { pos: { ...points[0]! }, horizontal: true, segmentIndex: 0 };
}

export interface WireHit {
  segmentIndex: number;
  point: Vec2;
  dist: number;
}

/** Closest segment within `tolerance` of `p`, or null. */
export function hitTestWire(points: readonly Vec2[], p: Vec2, tolerance: number): WireHit | null {
  const r = closestPointOnPolyline(p, points);
  if (!r || r.dist > tolerance) return null;
  return { segmentIndex: r.segmentIndex, point: r.point, dist: r.dist };
}

/**
 * Links with both ends on a sheet, with their full polylines, for rendering /
 * hit-testing in one pass. Links crossing sheets are not wires here; they
 * surface as hierarchical pins (see `crossSheetLinks`).
 */
export function sheetWires(project: Project, sheetId: string): { link: Link; points: Vec2[] }[] {
  const idx = indexProject(project);
  const out: { link: Link; points: Vec2[] }[] = [];
  for (const link of project.links) {
    const ca = idx.component(link.a.componentId);
    const cb = idx.component(link.b.componentId);
    if (ca?.sch.sheetId !== sheetId || cb?.sch.sheetId !== sheetId) continue;
    out.push({ link, points: fullWirePolyline(link, project) });
  }
  return out;
}
