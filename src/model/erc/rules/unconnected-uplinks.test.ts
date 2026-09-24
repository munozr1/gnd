import { describe, expect, it } from 'vitest';
import { createProject } from '@/model/factories';
import { LEAF, SERVER_1U, SPINE, addComponent, check, connect, end } from '../fixtures';
import { unconnectedUplinksRule } from './unconnected-uplinks';

describe('unconnected-uplinks', () => {
  it('reports a partly used uplink group with the free ports as targets', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1');
    const spine = addComponent(p, SPINE, 'SW2');
    connect(p, end(leaf, 'eth1/49'), end(spine, 'eth1/1'));
    connect(p, end(leaf, 'eth1/50'), end(spine, 'eth1/2'));
    connect(p, end(leaf, 'eth1/51', 0), end(spine, 'eth1/3'));

    const issues = check(unconnectedUplinksRule, p);
    expect(issues).toHaveLength(1);
    const issue = issues[0]!;
    expect(issue.severity).toBe('info');
    expect(issue.message).toBe('SW1 Uplinks: 5 of 8 ports free');
    expect(issue.targets[0]).toEqual({ kind: 'component', id: leaf.id });
    expect(issue.targets.slice(1).map((t) => (t.kind === 'component' ? t.portId : ''))).toEqual([
      'eth1/52',
      'eth1/53',
      'eth1/54',
      'eth1/55',
      'eth1/56',
    ]);
  });

  it('keeps the same id as ports fill up', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1');
    const spine = addComponent(p, SPINE, 'SW2');
    connect(p, end(leaf, 'eth1/49'), end(spine, 'eth1/1'));
    const before = check(unconnectedUplinksRule, p)[0]!.id;
    connect(p, end(leaf, 'eth1/50'), end(spine, 'eth1/2'));
    const after = check(unconnectedUplinksRule, p)[0]!.id;
    expect(after).toBe(before);
  });

  it('is silent for an untouched group and for a full group', () => {
    const p = createProject();
    const idle = addComponent(p, LEAF, 'SW1');
    const full = addComponent(p, LEAF, 'SW2');
    const spine = addComponent(p, SPINE, 'SW3');
    connect(p, end(idle, 'eth1/1'), end(addComponent(p, SERVER_1U, 'SRV1'), 'eth0'));
    for (let i = 49; i <= 56; i++) connect(p, end(full, `eth1/${i}`), end(spine, `eth1/${i - 48}`));
    expect(check(unconnectedUplinksRule, p)).toEqual([]);
  });

  it('ignores servers and non-uplink groups', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1');
    const spine = addComponent(p, SPINE, 'SW2');
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(leaf, 'eth1/1'), end(srv, 'eth0'));
    connect(p, end(spine, 'eth1/1'), end(addComponent(p, LEAF, 'SW3'), 'eth1/1'));
    expect(check(unconnectedUplinksRule, p)).toEqual([]);
  });
});
