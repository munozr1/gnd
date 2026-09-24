import { describe, expect, it } from 'vitest';
import { createProject } from '@/model/factories';
import { LC_PANEL, LEAF, MGMT_SWITCH, SERVER_1U, addComponent, check, connect, end, hasTarget } from '../fixtures';
import { missingOpticRule } from './missing-optic';

describe('missing-optic', () => {
  it('warns for each pluggable cage on a fibre link without an optic', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1');
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    const link = connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'), 'cbl.om4-duplex');

    const issues = check(missingOpticRule, p);
    expect(issues).toHaveLength(2);
    expect(issues[0]!.severity).toBe('warning');
    expect(issues[0]!.message).toBe('SW1:eth1/1: no optic on SFP28 port');
    expect(issues[1]!.message).toBe('SRV1:eth0: no optic on SFP28 port');
    expect(issues[0]!.targets[0]).toEqual({ kind: 'component', id: sw.id, portId: 'eth1/1' });
    expect(hasTarget(issues[0]!, 'link', link.id)).toBe(true);
  });

  it('warns when the link has no cable yet', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1');
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-sr' } });
    connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'));
    const issues = check(missingOpticRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe('SW1:eth1/1: no optic on SFP28 port');
  });

  it('excepts DAC and AOC cables', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1');
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'), 'cbl.dac-25g');
    connect(p, end(sw, 'eth1/49'), end(srv, 'eth1'), 'cbl.aoc-100g');
    expect(check(missingOpticRule, p)).toEqual([]);
  });

  it('is silent for fixed-connector ports and assigned optics', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.25g-sr' } });
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-sr' } });
    const pp = addComponent(p, LC_PANEL, 'PP1');
    const mgmt = addComponent(p, MGMT_SWITCH, 'SW2');
    connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'), 'cbl.om4-duplex');
    connect(p, end(pp, 'f1'), end(pp, 'r1'), 'cbl.om4-duplex');
    connect(p, end(sw, 'mgmt0'), end(mgmt, 'ge1'), 'cbl.cat6a');
    expect(check(missingOpticRule, p)).toEqual([]);
  });

  it('reports an optic id the catalog does not know, once per port', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/49': 'xcvr.nope' } });
    const s1 = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-sr' } });
    const s2 = addComponent(p, SERVER_1U, 'SRV2', { optics: { eth0: 'xcvr.25g-sr' } });
    connect(p, end(sw, 'eth1/49', 0), end(s1, 'eth0'), 'cbl.mpo-breakout');
    connect(p, end(sw, 'eth1/49', 1), end(s2, 'eth0'), 'cbl.mpo-breakout');
    const issues = check(missingOpticRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe("SW1:eth1/49: optic 'xcvr.nope' is not in the catalog");
  });
});
