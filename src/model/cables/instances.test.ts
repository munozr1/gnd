import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { createCable, createLink, createProject, ROOT_SHEET_ID } from '../factories';
import { indexProject } from '../query';
import { LEAF, PANEL_LC, place, SPINE } from '../schematic/testUtils';
import type { Cable, CableDef, Project } from '../types';
import {
  autoFillCableSide,
  autoFillPorts,
  deriveCableLinks,
  nextPortAfter,
  nextUnassignedLeg,
  plugCableLeg,
  plugCompatible,
  removeCable,
  sideChannels,
  syncCableLinks,
  unplugCableLeg,
  unplugComponents,
} from './instances';
import { resolveCable } from './resolve';

const MPO_PANEL = 'sym.mpo-patch-panel-12';
const def = (id: string): CableDef => {
  const d = builtinCatalog.cables.find((c) => c.id === id);
  if (!d) throw new Error(`no builtin cable ${id}`);
  return d;
};

/** A leaf with 100G-SR4 on eth1/49 and eth1/50, and a 24× LC panel. */
function fixture() {
  const p = createProject('t', '2026-01-01T00:00:00.000Z');
  const leaf = place(p, LEAF, { x: 0, y: 0 }, { ref: 'SW1' });
  leaf.optics['eth1/49'] = 'xcvr.100g-sr4';
  leaf.optics['eth1/50'] = 'xcvr.100g-sr4';
  const panel = place(p, PANEL_LC, { x: 600, y: 0 }, { ref: 'PP1' });
  return { p, leaf, panel };
}

function install(p: Project, defId: string, label = 'CBL1'): { p: Project; cable: Cable } {
  const cable = createCable(def(defId), label);
  const next = produce(p, (d) => {
    d.cables.push(cable);
  });
  return { p: next, cable: next.cables.find((c) => c.id === cable.id)! };
}

const cableOf = (p: Project, id: string): Cable => p.cables.find((c) => c.id === id)!;
const plugsOf = (p: Project, id: string, side: 'A' | 'B') =>
  cableOf(p, id).plugs.filter((x) => x.side === side).sort((x, y) => x.leg - y.leg).map((x) => x.portId);

describe('createCable', () => {
  it('has one unassigned plug per leg per side', () => {
    const c = createCable(def('cbl.om4-8f-mpo8-4lc'), 'CBL1');
    expect(c.plugs).toEqual([
      { side: 'A', leg: 0, componentId: null, portId: null },
      { side: 'B', leg: 0, componentId: null, portId: null },
      { side: 'B', leg: 1, componentId: null, portId: null },
      { side: 'B', leg: 2, componentId: null, portId: null },
      { side: 'B', leg: 3, componentId: null, portId: null },
    ]);
    expect(nextUnassignedLeg(c)).toEqual({ side: 'A', leg: 0 });
    expect(() => createCable(def('cbl.cat6a'), 'x')).toThrow(/Cannot connect/);
  });
});

describe('sideChannels', () => {
  it('pairs multi-fiber positions outer-in per leg and duplex legs one channel each', () => {
    const r = resolveCable(def('cbl.om4-8f-mpo8-4lc'));
    if ('error' in r) throw new Error(r.error);
    expect(sideChannels(r.sideA).map((c) => [c.index, c.slots[0].pos, c.slots[1].pos])).toEqual([[0, 1, 12], [1, 2, 11], [2, 3, 10], [3, 4, 9]]);
    expect(sideChannels(r.sideB).map((c) => [c.leg, c.index])).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
  });
});

describe('deriveCableLinks / syncCableLinks', () => {
  it('8F MPO-8 → 4×LC trunk from eth1/49 to F1..F4 yields 4 lane links on A and whole-port ends on B', () => {
    const { p: p0, leaf, panel } = fixture();
    const { p: p1, cable } = install(p0, 'cbl.om4-8f-mpo8-4lc');
    const p2 = produce(p1, (d) => {
      plugCableLeg(d, cable.id, 'A', 0, { componentId: leaf.id, portId: 'eth1/49' });
      for (let leg = 0; leg < 4; leg++) plugCableLeg(d, cable.id, 'B', leg, { componentId: panel.id, portId: `f${leg + 1}` });
    });
    const links = deriveCableLinks(p2, cableOf(p2, cable.id));
    expect(links).toEqual([
      { a: { componentId: leaf.id, portId: 'eth1/49', lane: 0 }, b: { componentId: panel.id, portId: 'f1' } },
      { a: { componentId: leaf.id, portId: 'eth1/49', lane: 1 }, b: { componentId: panel.id, portId: 'f2' } },
      { a: { componentId: leaf.id, portId: 'eth1/49', lane: 2 }, b: { componentId: panel.id, portId: 'f3' } },
      { a: { componentId: leaf.id, portId: 'eth1/49', lane: 3 }, b: { componentId: panel.id, portId: 'f4' } },
    ]);
    expect(p2.links).toHaveLength(4);
    expect(p2.links.every((l) => l.cableId === cable.id && l.cableDefId === 'cbl.om4-8f-mpo8-4lc')).toBe(true);
    expect(indexProject(p2).linksOfCable(cable.id)).toHaveLength(4);
    expect(indexProject(p2).plugAt({ componentId: panel.id, portId: 'f3' })).toEqual({ cableId: cable.id, side: 'B', leg: 2 });
    expect(indexProject(p2).plugAt({ componentId: panel.id, portId: 'f5' })).toBeUndefined();
  });

  it('links appear only once both ends of a channel are plugged', () => {
    const { p: p0, leaf, panel } = fixture();
    const { p: p1, cable } = install(p0, 'cbl.om4-8f-mpo8-4lc');
    const p2 = produce(p1, (d) => plugCableLeg(d, cable.id, 'A', 0, { componentId: leaf.id, portId: 'eth1/49' }));
    expect(p2.links).toHaveLength(0);
    const p3 = produce(p2, (d) => plugCableLeg(d, cable.id, 'B', 2, { componentId: panel.id, portId: 'f7' }));
    expect(p3.links).toHaveLength(1);
    expect(p3.links[0]).toMatchObject({ a: { portId: 'eth1/49', lane: 2 }, b: { portId: 'f7' }, cableId: cable.id });
  });

  it('straight 12F MPO-12 ↔ MPO-12 between two 4-lane ports yields 4 lane links (channels 5–6 unused)', () => {
    const p0 = createProject('t', '2026-01-01T00:00:00.000Z');
    const leaf = place(p0, LEAF, { x: 0, y: 0 }, { ref: 'SW1' });
    const spine = place(p0, SPINE, { x: 600, y: 0 }, { ref: 'SP1' });
    leaf.optics['eth1/49'] = 'xcvr.100g-sr4';
    spine.optics['eth1/1'] = 'xcvr.400g-dr4';
    const { p: p1, cable } = install(p0, 'cbl.om4-mpo-trunk');
    const p2 = produce(p1, (d) => {
      plugCableLeg(d, cable.id, 'A', 0, { componentId: leaf.id, portId: 'eth1/49' });
      plugCableLeg(d, cable.id, 'B', 0, { componentId: spine.id, portId: 'eth1/1' });
    });
    expect(p2.links.map((l) => [l.a.lane, l.b.lane])).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
  });

  it('an MPO-8 leg into a fixed MPO-12 panel port makes 4 lane links on both ends', () => {
    const p0 = createProject('t', '2026-01-01T00:00:00.000Z');
    const leaf = place(p0, LEAF, { x: 0, y: 0 }, { ref: 'SW1' });
    leaf.optics['eth1/49'] = 'xcvr.100g-sr4';
    const panel = place(p0, MPO_PANEL, { x: 600, y: 0 }, { ref: 'PP1' });
    const { p: p1, cable } = install(p0, 'cbl.om4-8f-mpo8-mpo8');
    const p2 = produce(p1, (d) => {
      plugCableLeg(d, cable.id, 'A', 0, { componentId: leaf.id, portId: 'eth1/49' });
      plugCableLeg(d, cable.id, 'B', 0, { componentId: panel.id, portId: 'f1' });
    });
    expect(p2.links.map((l) => [l.a.lane, l.b.lane])).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
  });

  it('unplugging leg B3 removes exactly its link (and its route); replugging restores it', () => {
    const { p: p0, leaf, panel } = fixture();
    const { p: p1, cable } = install(p0, 'cbl.om4-8f-mpo8-4lc');
    const p2 = produce(p1, (d) => {
      plugCableLeg(d, cable.id, 'A', 0, { componentId: leaf.id, portId: 'eth1/49' });
      autoFillCableSide(d, cable.id, 'B', { componentId: panel.id, portId: 'f1' });
    });
    const lane2 = p2.links.find((l) => l.a.lane === 2)!;
    const p3 = produce(p2, (d) => {
      d.routes[lane2.id] = { linkId: lane2.id, aRack: { side: 'left', entry: null, pinned: false }, bRack: { side: 'left', entry: null, pinned: false }, segments: [] };
      unplugCableLeg(d, cable.id, 'B', 2);
    });
    expect(p3.links.map((l) => l.a.lane).sort()).toEqual([0, 1, 3]);
    expect(p3.links.map((l) => l.id)).not.toContain(lane2.id);
    expect(p3.routes[lane2.id]).toBeUndefined();
    expect(plugsOf(p3, cable.id, 'B')).toEqual(['f1', 'f2', null, 'f4']);
    // The three untouched links keep their identity.
    expect(p3.links.map((l) => l.id)).toEqual(p2.links.filter((l) => l.id !== lane2.id).map((l) => l.id));
    const p4 = produce(p3, (d) => plugCableLeg(d, cable.id, 'B', 2, { componentId: panel.id, portId: 'f9' }));
    expect(p4.links.find((l) => l.a.lane === 2)?.b.portId).toBe('f9');
  });

  it('refuses a derived end that collides with a link the cable does not own', () => {
    const { p: p0, leaf, panel } = fixture();
    const { p: p1, cable } = install(p0, 'cbl.om4-8f-mpo8-4lc');
    const p2 = produce(p1, (d) => {
      plugCableLeg(d, cable.id, 'A', 0, { componentId: leaf.id, portId: 'eth1/49' });
      // Someone wires f2 by hand behind the cable's back, then leg B2 is pointed at it.
      d.links.push(createLink({ componentId: panel.id, portId: 'f2' }, { componentId: panel.id, portId: 'r2' }, null));
      d.cables[0]!.plugs.find((x) => x.side === 'B' && x.leg === 1)!.componentId = panel.id;
      d.cables[0]!.plugs.find((x) => x.side === 'B' && x.leg === 1)!.portId = 'f2';
    });
    expect(() => produce(p2, (d) => { syncCableLinks(d, cable.id); })).toThrow(/Port PP1:f2 is already used by PP1:f2 — PP1:r2/);
  });

  it('removeCable drops the cable with its links; unplugComponents nulls plugs of a deleted device', () => {
    const { p: p0, leaf, panel } = fixture();
    const { p: p1, cable } = install(p0, 'cbl.om4-8f-mpo8-4lc');
    const p2 = produce(p1, (d) => {
      plugCableLeg(d, cable.id, 'A', 0, { componentId: leaf.id, portId: 'eth1/49' });
      autoFillCableSide(d, cable.id, 'B', { componentId: panel.id, portId: 'f1' });
      d.links.push(createLink({ componentId: leaf.id, portId: 'eth1/1' }, { componentId: panel.id, portId: 'r1' }, null));
    });
    expect(p2.links).toHaveLength(5);
    const p3 = produce(p2, (d) => {
      d.links = d.links.filter((l) => l.a.componentId !== panel.id && l.b.componentId !== panel.id);
      expect(unplugComponents(d, [panel.id])).toEqual([cable.id]);
    });
    expect(plugsOf(p3, cable.id, 'B')).toEqual([null, null, null, null]);
    expect(plugsOf(p3, cable.id, 'A')).toEqual(['eth1/49']);
    expect(p3.links).toHaveLength(0);
    const p4 = produce(p2, (d) => removeCable(d, cable.id));
    expect(p4.cables).toEqual([]);
    expect(p4.links.map((l) => l.cableId)).toEqual([undefined]);
    expect(() => produce(p4, (d) => removeCable(d, cable.id))).toThrow(/Cable not found/);
  });
});

describe('plugCompatible', () => {
  it('refuses an LC leg on an MPO port with the required message', () => {
    const { p: p0, leaf } = fixture();
    const { p, cable } = install(p0, 'cbl.om4-8f-mpo8-4lc');
    const r = plugCompatible(p, cable, 'B', 1, { componentId: leaf.id, portId: 'eth1/49' });
    expect(r).toEqual({ ok: false, reason: 'LC-duplex leg 2 cannot plug into eth1/49 (MPO-12 port)' });
  });

  it('refuses an MPO leg on an LC panel port, an empty cage and an RJ45 port; accepts matching ports', () => {
    const { p: p0, leaf, panel } = fixture();
    const { p, cable } = install(p0, 'cbl.om4-8f-mpo8-4lc');
    expect(plugCompatible(p, cable, 'A', 0, { componentId: panel.id, portId: 'f1' })).toEqual({ ok: false, reason: 'MPO-8 leg A cannot plug into f1 (LC port)' });
    expect(plugCompatible(p, cable, 'A', 0, { componentId: leaf.id, portId: 'eth1/51' })).toEqual({ ok: false, reason: 'MPO-8 leg A cannot plug into eth1/51 (empty QSFP28 cage)' });
    expect(plugCompatible(p, cable, 'B', 0, { componentId: leaf.id, portId: 'mgmt0' })).toMatchObject({ ok: false });
    expect(plugCompatible(p, cable, 'A', 0, { componentId: leaf.id, portId: 'eth1/49' })).toEqual({ ok: true });
    expect(plugCompatible(p, cable, 'B', 3, { componentId: panel.id, portId: 'r24' })).toEqual({ ok: true });
    expect(plugCompatible(p, cable, 'B', 4, { componentId: panel.id, portId: 'f1' })).toMatchObject({ ok: false, reason: /no leg 5/ });
    expect(plugCompatible(p, cable, 'A', 0, { componentId: leaf.id, portId: 'nope' })).toMatchObject({ ok: false, reason: /has no port nope/ });
  });

  it('refuses ports used by another cable plug or a hand-drawn link, but accepts its own slot again', () => {
    const { p: p0, leaf, panel } = fixture();
    const { p: p1, cable } = install(p0, 'cbl.om4-8f-mpo8-4lc');
    const { p: p2, cable: other } = install(p1, 'cbl.om4-8f-mpo8-4lc', 'CBL2');
    const p3 = produce(p2, (d) => {
      plugCableLeg(d, cable.id, 'B', 0, { componentId: panel.id, portId: 'f1' });
      d.links.push(createLink({ componentId: panel.id, portId: 'f2' }, { componentId: panel.id, portId: 'r2' }, null));
    });
    expect(plugCompatible(p3, other, 'B', 0, { componentId: panel.id, portId: 'f1' })).toEqual({ ok: false, reason: 'PP1:f1 is already used by cable CBL1 (side B leg 1)' });
    expect(plugCompatible(p3, cableOf(p3, cable.id), 'B', 1, { componentId: panel.id, portId: 'f1' })).toMatchObject({ ok: false });
    expect(plugCompatible(p3, cableOf(p3, cable.id), 'B', 0, { componentId: panel.id, portId: 'f1' })).toEqual({ ok: true });
    expect(plugCompatible(p3, other, 'B', 0, { componentId: panel.id, portId: 'f2' })).toEqual({ ok: false, reason: 'PP1:f2 is already connected' });
    expect(() => produce(p3, (d) => plugCableLeg(d, other.id, 'B', 0, { componentId: leaf.id, portId: 'eth1/49' }))).toThrow(/LC-duplex leg 1 cannot plug into eth1\/49 \(MPO-12 port\)/);
  });
});

describe('autoFillPorts', () => {
  it('lands legs 1–4 on F1..F4 from F1', () => {
    const { p: p0, panel } = fixture();
    const { p, cable } = install(p0, 'cbl.om4-8f-mpo8-4lc');
    expect(autoFillPorts(p, cable, 'B', { componentId: panel.id, portId: 'f1' }).map((r) => r.portId)).toEqual(['f1', 'f2', 'f3', 'f4']);
  });

  it('skips occupied ports, fills only the remaining legs and stops at the end of the component', () => {
    const { p: p0, panel } = fixture();
    const { p: p1, cable } = install(p0, 'cbl.om4-8f-mpo8-4lc');
    const p2 = produce(p1, (d) => {
      plugCableLeg(d, cable.id, 'B', 0, { componentId: panel.id, portId: 'f10' });
      d.links.push(createLink({ componentId: panel.id, portId: 'f2' }, { componentId: panel.id, portId: 'r2' }, null));
    });
    const c = cableOf(p2, cable.id);
    expect(autoFillPorts(p2, c, 'B', { componentId: panel.id, portId: 'f1' }).map((r) => r.portId)).toEqual(['f1', 'f3', 'f4']);
    expect(autoFillPorts(p2, c, 'B', { componentId: panel.id, portId: 'f2' })).toEqual([]);
    expect(autoFillPorts(p2, c, 'B', { componentId: panel.id, portId: 'r23' }).map((r) => r.portId)).toEqual(['r23', 'r24']);
    expect(autoFillPorts(p2, c, 'B', { componentId: panel.id, portId: 'nope' })).toEqual([]);
    expect(nextPortAfter(p2, { componentId: panel.id, portId: 'f10' })).toEqual({ componentId: panel.id, portId: 'f11' });
    expect(nextPortAfter(p2, { componentId: panel.id, portId: 'r24' })).toBeNull();
  });

  it('autoFillCableSide plugs and syncs, returns the count, and throws for an incompatible first port', () => {
    const { p: p0, leaf, panel } = fixture();
    const { p: p1, cable } = install(p0, 'cbl.om4-8f-mpo8-4lc');
    let count = 0;
    const p2 = produce(p1, (d) => {
      plugCableLeg(d, cable.id, 'A', 0, { componentId: leaf.id, portId: 'eth1/49' });
      count = autoFillCableSide(d, cable.id, 'B', { componentId: panel.id, portId: 'f3' });
    });
    expect(count).toBe(4);
    expect(plugsOf(p2, cable.id, 'B')).toEqual(['f3', 'f4', 'f5', 'f6']);
    expect(p2.links.map((l) => l.b.portId)).toEqual(['f3', 'f4', 'f5', 'f6']);
    expect(() => produce(p2, (d) => { autoFillCableSide(d, cable.id, 'A', { componentId: panel.id, portId: 'f9' }); })).not.toThrow(); // nothing left on A
    expect(() => produce(p1, (d) => { autoFillCableSide(d, cable.id, 'B', { componentId: leaf.id, portId: 'eth1/50' }); })).toThrow(/LC-duplex leg 1 cannot plug into eth1\/50 \(MPO-12 port\)/);
  });
});

describe('deleteComponents keeps cables consistent', () => {
  it('nulls the plugs of a deleted device through the schematic mutator', async () => {
    const { deleteComponents } = await import('../schematic/mutations');
    const { p: p0, leaf, panel } = fixture();
    const { p: p1, cable } = install(p0, 'cbl.om4-8f-mpo8-4lc');
    const p2 = produce(p1, (d) => {
      plugCableLeg(d, cable.id, 'A', 0, { componentId: leaf.id, portId: 'eth1/49' });
      autoFillCableSide(d, cable.id, 'B', { componentId: panel.id, portId: 'f1' });
    });
    const p3 = produce(p2, (d) => {
      deleteComponents(d, [panel.id]);
    });
    expect(p3.links).toHaveLength(0);
    expect(plugsOf(p3, cable.id, 'B')).toEqual([null, null, null, null]);
    expect(plugsOf(p3, cable.id, 'A')).toEqual(['eth1/49']);
    expect(p3.components.map((c) => c.sch.sheetId)).toEqual([ROOT_SHEET_ID]);
  });
});
