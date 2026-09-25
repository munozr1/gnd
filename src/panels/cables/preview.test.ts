import { describe, expect, it } from 'vitest';
import { deriveSides } from '@/model/cables';
import { GLYPH_W, MAX_LEGS_DRAWN, previewHeight, previewLayout, type PreviewSpec } from './preview';

function spec(fiberCount: number, connA: string, connB: string, extra: Partial<PreviewSpec> = {}): PreviewSpec {
  const sides = deriveSides(fiberCount, connA, connB);
  if (!sides.ok) throw new Error(sides.error);
  return { fiberCount, channels: sides.channels, sideA: sides.sideA, sideB: sides.sideB, kind: sides.kind, ...extra };
}

const W = 600;

describe('previewLayout', () => {
  it('lays out the acceptance trunk: one MPO leg left, four LC legs fanning from a furcation on the right', () => {
    const s = spec(8, 'MPO-8', 'LC-duplex');
    const l = previewLayout(s, W, previewHeight(s));
    expect(l.sides.A.legs).toHaveLength(1);
    expect(l.sides.A.furcation).toBeUndefined();
    expect(l.sides.A.hiddenLegs).toBe(0);
    expect(l.sides.B.legs.map((x) => x.label)).toEqual(['1', '2', '3', '4']);
    expect(l.sides.B.furcation).toBeDefined();
    expect(l.sides.B.origin).toEqual(l.sides.B.furcation);
    // Left to right: A glyph, jacket, furcation, B glyphs; legs spread symmetrically about the jacket.
    const a = l.sides.A.legs[0]!;
    expect(a.x + GLYPH_W / 2).toBe(l.jacket.x1);
    expect(l.jacket.x1).toBeLessThan(l.jacket.x2);
    expect(l.jacket.x2).toBe(l.sides.B.furcation!.x);
    for (const leg of l.sides.B.legs) expect(leg.x).toBeGreaterThan(l.jacket.x2);
    const ys = l.sides.B.legs.map((x) => x.y);
    expect(ys).toEqual([...ys].sort((p, q) => p - q));
    expect((ys[0]! + ys[3]!) / 2).toBeCloseTo(l.jacket.y);
    expect(l.badge.text).toBe('8F · 4ch');
    expect(l.badge.x).toBeCloseTo((l.jacket.x1 + l.jacket.x2) / 2);
    // Glyph data the renderer needs.
    expect(a).toMatchObject({ connector: 'MPO-8', family: 'multi', fibers: 8, positions: [1, 2, 3, 4, 9, 10, 11, 12], label: 'A' });
    expect(l.sides.B.legs[0]).toMatchObject({ connector: 'LC-duplex', family: 'small', fibers: 2, positions: [1, 2] });
  });

  it('changing side B to MPO-8 makes a straight cable with no furcation on either side', () => {
    const s = spec(8, 'MPO-8', 'MPO-8');
    const l = previewLayout(s, W, previewHeight(s));
    expect(s.kind).toBe('straight');
    expect(l.sides.A.furcation).toBeUndefined();
    expect(l.sides.B.furcation).toBeUndefined();
    expect(l.sides.A.legs).toHaveLength(1);
    expect(l.sides.B.legs).toHaveLength(1);
    // The jacket runs glyph to glyph, both on the centre line.
    expect(l.jacket.x1).toBe(l.sides.A.legs[0]!.x + GLYPH_W / 2);
    expect(l.jacket.x2).toBe(l.sides.B.legs[0]!.x - GLYPH_W / 2);
    expect(l.sides.A.legs[0]!.y).toBe(l.jacket.y);
    expect(l.sides.B.legs[0]!.y).toBe(l.jacket.y);
  });

  it('a multi-leg straight cable has a furcation on both sides', () => {
    const s = spec(144, 'MPO-12', 'MPO-12');
    const l = previewLayout(s, W, previewHeight(s));
    expect(s.kind).toBe('straight');
    expect(l.sides.A.legs.map((x) => x.label)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L']);
    expect(l.sides.B.legs).toHaveLength(12);
    expect(l.sides.A.furcation).toBeDefined();
    expect(l.sides.B.furcation).toBeDefined();
    expect(l.sides.A.furcation!.x).toBeLessThan(l.sides.B.furcation!.x);
    expect(l.jacket).toMatchObject({ x1: l.sides.A.furcation!.x, x2: l.sides.B.furcation!.x, thickness: 12 });
  });

  it('caps the drawn legs and reports the rest as hidden', () => {
    const s = spec(48, 'MPO-24', 'LC-duplex');
    const l = previewLayout(s, W, previewHeight(s));
    expect(s.sideB.legs).toHaveLength(24);
    expect(l.sides.B.legs).toHaveLength(MAX_LEGS_DRAWN);
    expect(l.sides.B.hiddenLegs).toBe(24 - MAX_LEGS_DRAWN);
    expect(l.sides.A.legs).toHaveLength(2);
    expect(l.sides.A.hiddenLegs).toBe(0);
    // Every drawn leg stays inside the box.
    for (const leg of [...l.sides.A.legs, ...l.sides.B.legs]) {
      expect(leg.y).toBeGreaterThan(0);
      expect(leg.y).toBeLessThan(l.height);
    }
  });

  it('grows with the leg count and keeps a small cable compact', () => {
    expect(previewHeight(spec(2, 'LC-duplex', 'LC-duplex'))).toBe(120);
    expect(previewHeight(spec(8, 'MPO-8', 'LC-duplex'))).toBe(120);
    expect(previewHeight(spec(24, 'MPO-24', 'LC-duplex'))).toBeGreaterThan(previewHeight(spec(12, 'MPO-12', 'LC-duplex')));
    expect(previewHeight(spec(48, 'MPO-24', 'LC-duplex'))).toBe(previewHeight(spec(144, 'MPO-24', 'LC-duplex')));
  });

  it('uses the jacket colour, diameter and leg colour overrides it is given', () => {
    const s = spec(8, 'MPO-8', 'LC-duplex', { color: '#facc15', diameterMm: 5 });
    s.sideB.legs[1]!.color = '#ff0000';
    const l = previewLayout(s, W, 160);
    expect(l.jacket.color).toBe('#facc15');
    expect(l.jacket.thickness).toBe(5);
    expect(l.sides.B.legs[1]!.color).toBe('#ff0000');
    expect(l.sides.B.legs[0]!.color).not.toBe('#ff0000');
    expect(previewLayout(spec(2, 'LC-duplex', 'LC-duplex'), W, 120).jacket.thickness).toBe(3);
  });
});
