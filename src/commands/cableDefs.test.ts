import { describe, expect, it } from 'vitest';
import { builtinCatalog, catalogIndex } from '@/catalog';
import { deriveSides, deriveStrandMap, resolveCable } from '@/model/cables';
import { createProject, ROOT_SHEET_ID } from '@/model/factories';
import type { Project } from '@/model/types';
import { emptyHistory, executeCommand, undoCommand, type Command, type History } from '@/store/commands';
import { addCableDef, buildCableDef, cableDefIdFor, defaultBendRadiusMm, deleteCableDef, updateCableDef, type FiberCableDefInput } from './cableDefs';
import * as sch from './schematic';

function exec(project: Project, cmd: Command, history: History = emptyHistory()) {
  const r = executeCommand(project, history, cmd, 1000);
  return { project: r.project, history: r.history, changed: r.changed };
}

const fresh = () => createProject('t', '2026-01-01T00:00:00.000Z');

const TRUNK: FiberCableDefInput = {
  name: '8F OM4 MPO-8 → 4×LC-duplex',
  fiberCount: 8,
  fiberType: 'OM4',
  sideA: { connector: 'MPO-8' },
  sideB: { connector: 'LC-duplex' },
};

describe('buildCableDef', () => {
  it('fills the id and the legacy fields from the fiber definition', () => {
    const def = buildCableDef(TRUNK);
    expect(def).toMatchObject({
      id: 'cbl.custom.8f-om4-mpo-8-4-lc-duplex',
      name: TRUNK.name,
      media: 'OM4',
      mediaClass: 'fiber',
      endA: 'MPO-12',
      endB: 'LC',
      color: '#2dd4bf',
      diameterMm: 3,
      bendRadiusMm: 30,
      breakout: { fanout: 4 },
      fiberCount: 8,
      sideA: { connector: 'MPO-8' },
      sideB: { connector: 'LC-duplex' },
    });
    // Derived values are not stored as source of truth.
    expect(def).not.toHaveProperty('strandMap');
    expect(def).not.toHaveProperty('polarity');
    expect(def).not.toHaveProperty('breakoutLengthM');
    const r = resolveCable(def);
    expect('error' in r).toBe(false);
    if (!('error' in r)) expect(r.summary).toBe('8F OM4 · Trunk (breakout) · MPO-8 → 4×LC-duplex · 4 channels');
  });

  it('a straight cable has no breakout and an OS2 jacket is yellow', () => {
    const def = buildCableDef({ ...TRUNK, name: 'MPO-8 patch', fiberType: 'OS2', sideB: { connector: 'MPO-8' } });
    expect(def).not.toHaveProperty('breakout');
    expect(def).toMatchObject({ endA: 'MPO-12', endB: 'MPO-12', media: 'OS2', color: '#facc15' });
  });

  it('keeps explicit colour, diameter, bend radius, polarity, breakout length and a valid custom strand map', () => {
    const sides = deriveSides(8, 'MPO-8', 'LC-duplex');
    if (!sides.ok) throw new Error(sides.error);
    const strandMap = deriveStrandMap(8, sides.sideA, sides.sideB, 'A');
    const def = buildCableDef({ ...TRUNK, color: '#123456', diameterMm: 4.5, bendRadiusMm: 60, polarity: 'A', breakoutLengthM: 1, strandMap });
    expect(def).toMatchObject({ color: '#123456', diameterMm: 4.5, bendRadiusMm: 60, polarity: 'A', breakoutLengthM: 1, strandMap });
    const r = resolveCable(def);
    if ('error' in r) throw new Error(r.error);
    expect(r.strandMapCustom).toBe(true);
  });

  it('throws the first validation problem', () => {
    expect(() => buildCableDef({ ...TRUNK, name: '  ' })).toThrow(/name cannot be empty/);
    expect(() => buildCableDef({ ...TRUNK, fiberCount: 16, sideA: { connector: 'MPO-12' } })).toThrow(/16 fibers can't be split evenly into MPO-12 legs/);
    expect(() => buildCableDef({ ...TRUNK, sideB: { connector: 'LC-octuplex' } })).toThrow(/Unknown connector "LC-octuplex"/);
    expect(() => buildCableDef({ ...TRUNK, strandMap: [{ a: { leg: 0, pos: 1 }, b: { leg: 0, pos: 1 } }] })).toThrow(/Custom strand map/);
  });

  it('picks unique ids and sane bend radii', () => {
    expect(cableDefIdFor('Spine trunk')).toBe('cbl.custom.spine-trunk');
    expect(cableDefIdFor('Spine trunk', ['cbl.custom.spine-trunk'])).toBe('cbl.custom.spine-trunk-2');
    expect(cableDefIdFor('Spine trunk', ['cbl.custom.spine-trunk', 'cbl.custom.spine-trunk-2'])).toBe('cbl.custom.spine-trunk-3');
    expect(cableDefIdFor('→')).toBe('cbl.custom.cable');
    expect(defaultBendRadiusMm(2)).toBe(30);
    expect(defaultBendRadiusMm(3.5)).toBe(35);
    expect(defaultBendRadiusMm(12)).toBe(120);
  });
});

describe('addCableDef', () => {
  it('adds to the custom catalog, resolves through the catalog index and undoes', () => {
    const cmd = addCableDef(TRUNK);
    expect(cmd.result).toBeUndefined();
    const r = exec(fresh(), cmd);
    expect(r.changed).toBe(true);
    expect(cmd.result).toBe('cbl.custom.8f-om4-mpo-8-4-lc-duplex');
    expect(r.project.customCatalog.cables).toHaveLength(1);
    expect(catalogIndex(r.project).cable(cmd.result)).toMatchObject({ name: TRUNK.name, endB: 'LC' });
    expect(undoCommand(r.project, r.history, 'schematic').project.customCatalog.cables).toEqual([]);
  });

  it('suffixes a second definition with the same name and rejects a duplicate explicit id', () => {
    const first = addCableDef(TRUNK);
    let p = exec(fresh(), first).project;
    const second = addCableDef(TRUNK);
    p = exec(p, second).project;
    expect(second.result).toBe('cbl.custom.8f-om4-mpo-8-4-lc-duplex-2');
    expect(p.customCatalog.cables.map((c) => c.id)).toEqual([first.result, second.result]);
    expect(() => exec(p, addCableDef({ ...TRUNK, id: first.result! }))).toThrow(/already exists/);
  });

  it('rejects an invalid definition without touching the project', () => {
    const p = fresh();
    expect(() => exec(p, addCableDef({ ...TRUNK, fiberCount: 16, sideA: { connector: 'MPO-12' } }))).toThrow(/can't be split evenly/);
    expect(p.customCatalog.cables).toEqual([]);
  });
});

describe('updateCableDef', () => {
  it('re-derives the legacy fields and can drop a custom strand map', () => {
    const add = addCableDef(TRUNK);
    let p = exec(fresh(), add).project;
    const id = add.result!;
    p = exec(p, updateCableDef(id, { fiberType: 'OS2', color: '' })).project;
    expect(p.customCatalog.cables[0]).toMatchObject({ id, fiberType: 'OS2', media: 'OS2', color: '#facc15', endB: 'LC' });

    const sides = deriveSides(8, 'MPO-8', 'LC-duplex');
    if (!sides.ok) throw new Error(sides.error);
    const strandMap = deriveStrandMap(8, sides.sideA, sides.sideB, 'C');
    p = exec(p, updateCableDef(id, { strandMap })).project;
    expect(p.customCatalog.cables[0]!.strandMap).toEqual(strandMap);
    p = exec(p, updateCableDef(id, { strandMap: undefined })).project;
    expect(p.customCatalog.cables[0]).not.toHaveProperty('strandMap');

    // Switching to a straight cable drops the breakout and renames nothing.
    p = exec(p, updateCableDef(id, { sideB: { connector: 'MPO-8' } })).project;
    expect(p.customCatalog.cables[0]).not.toHaveProperty('breakout');
    expect(p.customCatalog.cables[0]).toMatchObject({ name: TRUNK.name, endB: 'MPO-12' });
  });

  it('copies a built-in definition into the custom catalog as an override, undoably', () => {
    const builtin = builtinCatalog.cables.find((c) => c.id === 'cbl.om4-8f-mpo8-4lc')!;
    const r = exec(fresh(), updateCableDef(builtin.id, { name: 'House trunk', breakoutLengthM: 0.8 }));
    expect(r.project.customCatalog.cables).toHaveLength(1);
    expect(r.project.customCatalog.cables[0]).toMatchObject({ id: builtin.id, name: 'House trunk', breakoutLengthM: 0.8, fiberCount: 8 });
    expect(catalogIndex(r.project).cable(builtin.id)?.name).toBe('House trunk');
    expect(builtin.name).toBe('8F OM4 MPO-8 → 4×LC-duplex');
    expect(undoCommand(r.project, r.history, 'schematic').project.customCatalog.cables).toEqual([]);
  });

  it('throws for unknown, non-fiber or newly invalid definitions', () => {
    const p = fresh();
    expect(() => exec(p, updateCableDef('cbl.nope', { name: 'x' }))).toThrow(/Unknown cable definition/);
    expect(() => exec(p, updateCableDef('cbl.cat6a', { name: 'x' }))).toThrow(/not a fiber cable definition/);
    const add = addCableDef(TRUNK);
    const q = exec(p, add).project;
    expect(() => exec(q, updateCableDef(add.result!, { fiberCount: 12 }))).toThrow(/12 fibers can't be split evenly into MPO-8 legs/);
  });
});

describe('deleteCableDef', () => {
  it('removes a custom definition and undoes', () => {
    const add = addCableDef(TRUNK);
    const p = exec(fresh(), add).project;
    const r = exec(p, deleteCableDef(add.result!));
    expect(r.project.customCatalog.cables).toEqual([]);
    expect(undoCommand(r.project, r.history, 'schematic').project.customCatalog.cables).toHaveLength(1);
  });

  it('refuses built-ins and definitions still used by a link, but allows removing an override in use', () => {
    expect(() => exec(fresh(), deleteCableDef('cbl.om4-8f-mpo8-4lc'))).toThrow(/not a custom cable definition/);

    let p = fresh();
    const leaf = sch.addComponent('sym.leaf-switch-48x25-8x100', ROOT_SHEET_ID, { x: 0, y: 0 });
    p = exec(p, leaf).project;
    const spine = sch.addComponent('sym.spine-switch-32x400', ROOT_SHEET_ID, { x: 600, y: 0 });
    p = exec(p, spine).project;
    const add = addCableDef({ ...TRUNK, name: 'In use', sideB: { connector: 'MPO-8' } });
    p = exec(p, add).project;
    p = exec(p, sch.addLink({ componentId: leaf.result!, portId: 'eth1/49' }, { componentId: spine.result!, portId: 'eth1/1' }, add.result!)).project;
    expect(() => exec(p, deleteCableDef(add.result!))).toThrow(/used by 1 link$/);

    const override = updateCableDef('cbl.om4-mpo-trunk', { name: 'Override' });
    p = exec(p, override).project;
    p = exec(p, sch.setLinkCable(p.links[0]!.id, 'cbl.om4-mpo-trunk')).project;
    p = exec(p, deleteCableDef('cbl.om4-mpo-trunk')).project;
    expect(p.customCatalog.cables.map((c) => c.id)).toEqual([add.result]);
    expect(catalogIndex(p).cable('cbl.om4-mpo-trunk')?.name).toBe('OM4 MPO trunk');
  });
});
