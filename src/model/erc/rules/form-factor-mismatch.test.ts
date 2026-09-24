import { describe, expect, it } from 'vitest';
import { createProject } from '@/model/factories';
import { LEAF, SERVER_1U, SPINE, addComponent, check, connect, end, hasTarget } from '../fixtures';
import { formFactorMismatchRule } from './form-factor-mismatch';

describe('form-factor-mismatch', () => {
  it('flags a QSFP28 optic in an SFP28 port, even when the port is not linked', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.100g-sr4' } });
    const issues = check(formFactorMismatchRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('error');
    expect(issues[0]!.message).toBe('SW1:eth1/1: 100G-SR4 (QSFP28) does not fit SFP28 port');
    expect(issues[0]!.targets).toEqual([{ kind: 'component', id: sw.id, portId: 'eth1/1' }]);
  });

  it('allows backward-compatible cages: SFP in SFP28, QSFP28 in QSFP-DD', () => {
    const p = createProject();
    addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.1g-t', 'eth1/2': 'xcvr.10g-sr', 'eth1/49': 'xcvr.100g-sr4' } });
    addComponent(p, SPINE, 'SW2', { optics: { 'eth1/1': 'xcvr.100g-sr4', 'eth1/2': 'xcvr.400g-dr4' } });
    expect(check(formFactorMismatchRule, p)).toEqual([]);
  });

  it('rejects the reverse direction: QSFP-DD optic in a QSFP28 cage', () => {
    const p = createProject();
    addComponent(p, LEAF, 'SW1', { optics: { 'eth1/49': 'xcvr.400g-dr4' } });
    const issues = check(formFactorMismatchRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('400G-DR4 (QSFP-DD) does not fit QSFP28 port');
  });

  it('falls back to the symbol pin type when no model is assigned', () => {
    const p = createProject();
    addComponent(p, LEAF, 'SW1', { footprintDefId: null, optics: { 'eth1/1': 'xcvr.100g-sr4' } });
    expect(check(formFactorMismatchRule, p)).toHaveLength(1);
  });

  it('ignores unknown optics and unknown ports', () => {
    const p = createProject();
    addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.nope', 'nope': 'xcvr.100g-sr4' } });
    expect(check(formFactorMismatchRule, p)).toEqual([]);
  });

  it('flags a DAC whose integrated transceiver does not fit one end', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1');
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    const link = connect(p, end(sw, 'eth1/49'), end(srv, 'eth0'), 'cbl.dac-100g');

    const issues = check(formFactorMismatchRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe('SRV1:eth0: DAC 100G (QSFP28) does not fit SFP28 port');
    expect(hasTarget(issues[0]!, 'component', srv.id, 'eth0')).toBe(true);
    expect(hasTarget(issues[0]!, 'link', link.id)).toBe(true);
  });

  it('accepts a DAC that fits both ends', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1');
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'), 'cbl.dac-25g');
    connect(p, end(sw, 'eth1/49'), end(addComponent(p, SPINE, 'SW2'), 'eth1/1'), 'cbl.aoc-100g');
    expect(check(formFactorMismatchRule, p)).toEqual([]);
  });
});
