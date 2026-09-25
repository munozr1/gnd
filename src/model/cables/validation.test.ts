import { describe, expect, it } from 'vitest';
import * as cables from '@/commands/cables';
import { finishRoute } from '@/commands/layout';
import * as sch from '@/commands/schematic';
import { runDrc } from '@/model/drc';
import { buildPodProject } from '@/model/demo';
import { runErc } from '@/model/erc';
import { LR4, MPO_TRUNK_12F, SPINE, SR4, builtinCableDef, placedTrunkFixture, run, trunkFixture, withCable, withCustomDef } from '@/model/erc/rules/cable-fixtures';
import { ROOT_SHEET_ID } from '@/model/factories';
import { ProjectIndex } from '@/model/query';
import { resolveCable } from './resolve';
import { cableDefProblems, cableLegViews, cableReach, legName, portOfferAt, resolveCableWith, usedFiberCount } from './validation';

const resolvedDef = (id: string) => {
  const r = resolveCable(builtinCableDef(id));
  if ('error' in r) throw new Error(r.error);
  return r;
};
const resolved8F = () => resolvedDef('cbl.om4-8f-mpo8-4lc');

describe('cableDefProblems / resolveCableWith', () => {
  it('is empty for a sound definition and names a missing one', () => {
    const f = trunkFixture();
    const idx = new ProjectIndex(f.project);
    expect(cableDefProblems(idx, idx.cable(f.cable)!)).toEqual([]);
    expect(resolveCableWith(idx, idx.cable(f.cable)!)?.fiberCount).toBe(8);
    const gone = withCable(f.project, { id: 'c-gone', label: 'T-2', cableDefId: 'cbl.gone', plugs: [] });
    const idx2 = new ProjectIndex(gone);
    expect(cableDefProblems(idx2, idx2.cable('c-gone')!)).toEqual(['Cable definition "cbl.gone" is not in the catalog.']);
    expect(resolveCableWith(idx2, idx2.cable('c-gone')!)).toBeUndefined();
  });

  it('reports the Cable Builder wording for an uneven split, which does not resolve', () => {
    const f = trunkFixture();
    const p = withCable(
      withCustomDef(f.project, {
        ...builtinCableDef('cbl.om4-8f-mpo8-4lc'),
        id: 'cbl.custom.bad',
        name: 'bad',
        fiberCount: 16,
        sideA: { connector: 'MPO-12' },
        sideB: { connector: 'LC-duplex' },
      }),
      { id: 'c-bad', label: 'T-2', cableDefId: 'cbl.custom.bad', plugs: [] },
    );
    const idx = new ProjectIndex(p);
    expect(cableDefProblems(idx, idx.cable('c-bad')!)).toEqual(["16 fibers can't be split evenly into MPO-12 legs (12 each). Use MPO-16 or MPO-8."]);
    expect(resolveCableWith(idx, idx.cable('c-bad')!)).toBeUndefined();
  });
});

describe('cableLegViews / legName', () => {
  it('lists side A then side B legs with their plugs and names', () => {
    const f = trunkFixture();
    const idx = new ProjectIndex(f.project);
    const views = cableLegViews(resolved8F(), idx.cable(f.cable)!);
    expect(views.map((v) => [v.side, v.leg.index, v.leg.label, v.connector, v.name, v.plug?.portId])).toEqual([
      ['A', 0, 'A', 'MPO-8', 'side A', 'eth1/49'],
      ['B', 0, '1', 'LC-duplex', 'side B leg 1', 'f1'],
      ['B', 1, '2', 'LC-duplex', 'side B leg 2', 'f2'],
      ['B', 2, '3', 'LC-duplex', 'side B leg 3', 'f3'],
      ['B', 3, '4', 'LC-duplex', 'side B leg 4', 'f4'],
    ]);
    expect(legName(1, 'B', { index: 0, label: '1', positions: [1, 2] })).toBe('side B');
    expect(legName(4, 'B', { index: 2, label: 'Tx3', positions: [1, 2] })).toBe('side B leg Tx3');
  });
});

describe('portOfferAt', () => {
  it('describes cages by their optic, empty cages, fixed ports and unknown ports', () => {
    const f = trunkFixture();
    const p = run(f.project, sch.setOptic(f.leaf, 'eth1/50', LR4));
    const idx = new ProjectIndex(p);
    expect(portOfferAt(idx, f.leaf, 'eth1/49')).toMatchObject({ view: { type: 'QSFP28', opticConnector: 'MPO-12', opticLanes: 4 }, describe: 'MPO-12 port' });
    expect(portOfferAt(idx, f.leaf, 'eth1/50')).toMatchObject({ view: { type: 'QSFP28', opticConnector: 'LC', opticLanes: 4 }, describe: 'LC port' });
    expect(portOfferAt(idx, f.leaf, 'eth1/51')).toMatchObject({ view: { type: 'QSFP28' }, describe: 'empty QSFP28 cage' });
    expect(portOfferAt(idx, f.leaf, 'mgmt0')).toMatchObject({ view: { type: 'RJ45' }, describe: 'RJ45 port' });
    expect(portOfferAt(idx, f.panel, 'f7')).toMatchObject({ view: { type: 'LC' }, describe: 'LC port' });
    expect(portOfferAt(idx, f.panel, 'f7')?.component.ref).toBe('PP1');
    expect(portOfferAt(idx, f.panel, 'nope')).toBeUndefined();
    expect(portOfferAt(idx, 'ghost', 'f1')).toBeUndefined();
  });
});

describe('usedFiberCount', () => {
  it('counts two fibers per channel that is plugged end to end', () => {
    const f = trunkFixture();
    expect(usedFiberCount(f.project, new ProjectIndex(f.project).cable(f.cable)!)).toBe(8);
    const one = run(f.project, cables.unplugLeg(f.cable, 'B', 2));
    expect(usedFiberCount(one, new ProjectIndex(one).cable(f.cable)!)).toBe(6);
    const none = trunkFixture({ plugB: false });
    expect(usedFiberCount(none.project, new ProjectIndex(none.project).cable(none.cable)!)).toBe(0);
  });

  it('is bounded by the ports lane capacity: a 12F MPO cord between 4-lane optics carries 8', () => {
    const f = trunkFixture({ plugA: false, plugB: false });
    const spine = sch.addComponent(SPINE, ROOT_SHEET_ID, { x: 0, y: 400 });
    let p = run(f.project, spine);
    const create = cables.createCable(MPO_TRUNK_12F, { label: 'X-1', plugsA: [{ componentId: f.leaf, portId: 'eth1/49' }] });
    p = run(p, sch.setOptic(spine.result!, 'eth1/1', SR4), create);
    p = run(p, cables.plugLeg(create.result!, 'B', 0, { componentId: spine.result!, portId: 'eth1/1' }));
    expect(usedFiberCount(p, new ProjectIndex(p).cable(create.result!)!)).toBe(8);
  });
});

describe('cableReach', () => {
  it('is null without a route or a declared length, else the jacket plus one breakout per fanned side', () => {
    const f = trunkFixture();
    expect(cableReach(f.project, new ProjectIndex(f.project).cable(f.cable)!, resolved8F())).toBeNull();
    const declared = run(f.project, cables.setCableLength(f.cable, 2));
    const cable = new ProjectIndex(declared).cable(f.cable)!;
    expect(cableReach(declared, cable, resolved8F())).toEqual({ jacketM: 2, routed: false, breakoutM: 0.5, totalM: 2.5 });
    // A straight cord fans out nowhere: no breakout allowance.
    expect(cableReach(declared, cable, resolvedDef('cbl.om4-duplex'))).toEqual({ jacketM: 2, routed: false, breakoutM: 0, totalM: 2 });
  });

  it('prefers the routed jacket over the declared length', () => {
    const f = placedTrunkFixture();
    const r2 = f.project.racks[1]!;
    const p = run(
      f.project,
      cables.setCableLength(f.cable, 1),
      finishRoute(f.cable, [{ layer: 'overhead', trayId: null, points: [{ x: 1150, y: 500 }, { x: r2.pos.x + 150, y: 500 }] }]),
    );
    const reach = cableReach(p, new ProjectIndex(p).cable(f.cable)!, resolved8F())!;
    expect(reach.routed).toBe(true);
    expect(reach.jacketM).toBeGreaterThan(3);
    expect(reach.breakoutM).toBe(0.5);
    expect(reach.totalM).toBeCloseTo(reach.jacketM + 0.5, 9);
  });
});

describe('Demo pod regression', () => {
  it('the Demo pod (no installed cables) raises no cable-* issue in ERC or DRC', () => {
    const project = buildPodProject();
    expect(project.cables).toEqual([]);
    expect(runErc(project).filter((i) => i.rule.startsWith('cable-'))).toEqual([]);
    expect(runDrc(project).filter((i) => i.rule.startsWith('cable-'))).toEqual([]);
  });
});
