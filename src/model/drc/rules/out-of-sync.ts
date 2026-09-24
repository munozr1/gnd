import { isOutOfSync } from '@/model/sync/diff';
import { defineRule } from '../rule';

export const outOfSync = defineRule({
  id: 'out-of-sync',
  name: 'Out of sync',
  description: 'The layout does not match the schematic (unapplied Update Layout changes).',
  defaultSeverity: 'error',
  check(project) {
    if (!isOutOfSync(project)) return [];
    return [{ key: 'out-of-sync', message: 'Layout is out of sync with the schematic: run Update Layout (F8)', targets: [] }];
  },
});
