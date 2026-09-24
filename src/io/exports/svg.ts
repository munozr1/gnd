/**
 * Small SVG plotting kit shared by the rack elevation and schematic plots:
 * page sizes, XML escaping, primitives and the KiCad-style double frame with
 * a title block in the bottom-right corner. Everything is monochrome so the
 * plots print cleanly.
 */
import type { Vec2 } from '@/model/types';

export interface PageSize {
  w: number;
  h: number;
}

/** A4 at 72 dpi (points); the SVG user unit is 1 pt. */
export const A4_PORTRAIT: PageSize = { w: 595, h: 842 };
export const A4_LANDSCAPE: PageSize = { w: 842, h: 595 };

export const PAGE_MARGIN = 18;
export const FRAME_GAP = 4;
export const TITLE_BLOCK_W = 300;
export const TITLE_BLOCK_H = 58;

export const FONT_SANS = 'Helvetica, Arial, sans-serif';
export const FONT_MONO = 'Menlo, Consolas, monospace';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const esc = (s: unknown): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Compact number for attributes: at most 2 decimals, no trailing zeros. */
export const num = (n: number): string => {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
};

export interface TextOptions {
  size?: number;
  anchor?: 'start' | 'middle' | 'end';
  bold?: boolean;
  italic?: boolean;
  /** Degrees, about (x, y). */
  rotate?: number;
  baseline?: 'auto' | 'middle' | 'hanging' | 'central';
  fill?: string;
  mono?: boolean;
  className?: string;
}

export function text(x: number, y: number, s: string, o: TextOptions = {}): string {
  const attrs: string[] = [`x="${num(x)}"`, `y="${num(y)}"`, `font-size="${num(o.size ?? 8)}"`];
  attrs.push(`font-family="${o.mono ? FONT_MONO : FONT_SANS}"`);
  if (o.anchor && o.anchor !== 'start') attrs.push(`text-anchor="${o.anchor}"`);
  if (o.bold) attrs.push('font-weight="bold"');
  if (o.italic) attrs.push('font-style="italic"');
  if (o.baseline && o.baseline !== 'auto') attrs.push(`dominant-baseline="${o.baseline}"`);
  if (o.fill) attrs.push(`fill="${o.fill}"`);
  if (o.rotate) attrs.push(`transform="rotate(${num(o.rotate)} ${num(x)} ${num(y)})"`);
  if (o.className) attrs.push(`class="${o.className}"`);
  return `<text ${attrs.join(' ')}>${esc(s)}</text>`;
}

export function rect(x: number, y: number, w: number, h: number, attrs = 'fill="none" stroke="#000" stroke-width="1"'): string {
  return `<rect x="${num(x)}" y="${num(y)}" width="${num(Math.max(0, w))}" height="${num(Math.max(0, h))}" ${attrs}/>`;
}

export function line(x1: number, y1: number, x2: number, y2: number, attrs = 'stroke="#000" stroke-width="1"'): string {
  return `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" ${attrs}/>`;
}

export function polyline(points: readonly Vec2[], attrs = 'fill="none" stroke="#000" stroke-width="1"'): string {
  if (points.length === 0) return '';
  return `<polyline points="${points.map((p) => `${num(p.x)},${num(p.y)}`).join(' ')}" ${attrs}/>`;
}

export function group(inner: string, attrs = ''): string {
  return `<g${attrs ? ` ${attrs}` : ''}>${inner}</g>`;
}

export interface TitleField {
  label: string;
  value: string;
}

export interface FrameOptions {
  /** Bold heading of the title block, e.g. 'Rack elevation'. */
  title: string;
  fields: TitleField[];
  sheet?: { n: number; of: number };
  /** Small print in the bottom-left corner. */
  note?: string;
}

/**
 * Double frame plus the title block. Returns the markup and the area left
 * for the drawing (inside the inner frame, above the title-block band).
 */
export function plotFrame(page: PageSize, o: FrameOptions): { markup: string; drawArea: Box } {
  const m = PAGE_MARGIN;
  const ix = m + FRAME_GAP;
  const iy = m + FRAME_GAP;
  const iw = page.w - 2 * ix;
  const ih = page.h - 2 * iy;
  const parts: string[] = [];
  parts.push(rect(0, 0, page.w, page.h, 'fill="#fff" stroke="none"'));
  parts.push(rect(m, m, page.w - 2 * m, page.h - 2 * m, 'fill="none" stroke="#000" stroke-width="1.2"'));
  parts.push(rect(ix, iy, iw, ih, 'fill="none" stroke="#000" stroke-width="0.6"'));

  // Title block, bottom-right, inside the inner frame.
  const tw = Math.min(TITLE_BLOCK_W, iw);
  const th = TITLE_BLOCK_H;
  const tx = ix + iw - tw;
  const ty = iy + ih - th;
  parts.push(rect(tx, ty, tw, th, 'fill="#fff" stroke="#000" stroke-width="1"'));
  parts.push(line(tx, ty + 18, tx + tw, ty + 18, 'stroke="#000" stroke-width="0.6"'));
  parts.push(text(tx + 6, ty + 13, o.title, { size: 10, bold: true }));
  parts.push(text(tx + tw - 6, ty + 13, 'Datacenter EDA', { size: 7, anchor: 'end', fill: '#444' }));
  const cols = 2;
  const colW = tw / cols;
  const rowH = 12;
  o.fields.slice(0, 6).forEach((f, i) => {
    const cx = tx + 6 + (i % cols) * colW;
    const cy = ty + 18 + rowH * (Math.floor(i / cols) + 1) - 3;
    parts.push(text(cx, cy, `${f.label}: `, { size: 6.5, fill: '#444' }));
    parts.push(text(cx + 34, cy, f.value, { size: 7, bold: false }));
  });
  if (o.sheet) {
    parts.push(text(tx + tw - 6, ty + th - 5, `Sheet ${o.sheet.n} / ${o.sheet.of}`, { size: 7, anchor: 'end', bold: true }));
  }
  if (o.note) parts.push(text(ix + 4, iy + ih - 4, o.note, { size: 6, fill: '#444' }));

  const pad = 8;
  return {
    markup: parts.join(''),
    drawArea: { x: ix + pad, y: iy + pad, w: iw - 2 * pad, h: ih - th - 2 * pad },
  };
}

/** Wrap page content in a standalone SVG document. */
export function svgDocument(page: PageSize, inner: string, opts: { title?: string; description?: string } = {}): string {
  const head = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(page.w)}" height="${num(page.h)}" viewBox="0 0 ${num(page.w)} ${num(page.h)}" font-family="${FONT_SANS}">`;
  const title = opts.title ? `<title>${esc(opts.title)}</title>` : '';
  const desc = opts.description ? `<desc>${esc(opts.description)}</desc>` : '';
  return `${head}${open}${title}${desc}${inner}</svg>\n`;
}

/**
 * Several pages stacked vertically in one document (a "plot set"), each with
 * its own frame. `pages` are page-sized fragments in page coordinates.
 */
export function svgPlotSet(page: PageSize, pages: readonly string[], opts: { title?: string; gap?: number } = {}): string {
  const gap = opts.gap ?? 12;
  const total = { w: page.w, h: pages.length === 0 ? page.h : pages.length * page.h + (pages.length - 1) * gap };
  const inner = pages.map((p, i) => group(p, `transform="translate(0 ${num(i * (page.h + gap))})"`)).join('');
  return svgDocument(total, inner, { title: opts.title });
}

/** Fit a world box into a target box: uniform scale (capped) and the translation that centres it. */
export function fitTransform(world: Box, target: Box, maxScale = Infinity): { s: number; tx: number; ty: number } {
  const s = Math.min(target.w / Math.max(1e-6, world.w), target.h / Math.max(1e-6, world.h), maxScale);
  const tx = target.x + (target.w - world.w * s) / 2 - world.x * s;
  const ty = target.y + (target.h - world.h * s) / 2 - world.y * s;
  return { s, tx, ty };
}
