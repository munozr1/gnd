import type { Issue } from '@/model/types';
import { componentTarget, ercIssue, type Rule } from '../rule';

/** A component has no physical model (footprint), or names one the catalog does not have. */
export const unassignedModelRule: Rule = {
  id: 'unassigned-model',
  name: 'Unassigned model',
  defaultSeverity: 'warning',
  check(project, idx) {
    const issues: Issue[] = [];
    for (const c of project.components) {
      if (c.footprintDefId === null) {
        issues.push(ercIssue(unassignedModelRule, `${c.ref} has no physical model assigned`, [componentTarget(c.id)]));
      } else if (!idx.catalog.footprint(c.footprintDefId)) {
        issues.push(
          ercIssue(unassignedModelRule, `${c.ref}: model '${c.footprintDefId}' is not in the catalog`, [
            componentTarget(c.id),
          ]),
        );
      }
    }
    return issues;
  },
};
