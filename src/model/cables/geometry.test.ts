import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { createCable, createProject, createRack } from '../factories';
import { portFloorPos } from '../routing/positions';
import { LEAF, PANEL_LC, place } from '../schematic/testUtils';
import type { Cable, Project } from '../types';
import { cableEnds, cableSchematicFan, FAN_OFFSET, furcationDefaultFloorPos } from './geometry';
import { autoFillCableSide, plugCableLeg } from './instances';

const rackDef = builtinCatalog.racks[0]!;
const cableDef = builtinCatalog.cables.find((c) => c.id === 'cbl.om4-8f-mpo8-4lc')!;

/** Leaf (SR4 on eth1/49) and LC panel in two racks 3 m apart, trunk plugged eth1/49 → f1..f4. */
function connected(): { p: Project; cable: Cable; leafId: string; panelId: string } {
  const p0 = createProject('t', '2026-01-01T00:00:00.000Z');
  const leaf = place(p0, LEAF, { x: 0, y: 0 }, { ref: 'SW1' });
  leaf.optics['eth1/49'] = 'xcvr.100g-sr4';
  const panel = place(p0, PANEL_LC, { x: 600, y: 0 }, { ref: 'PP1' });
  const r1 = createRack(rackDef, { name: 'A01', pos: { x: 1000, y: 1000 } });
  const r2 = createRack(rackDef, { name: 'A02', pos: { x: 4000, y: 1000 } });
  p0.racks.push(r1, r2);
  p0.placements.push({ componentId: leaf.id, rackId: r1.id, uPosition: 40, face: 'front' }, { componentId: panel.id, rackId: r2.id, uPosition: 10, face: 'front' });
  const cable = createCable(cableDef, 'CBL1');
  p0.cables.push(cable);
  const p = produce(p0, (d) => {
    plugCableLeg(d, cable.id, 'A', 0, { componentId: leaf.id, portId: 'eth1/49' });
    autoFillCableSide(d, cable.id, 'B', { componentId: panel.id, portId: 'f1' });
  });
  return { p, cable: p.cables[0]!, leafId: leaf.id, panelId: panel.id };
}

describe('cableEnds', () => {
  it('lists plugged ports per side in leg order', () => {
    const { p, cable, leafId, panelId } = connected();
    expect(cableEnds(p, cable)).toEqual({
      A: [{ componentId: leafId, portId: 'eth1/49' }],
      B: ['f1', 'f2', 'f3', 'f4'].map((portId) => ({ componentId: panelId, portId })),
    });
    const bare = createCable(cableDef, 'CBL2');
    expect(cableEnds(p, bare)).toEqual({ A: [], B: [] });
  });
});

describe('furcationDefaultFloorPos', () => {
  it('sits the breakout length back from side B towards side A, and null without placed ports', () => {
    const { p, cable, leafId, panelId } = connected();
    const a = portFloorPos(p, leafId, 'eth1/49')!;
    const bs = ['f1', 'f2', 'f3', 'f4'].map((id) => portFloorPos(p, panelId, id)!);
    const bc = { x: bs.reduce((s, q) => s + q.x, 0) / 4, y: bs.reduce((s, q) => s + q.y, 0) / 4 };
    const f = furcationDefaultFloorPos(p, cable, 'B')!;
    const d = Math.hypot(f.x - bc.x, f.y - bc.y);
    expect(d).toBeCloseTo(500, 6);
    // On the segment from B's centroid to A's port: same direction, closer to A than the centroid is.
    expect(Math.hypot(f.x - a.x, f.y - a.y)).toBeLessThan(Math.hypot(bc.x - a.x, bc.y - a.y));
    const fa = furcationDefaultFloorPos(p, cable, 'A')!;
    expect(Math.hypot(fa.x - a.x, fa.y - a.y)).toBeCloseTo(500, 6);
    const unplaced = produce(p, (d2) => {
      d2.placements = [];
    });
    expect(furcationDefaultFloorPos(unplaced, cable, 'B')).toBeNull();
  });

  it('clamps to the midpoint when the ends are closer than the breakout length', () => {
    const { p, cable } = connected();
    const close = produce(p, (d) => {
      d.racks[1]!.pos = { x: 1000, y: 1700 };
    });
    const f = furcationDefaultFloorPos(close, cable, 'B')!;
    const a = furcationDefaultFloorPos(close, cable, 'A')!;
    // Both sides back off to the same midpoint.
    expect(Math.hypot(f.x - a.x, f.y - a.y)).toBeLessThan(1e-6);
  });
});

describe('cableSchematicFan', () => {
  it('gives the pins per side and a furcation 40 units from the multi-leg side towards the other side', () => {
    const { p, cable } = connected();
    const fan = cableSchematicFan(p, cable);
    expect(fan.aPins.map((x) => x.leg)).toEqual([0]);
    expect(fan.bPins.map((x) => x.leg)).toEqual([0, 1, 2, 3]);
    // Panel pins f1..f4 hang off its left edge (x = 600 - 20) at y = 10..40; the leaf is to the left.
    expect(fan.bPins.map((x) => x.pos)).toEqual([580, 580, 580, 580].map((x, i) => ({ x, y: 10 * (i + 1) })));
    expect(fan.furcationB).toEqual({ x: 580 - FAN_OFFSET, y: 25 });
    expect(fan.furcationA).toBeUndefined();
    expect(fan.aPins[0]!.pos.x).toBeLessThan(580);
  });

  it('filters by sheet and fans away from the body when the other side is elsewhere', () => {
    const { p, cable, leafId } = connected();
    const other = produce(p, (d) => {
      d.sheets.push({ id: 'pod', name: 'Pod', parentId: 'root' });
      d.components.find((c) => c.id === leafId)!.sch.sheetId = 'pod';
    });
    const fan = cableSchematicFan(other, cable, 'root');
    expect(fan.aPins).toEqual([]);
    expect(fan.bPins).toHaveLength(4);
    // Panel pins point left (-x); with no side A pin on this sheet the fan goes that way too.
    expect(fan.furcationB).toEqual({ x: 580 - FAN_OFFSET, y: 25 });
    expect(cableSchematicFan(other, cable, 'pod').bPins).toEqual([]);
  });
});
