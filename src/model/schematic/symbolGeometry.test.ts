import { describe, expect, it } from 'vitest';
import { createLink } from '../factories';
import {
  GRID,
  MAX_VISIBLE_PINS_PER_SIDE,
  PIN_LENGTH,
  PIN_PITCH,
  collapsedStubs,
  componentLayout,
  localToWorld,
  pinEndpoint,
  pinPositions,
  portLabel,
  symbolBounds,
  symbolLayout,
  usedPortIds,
  worldSide,
  worldToLocal,
} from './symbolGeometry';
import { LEAF, SERVER_1U, SPINE, fixtureProject, place, symbol } from './testUtils';

const none = new Set<string>();

describe('constants', () => {
  it('exports the grid contract', () => {
    expect(PIN_PITCH).toBe(10);
    expect(PIN_LENGTH).toBe(20);
    expect(GRID).toBe(10);
    expect(MAX_VISIBLE_PINS_PER_SIDE).toBe(12);
  });
});

describe('expanded symbol', () => {
  it('places pins at their declared offsets, one pin length off the body', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 100, y: 100 }, { expanded: true });
    const pins = pinPositions(symbol(LEAF), leaf, { collapsed: false, usedPortIds: none });
    expect(pins.size).toBe(57);
    const first = pins.get('eth1/1')!;
    expect(first.pos).toEqual({ x: 100 - PIN_LENGTH, y: 110 });
    expect(first.bodyPos).toEqual({ x: 100, y: 110 });
    expect(first.dir).toEqual({ x: -1, y: 0 });
    expect(first.side).toBe('L');
    const up = pins.get('eth1/49')!;
    expect(up.pos).toEqual({ x: 100 + 200 + PIN_LENGTH, y: 110 });
    expect(up.dir).toEqual({ x: 1, y: 0 });
    expect(pins.get('eth1/48')!.pos.y).toBe(100 + 480);
  });

  it('reports the full body bounds and no stubs', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 100, y: 100 }, { expanded: true });
    expect(symbolBounds(symbol(LEAF), leaf)).toEqual({ x: 100, y: 100, width: 200, height: 500 });
    expect(collapsedStubs(symbol(LEAF), leaf)).toEqual([]);
  });
});

describe('collapse mode', () => {
  it('hides unused pins beyond the limit and packs the rest at PIN_PITCH', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 0, y: 0 });
    const layout = symbolLayout(symbol(LEAF), leaf, { collapsed: true, usedPortIds: none });
    // L side: 12 of 48 shown; R side: 9 pins (< limit) shown untouched.
    expect(layout.pins.size).toBe(12 + 9);
    expect(layout.collapsed).toBe(true);
    for (let i = 1; i <= 12; i++) {
      expect(layout.pins.get(`eth1/${i}`)!.pos).toEqual({ x: -PIN_LENGTH, y: i * PIN_PITCH });
    }
    expect(layout.pins.has('eth1/13')).toBe(false);
    expect(layout.stubs).toHaveLength(1);
    const stub = layout.stubs[0]!;
    expect(stub.side).toBe('L');
    expect(stub.count).toBe(36);
    expect(stub.hiddenPortIds[0]).toBe('eth1/13');
    expect(stub.pos).toEqual({ x: -PIN_LENGTH, y: 13 * PIN_PITCH });
    // Body shrinks to the packed extent (stub + one pitch).
    expect(layout.height).toBe(140);
    expect(layout.bounds).toEqual({ x: 0, y: 0, width: 200, height: 140 });
    // Right side pins keep their catalog offsets but hang off the packed body.
    expect(layout.pins.get('mgmt0')!.pos).toEqual({ x: 200 + PIN_LENGTH, y: 90 });
  });

  it('keeps used pins visible, filling the remaining slots with the first unused ones', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 0, y: 0 });
    const used = new Set(['eth1/20', 'eth1/40']);
    const layout = symbolLayout(symbol(LEAF), leaf, { collapsed: true, usedPortIds: used });
    const left = [...layout.pins.values()].filter((v) => v.side === 'L');
    expect(left).toHaveLength(12);
    expect(left.map((v) => v.portId)).toEqual([
      ...Array.from({ length: 10 }, (_, i) => `eth1/${i + 1}`),
      'eth1/20',
      'eth1/40',
    ]);
    expect(layout.pins.get('eth1/20')!.pos.y).toBe(110);
    expect(layout.pins.get('eth1/40')!.pos.y).toBe(120);
    expect(layout.stubs[0]!.count).toBe(36);
    expect(layout.stubs[0]!.hiddenPortIds).not.toContain('eth1/20');
  });

  it('shows more than the limit when more pins than that are used', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 0, y: 0 });
    const used = new Set(Array.from({ length: 14 }, (_, i) => `eth1/${i + 1}`));
    const layout = symbolLayout(symbol(LEAF), leaf, { collapsed: true, usedPortIds: used });
    const left = [...layout.pins.values()].filter((v) => v.side === 'L');
    expect(left).toHaveLength(14);
    expect(layout.stubs[0]!.count).toBe(34);
    expect(layout.height).toBe(160);
  });

  it('collapses both sides of a spine', () => {
    const p = fixtureProject();
    const spine = place(p, SPINE, { x: 0, y: 0 });
    const layout = symbolLayout(symbol(SPINE), spine, { collapsed: true, usedPortIds: none });
    expect(layout.stubs.map((s) => [s.side, s.count])).toEqual([
      ['L', 4],
      ['R', 5],
    ]);
    expect(layout.height).toBe(140);
  });

  it('does not collapse when the component has expanded pins or when nothing would hide', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 0, y: 0 }, { expanded: true });
    expect(symbolLayout(symbol(LEAF), leaf, { collapsed: false, usedPortIds: none }).collapsed).toBe(false);
    const srv = place(p, SERVER_1U, { x: 0, y: 0 });
    const layout = symbolLayout(symbol(SERVER_1U), srv, { collapsed: true, usedPortIds: none });
    expect(layout.collapsed).toBe(false);
    expect(layout.bounds).toEqual({ x: 0, y: 0, width: 200, height: 40 });
  });

  it('routes a hidden port to its side stub via pinEndpoint', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 0, y: 0 });
    const layout = symbolLayout(symbol(LEAF), leaf, { collapsed: true, usedPortIds: none });
    const hidden = pinEndpoint(layout, 'eth1/30')!;
    expect(hidden.hidden).toBe(true);
    expect(hidden.pos).toEqual(layout.stubs[0]!.pos);
    expect(hidden.dir).toEqual({ x: -1, y: 0 });
    expect(pinEndpoint(layout, 'eth1/1')!.hidden).toBe(false);
    expect(pinEndpoint(layout, 'nope')).toBeUndefined();
  });
});

describe('rotation and mirror', () => {
  it('rotates pins and directions about the component position', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 100, y: 100 }, { expanded: true });
    leaf.sch.rotation = 90;
    const pins = pinPositions(symbol(LEAF), leaf, { collapsed: false, usedPortIds: none });
    // local (-20, 10) -> rotate90 -> (-10, -20) -> + pos
    expect(pins.get('eth1/1')!.pos).toEqual({ x: 90, y: 80 });
    expect(pins.get('eth1/1')!.dir).toEqual({ x: 0, y: -1 });
    const b = symbolBounds(symbol(LEAF), leaf, { collapsed: false, usedPortIds: none });
    expect(b).toEqual({ x: 100 - 500, y: 100, width: 500, height: 200 });
  });

  it('mirrors across the vertical axis before rotating', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 100, y: 100 }, { expanded: true });
    leaf.sch.mirrored = true;
    const pins = pinPositions(symbol(LEAF), leaf, { collapsed: false, usedPortIds: none });
    expect(pins.get('eth1/1')!.pos).toEqual({ x: 120, y: 110 });
    expect(pins.get('eth1/1')!.dir).toEqual({ x: 1, y: 0 });
    expect(worldSide(pins.get('eth1/1')!.dir)).toBe('R');
    expect(symbolBounds(symbol(LEAF), leaf, { collapsed: false, usedPortIds: none })).toEqual({
      x: -100,
      y: 100,
      width: 200,
      height: 500,
    });
  });

  it('worldToLocal inverts localToWorld for every orientation', () => {
    const p = fixtureProject();
    const c = place(p, LEAF, { x: 37, y: -12 });
    for (const rotation of [0, 90, 180, 270] as const) {
      for (const mirrored of [false, true]) {
        c.sch.rotation = rotation;
        c.sch.mirrored = mirrored;
        const local = { x: 55, y: 130 };
        expect(worldToLocal(localToWorld(local, c), c)).toEqual(local);
      }
    }
  });
});

describe('project-aware helpers', () => {
  it('derives used ports from links and caches per project identity', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 0, y: 0 });
    const spine = place(p, SPINE, { x: 600, y: 0 });
    p.links.push(createLink({ componentId: leaf.id, portId: 'eth1/30' }, { componentId: spine.id, portId: 'eth1/20' }));
    expect(usedPortIds(p, leaf.id)).toEqual(new Set(['eth1/30']));
    const layout = componentLayout(p, leaf.id)!;
    expect(layout.pins.has('eth1/30')).toBe(true);
    expect(layout.pins.has('eth1/12')).toBe(false); // bumped by the used pin
    expect(componentLayout(p, leaf.id)).toBe(layout);
    expect(componentLayout(p, 'missing')).toBeUndefined();
  });

  it('symbolBounds without options follows expandedPins', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 0, y: 0 });
    expect(symbolBounds(symbol(LEAF), leaf).height).toBe(140);
    leaf.expandedPins = true;
    expect(symbolBounds(symbol(LEAF), leaf).height).toBe(500);
  });

  it('labels a pin by port id and type', () => {
    expect(portLabel(symbol(LEAF).pins.find((x) => x.portId === 'eth1/49')!)).toBe('eth1/49 QSFP28');
  });
});
