import type { DeviceKind, Issue } from '@/model/types';
import { componentTarget, ercIssue, type Rule } from '../rule';
import { pinsInGroup } from '../helpers';

const NETWORK_KINDS: ReadonlySet<DeviceKind> = new Set<DeviceKind>(['switch', 'router', 'firewall']);

/**
 * A switch's uplink-role port group is partly used: at least one port is on
 * a link and at least one is free. A group with nothing connected is not
 * reported (the device is simply not cabled yet).
 */
export const unconnectedUplinksRule: Rule = {
  id: 'unconnected-uplinks',
  name: 'Unconnected uplinks',
  defaultSeverity: 'info',
  check(project, idx) {
    const issues: Issue[] = [];
    for (const c of project.components) {
      const symbol = idx.symbolOf(c);
      if (!symbol || !NETWORK_KINDS.has(symbol.kind)) continue;
      for (const group of symbol.groups ?? []) {
        if (group.role !== 'uplink') continue;
        const pins = pinsInGroup(symbol, group.id);
        if (pins.length === 0) continue;
        const free = pins.filter((p) => idx.isPortFree(c.id, p.portId));
        const used = pins.length - free.length;
        if (used === 0 || free.length === 0) continue;
        issues.push(
          ercIssue(
            unconnectedUplinksRule,
            `${c.ref} ${group.name}: ${free.length} of ${pins.length} ports free`,
            [componentTarget(c.id), ...free.map((p) => componentTarget(c.id, p.portId))],
            [`component:${c.id}`, `group:${group.id}`],
          ),
        );
      }
    }
    return issues;
  },
};
