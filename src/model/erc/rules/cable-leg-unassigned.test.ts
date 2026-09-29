import { describe, expect, it } from 'vitest';
import * as cables from '@/commands/cables';
import * as sch from '@/commands/schematic';
import { check } from '../fixtures';
import { cableLegUnassignedRule } from './cable-leg-unassigned';
import { run, trunkFixture, withPlug } from './cable-fixtures';

describe('cable-leg-unassigned', () => {
  it('warns for every leg of a cable that is not connected yet', () => {
    const f = trunkFixture({ plugA: false, plugB: false });
    const issues = check(cableLegUnassignedRule, f.project);
    expect(issues.map((i) => i.message)).toEqual([
      'T-1: side A is not connected',
      'T-1: side B leg 1 is not connected',
      'T-1: side B leg 2 is not connected',
      'T-1: side B leg 3 is not connected',
      'T-1: side B leg 4 is not connected',
    ]);
    expect(issues.every((i) => i.severity === 'warning' && i.targets.length === 1 && i.targets[0]!.kind === 'cable' && i.targets[0]!.id === f.cable)).toBe(true);
    expect(new Set(issues.map((i) => i.id)).size).toBe(5);
  });

  it('is clean for a fully plugged trunk and reports just the leg that is unplugged', () => {
    const f = trunkFixture();
    expect(check(cableLegUnassignedRule, f.project)).toEqual([]);
    const issues = check(cableLegUnassignedRule, run(f.project, cables.unplugLeg(f.cable, 'B', 2)));
    expect(issues.map((i) => i.message)).toEqual(['T-1: side B leg 3 is not connected']);
  });

  it('treats a plug on a port that no longer exists as unassigned', () => {
    const f = trunkFixture();
    const ghost = check(cableLegUnassignedRule, withPlug(f.project, f.cable, 'B', 0, { componentId: 'ghost', portId: 'f1' }));
    expect(ghost.map((i) => i.message)).toEqual(['T-1: side B leg 1 is plugged into a port that no longer exists']);
    expect(ghost[0]!.targets).toEqual([{ kind: 'cable', id: f.cable }]);
    const badPort = check(cableLegUnassignedRule, withPlug(f.project, f.cable, 'B', 1, { componentId: f.panel, portId: 'f99' }));
    expect(badPort.map((i) => i.message)).toEqual(['T-1: side B leg 2 is plugged into a port that no longer exists']);
    expect(badPort[0]!.targets).toEqual([
      { kind: 'cable', id: f.cable },
      { kind: 'component', id: f.panel, portId: 'f99' },
    ]);
  });

  it('keeps the same issue id for a leg whether it is unplugged or dangling, and across a relabel', () => {
    const f = trunkFixture();
    const unplugged = check(cableLegUnassignedRule, run(f.project, cables.unplugLeg(f.cable, 'B', 0)));
    const dangling = check(cableLegUnassignedRule, withPlug(f.project, f.cable, 'B', 0, { componentId: 'ghost', portId: 'f1' }));
    const relabelled = check(cableLegUnassignedRule, run(f.project, cables.unplugLeg(f.cable, 'B', 0), cables.setCableLabel(f.cable, 'Uplink')));
    expect(dangling[0]!.id).toBe(unplugged[0]!.id);
    expect(relabelled[0]!.id).toBe(unplugged[0]!.id);
    expect(relabelled[0]!.message).toBe('Uplink: side B leg 1 is not connected');
    // A different leg is a different issue.
    const other = check(cableLegUnassignedRule, run(f.project, cables.unplugLeg(f.cable, 'B', 1)));
    expect(other[0]!.id).not.toBe(unplugged[0]!.id);
    // Optics do not matter here: an incompatible but plugged leg is not "unassigned".
    expect(check(cableLegUnassignedRule, run(f.project, sch.setOptic(f.leaf, 'eth1/49', null)))).toEqual([]);
  });
});
