import { describe, expect, it } from 'vitest';
import { createProject } from '@/model/factories';
import { LEAF, SERVER_1U, addComponent, check, connect, end, hasTarget } from '../fixtures';
import { portReuseRule } from './port-reuse';

describe('port-reuse', () => {
  it('flags a port that is on two links, targeting the port and both links', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1');
    const s1 = addComponent(p, SERVER_1U, 'SRV1');
    const s2 = addComponent(p, SERVER_1U, 'SRV2');
    const l1 = connect(p, end(sw, 'eth1/1'), end(s1, 'eth0'));
    const l2 = connect(p, end(sw, 'eth1/1'), end(s2, 'eth0'));

    const issues = check(portReuseRule, p);
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    expect(issue.rule).toBe('port-reuse');
    expect(issue.severity).toBe('error');
    expect(issue.domain).toBe('erc');
    expect(issue.message).toBe('SW1:eth1/1 is on 2 links');
    expect(issue.targets[0]).toEqual({ kind: 'component', id: sw.id, portId: 'eth1/1' });
    expect(hasTarget(issue, 'link', l1.id)).toBe(true);
    expect(hasTarget(issue, 'link', l2.id)).toBe(true);
  });

  it('flags a whole-port link together with a lane link on the same port', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1');
    const s1 = addComponent(p, SERVER_1U, 'SRV1');
    const s2 = addComponent(p, SERVER_1U, 'SRV2');
    connect(p, end(sw, 'eth1/49'), end(s1, 'eth0'));
    connect(p, end(sw, 'eth1/49', 0), end(s2, 'eth0'));

    const issues = check(portReuseRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe('SW1:eth1/49 is used both as a whole port and as breakout lanes');
    expect(hasTarget(issues[0]!, 'component', sw.id, 'eth1/49')).toBe(true);
  });

  it('flags the same lane on two links', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1');
    const s1 = addComponent(p, SERVER_1U, 'SRV1');
    const s2 = addComponent(p, SERVER_1U, 'SRV2');
    connect(p, end(sw, 'eth1/49', 2), end(s1, 'eth0'));
    connect(p, end(sw, 'eth1/49', 2), end(s2, 'eth0'));

    const issues = check(portReuseRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe('SW1:eth1/49.2 is on 2 links');
  });

  it('accepts distinct lanes of one port', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1');
    const servers = [0, 1, 2, 3].map((i) => addComponent(p, SERVER_1U, `SRV${i + 1}`));
    servers.forEach((s, lane) => connect(p, end(sw, 'eth1/49', lane), end(s, 'eth0')));
    expect(check(portReuseRule, p)).toEqual([]);
  });

  it('accepts distinct ports', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1');
    const s1 = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(sw, 'eth1/1'), end(s1, 'eth0'));
    connect(p, end(sw, 'eth1/2'), end(s1, 'eth1'));
    expect(check(portReuseRule, p)).toEqual([]);
  });

  it('ids are stable across runs and distinct per conflict', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1');
    const s1 = addComponent(p, SERVER_1U, 'SRV1');
    const s2 = addComponent(p, SERVER_1U, 'SRV2');
    connect(p, end(sw, 'eth1/1'), end(s1, 'eth0'));
    connect(p, end(sw, 'eth1/1'), end(s2, 'eth0'));
    connect(p, end(sw, 'eth1/2'), end(s1, 'eth1'));
    connect(p, end(sw, 'eth1/2'), end(s2, 'eth1'));

    const first = check(portReuseRule, p).map((i) => i.id);
    const second = check(portReuseRule, p).map((i) => i.id);
    expect(first).toEqual(second);
    expect(new Set(first).size).toBe(2);
  });
});
