/**
 * Viewport math for a Konva stage: world (mm) -> screen (px) is
 * `screen = world * scale + offset`. Pure, so it can be unit tested.
 */
import type { Rect } from '@/model/geometry';
import type { Vec2 } from '@/model/types';
import { MAX_PX_PER_MM, MIN_PX_PER_MM } from './constants';

export interface Viewport {
  x: number;
  y: number;
  /** Pixels per millimetre. */
  scale: number;
}

export interface Size {
  width: number;
  height: number;
}

export const clampScale = (s: number): number => Math.min(MAX_PX_PER_MM, Math.max(MIN_PX_PER_MM, s));

export const screenToWorld = (v: Viewport, p: Vec2): Vec2 => ({ x: (p.x - v.x) / v.scale, y: (p.y - v.y) / v.scale });
export const worldToScreen = (v: Viewport, p: Vec2): Vec2 => ({ x: p.x * v.scale + v.x, y: p.y * v.scale + v.y });

/** Zoom by `factor` keeping the world point under screen `at` fixed. */
export function zoomAt(v: Viewport, at: Vec2, factor: number): Viewport {
  const scale = clampScale(v.scale * factor);
  const world = screenToWorld(v, at);
  return { scale, x: at.x - world.x * scale, y: at.y - world.y * scale };
}

/** Fit a world rect into the stage with `paddingPx` on every side. */
export function fitRect(rect: Rect, size: Size, paddingPx = 32, maxScale = MAX_PX_PER_MM): Viewport {
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  const availW = Math.max(1, size.width - paddingPx * 2);
  const availH = Math.max(1, size.height - paddingPx * 2);
  const scale = clampScale(Math.min(availW / w, availH / h, maxScale));
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return { scale, x: size.width / 2 - cx * scale, y: size.height / 2 - cy * scale };
}

/** The world rect currently visible. */
export function visibleWorld(v: Viewport, size: Size): Rect {
  const tl = screenToWorld(v, { x: 0, y: 0 });
  const br = screenToWorld(v, { x: size.width, y: size.height });
  return { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
}

export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export const padRect = (r: Rect, padMm: number): Rect => ({
  x: r.x - padMm,
  y: r.y - padMm,
  width: r.width + padMm * 2,
  height: r.height + padMm * 2,
});
