import { describe, expect, it } from 'vitest';
import { createProject, ROOT_SHEET_ID } from '@/model/factories';
import type { Project } from '@/model/types';
import { emptyHistory, executeCommand, redoCommand, undoCommand, type Command, type History } from '@/store/commands';
import * as cables from './cables';
import * as sch from './schematic';

const LEAF = 'sym.leaf-switch-48x25-8x100';
const PANEL = 'sym.fiber-patch-panel-24lc';
const TRUNK = 'cbl.om4-8f-mpo8-4lc';

function exec(project: Project, cmd: Command, history: History = emptyHistory(), now = 1000) {
  const r = executeCommand(project, history, cmd, now);
  return { project: r.project, history: r.history, changed: r.changed };
}

function seed() {
  let p = createProject('t', '2026-01-01T00:00:00.000Z');
  const leaf = sch.addComponent(LEAF, ROOT_SHEET_ID, { x: 0, y: 0 });
  p = exec(p, leaf).project;
  const panel = sch.addComponent(PANEL, ROOT_SHEET_ID, { x: 600, y: 0 });
  p = exec(p, panel).project;
  p = exec(p, sch.setOptic(leaf.result!, 'eth1/49', 'xcvr.100g-sr4')).project;
  p = exec(p, sch.setOptic(leaf.result!, 'eth1/50', 'xcvr.100g-sr4')).project;
  return { p, leaf: leaf.result!, panel: panel.result! };
}

const plugs = (p: Project, side: 'A' | 'B') => p.cables[0]!.plugs.filter((x) => x.side === side).map((x) => x.portId);

describe('cable commands', () => {
  it('createCable installs an unassigned cable with a sequential label and is undoable', () => {
    const { p } = seed();
    const cmd = cables.createCable(TRUNK);
    const r = exec(p, cmd);
    expect(r.changed).toBe(true);
    expect(cmd.result).toBe(r.project.cables[0]!.id);
    expect(r.project.cables[0]).toMatchObject({ label: 'CBL1', cableDefId: TRUNK });
    expect(r.project.cables[0]!.plugs).toHaveLength(5);
    expect(r.project.links).toEqual([]);
    const r2 = exec(r.project, cables.createCable(TRUNK, { label: '  ' }), r.history);
    expect(r2.project.cables.map((c) => c.label)).toEqual(['CBL1', 'CBL2']);
    expect(undoCommand(r2.project, r2.history, 'schematic').project).toEqual(r.project);
    expect(undoCommand(r.project, r.history, 'schematic').project).toEqual(p);
    expect(() => exec(p, cables.createCable('cbl.nope'))).toThrow(/Unknown cable/);
    expect(() => exec(p, cables.createCable('cbl.cat6a'))).toThrow(/Cannot connect/);
  });

  it('createCable with plugsA plugs side A in leg order', () => {
    const { p, leaf } = seed();
    const cmd = cables.createCable(TRUNK, { label: 'Uplink', plugsA: [{ componentId: leaf, portId: 'eth1/49' }] });
    const r = exec(p, cmd);
    expect(r.project.cables[0]!.label).toBe('Uplink');
    expect(plugs(r.project, 'A')).toEqual(['eth1/49']);
    expect(() => exec(p, cables.createCable(TRUNK, { plugsA: [{ componentId: leaf, portId: 'eth1/51' }] }))).toThrow(/empty QSFP28 cage/);
  });

  it('plugLeg, autoFillSide, unplugLeg and deleteCable each undo to exactly the previous project', () => {
    const { p: p0, leaf, panel } = seed();
    const create = cables.createCable(TRUNK);
    const s1 = exec(p0, create);
    const id = create.result!;

    const s2 = exec(s1.project, cables.plugLeg(id, 'A', 0, { componentId: leaf, portId: 'eth1/49' }), s1.history, 2000);
    expect(plugs(s2.project, 'A')).toEqual(['eth1/49']);
    expect(s2.project.links).toEqual([]);
    expect(() => exec(s2.project, cables.plugLeg(id, 'B', 0, { componentId: leaf, portId: 'eth1/50' }), s2.history)).toThrow(
      'LC-duplex leg 1 cannot plug into eth1/50 (MPO-12 port)',
    );

    const fill = cables.autoFillSide(id, 'B', { componentId: panel, portId: 'f1' });
    const s3 = exec(s2.project, fill, s2.history, 3000);
    expect(fill.result).toBe(4);
    expect(plugs(s3.project, 'B')).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(s3.project.links).toHaveLength(4);
    expect(s3.project.links.map((l) => [l.a.portId, l.a.lane, l.b.portId, l.cableId])).toEqual([
      ['eth1/49', 0, 'f1', id],
      ['eth1/49', 1, 'f2', id],
      ['eth1/49', 2, 'f3', id],
      ['eth1/49', 3, 'f4', id],
    ]);
    expect(s3.history.schematic.undo.map((e) => e.label)).toEqual(['Connect cable', 'Plug leg A1', 'Auto-fill side B']);

    const s4 = exec(s3.project, cables.unplugLeg(id, 'B', 2), s3.history, 4000);
    expect(plugs(s4.project, 'B')).toEqual(['f1', 'f2', null, 'f4']);
    expect(s4.project.links.map((l) => l.b.portId)).toEqual(['f1', 'f2', 'f4']);

    const s5 = exec(s4.project, cables.deleteCable(id), s4.history, 5000);
    expect(s5.project.cables).toEqual([]);
    expect(s5.project.links).toEqual([]);

    // Undo walks back through every step, restoring the exact projects.
    const u1 = undoCommand(s5.project, s5.history, 'schematic');
    expect(u1.project).toEqual(s4.project);
    const u2 = undoCommand(u1.project, u1.history, 'schematic');
    expect(u2.project).toEqual(s3.project);
    const u3 = undoCommand(u2.project, u2.history, 'schematic');
    expect(u3.project).toEqual(s2.project);
    const u4 = undoCommand(u3.project, u3.history, 'schematic');
    expect(u4.project).toEqual(s1.project);
    const u5 = undoCommand(u4.project, u4.history, 'schematic');
    expect(u5.project).toEqual(p0);
    const r1 = redoCommand(u5.project, u5.history, 'schematic');
    expect(r1.project).toEqual(s1.project);
  });

  it('deleteCables ignores unknown ids; label, length and furcation edit the instance', () => {
    const { p: p0 } = seed();
    const create = cables.createCable(TRUNK);
    const s1 = exec(p0, create);
    const id = create.result!;
    const s2 = exec(s1.project, cables.setCableLabel(id, ' Trunk 1 '), s1.history);
    expect(s2.project.cables[0]!.label).toBe('Trunk 1');
    expect(() => exec(s2.project, cables.setCableLabel(id, ' '), s2.history)).toThrow(/cannot be empty/);
    const s3 = exec(s2.project, cables.setCableLength(id, 5), s2.history);
    expect(s3.project.cables[0]!.lengthM).toBe(5);
    const s4 = exec(s3.project, cables.setCableLength(id, 0), s3.history);
    expect(s4.project.cables[0]!.lengthM).toBeUndefined();
    const f1 = exec(s4.project, cables.setFurcation(id, 'B', { x: 100, y: 200 }, false), s4.history, 1000);
    const f2 = exec(f1.project, cables.setFurcation(id, 'B', { x: 120, y: 200 }), f1.history, 1100);
    expect(f2.project.cables[0]!.furcation).toEqual({ B: { pos: { x: 120, y: 200 }, pinned: true } });
    expect(f2.history.schematic.undo.length).toBe(f1.history.schematic.undo.length); // coalesced drag
    const s5 = exec(f2.project, cables.deleteCables([id, 'nope']), f2.history);
    expect(s5.project.cables).toEqual([]);
    expect(exec(s5.project, cables.deleteCables(['nope']), s5.history).changed).toBe(false);
    expect(() => exec(s5.project, cables.setCableLabel(id, 'x'), s5.history)).toThrow(/Cable not found/);
  });

  it('deleting a plugged device through deleteComponents unassigns its legs and drops the links', () => {
    const { p: p0, leaf, panel } = seed();
    const create = cables.createCable(TRUNK, { plugsA: [{ componentId: leaf, portId: 'eth1/49' }] });
    const s1 = exec(p0, create);
    const s2 = exec(s1.project, cables.autoFillSide(create.result!, 'B', { componentId: panel, portId: 'f1' }), s1.history);
    expect(s2.project.links).toHaveLength(4);
    const s3 = exec(s2.project, sch.deleteComponents(panel), s2.history);
    expect(s3.project.links).toEqual([]);
    expect(plugs(s3.project, 'B')).toEqual([null, null, null, null]);
    expect(undoCommand(s3.project, s3.history, 'schematic').project).toEqual(s2.project);
  });
});
