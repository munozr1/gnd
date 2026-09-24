/**
 * Adversarial tests for symbol geometry: every rotation x mirror combination,
 * collapse mode with used pins, and wires attaching to '+N unused' stubs.
 */
import { describe, expect, it } from 'vitest';
import { createLink } from '../factories';
import type { PinSide, Rotation, SymbolDef, Vec2 } from '../types';
import { rotateComponent } from './mutations';
import {
  MAX_VISIBLE_PINS_PER_SIDE,
  PIN_LENGTH,
  PIN_PITCH,
  componentLayout,
  localToWorld,
  pinEndpoint,
  symbolLayout,
  worldSide,
  worldToLocal,
} from './symbolGeometry';
import { LEAF, SPINE, fixtureProject, place, symbol } from './testUtils';
import { autoWirePoints, fullWirePolyline, wireEndpoints } from './wires';

const none = new Set<string>();
const ORIENTATIONS: { rotation: Rotation; mirrored: boolean }[] = [];
for (const rotation of [0, 90, 180, 270] as const) for (const mirrored of [false, true]) ORIENTATIONS.push({ rotation, mirrored });

const noNegativeZero = (p: Vec2): boolean => !Object.is(p.x, -0) && !Object.is(p.y, -0);
const isUnitAxis = (d: Vec2): boolean => (Math.abs(d.x) === 1 && d.y === 0) || (Math.abs(d.y) === 1 && d.x === 0);
const orthogonal = (pts: readonly Vec2[]): boolean => {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (a.x !== b.x && a.y !== b.y) return false;
  }
  return true;
};

/** World side an L / R pin ends up on for each orientation (mirror first, then rotation). */
const SIDE_TABLE: Record<'L' | 'R', Record<'plain' | 'mirrored', Record<Rotation, PinSide>>> = {
  L: {
    plain: { 0: 'L', 90: 'T', 180: 'R', 270: 'B' },
    mirrored: { 0: 'R', 90: 'B', 180: 'L', 270: 'T' },
  },
  R: {
    plain: { 0: 'R', 90: 'B', 180: 'L', 270: 'T' },
    mirrored: { 0: 'L', 90: 'T', 180: 'R', 270: 'B' },
  },
};

describe('pin geometry under every rotation and mirror', () => {
  it('keeps pins one PIN_LENGTH outside the body edge they exit, with no -0 and no shared positions', () => {
    for (const o of ORIENTATIONS) {
      const p = fixtureProject();
      const leaf = place(p, LEAF, { x: 100, y: 100 }, { expanded: true });
      leaf.sch.rotation = o.rotation;
      if (o.mirrored) leaf.sch.mirrored = true;
      const layout = symbolLayout(symbol(LEAF), leaf, { collapsed: false, usedPortIds: none });
      expect(layout.pins.size).toBe(57);
      const b = layout.bounds;
      const seen = new Set<string>();
      for (const pin of layout.pins.values()) {
        expect(isUnitAxis(pin.dir)).toBe(true);
        expect(noNegativeZero(pin.pos)).toBe(true);
        expect(noNegativeZero(pin.bodyPos)).toBe(true);
        expect(noNegativeZero(pin.dir)).toBe(true);
        expect(pin.pos).toEqual({ x: pin.bodyPos.x + pin.dir.x * PIN_LENGTH, y: pin.bodyPos.y + pin.dir.y * PIN_LENGTH });
        const side = worldSide(pin.dir);
        expect(side).toBe(SIDE_TABLE[pin.side as 'L' | 'R'][o.mirrored ? 'mirrored' : 'plain'][o.rotation]);
        // bodyPos sits on the body edge it exits; pos is one pin length further out.
        switch (side) {
          case 'L':
            expect(pin.bodyPos.x).toBe(b.x);
            expect(pin.pos.x).toBe(b.x - PIN_LENGTH);
            break;
          case 'R':
            expect(pin.bodyPos.x).toBe(b.x + b.width);
            expect(pin.pos.x).toBe(b.x + b.width + PIN_LENGTH);
            break;
          case 'T':
            expect(pin.bodyPos.y).toBe(b.y);
            expect(pin.pos.y).toBe(b.y - PIN_LENGTH);
            break;
          case 'B':
            expect(pin.bodyPos.y).toBe(b.y + b.height);
            expect(pin.pos.y).toBe(b.y + b.height + PIN_LENGTH);
            break;
        }
        // The along-edge coordinate stays inside the body extent.
        if (side === 'L' || side === 'R') {
          expect(pin.bodyPos.y).toBeGreaterThanOrEqual(b.y);
          expect(pin.bodyPos.y).toBeLessThanOrEqual(b.y + b.height);
        } else {
          expect(pin.bodyPos.x).toBeGreaterThanOrEqual(b.x);
          expect(pin.bodyPos.x).toBeLessThanOrEqual(b.x + b.width);
        }
        const key = `${pin.pos.x},${pin.pos.y}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('matches hand-computed positions at 180, 270 and mirrored+90', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 100, y: 100 }, { expanded: true });
    const pins = () => symbolLayout(symbol(LEAF), leaf, { collapsed: false, usedPortIds: none });

    leaf.sch.rotation = 180;
    let l = pins();
    expect(l.pins.get('eth1/1')!.pos).toEqual({ x: 120, y: 90 });
    expect(l.pins.get('eth1/1')!.bodyPos).toEqual({ x: 100, y: 90 });
    expect(l.pins.get('eth1/1')!.dir).toEqual({ x: 1, y: 0 });
    expect(l.pins.get('eth1/49')!.pos).toEqual({ x: -120, y: 90 });
    expect(l.pins.get('eth1/49')!.dir).toEqual({ x: -1, y: 0 });
    expect(l.bounds).toEqual({ x: -100, y: -400, width: 200, height: 500 });

    leaf.sch.rotation = 270;
    l = pins();
    expect(l.pins.get('eth1/1')!.pos).toEqual({ x: 110, y: 120 });
    expect(l.pins.get('eth1/1')!.bodyPos).toEqual({ x: 110, y: 100 });
    expect(l.pins.get('eth1/1')!.dir).toEqual({ x: 0, y: 1 });
    expect(l.bounds).toEqual({ x: 100, y: -100, width: 500, height: 200 });

    leaf.sch.rotation = 90;
    leaf.sch.mirrored = true;
    l = pins();
    expect(l.pins.get('eth1/1')!.pos).toEqual({ x: 90, y: 120 });
    expect(l.pins.get('eth1/1')!.bodyPos).toEqual({ x: 90, y: 100 });
    expect(l.pins.get('eth1/1')!.dir).toEqual({ x: 0, y: 1 });
    expect(l.pins.get('eth1/49')!.pos).toEqual({ x: 90, y: -120 });
    expect(l.pins.get('eth1/49')!.dir).toEqual({ x: 0, y: -1 });
    expect(l.bounds).toEqual({ x: -400, y: -100, width: 500, height: 200 });

    leaf.sch.rotation = 180;
    l = pins();
    expect(l.pins.get('eth1/1')!.pos).toEqual({ x: 80, y: 90 });
    expect(l.pins.get('eth1/1')!.dir).toEqual({ x: -1, y: 0 });

    leaf.sch.rotation = 270;
    l = pins();
    expect(l.pins.get('eth1/1')!.pos).toEqual({ x: 110, y: 80 });
    expect(l.pins.get('eth1/1')!.dir).toEqual({ x: 0, y: -1 });
  });

  it('worldToLocal recovers every pin outer point exactly, without -0, in every orientation', () => {
    for (const o of ORIENTATIONS) {
      const p = fixtureProject();
      const leaf = place(p, LEAF, { x: 0, y: 0 }, { expanded: true });
      leaf.sch.rotation = o.rotation;
      if (o.mirrored) leaf.sch.mirrored = true;
      const layout = symbolLayout(symbol(LEAF), leaf, { collapsed: false, usedPortIds: none });
      for (const pin of symbol(LEAF).pins) {
        const expected =
          pin.side === 'L'
            ? { x: -PIN_LENGTH, y: pin.offset }
            : pin.side === 'R'
              ? { x: 200 + PIN_LENGTH, y: pin.offset }
              : pin.side === 'T'
                ? { x: pin.offset, y: -PIN_LENGTH }
                : { x: pin.offset, y: 500 + PIN_LENGTH };
        const back = worldToLocal(layout.pins.get(pin.portId)!.pos, leaf);
        expect(noNegativeZero(back)).toBe(true);
        expect(back).toEqual(expected);
      }
      // The origin round-trips to exactly {0, 0} (not {-0, 0}).
      const origin = worldToLocal(localToWorld({ x: 0, y: 0 }, leaf), leaf);
      expect(Object.is(origin.x, 0) && Object.is(origin.y, 0)).toBe(true);
    }
  });
});

describe('collapse mode', () => {
  it('packs used pins under mirror + rotation exactly as localToWorld of the packed slots', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 100, y: 100 });
    leaf.sch.rotation = 90;
    leaf.sch.mirrored = true;
    const used = new Set(['eth1/30', 'eth1/48']);
    const layout = symbolLayout(symbol(LEAF), leaf, { collapsed: true, usedPortIds: used });
    // Slots: eth1/1..10 fill the first 10, then eth1/30 (slot 11) and eth1/48 (slot 12), stub in slot 13.
    expect(layout.pins.get('eth1/30')).toMatchObject({ pos: { x: -10, y: 120 }, bodyPos: { x: -10, y: 100 }, dir: { x: 0, y: 1 } });
    expect(layout.pins.get('eth1/48')!.pos).toEqual({ x: -20, y: 120 });
    expect(layout.pins.has('eth1/11')).toBe(false);
    expect(layout.stubs).toHaveLength(1);
    expect(layout.stubs[0]).toMatchObject({ side: 'L', count: 36, pos: { x: -30, y: 120 }, bodyPos: { x: -30, y: 100 }, dir: { x: 0, y: 1 } });
    expect(layout.stubs[0]!.hiddenPortIds).not.toContain('eth1/30');
    expect(layout.stubs[0]!.hiddenPortIds).not.toContain('eth1/48');
    expect(layout.stubs[0]!.hiddenPortIds).toHaveLength(36);
    expect(layout.width).toBe(200);
    expect(layout.height).toBe(140);
    expect(layout.bounds).toEqual({ x: -40, y: -100, width: 140, height: 200 });
    // The stub hangs off the same world edge as the packed pins.
    expect(worldSide(layout.stubs[0]!.dir)).toBe('B');
    expect(layout.stubs[0]!.bodyPos.y).toBe(layout.bounds.y + layout.bounds.height);
  });

  it('never hides a used pin, and shows exactly hidden + visible = all pins on the side', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 0, y: 0 });
    for (const usedCount of [0, 1, 11, 12, 13, 20, 47, 48]) {
      // Use every other pin from the bottom up so used pins are scattered.
      const used = new Set<string>();
      for (let i = 48; used.size < usedCount; i--) used.add(`eth1/${i}`);
      const layout = symbolLayout(symbol(LEAF), leaf, { collapsed: true, usedPortIds: used });
      const left = [...layout.pins.values()].filter((v) => v.side === 'L').map((v) => v.portId);
      for (const u of used) expect(left).toContain(u);
      const stub = layout.stubs.find((s) => s.side === 'L');
      const hidden = stub?.hiddenPortIds ?? [];
      expect(left.length + hidden.length).toBe(48);
      expect(new Set([...left, ...hidden]).size).toBe(48);
      if (usedCount >= 48) {
        expect(stub).toBeUndefined();
        expect(layout.height).toBe(500);
        expect(layout.collapsed).toBe(false);
      } else {
        expect(stub).toBeDefined();
        expect(left.length).toBe(Math.max(MAX_VISIBLE_PINS_PER_SIDE, usedCount));
        expect(stub!.count).toBe(48 - left.length);
        // Visible pins are packed contiguously at PIN_PITCH from the top with the stub right after.
        const ys = left.map((id) => layout.pins.get(id)!.pos.y);
        expect(ys).toEqual(left.map((_, i) => (i + 1) * PIN_PITCH));
        expect(stub!.pos.y).toBe((left.length + 1) * PIN_PITCH);
        expect(layout.height).toBe((left.length + 2) * PIN_PITCH);
      }
    }
  });

  it('collapses both sides of a spine independently, keeping used pins on each', () => {
    const p = fixtureProject();
    const spine = place(p, SPINE, { x: 0, y: 0 });
    const used = new Set(['eth1/16', 'eth1/32', 'mgmt0']);
    const layout = symbolLayout(symbol(SPINE), spine, { collapsed: true, usedPortIds: used });
    const left = [...layout.pins.values()].filter((v) => v.side === 'L').map((v) => v.portId);
    const right = [...layout.pins.values()].filter((v) => v.side === 'R').map((v) => v.portId);
    expect(left).toEqual([...Array.from({ length: 11 }, (_, i) => `eth1/${i + 1}`), 'eth1/16']);
    expect(right).toEqual([...Array.from({ length: 10 }, (_, i) => `eth1/${i + 17}`), 'eth1/32', 'mgmt0']);
    expect(layout.stubs.map((s) => [s.side, s.count])).toEqual([
      ['L', 4],
      ['R', 5],
    ]);
    expect(layout.pins.get('eth1/32')!.pos).toEqual({ x: 220, y: 110 });
    expect(layout.pins.get('mgmt0')!.pos).toEqual({ x: 220, y: 120 });
    expect(layout.height).toBe(140);
  });

  it('collapses T/B sides of a custom symbol and shrinks the width, also under rotation', () => {
    const custom: SymbolDef = {
      id: 'sym.test-top',
      name: 'Top-heavy',
      kind: 'generic',
      refPrefix: 'U',
      width: 200,
      height: 60,
      pins: [
        ...Array.from({ length: 15 }, (_, i) => ({ portId: `t${i + 1}`, side: 'T' as const, offset: (i + 1) * 10, type: 'SFP28' as const, speedsGbps: [25] })),
        ...Array.from({ length: 3 }, (_, i) => ({ portId: `b${i + 1}`, side: 'B' as const, offset: (i + 1) * 10, type: 'SFP28' as const, speedsGbps: [25] })),
      ],
      defaultFootprintIds: [],
    };
    const p = fixtureProject();
    const c = place(p, LEAF, { x: 0, y: 0 });
    c.symbolDefId = custom.id;
    let layout = symbolLayout(custom, c, { collapsed: true, usedPortIds: none });
    expect(layout.width).toBe(140);
    expect(layout.height).toBe(60);
    expect(layout.pins.get('t1')).toMatchObject({ pos: { x: 10, y: -20 }, bodyPos: { x: 10, y: 0 }, dir: { x: 0, y: -1 } });
    expect(layout.pins.get('t12')!.pos).toEqual({ x: 120, y: -20 });
    expect(layout.pins.has('t13')).toBe(false);
    expect(layout.stubs).toEqual([
      expect.objectContaining({ side: 'T', count: 3, hiddenPortIds: ['t13', 't14', 't15'], pos: { x: 130, y: -20 }, dir: { x: 0, y: -1 } }),
    ]);
    expect(layout.pins.get('b3')).toMatchObject({ pos: { x: 30, y: 80 }, bodyPos: { x: 30, y: 60 }, dir: { x: 0, y: 1 } });
    expect(layout.bounds).toEqual({ x: 0, y: 0, width: 140, height: 60 });

    c.sch.rotation = 90;
    layout = symbolLayout(custom, c, { collapsed: true, usedPortIds: new Set(['t15']) });
    // Local: t15 is slot 12 (after t1..t11) -> (120, -20); rotate90 -> (20, 120).
    expect(layout.pins.get('t15')).toMatchObject({ pos: { x: 20, y: 120 }, dir: { x: 1, y: 0 } });
    expect(layout.pins.has('t12')).toBe(false);
    expect(layout.stubs[0]).toMatchObject({ side: 'T', count: 3, pos: { x: 20, y: 130 }, dir: { x: 1, y: 0 } });
    expect(layout.bounds).toEqual({ x: -60, y: 0, width: 60, height: 140 });
  });
});

describe('wires reach stubs and packed pins', () => {
  it('attaches a hidden port to its side stub, in the stub direction, under rotation', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 0, y: 0 });
    const spine = place(p, SPINE, { x: 600, y: 0 }, { expanded: true });
    let layout = symbolLayout(symbol(LEAF), leaf, { collapsed: true, usedPortIds: none });
    let end = pinEndpoint(layout, 'eth1/30')!;
    expect(end).toEqual({ pos: { x: -PIN_LENGTH, y: 13 * PIN_PITCH }, dir: { x: -1, y: 0 }, hidden: true });
    const spinePin = symbolLayout(symbol(SPINE), spine, { collapsed: false, usedPortIds: none }).pins.get('eth1/1')!;
    const mid = autoWirePoints(end.pos, end.dir, spinePin.pos, spinePin.dir);
    const poly = [end.pos, ...mid, spinePin.pos];
    expect(orthogonal(poly)).toBe(true);
    // The first leg leaves the stub in its own direction (to the left), not through the body.
    expect(mid[0]!.x).toBeLessThan(end.pos.x);

    leaf.sch.rotation = 90;
    layout = symbolLayout(symbol(LEAF), leaf, { collapsed: true, usedPortIds: none });
    end = pinEndpoint(layout, 'eth1/30')!;
    expect(end).toEqual({ pos: { x: -130, y: -20 }, dir: { x: 0, y: -1 }, hidden: true });
    expect(pinEndpoint(layout, 'eth1/5')!.hidden).toBe(false);
    expect(pinEndpoint(layout, 'mgmt0')!.hidden).toBe(false);
  });

  it('routes a linked port to its packed (not natural) pin slot, and follows rotation', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 0, y: 0 });
    const spine = place(p, SPINE, { x: 600, y: 0 });
    const link = createLink({ componentId: leaf.id, portId: 'eth1/30' }, { componentId: spine.id, portId: 'eth1/30' });
    p.links.push(link);
    let ends = wireEndpoints(link, p)!;
    // eth1/30 is bumped into slot 12 on the leaf; spine eth1/30 lands in slot 12 on its right side.
    expect(ends.a).toEqual({ pos: { x: -20, y: 120 }, dir: { x: -1, y: 0 }, hidden: false });
    expect(ends.b).toEqual({ pos: { x: 820, y: 120 }, dir: { x: 1, y: 0 }, hidden: false });
    expect(componentLayout(p, leaf.id)!.stubs[0]!.hiddenPortIds).not.toContain('eth1/30');

    rotateComponent(p, leaf.id);
    const p2 = { ...p }; // new identity: the per-project caches must not serve the pre-rotation layout
    ends = wireEndpoints(link, p2)!;
    expect(ends.a).toEqual({ pos: { x: -120, y: -20 }, dir: { x: 0, y: -1 }, hidden: false });
    const poly = fullWirePolyline(link, p2);
    expect(poly[0]).toEqual(ends.a.pos);
    expect(poly[poly.length - 1]).toEqual(ends.b.pos);
    expect(orthogonal(poly)).toBe(true);
    expect(poly.every(noNegativeZero)).toBe(true);
  });

  it('full polylines start and end on the pins for every orientation of both ends', () => {
    for (const oa of ORIENTATIONS) {
      for (const ob of [ORIENTATIONS[0]!, ORIENTATIONS[3]!, ORIENTATIONS[6]!]) {
        const p = fixtureProject();
        const leaf = place(p, LEAF, { x: 0, y: 0 }, { expanded: true });
        const spine = place(p, SPINE, { x: 900, y: 300 });
        leaf.sch.rotation = oa.rotation;
        if (oa.mirrored) leaf.sch.mirrored = true;
        spine.sch.rotation = ob.rotation;
        if (ob.mirrored) spine.sch.mirrored = true;
        const link = createLink({ componentId: leaf.id, portId: 'eth1/7' }, { componentId: spine.id, portId: 'eth1/20' });
        p.links.push(link);
        const ends = wireEndpoints(link, p)!;
        const poly = fullWirePolyline(link, p);
        expect(poly.length).toBeGreaterThanOrEqual(2);
        expect(poly[0]).toEqual(ends.a.pos);
        expect(poly[poly.length - 1]).toEqual(ends.b.pos);
        expect(orthogonal(poly)).toBe(true);
        expect(poly.every(noNegativeZero)).toBe(true);
      }
    }
  });
});
