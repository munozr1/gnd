import { cableTarget, resolveCableWith, usedFiberCount } from '@/model/cables/validation';
import type { Issue } from '@/model/types';
import { ercIssue, type Rule } from '../rule';

/**
 * Fibers of the definition that never reach a plugged port at both ends
 * (a 12F MPO-12 cord between two 4-lane optics carries 8; an unassigned LC
 * leg idles its channel). A cable with nothing in service at all is not
 * reported: cable-leg-unassigned already says why.
 */
export const cableUnusedFibersRule: Rule = {
  id: 'cable-unused-fibers',
  name: 'Unused fibers',
  defaultSeverity: 'info',
  check(project, idx) {
    const issues: Issue[] = [];
    for (const cable of project.cables) {
      const resolved = resolveCableWith(idx, cable);
      if (!resolved) continue;
      const used = usedFiberCount(project, cable);
      if (used === 0 || used >= resolved.fiberCount) continue;
      issues.push(
        ercIssue(
          cableUnusedFibersRule,
          `${cable.label}: ${resolved.fiberCount - used} of ${resolved.fiberCount} fibers unused`,
          [cableTarget(cable.id)],
          [`cable:${cable.id}`],
        ),
      );
    }
    return issues;
  },
};
