import { describe, expect, it } from 'vitest';
import { createLink } from '../factories';
import { applyBreakout, breakoutFanout, breakoutLanes, planBreakout } from './breakout';
import { LEAF, SERVER_1U, fixtureProject, place } from './testUtils';

function rig(nServers = 4) {
  const p = fixtureProject();
  const leaf = place(p, LEAF, { x: 0, y: 0 }, { ref: 'SW1' });
  const servers = Array.from({ length: nServers }, (_, i) => place(p, SERVER_1U, { x: 400, y: 60 * i }, { ref: `SRV${i + 1}` }));
  const targets = servers.map((s) => ({ componentId: s.id, portId: 'eth0' }));
  return { p, leaf, servers, targets };
}

describe('planBreakout', () => {
  it('fans a QSFP port out to one lane per target', () => {
    const { p, leaf, targets } = rig();
    const plan = planBreakout(p, { componentId: leaf.id, portId: 'eth1/49', targets, cableDefId: 'cbl.mpo-breakout' });
    expect(plan.ok).toBe(true);
    expect(plan.errors).toEqual([]);
    expect(plan.fanout).toBe(4);
    expect(plan.links.map((l) => l.a.lane)).toEqual([0, 1, 2, 3]);
    expect(plan.links.every((l) => l.a.componentId === leaf.id && l.a.portId === 'eth1/49')).toBe(true);
    expect(plan.links.map((l) => l.b.componentId)).toEqual(targets.map((t) => t.componentId));
    expect(plan.links.every((l) => l.cableDefId === 'cbl.mpo-breakout')).toBe(true);

    const ids = applyBreakout(p, plan);
    expect(ids).toHaveLength(4);
    expect(breakoutLanes(p, leaf.id, 'eth1/49').map((l) => l.a.lane)).toEqual([0, 1, 2, 3]);

    const full = planBreakout(p, { componentId: leaf.id, portId: 'eth1/49', targets: [{ componentId: targets[0]!.componentId, portId: 'eth1' }], cableDefId: null });
    expect(full.ok).toBe(false);
    expect(full.errors.map((e) => e.code)).toContain('no-free-lanes');
    expect(full.usedLanes).toEqual([0, 1, 2, 3]);
  });

  it('assigns the lowest free lanes when some are taken', () => {
    const { p, leaf, targets } = rig();
    p.links.push(createLink({ componentId: leaf.id, portId: 'eth1/49', lane: 1 }, targets[0]!));
    const plan = planBreakout(p, { componentId: leaf.id, portId: 'eth1/49', targets: targets.slice(1, 3), cableDefId: null });
    expect(plan.ok).toBe(true);
    expect(plan.links.map((l) => l.a.lane)).toEqual([0, 2]);
  });

  it('rejects a non-QSFP source', () => {
    const { p, leaf, targets } = rig(1);
    const plan = planBreakout(p, { componentId: leaf.id, portId: 'eth1/1', targets, cableDefId: null });
    expect(plan.ok).toBe(false);
    expect(plan.errors[0]!.code).toBe('source-not-breakout-capable');
  });

  it('rejects more targets than the fanout', () => {
    const { p, leaf, targets } = rig(5);
    const plan = planBreakout(p, { componentId: leaf.id, portId: 'eth1/49', targets, cableDefId: 'cbl.mpo-breakout' });
    expect(plan.ok).toBe(false);
    expect(plan.links).toEqual([]);
    expect(plan.errors.map((e) => e.code)).toContain('too-many-targets');
  });

  it('rejects occupied, duplicate and self targets and a whole-port-linked source', () => {
    const { p, leaf, servers, targets } = rig(3);
    p.links.push(createLink({ componentId: servers[0]!.id, portId: 'eth0' }, { componentId: servers[2]!.id, portId: 'eth1' }));
    const plan = planBreakout(p, {
      componentId: leaf.id,
      portId: 'eth1/49',
      targets: [targets[0]!, targets[1]!, targets[1]!, { componentId: leaf.id, portId: 'eth1/49' }],
      cableDefId: null,
    });
    expect(plan.ok).toBe(false);
    expect(plan.errors.map((e) => [e.code, e.targetIndex])).toEqual([
      ['target-occupied', 0],
      ['duplicate-target', 2],
      ['target-is-source', 3],
    ]);

    p.links.push(createLink({ componentId: leaf.id, portId: 'eth1/50' }, { componentId: servers[1]!.id, portId: 'eth1' }));
    const occupied = planBreakout(p, { componentId: leaf.id, portId: 'eth1/50', targets: [targets[2]!], cableDefId: null });
    expect(occupied.errors[0]!.code).toBe('source-occupied');
  });

  it('derives the fanout from the cable, then the optic, then the default', () => {
    const { p, leaf } = rig(0);
    expect(breakoutFanout(p, leaf.id, 'eth1/49', 'cbl.mpo-breakout')).toBe(4);
    leaf.optics['eth1/49'] = 'xcvr.400g-sr8';
    expect(breakoutFanout(p, leaf.id, 'eth1/49', null)).toBe(8);
    delete leaf.optics['eth1/49'];
    expect(breakoutFanout(p, leaf.id, 'eth1/49', null)).toBe(4);
  });

  it('applyBreakout refuses a failed plan', () => {
    const { p, leaf, targets } = rig(1);
    const plan = planBreakout(p, { componentId: leaf.id, portId: 'bogus', targets, cableDefId: null });
    expect(plan.errors[0]!.code).toBe('missing-port');
    expect(() => applyBreakout(p, plan)).toThrow(/Breakout plan has errors/);
  });
});
