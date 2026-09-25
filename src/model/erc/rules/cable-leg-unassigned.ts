import { isPlugged } from '@/model/cables';
import { cableLegViews, cableTarget, portOfferAt, resolveCableWith } from '@/model/cables/validation';
import type { Issue, IssueTarget } from '@/model/types';
import { componentTarget, ercIssue, type Rule } from '../rule';

/**
 * A leg of an installed cable has no port (a sketch: allowed, but the cable
 * carries nothing on it), or its port no longer exists (imported or stale
 * data — the app nulls plugs when a device is deleted).
 */
export const cableLegUnassignedRule: Rule = {
  id: 'cable-leg-unassigned',
  name: 'Cable leg unassigned',
  defaultSeverity: 'warning',
  check(project, idx) {
    const issues: Issue[] = [];
    for (const cable of project.cables) {
      const resolved = resolveCableWith(idx, cable);
      if (!resolved) continue;
      for (const { side, leg, plug, name } of cableLegViews(resolved, cable)) {
        let message: string;
        const targets: IssueTarget[] = [cableTarget(cable.id)];
        if (!isPlugged(plug)) {
          message = `${cable.label}: ${name} is not connected`;
        } else if (!portOfferAt(idx, plug.componentId, plug.portId)) {
          message = `${cable.label}: ${name} is plugged into a port that no longer exists`;
          if (idx.component(plug.componentId)) targets.push(componentTarget(plug.componentId, plug.portId));
        } else {
          continue;
        }
        issues.push(ercIssue(cableLegUnassignedRule, message, targets, [`cable:${cable.id}`, `side:${side}`, `leg:${leg.index}`]));
      }
    }
    return issues;
  },
};
