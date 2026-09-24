import { describe, expect, it } from 'vitest';
import { createProject } from '@/model/factories';
import { LEAF, MGMT_SWITCH, SERVER_1U, addComponent, check, connect, end, hasTarget } from '../fixtures';
import { mediaMismatchRule } from './media-mismatch';

describe('media-mismatch', () => {
  it('flags an MMF optic facing an SMF optic', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.25g-sr' } });
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-lr' } });
    const link = connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'));

    const issues = check(mediaMismatchRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('error');
    expect(issues[0]!.message).toBe('SW1:eth1/1 (25G-SR, MMF) — SRV1:eth0 (25G-LR, SMF): optic media differ');
    expect(issues[0]!.targets[0]).toEqual({ kind: 'link', id: link.id });
  });

  it('flags SMF optics on an OM4 cable, once per end', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.25g-lr' } });
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-lr' } });
    connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'), 'cbl.om4-duplex');

    const issues = check(mediaMismatchRule, p);
    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.message)).toEqual([
      'SW1:eth1/1: 25G-LR (SMF) on OM4 duplex cable (needs MMF)',
      'SRV1:eth0: 25G-LR (SMF) on OM4 duplex cable (needs MMF)',
    ]);
    expect(hasTarget(issues[0]!, 'component', sw.id, 'eth1/1')).toBe(true);
  });

  it('flags an MMF optic on an OS2 cable and a copper optic on fibre', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.25g-sr', 'eth1/2': 'xcvr.1g-t' } });
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-lr' } });
    connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'), 'cbl.os2-duplex');
    connect(p, end(sw, 'eth1/2'), end(srv, 'eth1'), 'cbl.om4-duplex');

    const messages = check(mediaMismatchRule, p).map((i) => i.message);
    expect(messages).toContain('SW1:eth1/1 (25G-SR, MMF) — SRV1:eth0 (25G-LR, SMF): optic media differ');
    expect(messages).toContain('SW1:eth1/1: 25G-SR (MMF) on OS2 duplex cable (needs SMF)');
    expect(messages).toContain('SW1:eth1/2: 1G-T (Copper) on OM4 duplex cable (needs MMF)');
    expect(messages).toHaveLength(3);
  });

  it('flags an optic assigned on a DAC link', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.25g-sr' } });
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    const link = connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'), 'cbl.dac-25g');

    const issues = check(mediaMismatchRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe(
      'SW1:eth1/1: 25G-SR assigned on DAC 25G link (integrated cable has no cage for an optic)',
    );
    expect(hasTarget(issues[0]!, 'link', link.id)).toBe(true);
  });

  it('accepts matching media', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.25g-sr', 'eth1/2': 'xcvr.25g-lr', 'eth1/3': 'xcvr.1g-t' } });
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-sr', eth1: 'xcvr.25g-lr' } });
    const mgmt = addComponent(p, MGMT_SWITCH, 'SW2');
    connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'), 'cbl.om4-duplex');
    connect(p, end(sw, 'eth1/2'), end(srv, 'eth1'), 'cbl.os2-duplex');
    connect(p, end(sw, 'eth1/3'), end(mgmt, 'ge1'), 'cbl.cat6a');
    connect(p, end(sw, 'mgmt0'), end(mgmt, 'ge2'), 'cbl.cat6a');
    connect(p, end(sw, 'eth1/4'), end(srv, 'bmc0'), 'cbl.dac-25g');
    expect(check(mediaMismatchRule, p)).toEqual([]);
  });

  it('is silent with no cable and no optics', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1');
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'));
    expect(check(mediaMismatchRule, p)).toEqual([]);
  });
});
