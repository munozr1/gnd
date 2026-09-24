import { describe, expect, it } from 'vitest';
import { componentTarget, ercIssue, hashKey, issueId, linkTarget, targetKey, type Rule } from './rule';

const rule: Rule = { id: 'demo-rule', name: 'Demo', defaultSeverity: 'warning', check: () => [] };

describe('issue ids', () => {
  it('hashKey is deterministic and hex', () => {
    expect(hashKey('abc')).toBe(hashKey('abc'));
    expect(hashKey('abc')).not.toBe(hashKey('abd'));
    expect(hashKey('abc')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('targetKey includes the port for component targets', () => {
    expect(targetKey(componentTarget('c1'))).toBe('component:c1');
    expect(targetKey(componentTarget('c1', 'eth0'))).toBe('component:c1:eth0');
    expect(targetKey(linkTarget('l1'))).toBe('link:l1');
  });

  it('issueId is prefixed with the domain and rule', () => {
    expect(issueId('port-reuse', ['component:c1:eth0'])).toMatch(/^erc\.port-reuse\.[0-9a-f]{16}$/);
  });

  it('ercIssue derives a stable id from sorted target keys', () => {
    const a = ercIssue(rule, 'm', [componentTarget('c1', 'eth0'), linkTarget('l1')]);
    const b = ercIssue(rule, 'other message', [linkTarget('l1'), componentTarget('c1', 'eth0')]);
    expect(a.id).toBe(b.id);
    expect(a).toMatchObject({ rule: 'demo-rule', severity: 'warning', domain: 'erc', message: 'm' });
  });

  it('explicit keys override target-derived ids', () => {
    const targets = [componentTarget('c1')];
    const a = ercIssue(rule, 'm', targets, ['component:c1', 'lane:0']);
    const b = ercIssue(rule, 'm', targets, ['component:c1', 'lane:1']);
    const c = ercIssue(rule, 'm', targets);
    expect(a.id).not.toBe(b.id);
    expect(a.id).not.toBe(c.id);
  });
});
