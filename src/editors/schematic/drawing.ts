import type { CableSchematicDrawing, CableSchematicEnd } from '@/model/cables';
import { add, scale } from '@/model/geometry';
import { indexProject } from '@/model/query';
import { wireMidpoint, worldSide } from '@/model/schematic';
import type { Project, Vec2 } from '@/model/types';
import { legKey, type DeviceDrawing, type Scene, type WireDrawing } from './scene';

export const COLORS = { body: '#182331', border: '#4f6b82', text: '#dce6ef', muted: '#8298ae', accent: '#60b7ff', hover: '#b7e3ff', wire: '#67c9bc', dim: '#3a4858' };
export const WIRE_WIDTH = 1.2;
/** A cable jacket is three plain wires wide; its legs are plain wires. */
export const JACKET_WIDTH = WIRE_WIDTH * 3;
const CANVAS_BG = '#10151d';

export function line(ctx: CanvasRenderingContext2D, points: readonly Vec2[], color: string, width = 1) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size = 8, color = COLORS.text, align: CanvasTextAlign = 'left', maxWidth?: number) {
  ctx.font = `${size}px ui-monospace, monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  if (maxWidth) ctx.fillText(value, x, y, maxWidth);
  else ctx.fillText(value, x, y);
}

/**
 * Pins the cable tool cannot plug the current leg into are drawn dimmed;
 * keys are 'componentId/portId' (see src/panels/cables/cabling.ts).
 */
export type DimmedPins = ReadonlySet<string>;
export const pinKey = (componentId: string, portId: string): string => `${componentId}/${portId}`;

export function drawDevice(ctx: CanvasRenderingContext2D, { component: c, layout }: DeviceDrawing, project: Project, dimmedPins?: DimmedPins) {
  const idx = indexProject(project);
  const b = layout.bounds;
  ctx.fillStyle = COLORS.body;
  ctx.fillRect(b.x, b.y, b.width, b.height);
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(b.x, b.y, b.width, b.height);
  text(ctx, c.ref, b.x, b.y - 10, 11, COLORS.accent);
  const symbol = idx.symbolOf(c);
  // A quiet centre band keeps the device identity separate from the port banks.
  const centreWidth = Math.max(35, b.width - 130);
  text(ctx, c.value || symbol?.kind || '', b.x + b.width / 2, b.y + b.height / 2 - 6, 9, COLORS.text, 'center', centreWidth);
  text(ctx, idx.footprintOf(c)?.model ?? 'No model', b.x + b.width / 2, b.y + b.height - 5, 6.5, COLORS.muted, 'center', b.width - 12);
  for (const pin of layout.pins.values()) {
    const used = !idx.isPortFree(c.id, pin.portId);
    const color = dimmedPins?.has(pinKey(c.id, pin.portId)) ? COLORS.dim : used ? COLORS.accent : COLORS.muted;
    line(ctx, [pin.pos, pin.bodyPos], color);
    ctx.beginPath();
    ctx.arc(pin.pos.x, pin.pos.y, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    const side = worldSide(pin.dir);
    const label = `${pin.portId} ${pin.pin.type}`;
    if (side === 'L' || side === 'R') {
      text(ctx, label, pin.bodyPos.x + (side === 'L' ? 4 : -4), pin.bodyPos.y, 6.5, color, side === 'L' ? 'left' : 'right', Math.max(30, b.width / 2 - 6));
    } else {
      ctx.save();
      ctx.translate(pin.bodyPos.x, pin.bodyPos.y + (side === 'T' ? 4 : -4));
      ctx.rotate(side === 'T' ? Math.PI / 2 : -Math.PI / 2);
      text(ctx, label, 0, 0, 6.5, color, 'left', Math.max(30, b.height / 2 - 6));
      ctx.restore();
    }
  }
  for (const stub of layout.stubs) {
    line(ctx, [stub.pos, stub.bodyPos], COLORS.accent);
    ctx.fillStyle = '#10151d';
    ctx.fillRect(stub.pos.x - 23, stub.pos.y - 4, 46, 8);
    text(ctx, `+${stub.count} unused`, stub.pos.x, stub.pos.y, 7, COLORS.accent, 'center');
  }
}

export function drawSymbols(ctx: CanvasRenderingContext2D, scene: Scene, project: Project, dimmedPins?: DimmedPins) {
  for (const device of scene.devices) drawDevice(ctx, device, project, dimmedPins);
  for (const { sheet, rect: r, pins } of scene.sheets) {
    ctx.fillStyle = '#1a2834';
    ctx.fillRect(r.x, r.y, r.width, r.height);
    ctx.strokeStyle = '#7098aa';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(r.x, r.y, r.width, r.height);
    ctx.setLineDash([]);
    text(ctx, sheet.name, r.x + 8, r.y + 14, 11, COLORS.accent);
    text(ctx, 'Double-click to enter', r.x + 8, r.y + 28, 7, COLORS.muted);
    const capacity = Math.max(0, Math.floor((r.height - 52) / 10));
    pins.slice(0, capacity).forEach((p, i) => text(ctx, p, r.x + 8, r.y + 42 + i * 10, 7, COLORS.text, 'left', r.width - 16));
    if (pins.length > capacity) text(ctx, `+${pins.length - capacity} connections`, r.x + 8, r.y + r.height - 10, 7, COLORS.muted);
  }
}

export function drawWire(ctx: CanvasRenderingContext2D, wire: WireDrawing, project: Project, color?: string, width = 1.2) {
  const stroke = color ?? indexProject(project).cableOf(wire.link)?.color ?? COLORS.wire;
  line(ctx, wire.points, stroke, width);
  if (wire.offSheetLabel) {
    const end = wire.points.at(-1)!;
    text(ctx, wire.offSheetLabel, end.x + 4, end.y - 5, 7, stroke);
  } else if (wire.link.label) {
    const mid = wireMidpoint(wire.points);
    ctx.font = '8px ui-monospace, monospace';
    const w = ctx.measureText(wire.link.label).width;
    ctx.fillStyle = '#10151d';
    ctx.fillRect(mid.x - w / 2 - 3, mid.y - 12, w + 6, 11);
    text(ctx, wire.link.label, mid.x, mid.y - 6, 8, stroke, 'center');
  }
}

// ---------------------------------------------------------------------------
// Cables: one thick jacket, a boot glyph at each furcation, thin legs
// ---------------------------------------------------------------------------

const GLYPH_LENGTH = 8;
const GLYPH_HALF_WIDTH = 4.5;

/** Boot at a fan's furcation: narrow on the jacket side, widening towards the legs. */
function glyphPolygon(end: CableSchematicEnd, halfBase: number): Vec2[] {
  const perp = { x: -end.dir.y, y: end.dir.x };
  const back = add(end.anchor, scale(end.dir, 2));
  const front = add(end.anchor, scale(end.dir, -GLYPH_LENGTH));
  return [add(back, scale(perp, halfBase)), add(front, scale(perp, GLYPH_HALF_WIDTH)), add(front, scale(perp, -GLYPH_HALF_WIDTH)), add(back, scale(perp, -halfBase))];
}

function fillPolygon(ctx: CanvasRenderingContext2D, points: readonly Vec2[], color: string) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/** Open end of an unassigned leg / jacket. */
function hollowCircle(ctx: CanvasRenderingContext2D, p: Vec2, color: string, r = 2.5) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = CANVAS_BG;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function drawBadge(ctx: CanvasRenderingContext2D, badge: { pos: Vec2; text: string }, color: string) {
  ctx.font = '7px ui-monospace, monospace';
  const w = ctx.measureText(badge.text).width + 8, h = 11;
  const x = badge.pos.x - w / 2, y = badge.pos.y - h / 2;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, 3);
  else ctx.rect(x, y, w, h);
  ctx.fillStyle = CANVAS_BG;
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  text(ctx, badge.text, badge.pos.x, badge.pos.y + 0.5, 7, color, 'center');
}

export const cableColor = (d: CableSchematicDrawing): string => d.resolved.color || COLORS.wire;

/** Jacket, fans (glyph + legs, dangling stubs end in a hollow circle, off-sheet stubs carry a label) and the 'NF · Mch' badge. */
export function drawCable(ctx: CanvasRenderingContext2D, d: CableSchematicDrawing) {
  const color = cableColor(d);
  line(ctx, d.jacket, color, JACKET_WIDTH);
  for (const end of [d.ends.A, d.ends.B]) {
    if (end.kind === 'fan') {
      for (const leg of end.legs) {
        line(ctx, leg.points, color, WIRE_WIDTH);
        const tip = leg.points.at(-1)!;
        if (leg.state !== 'pin') hollowCircle(ctx, tip, color);
        if (leg.state === 'offSheet' && leg.offSheetLabel) text(ctx, leg.offSheetLabel, tip.x + 4, tip.y - 5, 6.5, color);
      }
      fillPolygon(ctx, glyphPolygon(end, JACKET_WIDTH / 2), color);
    } else if (end.kind === 'dangling') {
      hollowCircle(ctx, end.anchor, color);
    } else if (end.kind === 'offSheet' && end.offSheetLabel) {
      text(ctx, end.offSheetLabel, end.anchor.x + 4, end.anchor.y - 5, 7, color);
    }
  }
  drawBadge(ctx, d.badge, color);
}

/**
 * Glow for a selected or hovered cable: the jacket (unless `jacket` is
 * false), the glyphs and the given legs ('all', or a set of `legKey`s).
 * The badge is redrawn on top so the glow, which sits on the overlay
 * layer above the wires, does not run through its label.
 */
export function drawCableHighlight(ctx: CanvasRenderingContext2D, d: CableSchematicDrawing, color: string, legs: 'all' | ReadonlySet<string>, jacket = true) {
  if (jacket) line(ctx, d.jacket, color, JACKET_WIDTH + 1.6);
  for (const end of [d.ends.A, d.ends.B]) {
    if (end.kind !== 'fan') continue;
    if (jacket) fillPolygon(ctx, glyphPolygon(end, JACKET_WIDTH / 2 + 0.8), color);
    for (const leg of end.legs) {
      if (legs === 'all' || legs.has(legKey(end.side, leg.leg))) line(ctx, leg.points, color, WIRE_WIDTH + 1.3);
    }
  }
  if (jacket) drawBadge(ctx, d.badge, color);
}
