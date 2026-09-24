/**
 * Group polylines by stroke style so thousands of thin lines draw as one
 * canvas path per style. Pure; the drawing side lives in ./draw.ts.
 */
import type { Vec2 } from '@/model/types';

export interface StrokeItem {
  color: string;
  /** 0..1, default 1. */
  alpha?: number;
  /** Line width in screen pixels, default 1. */
  width?: number;
  points: readonly Vec2[];
}

export interface StrokeBatch {
  key: string;
  color: string;
  alpha: number;
  width: number;
  /** Flat [x0, y0, x1, y1, ...] per polyline. */
  lines: number[][];
  segmentCount: number;
}

export const batchKey = (color: string, alpha: number, width: number): string => `${color}|${alpha}|${width}`;

/** Batches in order of first appearance; polylines with fewer than two points are dropped. */
export function batchStrokes(items: readonly StrokeItem[]): StrokeBatch[] {
  const map = new Map<string, StrokeBatch>();
  for (const it of items) {
    if (it.points.length < 2) continue;
    const alpha = it.alpha ?? 1;
    const width = it.width ?? 1;
    const key = batchKey(it.color, alpha, width);
    let b = map.get(key);
    if (!b) {
      b = { key, color: it.color, alpha, width, lines: [], segmentCount: 0 };
      map.set(key, b);
    }
    const flat = new Array<number>(it.points.length * 2);
    for (let i = 0; i < it.points.length; i++) {
      const p = it.points[i]!;
      flat[i * 2] = p.x;
      flat[i * 2 + 1] = p.y;
    }
    b.lines.push(flat);
    b.segmentCount += it.points.length - 1;
  }
  return [...map.values()];
}
