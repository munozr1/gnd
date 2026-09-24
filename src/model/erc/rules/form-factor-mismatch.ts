import { formFactorFits } from '@/model/query';
import type { Issue } from '@/model/types';
import { componentTarget, ercIssue, linkTarget, type Rule } from '../rule';
import { endsOf, portTypeOf } from '../helpers';

/**
 * An assigned optic's form factor does not fit its port (per
 * `formFactorFits`, which allows backward-compatible cages such as SFP in
 * SFP28 or QSFP28 in QSFP-DD). Every entry in `component.optics` is checked,
 * linked or not. DAC / AOC cables carry integrated transceivers, so their
 * form factor must fit both ends' ports too.
 */
export const formFactorMismatchRule: Rule = {
  id: 'form-factor-mismatch',
  name: 'Form-factor mismatch',
  defaultSeverity: 'error',
  check(project, idx) {
    const issues: Issue[] = [];

    for (const c of project.components) {
      for (const portId of Object.keys(c.optics).sort()) {
        const xcvr = idx.catalog.transceiver(c.optics[portId]);
        const portType = portTypeOf(idx, c, portId);
        if (!xcvr || !portType) continue;
        if (formFactorFits(portType, xcvr.formFactor)) continue;
        issues.push(
          ercIssue(
            formFactorMismatchRule,
            `${c.ref}:${portId}: ${xcvr.name} (${xcvr.formFactor}) does not fit ${portType} port`,
            [componentTarget(c.id, portId)],
          ),
        );
      }
    }

    for (const link of project.links) {
      const cable = idx.cableOf(link);
      if (!cable?.integrated) continue;
      for (const end of endsOf(link)) {
        const c = idx.component(end.componentId);
        if (!c) continue;
        const portType = portTypeOf(idx, c, end.portId);
        if (!portType) continue;
        if (formFactorFits(portType, cable.integrated.formFactor)) continue;
        issues.push(
          ercIssue(
            formFactorMismatchRule,
            `${c.ref}:${end.portId}: ${cable.name} (${cable.integrated.formFactor}) does not fit ${portType} port`,
            [componentTarget(c.id, end.portId), linkTarget(link.id)],
          ),
        );
      }
    }

    return issues;
  },
};
