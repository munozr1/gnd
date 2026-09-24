import { isPluggableCage } from '@/model/query';
import type { Issue } from '@/model/types';
import { componentTarget, ercIssue, linkTarget, type Rule } from '../rule';
import { endsOf, isIntegratedCable, portOfEnd, portTypeOf } from '../helpers';

/**
 * A pluggable cage on a link has no usable optic and the cable is not a
 * DAC / AOC (whose integrated ends fill the cage). Reported once per port.
 */
export const missingOpticRule: Rule = {
  id: 'missing-optic',
  name: 'Missing optic',
  defaultSeverity: 'warning',
  check(project, idx) {
    const issues: Issue[] = [];
    const reported = new Set<string>();
    for (const link of project.links) {
      if (isIntegratedCable(idx.cableOf(link))) continue;
      for (const end of endsOf(link)) {
        const key = `${end.componentId}/${end.portId}`;
        if (reported.has(key)) continue;
        const c = idx.component(end.componentId);
        if (!c) continue;
        const type = portTypeOf(idx, c, end.portId);
        if (!type || !isPluggableCage(type)) continue;
        const assignedId = c.optics[end.portId];
        if (assignedId && idx.catalog.transceiver(assignedId)) continue;
        reported.add(key);
        const label = idx.endLabel(portOfEnd(end));
        issues.push(
          ercIssue(
            missingOpticRule,
            assignedId
              ? `${label}: optic '${assignedId}' is not in the catalog`
              : `${label}: no optic on ${type} port`,
            [componentTarget(c.id, end.portId), linkTarget(link.id)],
            [`component:${c.id}:${end.portId}`],
          ),
        );
      }
    }
    return issues;
  },
};
