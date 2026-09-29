import { describe, expect, it } from 'vitest';
import * as cables from '@/commands/cables';
import * as sch from '@/commands/schematic';
import { ROOT_SHEET_ID } from '@/model/factories';
import { check } from '../fixtures';
import { cableUnusedFibersRule } from './cable-unused-fibers';
import { MPO_TRUNK_12F, SPINE, SR4, run, trunkFixture } from './cable-fixtures';

/** The trunk fixture plus a 12F MPO-12 cord 'X-1' from SW1 eth1/50 (SR4) to a spine's eth1/1 (SR4): two 4-lane optics. */
function withMpoCord() {
  const f = trunkFixture();
  const spine = sch.addComponent(SPINE, ROOT_SHEET_ID, { x: 0, y: 400 });
  let project = run(f.project, spine);
  const create = cables.createCable(MPO_TRUNK_12F, { label: 'X-1', plugsA: [{ componentId: f.leaf, portId: 'eth1/50' }] });
  project = run(project, sch.setOptic(f.leaf, 'eth1/50', SR4), sch.setOptic(spine.result!, 'eth1/1', SR4), create);
  project = run(project, cables.plugLeg(create.result!, 'B', 0, { componentId: spine.result!, portId: 'eth1/1' }));
  return { ...f, project, spine: spine.result!, cord: create.result! };
}

describe('cable-unused-fibers', () => {
  it('reports the fibers a 12F MPO cord leaves idle between two 4-lane optics', () => {
    const f = withMpoCord();
    const issues = check(cableUnusedFibersRule, f.project);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'info', rule: 'cable-unused-fibers', message: 'X-1: 4 of 12 fibers unused', targets: [{ kind: 'cable', id: f.cord }] });
  });

  it('is clean for a fully used 8F trunk and reports an unplugged leg as two idle fibers', () => {
    const f = trunkFixture();
    expect(check(cableUnusedFibersRule, f.project)).toEqual([]);
    const issues = check(cableUnusedFibersRule, run(f.project, cables.unplugLeg(f.cable, 'B', 2)));
    expect(issues.map((i) => i.message)).toEqual(['T-1: 2 of 8 fibers unused']);
  });

  it('says nothing about a cable with no channel in service (the unassigned legs are the warning)', () => {
    expect(check(cableUnusedFibersRule, trunkFixture({ plugA: false, plugB: false }).project)).toEqual([]);
    expect(check(cableUnusedFibersRule, trunkFixture({ plugB: false }).project)).toEqual([]);
    expect(check(cableUnusedFibersRule, trunkFixture({ plugA: false }).project)).toEqual([]);
  });

  it('keeps its id across a relabel and when the idle count changes', () => {
    const f = withMpoCord();
    const before = check(cableUnusedFibersRule, f.project);
    const after = check(cableUnusedFibersRule, run(f.project, cables.setCableLabel(f.cord, 'Spine link')));
    expect(after.map((i) => i.id)).toEqual(before.map((i) => i.id));
    expect(after[0]!.message).toBe('Spine link: 4 of 12 fibers unused');
    const trunkToo = check(cableUnusedFibersRule, run(f.project, cables.unplugLeg(f.cable, 'B', 0)));
    expect(trunkToo.map((i) => i.message).sort()).toEqual(['T-1: 2 of 8 fibers unused', 'X-1: 4 of 12 fibers unused']);
    expect(trunkToo.find((i) => i.message.startsWith('X-1'))!.id).toBe(before[0]!.id);
  });
});
