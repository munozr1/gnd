/**
 * rbush-backed segment index for hit-testing thousands of thin lines
 * (airwires, route parts, tray centrelines) in world millimetres.
 */
import RBush from 'rbush';
import { closestPointOnSegment, type Rect } from '@/model/geometry';
import type { Vec2 } from '@/model/types';

export interface SegmentEntry<T> {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  a: Vec2;
  b: Vec2;
  ref: T;
}

export interface SegmentHit<T> {
  ref: T;
  dist: number;
  point: Vec2;
  a: Vec2;
  b: Vec2;
}

export const segmentEntry = <T>(a: Vec2, b: Vec2, ref: T): SegmentEntry<T> => ({
  minX: Math.min(a.x, b.x),
  minY: Math.min(a.y, b.y),
  maxX: Math.max(a.x, b.x),
  maxY: Math.max(a.y, b.y),
  a,
  b,
  ref,
});

export class SegmentIndex<T> {
  private readonly tree = new RBush<SegmentEntry<T>>();
  private count = 0;

  constructor(entries?: readonly SegmentEntry<T>[]) {
    if (entries?.length) this.load(entries);
  }

  get size(): number {
    return this.count;
  }

  load(entries: readonly SegmentEntry<T>[]): this {
    this.tree.load(entries);
    this.count += entries.length;
    return this;
  }

  /** Every entry whose bbox intersects `rect`. */
  searchRect(rect: Rect): SegmentEntry<T>[] {
    return this.tree.search({ minX: rect.x, minY: rect.y, maxX: rect.x + rect.width, maxY: rect.y + rect.height });
  }

  /** Closest segment within `tolerance` of `p`, or null. `accept` filters candidates. */
  nearest(p: Vec2, tolerance: number, accept?: (ref: T) => boolean): SegmentHit<T> | null {
    const cands = this.tree.search({ minX: p.x - tolerance, minY: p.y - tolerance, maxX: p.x + tolerance, maxY: p.y + tolerance });
    let best: SegmentHit<T> | null = null;
    for (const c of cands) {
      if (accept && !accept(c.ref)) continue;
      const r = closestPointOnSegment(p, c.a, c.b);
      if (r.dist <= tolerance && (!best || r.dist < best.dist)) best = { ref: c.ref, dist: r.dist, point: r.point, a: c.a, b: c.b };
    }
    return best;
  }
}
