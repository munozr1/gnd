import { describe, expect, it } from 'vitest';
import { createProject } from '@/model/factories';
import { LC_PANEL, LEAF, MGMT_SWITCH, MPO_PANEL, SERVER_1U, SPINE, addComponent, check, connect, end, hasTarget } from '../fixtures';
import { connectorMismatchRule } from './connector-mismatch';

describe('connector-mismatch', () => {
  it('flags an LC cable on MPO-12 optics at both ends', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/49': 'xcvr.100g-sr4' } });
    const spine = addComponent(p, SPINE, 'SW2', { optics: { 'eth1/1': 'xcvr.100g-sr4' } });
    const link = connect(p, end(leaf, 'eth1/49'), end(spine, 'eth1/1'), 'cbl.om4-duplex');

    const issues = check(connectorMismatchRule, p);
    expect(issues).toHaveLength(2);
    expect(issues[0]!.severity).toBe('error');
    expect(issues[0]!.message).toBe('SW1:eth1/49: OM4 duplex LC end on 100G-SR4 (MPO-12)');
    expect(issues[1]!.message).toBe('SW2:eth1/1: OM4 duplex LC end on 100G-SR4 (MPO-12)');
    expect(hasTarget(issues[0]!, 'component', leaf.id, 'eth1/49')).toBe(true);
    expect(hasTarget(issues[0]!, 'link', link.id)).toBe(true);
  });

  it('accepts an MPO trunk on MPO-12 optics and LC cables on LC optics', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/49': 'xcvr.100g-sr4', 'eth1/1': 'xcvr.25g-sr' } });
    const spine = addComponent(p, SPINE, 'SW2', { optics: { 'eth1/1': 'xcvr.100g-sr4' } });
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-sr' } });
    connect(p, end(leaf, 'eth1/49'), end(spine, 'eth1/1'), 'cbl.om4-mpo-trunk');
    connect(p, end(leaf, 'eth1/1'), end(srv, 'eth0'), 'cbl.om4-duplex');
    expect(check(connectorMismatchRule, p)).toEqual([]);
  });

  it('accepts a breakout cable between an MPO parent lane and an LC leg, either way round', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/49': 'xcvr.100g-sr4' } });
    const s1 = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-sr' } });
    const s2 = addComponent(p, SERVER_1U, 'SRV2', { optics: { eth0: 'xcvr.25g-sr' } });
    connect(p, end(leaf, 'eth1/49', 0), end(s1, 'eth0'), 'cbl.mpo-breakout');
    connect(p, end(s2, 'eth0'), end(leaf, 'eth1/49', 1), 'cbl.mpo-breakout');
    expect(check(connectorMismatchRule, p)).toEqual([]);
  });

  it('flags a breakout leg landing on an MPO optic', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/49': 'xcvr.100g-sr4' } });
    const spine = addComponent(p, SPINE, 'SW2', { optics: { 'eth1/1': 'xcvr.100g-sr4' } });
    connect(p, end(leaf, 'eth1/49', 0), end(spine, 'eth1/1'), 'cbl.mpo-breakout');
    const issues = check(connectorMismatchRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe('SW2:eth1/1: MPO breakout LC end on 100G-SR4 (MPO-12)');
  });

  it('requires RJ45 cable ends on RJ45 ports and accepts Cat6A there', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1');
    const mgmt = addComponent(p, MGMT_SWITCH, 'SW2');
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(leaf, 'mgmt0'), end(mgmt, 'ge1'), 'cbl.cat6a');
    const bad = connect(p, end(srv, 'bmc0'), end(mgmt, 'ge2'), 'cbl.om4-duplex');

    const issues = check(connectorMismatchRule, p);
    expect(issues).toHaveLength(2);
    expect(issues[0]!.message).toBe('SRV1:bmc0: OM4 duplex LC end on RJ45 port');
    expect(issues[1]!.message).toBe('SW2:ge2: OM4 duplex LC end on RJ45 port');
    expect(hasTarget(issues[0]!, 'link', bad.id)).toBe(true);
  });

  it('flags a Cat6A cable on a fibre optic', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.25g-sr' } });
    const mgmt = addComponent(p, MGMT_SWITCH, 'SW2');
    connect(p, end(leaf, 'eth1/1'), end(mgmt, 'ge1'), 'cbl.cat6a');
    const issues = check(connectorMismatchRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe('SW1:eth1/1: Cat6A patch RJ45 end on 25G-SR (LC)');
  });

  it('accepts a 1G-T copper optic on Cat6A', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.1g-t' } });
    const mgmt = addComponent(p, MGMT_SWITCH, 'SW2');
    connect(p, end(leaf, 'eth1/1'), end(mgmt, 'ge1'), 'cbl.cat6a');
    expect(check(connectorMismatchRule, p)).toEqual([]);
  });

  it('patch-panel ports accept their own connector and reject others', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.25g-sr', 'eth1/49': 'xcvr.100g-sr4' } });
    const lc = addComponent(p, LC_PANEL, 'PP1');
    const mpo = addComponent(p, MPO_PANEL, 'PP2');
    connect(p, end(leaf, 'eth1/1'), end(lc, 'f1'), 'cbl.om4-duplex');
    connect(p, end(leaf, 'eth1/49'), end(mpo, 'f1'), 'cbl.om4-mpo-trunk');
    connect(p, end(lc, 'r1'), end(mpo, 'r1'), 'cbl.om4-mpo-trunk');

    const issues = check(connectorMismatchRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe('PP1:r1: OM4 MPO trunk MPO-12 end on LC port');
  });

  it('skips DAC/AOC cables, missing cables and cages without optics', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1');
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(leaf, 'eth1/1'), end(srv, 'eth0'), 'cbl.dac-25g');
    connect(p, end(leaf, 'eth1/2'), end(srv, 'eth1'));
    connect(p, end(leaf, 'eth1/3'), end(addComponent(p, SERVER_1U, 'SRV2'), 'eth0'), 'cbl.om4-duplex');
    expect(check(connectorMismatchRule, p)).toEqual([]);
  });
});
