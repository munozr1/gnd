import { cableDefProblems, cableTarget } from '@/model/cables/validation';
import type { Issue } from '@/model/types';
import { ercIssue, type Rule } from '../rule';

/**
 * An installed cable's definition is unsound: missing from the catalog, a
 * fiber count that does not split evenly into a side's connector, an unknown
 * connector, a custom strand map that is not a bijection, … One issue per
 * problem, worded exactly as the Cable Builder words it.
 */
export const cableDefInvalidRule: Rule = {
  id: 'cable-def-invalid',
  name: 'Invalid cable definition',
  defaultSeverity: 'error',
  check(project, idx) {
    const issues: Issue[] = [];
    for (const cable of project.cables) {
      for (const problem of cableDefProblems(idx, cable)) {
        issues.push(
          ercIssue(cableDefInvalidRule, `${cable.label}: ${problem}`, [cableTarget(cable.id)], [`cable:${cable.id}`, problem]),
        );
      }
    }
    return issues;
  },
};
