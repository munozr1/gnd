/**
 * Viewport math for the schematic stage. The stage draws world units scaled
 * by `scale` and offset by (x, y) screen pixels:
 *   screen = world * scale + (x, y)
 * Pure; no Konva or React.
 */
import type { Rect } from '@/model/geometry';
import type { Vec2 } from '@/model/types';

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_SCALE = 0.05;
export const MAX_SCALE = 8;
export const DEFAULT_VIEWPORT: Viewport = { x: 60, y: 60, scale: 1 };
/** Screen pixels kept around content by `fitRect`. */
export const FIT_PADDING = 48;
/** `fitRect` never zooms in past this, so a single small symbol stays readable rather than huge. */
export const FIT_MAX_SCALE = 2.5;

export const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export const screenToWorld = (vp: Viewport, p: Vec2): Vec2 => ({ x: (p.x - vp.x) / vp.scale, y: (p.y - vp.y) / vp.scale });
export const worldToScreen = (vp: Viewport, p: Vec2): Vec2 => ({ x: p.x * vp.scale + vp.x, y: p.y * vp.scale + vp.y });

export const sameViewport = (a: Viewport, b: Viewport): boolean => a.x === b.x && a.y === b.y && a.scale === b.scale;

/** Zoom by `factor` keeping the world point under `screen` fixed. */
export function zoomAt(vp: Viewport, screen: Vec2, factor: number): Viewport {
  const scale = clampScale(vp.scale * factor);
  if (scale === vp.scale) return vp;
  const k = scale / vp.scale;
  return { x: screen.x - (screen.x - vp.x) * k, y: screen.y - (screen.y - vp.y) * k, scale };
}

export const panBy = (vp: Viewport, delta: Vec2): Viewport =>
  delta.x === 0 && delta.y === 0 ? vp : { ...vp, x: vp.x + delta.x, y: vp.y + delta.y };

/** Viewport that shows `rect` centred, as large as fits (bounded by `maxScale`). */
export function fitRect(rect: Rect, size: Size, opts: { padding?: number; maxScale?: number } = {}): Viewport {
  const padding = opts.padding ?? FIT_PADDING;
  const maxScale = opts.maxScale ?? FIT_MAX_SCALE;
  const w = Math.max(rect.width, 1);
  const h = Math.max(rect.height, 1);
  const availW = Math.max(size.width - 2 * padding, 1);
  const availH = Math.max(size.height - 2 * padding, 1);
  const scale = clampScale(Math.min(availW / w, availH / h, maxScale));
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return { x: size.width / 2 - cx * scale, y: size.height / 2 - cy * scale, scale };
}

/** World-space rectangle currently on screen. */
export function visibleWorldRect(vp: Viewport, size: Size): Rect {
  const tl = screenToWorld(vp, { x: 0, y: 0 });
  const br = screenToWorld(vp, { x: size.width, y: size.height });
  return { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
}

/** Wheel delta -> zoom factor (deltaMode 1 = lines, 2 = pages). Clamped so one notch never jumps too far. */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const f = Math.exp(-px * 0.0018);
  return Math.min(1.6, Math.max(1 / 1.6, f));
}

/** Zoom about the centre of the view by a fixed step (toolbar / keyboard). */
export const zoomStep = (vp: Viewport, size: Size, direction: 1 | -1): Viewport =>
  zoomAt(vp, { x: size.width / 2, y: size.height / 2 }, direction > 0 ? 1.25 : 0.8);

/** Grow a rect by `pad` on every side (world units). */
export const padRect = (r: Rect, pad: number): Rect => ({ x: r.x - pad, y: r.y - pad, width: r.width + 2 * pad, height: r.height + 2 * pad });

/** Union of two rects (either may be null). */
export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
