import { trayFill } from '../../routing/fill';
import { defineRule, type DrcFinding } from '../rule';

export const trayOverfill = defineRule({
  id: 'tray-overfill',
  name: 'Tray overfill',
  description: 'Tray cross-section fill exceeds the configured threshold.',
  defaultSeverity: 'warning',
  check(project) {
    const out: DrcFinding[] = [];
    for (const tray of project.trays) {
      const fill = trayFill(project, tray.id);
      if (!fill || fill.fraction <= project.settings.trayFillWarn) continue;
      out.push({
        key: tray.id,
        message: `Tray ${tray.name ?? tray.id} is ${Math.round(fill.fraction * 100)}% full (${fill.cableCount} cables, limit ${Math.round(project.settings.trayFillWarn * 100)}%)`,
        targets: [{ kind: 'tray', id: tray.id }],
      });
    }
    return out;
  },
});
