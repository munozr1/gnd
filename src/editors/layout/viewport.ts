/**
 * Floor-plan viewport math. World units are millimetres; the screen is
 * `world * scale + offset` in CSS pixels. At zoom 1 one pixel is 10 mm.
 */
import type { Rect } from '@/model/geometry';
import type { Vec2 } from '@/model/types';

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

/** px per mm at zoom 1 (1 px = 10 mm). */
export const BASE_SCALE = 0.1;
export const MIN_SCALE = 0.004;
export const MAX_SCALE = 8;
/** Above this scale airwires attach to port positions instead of rack centres. */
export const PORT_DETAIL_SCALE = 0.3;

export const clampScale = (s: number, min = MIN_SCALE, max = MAX_SCALE): number => Math.min(max, Math.max(min, s));

export const worldToScreen = (vp: Viewport, p: Vec2): Vec2 => ({ x: p.x * vp.scale + vp.x, y: p.y * vp.scale + vp.y });
export const screenToWorld = (vp: Viewport, p: Vec2): Vec2 => ({ x: (p.x - vp.x) / vp.scale, y: (p.y - vp.y) / vp.scale });

/** Zoom level relative to the default (1 = 1 px per 10 mm). */
export const zoomLevel = (vp: Viewport): number => vp.scale / BASE_SCALE;

/** Scale by `factor` keeping the world point under `screen` fixed. */
export function zoomAt(vp: Viewport, screen: Vec2, factor: number, min = MIN_SCALE, max = MAX_SCALE): Viewport {
  const scale = clampScale(vp.scale * factor, min, max);
  if (scale === vp.scale) return vp;
  const w = screenToWorld(vp, screen);
  return { scale, x: screen.x - w.x * scale, y: screen.y - w.y * scale };
}

export const panBy = (vp: Viewport, delta: Vec2): Viewport => ({ ...vp, x: vp.x + delta.x, y: vp.y + delta.y });

/** Viewport that shows `rect` centred with `paddingPx` around it. Degenerate rects centre at the default zoom. */
export function fitRect(rect: Rect, size: Size, paddingPx = 40, min = MIN_SCALE, max = MAX_SCALE): Viewport {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const availW = Math.max(1, size.width - 2 * paddingPx);
  const availH = Math.max(1, size.height - 2 * paddingPx);
  let scale = BASE_SCALE;
  if (rect.width > 0 || rect.height > 0) {
    const sx = rect.width > 0 ? availW / rect.width : Infinity;
    const sy = rect.height > 0 ? availH / rect.height : Infinity;
    scale = clampScale(Math.min(sx, sy), min, max);
  }
  return { scale, x: size.width / 2 - cx * scale, y: size.height / 2 - cy * scale };
}

/** World rect currently visible in a `size` canvas. */
export function visibleWorldRect(vp: Viewport, size: Size): Rect {
  const tl = screenToWorld(vp, { x: 0, y: 0 });
  const br = screenToWorld(vp, { x: size.width, y: size.height });
  return { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y };
}

/** Grow a rect by a margin on every side. */
export const inflateRect = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, width: r.width + 2 * m, height: r.height + 2 * m });

/** Union of rects; null for an empty list. */
export function unionRects(rects: readonly Rect[]): Rect | null {
  let out: Rect | null = null;
  for (const r of rects) {
    if (!out) {
      out = { ...r };
      continue;
    }
    const x = Math.min(out.x, r.x);
    const y = Math.min(out.y, r.y);
    const x2 = Math.max(out.x + out.width, r.x + r.width);
    const y2 = Math.max(out.y + out.height, r.y + r.height);
    out = { x, y, width: x2 - x, height: y2 - y };
  }
  return out;
}

/** Format a world position for the status bar. */
export const formatMm = (p: Vec2): string => `x ${Math.round(p.x)}  y ${Math.round(p.y)} mm`;
