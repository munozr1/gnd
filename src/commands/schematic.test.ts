import { describe, expect, it } from 'vitest';
import { catalogIndex } from '@/catalog';
import { createProject, ROOT_SHEET_ID } from '@/model/factories';
import { planBreakout, planFabric } from '@/model/schematic';
import type { Project } from '@/model/types';
import { COALESCE_WINDOW_MS, emptyHistory, executeCommand, undoCommand, type Command, type History } from '@/store/commands';
import { buildCustomDevice, validateCustomDevice } from './customDevice';
import * as sch from './schematic';

const LEAF = 'sym.leaf-switch-48x25-8x100';
const SPINE = 'sym.spine-switch-32x400';
const SERVER = 'sym.server-1u';

function exec(project: Project, cmd: Command, history: History = emptyHistory(), now = 1000) {
  const r = executeCommand(project, history, cmd, now);
  return { project: r.project, history: r.history, changed: r.changed };
}

function seed() {
  let p: Project = createProject('t', '2026-01-01T00:00:00.000Z');
  const leaf = sch.addComponent(LEAF, ROOT_SHEET_ID, { x: 0, y: 0 });
  p = exec(p, leaf).project;
  const spine = sch.addComponent(SPINE, ROOT_SHEET_ID, { x: 600, y: 0 });
  p = exec(p, spine).project;
  const srv = sch.addComponent(SERVER, ROOT_SHEET_ID, { x: 0, y: 600 });
  p = exec(p, srv).project;
  return { p, leaf: leaf.result!, spine: spine.result!, srv: srv.result! };
}

describe('components and links', () => {
  it('addComponent yields the new id and is undoable', () => {
    const p0 = createProject('t', '2026-01-01T00:00:00.000Z');
    const cmd = sch.addComponent(LEAF, ROOT_SHEET_ID, { x: 103, y: 96 }, { value: 'leaf-a' });
    expect(cmd.result).toBeUndefined();
    const r = exec(p0, cmd);
    expect(r.changed).toBe(true);
    expect(r.project.components[0]).toMatchObject({ id: cmd.result, ref: 'SW1', value: 'leaf-a', sch: { pos: { x: 100, y: 100 } } });
    expect(undoCommand(r.project, r.history, 'schematic').project.components).toEqual([]);
    expect(() => exec(p0, sch.addComponent('sym.nope', ROOT_SHEET_ID, { x: 0, y: 0 }))).toThrow(/Unknown symbol/);
  });

  it('moveComponents coalesces per drag and nudges of the same selection', () => {
    const { p, leaf, spine } = seed();
    const a = exec(p, sch.moveComponents([leaf], { x: 10, y: 0 }, 'drag1'), emptyHistory(), 1000);
    const b = exec(a.project, sch.moveComponents([leaf], { x: 10, y: 0 }, 'drag1'), a.history, 1200);
    expect(b.history.schematic.undo).toHaveLength(1);
    expect(b.project.components[0]!.sch.pos).toEqual({ x: 20, y: 0 });
    const c = exec(b.project, sch.moveComponents([spine, leaf], { x: 0, y: 10 }), b.history, 1300);
    const d = exec(c.project, sch.moveComponents([leaf, spine], { x: 0, y: 10 }), c.history, 1400);
    expect(d.history.schematic.undo).toHaveLength(2);
    const e = exec(d.project, sch.moveComponents([leaf], { x: 0, y: 10 }), d.history, 1400 + COALESCE_WINDOW_MS + 1);
    expect(e.history.schematic.undo).toHaveLength(3);
    expect(e.history.schematic.undo[1]!.label).toBe('Move 2 components');
  });

  it('links: add (deriving the cable), label, cable, wire points, delete', () => {
    const { p, leaf, spine } = seed();
    let q = exec(p, sch.setOptic(leaf, 'eth1/49', 'xcvr.100g-sr4')).project;
    q = exec(q, sch.setOptic(spine, 'eth1/1', 'xcvr.100g-sr4')).project;
    expect(() => exec(q, sch.setOptic(spine, 'eth1/1', 'xcvr.nope'))).toThrow(/Unknown transceiver/);
    const add = sch.addLink({ componentId: leaf, portId: 'eth1/49' }, { componentId: spine, portId: 'eth1/1' });
    q = exec(q, add).project;
    const link = q.links.find((l) => l.id === add.result)!;
    expect(link.cableDefId).toBe('cbl.om4-mpo-trunk');
    expect(() => exec(q, sch.addLink({ componentId: leaf, portId: 'eth1/49' }, { componentId: spine, portId: 'eth1/2' }))).toThrow(/already connected/);
    q = exec(q, sch.setLinkLabel(link.id, 'uplink-1')).project;
    q = exec(q, sch.setLinkCable(link.id, 'cbl.os2-mpo-trunk')).project;
    expect(() => exec(q, sch.setLinkCable(link.id, 'cbl.nope'))).toThrow(/Unknown cable/);
    const w1 = exec(q, sch.setLinkWirePoints(link.id, [{ x: 300, y: 10 }]), emptyHistory(), 1000);
    const w2 = exec(w1.project, sch.setLinkWirePoints(link.id, [{ x: 320, y: 10 }]), w1.history, 1100);
    expect(w2.history.schematic.undo).toHaveLength(1);
    const l2 = w2.project.links[0]!;
    expect(l2).toMatchObject({ label: 'uplink-1', cableDefId: 'cbl.os2-mpo-trunk', sch: { wirePoints: [{ x: 320, y: 10 }] } });
    const del = exec(w2.project, sch.deleteLinks(link.id));
    expect(del.project.links).toEqual([]);
  });

  it('deleteSelection removes components with their links, links, and sheets', () => {
    const { p, leaf, spine, srv } = seed();
    let q = exec(p, sch.addLink({ componentId: leaf, portId: 'eth1/49' }, { componentId: spine, portId: 'eth1/1' }, null)).project;
    const down = sch.addLink({ componentId: srv, portId: 'eth0' }, { componentId: leaf, portId: 'eth1/1' }, null);
    q = exec(q, down).project;
    const sheet = sch.createSheet(ROOT_SHEET_ID, 'Pod A', { x: 0, y: 0 });
    q = exec(q, sheet).project;
    const podLeaf = sch.addComponent(LEAF, sheet.result!, { x: 0, y: 0 });
    q = exec(q, podLeaf).project;

    const cmd = sch.deleteSelection([
      { kind: 'component', id: spine },
      { kind: 'link', id: down.result! },
      { kind: 'sheet', id: sheet.result! },
      { kind: 'rack', id: 'ignored' },
    ]);
    const r = exec(q, cmd);
    expect(cmd.result).toEqual({
      componentIds: [podLeaf.result, spine],
      linkIds: [q.links[0]!.id, down.result],
      sheetIds: [sheet.result],
    });
    expect(r.project.components.map((c) => c.id).sort()).toEqual([leaf, srv].sort());
    expect(r.project.links).toEqual([]);
    expect(r.project.sheets.map((s) => s.id)).toEqual([ROOT_SHEET_ID]);
    expect(r.history.schematic.undo[0]!.label).toBe('Delete 3 items'); // the rack item is ignored
    expect(undoCommand(r.project, r.history, 'schematic').project).toEqual(q);
  });

  it('rotate / mirror / value / ref / footprint / expand', () => {
    const { p, leaf, spine } = seed();
    let q = exec(p, sch.rotateComponents([leaf, spine], -1)).project;
    expect(q.components.map((c) => c.sch.rotation)).toEqual([270, 270, 0]);
    q = exec(q, sch.mirrorComponents(leaf)).project;
    expect(q.components[0]!.sch.mirrored).toBe(true);
    q = exec(q, sch.setComponentValue(leaf, 'leaf-a')).project;
    q = exec(q, sch.setComponentRef(leaf, ' LEAF1 ')).project;
    expect(q.components[0]).toMatchObject({ value: 'leaf-a', ref: 'LEAF1' });
    expect(() => exec(q, sch.setComponentRef(spine, 'LEAF1'))).toThrow(/already used/);
    const fp = sch.setFootprint([leaf, spine], null);
    q = exec(q, fp).project;
    expect(fp.result).toBe(2);
    expect(q.components.slice(0, 2).every((c) => c.footprintDefId === null)).toBe(true);
    expect(() => exec(q, sch.setFootprint(leaf, 'fp.nope'))).toThrow(/Unknown footprint/);
    const tog = sch.toggleExpandedPins(leaf);
    q = exec(q, tog).project;
    expect(tog.result).toBe(true);
    expect(q.components[0]!.expandedPins).toBe(true);
    const bulk = sch.bulkAssign({ refGlob: 'SRV*', footprintDefId: 'fp.server-1u', optics: [{ portGlob: 'eth*', opticId: 'xcvr.25g-sr' }] });
    q = exec(q, bulk).project;
    expect(bulk.result).toBe(1);
    expect(q.components[2]!.optics).toEqual({ eth0: 'xcvr.25g-sr', eth1: 'xcvr.25g-sr' });
  });

  it('annotate reports ref changes', () => {
    const { p } = seed();
    const q = exec(p, sch.addComponent(LEAF, ROOT_SHEET_ID, { x: 0, y: 900 }, { annotate: false })).project;
    const ann = sch.annotate();
    const r = exec(q, ann);
    expect(ann.result).toEqual([{ componentId: q.components[3]!.id, from: 'SW?', to: 'SW3' }]);
    expect(exec(r.project, sch.annotate()).changed).toBe(false);
  });
});

describe('sheets', () => {
  it('create, rename, move, duplicate and delete', () => {
    const { p, leaf } = seed();
    const create = sch.createSheet(ROOT_SHEET_ID, ' Pod A ', { x: 100, y: 100 });
    let q = exec(p, create).project;
    expect(q.sheets[1]).toMatchObject({ id: create.result, name: 'Pod A', parentId: ROOT_SHEET_ID, sch: { pos: { x: 100, y: 100 } } });
    expect(() => exec(q, sch.createSheet(ROOT_SHEET_ID, '  ', { x: 0, y: 0 }))).toThrow(/empty/);
    q = exec(q, sch.renameSheet(create.result!, 'Pod 1')).project;
    const m1 = exec(q, sch.moveSheetSymbol(create.result!, { x: 110, y: 100 }, 'd'), emptyHistory(), 1000);
    const m2 = exec(m1.project, sch.moveSheetSymbol(create.result!, { x: 120, y: 100 }, 'd'), m1.history, 1100);
    expect(m2.history.schematic.undo).toHaveLength(1);
    q = m2.project;
    expect(q.sheets[1]).toMatchObject({ name: 'Pod 1', sch: { pos: { x: 120, y: 100 } } });
    q = exec(q, sch.addComponent(SERVER, create.result!, { x: 0, y: 0 })).project;
    q = exec(q, sch.addLink({ componentId: q.components[3]!.id, portId: 'eth0' }, { componentId: leaf, portId: 'eth1/1' }, null)).project;
    const dup = sch.duplicateSheet(create.result!, 'Pod 2');
    q = exec(q, dup).project;
    expect(q.sheets).toHaveLength(3);
    expect(dup.result!.droppedCrossSheetLinks).toHaveLength(1);
    expect(q.components.map((c) => c.ref)).toContain('SRV3');
    const del = sch.deleteSheet(dup.result!.sheetId);
    q = exec(q, del).project;
    expect(del.result!.componentIds).toHaveLength(1);
    expect(q.sheets).toHaveLength(2);
    expect(() => exec(q, sch.deleteSheet(ROOT_SHEET_ID))).toThrow(/root sheet/);
  });
});

describe('fabric, breakout, custom devices', () => {
  it('applies fabric and breakout plans', () => {
    const { p, leaf, spine, srv } = seed();
    const plan = planFabric(p, {
      leafIds: [leaf],
      spineIds: [spine],
      leafPortIds: ['eth1/49'],
      spinePortIds: ['eth1/1'],
      cableDefId: null,
      opticId: 'xcvr.100g-sr4',
      labelPrefix: 'fab-',
    });
    const fab = sch.applyFabric(plan);
    const q = exec(p, fab);
    expect(fab.result).toHaveLength(1);
    expect(q.project.links[0]).toMatchObject({ id: fab.result![0], label: 'fab-1' });
    expect(q.history.schematic.undo[0]!.label).toBe('Fabric connect (link)');

    const bo = planBreakout(q.project, {
      componentId: leaf,
      portId: 'eth1/50',
      targets: [{ componentId: srv, portId: 'eth0' }, { componentId: srv, portId: 'eth1' }],
      cableDefId: 'cbl.mpo-breakout',
    });
    expect(bo.ok).toBe(true);
    const cmd = sch.applyBreakout(bo);
    const r = exec(q.project, cmd);
    expect(cmd.result).toHaveLength(2);
    expect(r.project.links).toHaveLength(3);
    const bad = planBreakout(r.project, { componentId: leaf, portId: 'eth1/1', targets: [], cableDefId: null });
    expect(() => exec(r.project, sch.applyBreakout(bad))).toThrow(/errors/);
  });

  it('adds a custom symbol + footprint that addComponent can then use', () => {
    const p0 = createProject('t', '2026-01-01T00:00:00.000Z');
    const form = {
      name: 'Edge Router 4x100',
      kind: 'router' as const,
      heightU: 2,
      ports: [
        { id: 'et1', type: 'QSFP28' as const, role: 'uplink' as const },
        { id: 'et2', type: 'QSFP28' as const, role: 'uplink' as const },
        { id: 'et3', type: 'SFP28' as const, role: 'downlink' as const },
        { id: 'ma1', type: 'RJ45' as const, role: 'mgmt' as const, face: 'rear' as const },
      ],
    };
    const add = sch.addCustomSymbolAndFootprint(form);
    const r = exec(p0, add);
    expect(add.result).toEqual({ symbolId: 'sym.custom.edge-router-4x100', footprintId: 'fp.custom.edge-router-4x100' });
    const idx = catalogIndex(r.project);
    const symbol = idx.symbol(add.result!.symbolId)!;
    expect(symbol).toMatchObject({ kind: 'router', refPrefix: 'RTR', width: 200, height: 40, defaultFootprintIds: [add.result!.footprintId] });
    expect(symbol.pins.map((x) => [x.portId, x.side, x.offset])).toEqual([
      ['et1', 'R', 10],
      ['et2', 'R', 20],
      ['et3', 'L', 10],
      ['ma1', 'L', 20], // mgmt goes to the emptier side
    ]);
    expect(symbol.groups?.map((g) => g.role)).toEqual(['uplink', 'downlink', 'mgmt']);
    const fp = idx.footprint(add.result!.footprintId)!;
    expect(fp).toMatchObject({ heightU: 2, depthMm: 500, widthMm: 482.6, kind: 'router' });
    expect(fp.ports.map((x) => [x.id, x.face])).toEqual([['et1', 'front'], ['et2', 'front'], ['et3', 'front'], ['ma1', 'rear']]);
    expect(fp.ports[0]!.pos.x).toBeLessThan(fp.ports[1]!.pos.x);

    // Usable immediately, and a second device with the same name gets a fresh id.
    const comp = sch.addComponent(add.result!.symbolId, ROOT_SHEET_ID, { x: 0, y: 0 });
    const s = exec(r.project, comp);
    expect(s.project.components[0]).toMatchObject({ ref: 'RTR1', footprintDefId: add.result!.footprintId });
    const again = sch.addCustomSymbolAndFootprint(form);
    exec(s.project, again);
    expect(again.result).toEqual({ symbolId: 'sym.custom.edge-router-4x100-2', footprintId: 'fp.custom.edge-router-4x100-2' });
    expect(undoCommand(r.project, r.history, 'schematic').project.customCatalog.symbols).toEqual([]);
  });

  it('validates the custom device form', () => {
    const base = { name: 'X', kind: 'switch' as const, heightU: 1, ports: [] };
    expect(validateCustomDevice(base)).toBeNull();
    expect(validateCustomDevice({ ...base, name: ' ' })).toMatch(/name/);
    expect(validateCustomDevice({ ...base, heightU: 1.5 })).toMatch(/whole number/);
    expect(validateCustomDevice({ ...base, ports: [{ id: 'a', type: 'LC' }, { id: 'a', type: 'LC' }] })).toMatch(/twice/);
    expect(validateCustomDevice({ ...base, ports: [{ id: 'a', type: 'XX' as never }] })).toMatch(/unknown type/);
    expect(() => buildCustomDevice({ ...base, refPrefix: 'S1' })).toThrow(/letters/);
    const built = buildCustomDevice({ ...base, ports: Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, type: 'LC' as const })) });
    expect(built.symbol.height).toBe(80); // 6 per side
    expect(built.symbol.pins.filter((x) => x.side === 'L')).toHaveLength(6);
  });
});
