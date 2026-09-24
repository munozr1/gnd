/**
 * Uniform-grid spatial index over line segments for pointer hit-testing of
 * thousands of thin wires without per-shape Konva hit regions. Segments are
 * bucketed by the grid cells their bounding box covers; a query scans the
 * cells around the point and returns the nearest segment within tolerance.
 */
import { closestPointOnSegment } from '@/model/geometry';
import type { Vec2 } from '@/model/types';

export interface IndexedSegment<T> {
  a: Vec2;
  b: Vec2;
  data: T;
}

export interface SegmentHit<T> {
  segment: IndexedSegment<T>;
  point: Vec2;
  dist: number;
}

export class SegmentIndex<T> {
  private readonly cells = new Map<string, IndexedSegment<T>[]>();
  private count = 0;

  constructor(readonly cellSize = 250) {}

  get size(): number {
    return this.count;
  }

  private key(cx: number, cy: number): string {
    return `${cx}:${cy}`;
  }

  add(a: Vec2, b: Vec2, data: T): void {
    const seg: IndexedSegment<T> = { a, b, data };
    const s = this.cellSize;
    const x0 = Math.floor(Math.min(a.x, b.x) / s);
    const x1 = Math.floor(Math.max(a.x, b.x) / s);
    const y0 = Math.floor(Math.min(a.y, b.y) / s);
    const y1 = Math.floor(Math.max(a.y, b.y) / s);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.key(cx, cy);
        const arr = this.cells.get(k);
        if (arr) arr.push(seg);
        else this.cells.set(k, [seg]);
      }
    }
    this.count++;
  }

  addPolyline(points: readonly Vec2[], data: T): void {
    for (let i = 1; i < points.length; i++) this.add(points[i - 1]!, points[i]!, data);
  }

  /** Nearest segment within `tolerance` of `p`, or null. */
  nearest(p: Vec2, tolerance: number): SegmentHit<T> | null {
    const s = this.cellSize;
    const x0 = Math.floor((p.x - tolerance) / s);
    const x1 = Math.floor((p.x + tolerance) / s);
    const y0 = Math.floor((p.y - tolerance) / s);
    const y1 = Math.floor((p.y + tolerance) / s);
    let best: SegmentHit<T> | null = null;
    const seen = new Set<IndexedSegment<T>>();
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const arr = this.cells.get(this.key(cx, cy));
        if (!arr) continue;
        for (const seg of arr) {
          if (seen.has(seg)) continue;
          seen.add(seg);
          const r = closestPointOnSegment(p, seg.a, seg.b);
          if (r.dist <= tolerance && (!best || r.dist < best.dist)) best = { segment: seg, point: r.point, dist: r.dist };
        }
      }
    }
    return best;
  }
}
