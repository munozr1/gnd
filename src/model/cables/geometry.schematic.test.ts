import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { createCable, createProject } from '../factories';
import { componentLayout, pinEndpoint } from '../schematic/symbolGeometry';
import { LEAF, PANEL_LC, place } from '../schematic/testUtils';
import type { Cable, Project, Vec2 } from '../types';
import { cableSchematicDrawing, DANGLE_LENGTH, FAN_OFFSET, LEG_STUB, legsLinkedTo } from './geometry';
import { autoFillCableSide, plugCableLeg, unplugCableLeg } from './instances';
import { resolveCable } from './resolve';

const TRUNK = builtinCatalog.cables.find((c) => c.id === 'cbl.om4-8f-mpo8-4lc')!;
const DUPLEX = builtinCatalog.cables.find((c) => c.id === 'cbl.om4-duplex')!;

/** Leaf SW1 (SR4 on eth1/49) at the origin and LC panel PP1 to its right; an 8F trunk, plugged as requested. */
function fixture(plug: { a?: boolean; b?: boolean } = { a: true, b: true }): { p: Project; cable: Cable; leafId: string; panelId: string } {
  const p0 = createProject('t', '2026-01-01T00:00:00.000Z');
  const leaf = place(p0, LEAF, { x: 0, y: 0 }, { ref: 'SW1' });
  leaf.optics['eth1/49'] = 'xcvr.100g-sr4';
  const panel = place(p0, PANEL_LC, { x: 600, y: 0 }, { ref: 'PP1' });
  const cable = createCable(TRUNK, 'CBL1');
  p0.cables.push(cable);
  const p = produce(p0, (d) => {
    if (plug.a) plugCableLeg(d, cable.id, 'A', 0, { componentId: leaf.id, portId: 'eth1/49' });
    if (plug.b) autoFillCableSide(d, cable.id, 'B', { componentId: panel.id, portId: 'f1' });
  });
  return { p, cable: p.cables[0]!, leafId: leaf.id, panelId: panel.id };
}
const pinOf = (p: Project, componentId: string, portId: string) => pinEndpoint(componentLayout(p, componentId)!, portId)!;
const orthogonal = (pts: Vec2[]) => pts.every((q, i) => i === 0 || q.x === pts[i - 1]!.x || q.y === pts[i - 1]!.y);

describe('cableSchematicDrawing', () => {
  it('ends on the single A pin, fans side B from a furcation in front of its pins, and badges the jacket', () => {
    const { p, cable, leafId } = fixture();
    const d = cableSchematicDrawing(p, cable, 'root')!;
    const a = pinOf(p, leafId, 'eth1/49');
    expect(d.ends.A).toMatchObject({ kind: 'pin', anchor: a.pos, dir: a.dir, legs: [], ref: { componentId: leafId, portId: 'eth1/49' } });
    // Panel pins f1..f4 hang off its left edge at x = 580, y = 10..40, pointing -x: the fan sits FAN_OFFSET further left at their mean y.
    const furcation = { x: 580 - FAN_OFFSET, y: 25 };
    expect(d.ends.B).toMatchObject({ kind: 'fan', anchor: furcation, dir: { x: -1, y: 0 } });
    expect(d.ends.B.legs.map((l) => l.state)).toEqual(['pin', 'pin', 'pin', 'pin']);
    expect(d.ends.B.legs.map((l) => l.points)).toEqual([10, 20, 30, 40].map((y) => [furcation, { x: 580 - LEG_STUB, y }, { x: 580, y }]));
    expect(d.ends.B.legs.map((l) => l.ref?.portId)).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(d.jacket[0]).toEqual(a.pos);
    expect(d.jacket.at(-1)).toEqual(furcation);
    expect(orthogonal(d.jacket)).toBe(true);
    expect(d.badge.text).toBe('8F · 4ch');
    expect(d.resolved.color).toBe(TRUNK.color);
  });

  it('dangles unassigned legs DANGLE_LENGTH past the furcation, spread by leg order', () => {
    const { p, cable } = fixture();
    const partial = produce(p, (d) => unplugCableLeg(d, cable.id, 'B', 2));
    const d = cableSchematicDrawing(partial, partial.cables[0]!, 'root')!;
    const furcation = d.ends.B.anchor;
    expect(d.ends.B.legs.map((l) => l.state)).toEqual(['pin', 'pin', 'dangling', 'pin']);
    // Leg 3 of 4 sits half a pitch below the fan axis; the stub continues towards the pins (+x).
    expect(d.ends.B.legs[2]!.points).toEqual([furcation, { x: furcation.x + DANGLE_LENGTH, y: furcation.y + 4 }]);
    expect(d.ends.B.legs[2]!.ref).toBeUndefined();
  });

  it('lays out a pending fan 60 units past the plugged A pin when nothing on side B is plugged', () => {
    const { p, cable, leafId } = fixture({ a: true });
    const d = cableSchematicDrawing(p, cable, 'root')!;
    const a = pinOf(p, leafId, 'eth1/49');
    const furcation = { x: a.pos.x + a.dir.x * 60, y: a.pos.y + a.dir.y * 60 };
    expect(d.jacket).toEqual([a.pos, furcation]);
    // The leaf's uplink pins point +x; the pending fan's jacket leaves it back towards the pin (no -0: consumers compare with ===).
    expect(a.dir).toEqual({ x: 1, y: 0 });
    expect(d.ends.B).toMatchObject({ kind: 'fan', anchor: furcation, dir: { x: -1, y: 0 } });
    expect(d.ends.B.legs.map((l) => l.state)).toEqual(['dangling', 'dangling', 'dangling', 'dangling']);
    expect(d.ends.B.legs.map((l) => l.points[1]!.y - furcation.y)).toEqual([-12, -4, 4, 12]);
    expect(d.ends.B.legs.every((l) => l.points[1]!.x === furcation.x + DANGLE_LENGTH)).toBe(true);
  });

  it('dangles the jacket from the fan when the single A leg is unassigned, and draws nothing with no pin on the sheet', () => {
    const { p, cable } = fixture({ b: true });
    const d = cableSchematicDrawing(p, cable, 'root')!;
    const furcation = { x: 580 - FAN_OFFSET, y: 25 };
    expect(d.ends.A).toMatchObject({ kind: 'dangling', anchor: { x: furcation.x - DANGLE_LENGTH, y: 25 }, dir: { x: 1, y: 0 }, legs: [] });
    expect(d.jacket).toEqual([d.ends.A.anchor, furcation]);
    const bare = fixture({});
    expect(cableSchematicDrawing(bare.p, bare.cable, 'root')).toBeNull();
    expect(cableSchematicDrawing(p, cable, 'nowhere')).toBeNull();
  });

  it('shows a side plugged on another sheet as an off-sheet stub, on both sheets', () => {
    const { p, cable, leafId, panelId } = fixture();
    const split = produce(p, (d) => {
      d.sheets.push({ id: 'pod', name: 'Pod A', parentId: 'root' });
      d.components.find((c) => c.id === panelId)!.sch.sheetId = 'pod';
    });
    const root = cableSchematicDrawing(split, cable, 'root')!;
    const a = pinOf(split, leafId, 'eth1/49');
    expect(root.ends.B).toMatchObject({ kind: 'offSheet', anchor: { x: a.pos.x + a.dir.x * 60, y: a.pos.y }, legs: [], ref: { componentId: panelId, portId: 'f1' }, offSheetLabel: 'PP1:f1 ▸ Pod A' });
    expect(root.jacket).toEqual([a.pos, root.ends.B.anchor]);
    const pod = cableSchematicDrawing(split, cable, 'pod')!;
    expect(pod.ends.B.kind).toBe('fan');
    expect(pod.ends.A).toMatchObject({ kind: 'offSheet', anchor: { x: 580 - FAN_OFFSET - 60, y: 25 }, offSheetLabel: 'SW1:eth1/49 ▸ Root' });
  });

  it('draws a straight duplex cord pin to pin with no fan', () => {
    const p0 = createProject('t', '2026-01-01T00:00:00.000Z');
    const p1 = place(p0, PANEL_LC, { x: 0, y: 0 }, { ref: 'PP1' });
    const p2 = place(p0, PANEL_LC, { x: 600, y: 200 }, { ref: 'PP2' });
    const cable = createCable(DUPLEX, 'CBL1');
    p0.cables.push(cable);
    const p = produce(p0, (d) => {
      plugCableLeg(d, cable.id, 'A', 0, { componentId: p1.id, portId: 'r1' });
      plugCableLeg(d, cable.id, 'B', 0, { componentId: p2.id, portId: 'f1' });
    });
    const d = cableSchematicDrawing(p, p.cables[0]!, 'root')!;
    expect(d.ends.A).toMatchObject({ kind: 'pin', anchor: pinOf(p, p1.id, 'r1').pos, legs: [] });
    expect(d.ends.B).toMatchObject({ kind: 'pin', anchor: pinOf(p, p2.id, 'f1').pos, legs: [] });
    expect(d.jacket[0]).toEqual(d.ends.A.anchor);
    expect(d.jacket.at(-1)).toEqual(d.ends.B.anchor);
    expect(orthogonal(d.jacket)).toBe(true);
    expect(d.badge.text).toBe('2F · 1ch');
  });
});

describe('legsLinkedTo', () => {
  it('follows the strand map from a leg to the legs on the other side carrying its fibers', () => {
    const trunk = resolveCable(TRUNK);
    if ('error' in trunk) throw new Error(trunk.error);
    expect(legsLinkedTo(trunk, 'B', 2)).toEqual([0]);
    expect(legsLinkedTo(trunk, 'A', 0)).toEqual([0, 1, 2, 3]);
    expect(legsLinkedTo(trunk, 'B', 9)).toEqual([]);
    const big = resolveCable(builtinCatalog.cables.find((c) => c.id === 'cbl.os2-144f-12mpo12')!);
    if ('error' in big) throw new Error(big.error);
    expect(legsLinkedTo(big, 'B', 7)).toEqual([7]);
  });
});
