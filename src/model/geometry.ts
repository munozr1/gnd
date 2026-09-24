import type { Vec2 } from './types';

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const manhattan = (a: Vec2, b: Vec2): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
export const eq = (a: Vec2, b: Vec2, eps = 1e-6): boolean =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

export const snap = (v: number, grid: number): number => (grid > 0 ? Math.round(v / grid) * grid : v);
export const snapVec = (p: Vec2, grid: number): Vec2 => ({ x: snap(p.x, grid), y: snap(p.y, grid) });

/** Total length of a polyline. */
export function polylineLength(points: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1]!, points[i]!);
  return total;
}

/** Rotate a point about the origin by a multiple of 90 degrees. */
export function rotate90(p: Vec2, deg: 0 | 90 | 180 | 270): Vec2 {
  switch (deg) {
    case 0:
      return { x: p.x, y: p.y };
    case 90:
      return { x: -p.y, y: p.x };
    case 180:
      return { x: -p.x, y: -p.y };
    case 270:
      return { x: p.y, y: -p.x };
  }
}

export function rotateDeg(p: Vec2, deg: number): Vec2 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Closest point on segment ab to p, and the distance. */
export function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; dist: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  let t = l2 === 0 ? 0 : dot(sub(p, a), ab) / l2;
  t = Math.max(0, Math.min(1, t));
  const point = add(a, scale(ab, t));
  return { point, t, dist: dist(p, point) };
}

/** Closest point on a polyline to p. */
export function closestPointOnPolyline(
  p: Vec2,
  points: readonly Vec2[],
): { point: Vec2; segmentIndex: number; t: number; dist: number } | null {
  let best: { point: Vec2; segmentIndex: number; t: number; dist: number } | null = null;
  for (let i = 1; i < points.length; i++) {
    const r = closestPointOnSegment(p, points[i - 1]!, points[i]!);
    if (!best || r.dist < best.dist) best = { point: r.point, segmentIndex: i - 1, t: r.t, dist: r.dist };
  }
  return best;
}

/** Point-in-polygon (ray casting). */
export function pointInPolygon(p: Vec2, poly: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]!;
    const pj = poly[j]!;
    const intersect =
      pi.y > p.y !== pj.y > p.y && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const rectContains = (r: Rect, p: Vec2): boolean =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

export const rectsIntersect = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export function rectCenter(r: Rect): Vec2 {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function boundsOf(points: readonly Vec2[]): Rect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Axis-aligned bounding box of a rack on the floor plan. `pos` is the
 * top-left of the footprint at rotation 0; rotation swaps width/depth.
 */
export function rackRect(rack: { pos: Vec2; rotationDeg: 0 | 90 | 180 | 270; widthMm: number; depthMm: number }): Rect {
  const rotated = rack.rotationDeg === 90 || rack.rotationDeg === 270;
  const w = rotated ? rack.depthMm : rack.widthMm;
  const h = rotated ? rack.widthMm : rack.depthMm;
  return { x: rack.pos.x, y: rack.pos.y, width: w, height: h };
}

/**
 * Orthogonal route between two points with a single elbow. `preferHorizontalFirst`
 * decides whether the first leg is horizontal. Returns the intermediate elbow
 * point(s) only (excluding a and b); empty if already aligned.
 */
export function orthogonalElbow(a: Vec2, b: Vec2, preferHorizontalFirst = true): Vec2[] {
  if (eq(a, b)) return [];
  if (Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6) return [];
  return preferHorizontalFirst ? [{ x: b.x, y: a.y }] : [{ x: a.x, y: b.y }];
}

/**
 * Orthogonal route between two pins that exit in given directions, with a
 * midpoint jog (Z-shape). Returns intermediate points excluding a and b.
 * Directions are unit-ish vectors pointing away from the pin.
 */
export function orthogonalZ(a: Vec2, aDir: Vec2, b: Vec2, bDir: Vec2, stub = 20): Vec2[] {
  const a1 = add(a, scale(aDir, stub));
  const b1 = add(b, scale(bDir, stub));
  const horizontalA = Math.abs(aDir.x) > Math.abs(aDir.y);
  const horizontalB = Math.abs(bDir.x) > Math.abs(bDir.y);
  const pts: Vec2[] = [a1];
  if (horizontalA && horizontalB) {
    const midX = (a1.x + b1.x) / 2;
    pts.push({ x: midX, y: a1.y }, { x: midX, y: b1.y });
  } else if (!horizontalA && !horizontalB) {
    const midY = (a1.y + b1.y) / 2;
    pts.push({ x: a1.x, y: midY }, { x: b1.x, y: midY });
  } else if (horizontalA) {
    pts.push({ x: b1.x, y: a1.y });
  } else {
    pts.push({ x: a1.x, y: b1.y });
  }
  pts.push(b1);
  // Collapse duplicates / collinear runs.
  return simplifyOrthogonal(pts);
}

/** Remove duplicate consecutive points and collinear interior points from a polyline. */
export function simplifyOrthogonal(points: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    if (out.length && eq(out[out.length - 1]!, p)) continue;
    out.push({ ...p });
  }
  let changed = true;
  while (changed && out.length >= 3) {
    changed = false;
    for (let i = 1; i < out.length - 1; i++) {
      const p = out[i - 1]!;
      const q = out[i]!;
      const r = out[i + 1]!;
      const collinear =
        (Math.abs(p.x - q.x) < 1e-6 && Math.abs(q.x - r.x) < 1e-6) ||
        (Math.abs(p.y - q.y) < 1e-6 && Math.abs(q.y - r.y) < 1e-6);
      if (collinear) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/** Angle in degrees at the corner b between segments ab and bc (0 = straight through, 90 = right angle). */
export function cornerAngleDeg(a: Vec2, b: Vec2, c: Vec2): number {
  const u = sub(b, a);
  const v = sub(c, b);
  const lu = len(u);
  const lv = len(v);
  if (lu === 0 || lv === 0) return 0;
  const cos = Math.max(-1, Math.min(1, dot(u, v) / (lu * lv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Segment-segment intersection test (proper or touching). */
export function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Whether a segment intersects or lies within a polygon. */
export function segmentIntersectsPolygon(a: Vec2, b: Vec2, poly: readonly Vec2[]): boolean {
  if (pointInPolygon(a, poly) || pointInPolygon(b, poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segmentsIntersect(a, b, poly[j]!, poly[i]!)) return true;
  }
  return false;
}

export function rectToPolygon(r: Rect): Vec2[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ];
}

/** Rect-polygon overlap test (any edge intersection or containment either way). */
export function rectIntersectsPolygon(r: Rect, poly: readonly Vec2[]): boolean {
  const rp = rectToPolygon(r);
  for (let i = 0; i < 4; i++) {
    if (segmentIntersectsPolygon(rp[i]!, rp[(i + 1) % 4]!, poly)) return true;
  }
  return poly.some((p) => rectContains(r, p));
}

/** Minimum distance from a point to a polygon boundary. */
export function distanceToPolygonEdge(p: Vec2, poly: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    best = Math.min(best, closestPointOnSegment(p, poly[j]!, poly[i]!).dist);
  }
  return best;
}
