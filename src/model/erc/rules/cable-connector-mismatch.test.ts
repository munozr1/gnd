import { describe, expect, it } from 'vitest';
import * as cables from '@/commands/cables';
import * as sch from '@/commands/schematic';
import { check, hasTarget } from '../fixtures';
import { cableConnectorMismatchRule } from './cable-connector-mismatch';
import { LR4, SR4, run, trunkFixture, withPlug } from './cable-fixtures';

describe('cable-connector-mismatch', () => {
  it('flags an LC leg plugged into an MPO port, naming the leg, the cable and the port', () => {
    const f = trunkFixture();
    // The connecting flow refuses this, so it is set directly (as imported data would be).
    const p = withPlug(run(f.project, sch.setOptic(f.leaf, 'eth1/50', SR4)), f.cable, 'B', 1, { componentId: f.leaf, portId: 'eth1/50' });
    const issues = check(cableConnectorMismatchRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'error', message: 'LC-duplex leg 2 of T-1 is plugged into SW1 eth1/50 (MPO-12 port)' });
    expect(issues[0]!.targets).toEqual([
      { kind: 'cable', id: f.cable },
      { kind: 'component', id: f.leaf, portId: 'eth1/50' },
    ]);
  });

  it('flags the MPO leg when its cage loses the optic or gets an LC one', () => {
    const f = trunkFixture();
    const empty = check(cableConnectorMismatchRule, run(f.project, sch.setOptic(f.leaf, 'eth1/49', null)));
    expect(empty.map((i) => i.message)).toEqual(['MPO-8 leg A of T-1 is plugged into SW1 eth1/49 (empty QSFP28 cage)']);
    expect(hasTarget(empty[0]!, 'component', f.leaf, 'eth1/49')).toBe(true);
    const lc = check(cableConnectorMismatchRule, run(f.project, sch.setOptic(f.leaf, 'eth1/49', LR4)));
    expect(lc.map((i) => i.message)).toEqual(['MPO-8 leg A of T-1 is plugged into SW1 eth1/49 (LC port)']);
    // Same cable, same leg: the issue keeps its id whatever the port now offers.
    expect(lc[0]!.id).toBe(empty[0]!.id);
  });

  it('accepts a correctly plugged trunk and ignores unplugged and dangling legs', () => {
    const f = trunkFixture();
    expect(check(cableConnectorMismatchRule, f.project)).toEqual([]);
    expect(check(cableConnectorMismatchRule, trunkFixture({ plugB: false }).project)).toEqual([]);
    const dangling = withPlug(f.project, f.cable, 'B', 0, { componentId: 'ghost', portId: 'f1' });
    expect(check(cableConnectorMismatchRule, dangling)).toEqual([]);
  });

  it('keeps issue ids across a relabel and a re-plug of the same leg', () => {
    const f = trunkFixture();
    const bad = withPlug(f.project, f.cable, 'B', 3, { componentId: f.leaf, portId: 'eth1/49' });
    const before = check(cableConnectorMismatchRule, bad);
    expect(before).toHaveLength(1);
    const moved = withPlug(run(bad, cables.setCableLabel(f.cable, 'Uplink'), sch.setOptic(f.leaf, 'eth1/50', SR4)), f.cable, 'B', 3, { componentId: f.leaf, portId: 'eth1/50' });
    const after = check(cableConnectorMismatchRule, moved);
    expect(after.map((i) => i.id)).toEqual(before.map((i) => i.id));
    expect(after[0]!.message).toBe('LC-duplex leg 4 of Uplink is plugged into SW1 eth1/50 (MPO-12 port)');
  });
});
