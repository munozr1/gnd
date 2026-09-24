import { describe, expect, it } from 'vitest';
import { createProject } from '@/model/factories';
import { GPU_SERVER, LEAF, MGMT_SWITCH, SERVER_1U, SERVER_2U, addComponent, check, connect, end } from '../fixtures';
import { singleHomedServerRule } from './single-homed-server';

describe('single-homed-server', () => {
  it('warns for a server with a single uplink', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1');
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'));

    const issues = check(singleHomedServerRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('warning');
    expect(issues[0]!.message).toBe('SRV1 is single-homed (1 of 2 expected uplinks)');
    expect(issues[0]!.targets).toEqual([{ kind: 'component', id: srv.id }]);
  });

  it('warns for a server with no uplinks, and ignores BMC links', () => {
    const p = createProject();
    const mgmt = addComponent(p, MGMT_SWITCH, 'SW1');
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(srv, 'bmc0'), end(mgmt, 'ge1'), 'cbl.cat6a');
    const issues = check(singleHomedServerRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe('SRV1 has no uplinks connected (expects 2)');
  });

  it('is silent for a dual-homed server', () => {
    const p = createProject();
    const sw1 = addComponent(p, LEAF, 'SW1');
    const sw2 = addComponent(p, LEAF, 'SW2');
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(sw1, 'eth1/1'), end(srv, 'eth0'));
    connect(p, end(sw2, 'eth1/1'), end(srv, 'eth1'));
    expect(check(singleHomedServerRule, p)).toEqual([]);
  });

  it('counts links on any uplink-role port of a multi-group server', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1');
    const gpu = addComponent(p, GPU_SERVER, 'SRV1');
    const srv2u = addComponent(p, SERVER_2U, 'SRV2');
    connect(p, end(sw, 'eth1/49'), end(gpu, 'osfp0'));
    connect(p, end(sw, 'eth1/50'), end(gpu, 'osfp1'));
    connect(p, end(sw, 'eth1/51'), end(srv2u, 'eth0'));
    connect(p, end(sw, 'eth1/1'), end(srv2u, 'eth2'));
    expect(check(singleHomedServerRule, p)).toEqual([]);
  });

  it('ignores non-server components', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1');
    const mgmt = addComponent(p, MGMT_SWITCH, 'SW2');
    connect(p, end(sw, 'eth1/1'), end(mgmt, 'xe1'));
    expect(check(singleHomedServerRule, p)).toEqual([]);
  });
});
