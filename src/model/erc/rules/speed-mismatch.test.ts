import { describe, expect, it } from 'vitest';
import { createProject } from '@/model/factories';
import { LEAF, SERVER_1U, SPINE, addComponent, check, connect, end, hasTarget } from '../fixtures';
import { speedMismatchRule } from './speed-mismatch';

describe('speed-mismatch', () => {
  it('flags different optic speeds at the two ends', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.25g-sr' } });
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.10g-sr' } });
    const link = connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'), 'cbl.om4-duplex');

    const issues = check(speedMismatchRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('error');
    expect(issues[0]!.message).toBe('SW1:eth1/1 (25G) — SRV1:eth0 (10G): speeds differ');
    expect(issues[0]!.targets[0]).toEqual({ kind: 'link', id: link.id });
    expect(hasTarget(issues[0]!, 'component', sw.id, 'eth1/1')).toBe(true);
    expect(hasTarget(issues[0]!, 'component', srv.id, 'eth0')).toBe(true);
  });

  it('accepts matching speeds', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.25g-sr' } });
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-lr' } });
    connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'), 'cbl.om4-duplex');
    expect(check(speedMismatchRule, p)).toEqual([]);
  });

  it('excepts breakout lanes: one lane of 100G-SR4 matches a 25G optic', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/49': 'xcvr.100g-sr4' } });
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-sr' } });
    connect(p, end(sw, 'eth1/49', 0), end(srv, 'eth0'), 'cbl.mpo-breakout');
    expect(check(speedMismatchRule, p)).toEqual([]);
  });

  it('still flags a lane whose share does not match the far end', () => {
    const p = createProject();
    const spine = addComponent(p, SPINE, 'SW1', { optics: { 'eth1/1': 'xcvr.400g-dr4' } });
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-sr' } });
    connect(p, end(spine, 'eth1/1', 0), end(srv, 'eth0'), 'cbl.mpo-breakout');
    const issues = check(speedMismatchRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe('SW1:eth1/1.0 (100G) — SRV1:eth0 (25G): speeds differ');
  });

  it('uses the integrated transceiver of a DAC at both ends', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1');
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'), 'cbl.dac-25g');
    expect(check(speedMismatchRule, p)).toEqual([]);
  });

  it('does not compare when an end has no transceiver', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.25g-sr' } });
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'), 'cbl.om4-duplex');
    expect(check(speedMismatchRule, p)).toEqual([]);
  });
});
