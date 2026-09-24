import { managerFill } from '../../routing/fill';
import { managerFor } from '../../routing/positions';
import { defineRule, type DrcFinding } from '../rule';

export const managerOverfill = defineRule({
  id: 'manager-overfill',
  name: 'Manager overfill',
  description: 'Vertical cable manager fill exceeds the configured threshold.',
  defaultSeverity: 'warning',
  check(project) {
    const out: DrcFinding[] = [];
    for (const rack of project.racks) {
      for (const side of ['left', 'right'] as const) {
        if (!managerFor(project, rack.id, side)) continue;
        const fill = managerFill(project, rack.id, side);
        if (fill.fraction <= project.settings.managerFillWarn) continue;
        out.push({
          key: `${rack.id}:${side}`,
          message: `${side} manager of rack ${rack.name} is ${Math.round(fill.fraction * 100)}% full (${fill.cableCount} cables, limit ${Math.round(project.settings.managerFillWarn * 100)}%)`,
          targets: [{ kind: 'rack', id: rack.id }],
        });
      }
    }
    return out;
  },
});
