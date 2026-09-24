import { describe, expect, it } from 'vitest';
import { createLink, createSheet } from '../factories';
import type { Project } from '../types';
import { crossSheetLinks, createChildSheet, deleteSheet, duplicateSheet, sheetPath } from './sheets';
import { LEAF, SERVER_1U, SPINE, emptyRoute, fixtureProject, place } from './testUtils';

/** Root: spine SW1. Pod A: leaf SW2, server SRV1, child sheet Rack 1 with server SRV2. */
function pod() {
  const p: Project = fixtureProject();
  const podA = createChildSheet(p, 'root', 'Pod A', { x: 100, y: 100 });
  const rack = createChildSheet(p, podA.id, 'Rack 1', { x: 0, y: 0 });
  const spine = place(p, SPINE, { x: 0, y: 0 }, { ref: 'SW1' });
  const leaf = place(p, LEAF, { x: 0, y: 0 }, { ref: 'SW2', sheetId: podA.id, value: 'leaf-a' });
  const srv1 = place(p, SERVER_1U, { x: 400, y: 0 }, { ref: 'SRV1', sheetId: podA.id });
  const srv2 = place(p, SERVER_1U, { x: 0, y: 0 }, { ref: 'SRV2', sheetId: rack.id });
  leaf.optics['eth1/1'] = 'xcvr.25g-sr';
  const internal = createLink({ componentId: leaf.id, portId: 'eth1/1' }, { componentId: srv1.id, portId: 'eth0' }, 'cbl.om4-duplex', 'L1');
  internal.sch.wirePoints = [{ x: 300, y: 10 }];
  const nested = createLink({ componentId: leaf.id, portId: 'eth1/2' }, { componentId: srv2.id, portId: 'eth0' });
  const cross = createLink({ componentId: leaf.id, portId: 'eth1/49' }, { componentId: spine.id, portId: 'eth1/1' });
  p.links.push(internal, nested, cross);
  p.routes[cross.id] = emptyRoute(cross.id);
  p.placements.push({ componentId: leaf.id, rackId: null, uPosition: null, face: 'front' });
  return { p, podA, rack, spine, leaf, srv1, srv2, internal, nested, cross };
}

describe('createChildSheet', () => {
  it('adds a sheet under the parent with a sheet symbol', () => {
    const p = fixtureProject();
    const s = createChildSheet(p, 'root', 'Spine', { x: 10, y: 20 });
    expect(p.sheets.find((x) => x.id === s.id)).toMatchObject({ name: 'Spine', parentId: 'root', sch: { pos: { x: 10, y: 20 } } });
    expect(() => createChildSheet(p, 'nope', 'X', { x: 0, y: 0 })).toThrow(/Sheet not found/);
  });
});

describe('sheetPath', () => {
  it('joins names from the root', () => {
    const { p, rack, podA } = pod();
    expect(sheetPath(p, rack.id)).toBe('Root / Pod A / Rack 1');
    expect(sheetPath(p, podA.id)).toBe('Root / Pod A');
    expect(sheetPath(p, 'root')).toBe('Root');
    expect(sheetPath(p, 'missing')).toBe('');
  });
});

describe('duplicateSheet', () => {
  it('clones the subtree with fresh ids and refs, keeps internal links, drops crossing ones', () => {
    const { p, podA, rack, leaf, srv1, srv2, internal, nested, cross } = pod();
    const before = { sheets: p.sheets.length, components: p.components.length, links: p.links.length };
    const r = duplicateSheet(p, podA.id, 'Pod B');

    expect(p.sheets).toHaveLength(before.sheets + 2);
    expect(p.components).toHaveLength(before.components + 3);
    expect(p.links).toHaveLength(before.links + 2);
    expect(r.droppedCrossSheetLinks).toEqual([cross.id]);
    expect(r.componentIdMap.size).toBe(3);
    expect(r.linkIdMap.size).toBe(2);
    expect(r.sheetIdMap.get(podA.id)).toBe(r.sheetId);

    const podB = p.sheets.find((s) => s.id === r.sheetId)!;
    expect(podB).toMatchObject({ name: 'Pod B', parentId: 'root' });
    expect(podB.sch!.pos).toEqual({ x: 100 + 160 + 20, y: 100 });
    const rackB = p.sheets.find((s) => s.id === r.sheetIdMap.get(rack.id))!;
    expect(rackB).toMatchObject({ name: 'Rack 1', parentId: podB.id });

    const leafB = p.components.find((c) => c.id === r.componentIdMap.get(leaf.id))!;
    const srv1B = p.components.find((c) => c.id === r.componentIdMap.get(srv1.id))!;
    const srv2B = p.components.find((c) => c.id === r.componentIdMap.get(srv2.id))!;
    expect(leafB.ref).toBe('SW3');
    expect([srv1B.ref, srv2B.ref]).toEqual(['SRV3', 'SRV4']);
    expect(leafB.sch.sheetId).toBe(podB.id);
    expect(srv2B.sch.sheetId).toBe(rackB.id);
    expect(leafB.value).toBe('leaf-a');
    expect(leafB.optics).toEqual({ 'eth1/1': 'xcvr.25g-sr' });
    expect(leafB.optics).not.toBe(leaf.optics);

    const internalB = p.links.find((l) => l.id === r.linkIdMap.get(internal.id))!;
    expect(internalB.a).toEqual({ componentId: leafB.id, portId: 'eth1/1' });
    expect(internalB.b).toEqual({ componentId: srv1B.id, portId: 'eth0' });
    expect(internalB).toMatchObject({ cableDefId: 'cbl.om4-duplex', label: 'L1', sch: { wirePoints: [{ x: 300, y: 10 }] } });
    const nestedB = p.links.find((l) => l.id === r.linkIdMap.get(nested.id))!;
    expect(nestedB.b.componentId).toBe(srv2B.id);

    // Originals untouched; nothing physical was cloned.
    expect(leaf.ref).toBe('SW2');
    expect(p.links.find((l) => l.id === cross.id)).toBeDefined();
    expect(p.placements).toHaveLength(1);
    expect(Object.keys(p.routes)).toEqual([cross.id]);
  });

  it('stamps out several copies side by side without overlapping sheet symbols', () => {
    const { p, podA } = pod();
    const b = duplicateSheet(p, podA.id, 'Pod B');
    const c = duplicateSheet(p, podA.id, 'Pod C');
    const xs = [podA.id, b.sheetId, c.sheetId].map((id) => p.sheets.find((x) => x.id === id)!.sch!.pos.x);
    expect(xs).toEqual([100, 280, 460]);
    expect(p.components.filter((x) => x.ref.startsWith('SW')).map((x) => x.ref).sort()).toEqual(['SW1', 'SW2', 'SW3', 'SW4']);
  });

  it('refuses the root sheet', () => {
    const { p } = pod();
    expect(() => duplicateSheet(p, 'root', 'Copy')).toThrow(/root sheet/);
  });
});

describe('deleteSheet', () => {
  it('removes the subtree with its components, links and routes', () => {
    const { p, podA, spine, cross } = pod();
    const r = deleteSheet(p, podA.id);
    expect(r.sheetIds).toHaveLength(2);
    expect(r.componentIds).toHaveLength(3);
    expect(r.linkIds).toHaveLength(3);
    expect(p.sheets.map((s) => s.id)).toEqual(['root']);
    expect(p.components.map((c) => c.id)).toEqual([spine.id]);
    expect(p.links).toEqual([]);
    expect(p.routes[cross.id]).toBeUndefined();
    expect(p.placements).toEqual([]);
    expect(() => deleteSheet(p, 'root')).toThrow(/root sheet/);
  });
});

describe('crossSheetLinks', () => {
  it('finds links with exactly one end inside the subtree', () => {
    const { p, podA, rack, leaf, spine, cross, nested } = pod();
    const forPod = crossSheetLinks(p, podA.id);
    expect(forPod).toHaveLength(1);
    expect(forPod[0]!.link.id).toBe(cross.id);
    expect(forPod[0]!.insideEnd.componentId).toBe(leaf.id);
    expect(forPod[0]!.outsideEnd.componentId).toBe(spine.id);
    // The nested link crosses the Rack 1 boundary but not Pod A's.
    const forRack = crossSheetLinks(p, rack.id);
    expect(forRack.map((x) => x.link.id)).toEqual([nested.id]);
    expect(crossSheetLinks(p, 'root')).toEqual([]);
  });

  it('ignores sheets that do not exist', () => {
    const p = fixtureProject();
    p.sheets.push(createSheet('Orphan', 'nope'));
    expect(crossSheetLinks(p, 'nope')).toEqual([]);
  });
});
