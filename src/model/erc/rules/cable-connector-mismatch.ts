import { isPlugged, portAcceptsConnector } from '@/model/cables';
import { cableLegViews, cableTarget, portOfferAt, resolveCableWith } from '@/model/cables/validation';
import type { Issue } from '@/model/types';
import { componentTarget, ercIssue, type Rule } from '../rule';

/**
 * A plugged leg's connector is not one the port accepts (its fixed
 * connector, or its optic's for a pluggable cage — `portAcceptsConnector`).
 * The connecting flow refuses such plugs, so this catches what changed
 * afterwards: an optic swapped or removed, a model reassigned, imported
 * data. A plug on a port that no longer exists is left to
 * cable-leg-unassigned.
 */
export const cableConnectorMismatchRule: Rule = {
  id: 'cable-connector-mismatch',
  name: 'Cable connector mismatch',
  defaultSeverity: 'error',
  check(project, idx) {
    const issues: Issue[] = [];
    for (const cable of project.cables) {
      const resolved = resolveCableWith(idx, cable);
      if (!resolved) continue;
      for (const { side, leg, connector, plug } of cableLegViews(resolved, cable)) {
        if (!isPlugged(plug)) continue;
        const port = portOfferAt(idx, plug.componentId, plug.portId);
        if (!port || portAcceptsConnector(port.view, connector)) continue;
        issues.push(
          ercIssue(
            cableConnectorMismatchRule,
            `${connector} leg ${leg.label} of ${cable.label} is plugged into ${port.component.ref} ${plug.portId} (${port.describe})`,
            [cableTarget(cable.id), componentTarget(plug.componentId, plug.portId)],
            [`cable:${cable.id}`, `side:${side}`, `leg:${leg.index}`],
          ),
        );
      }
    }
    return issues;
  },
};
