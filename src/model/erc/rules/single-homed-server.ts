import type { Issue } from '@/model/types';
import { componentTarget, ercIssue, type Rule } from '../rule';
import { distinctLinksOf, pinsWithRole } from '../helpers';

/**
 * A server whose symbol expects two or more uplinks has fewer than two links
 * on its uplink-role ports (management / BMC links do not count).
 */
export const singleHomedServerRule: Rule = {
  id: 'single-homed-server',
  name: 'Single-homed server',
  defaultSeverity: 'warning',
  check(project, idx) {
    const issues: Issue[] = [];
    for (const c of project.components) {
      const symbol = idx.symbolOf(c);
      if (!symbol || symbol.kind !== 'server') continue;
      const expected = symbol.expectedUplinks ?? 0;
      if (expected < 2) continue;
      const uplinkPorts = new Set(pinsWithRole(symbol, 'uplink').map((p) => p.portId));
      if (uplinkPorts.size === 0) continue;

      const connected = distinctLinksOf(idx, c.id).filter(
        (l) =>
          (l.a.componentId === c.id && uplinkPorts.has(l.a.portId)) ||
          (l.b.componentId === c.id && uplinkPorts.has(l.b.portId)),
      ).length;
      if (connected >= 2) continue;

      issues.push(
        ercIssue(
          singleHomedServerRule,
          connected === 0
            ? `${c.ref} has no uplinks connected (expects ${expected})`
            : `${c.ref} is single-homed (1 of ${expected} expected uplinks)`,
          [componentTarget(c.id)],
        ),
      );
    }
    return issues;
  },
};
