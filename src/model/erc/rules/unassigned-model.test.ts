import { describe, expect, it } from 'vitest';
import { createProject } from '@/model/factories';
import { LEAF, SERVER_1U, addComponent, check } from '../fixtures';
import { unassignedModelRule } from './unassigned-model';

describe('unassigned-model', () => {
  it('warns for a component with no footprint', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1', { footprintDefId: null });
    const issues = check(unassignedModelRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('warning');
    expect(issues[0]!.message).toBe('SW1 has no physical model assigned');
    expect(issues[0]!.targets).toEqual([{ kind: 'component', id: sw.id }]);
  });

  it('warns for a footprint id the catalog does not know', () => {
    const p = createProject();
    addComponent(p, LEAF, 'SW1', { footprintDefId: 'fp.nope' });
    const issues = check(unassignedModelRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe("SW1: model 'fp.nope' is not in the catalog");
  });

  it('is silent when the default footprint is assigned', () => {
    const p = createProject();
    addComponent(p, LEAF, 'SW1');
    addComponent(p, SERVER_1U, 'SRV1');
    expect(check(unassignedModelRule, p)).toEqual([]);
  });
});
