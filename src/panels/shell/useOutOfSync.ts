/**
 * "Out of sync" for the Layout tab badge: true when the schematic has changes
 * the layout has not applied (Update Layout, F8). `isOutOfSync` stops at the
 * first change, so evaluating it once per project identity is cheap.
 */
import { useMemo } from 'react';
import { isOutOfSync } from '@/model/sync';
import { useProject } from '@/store';

export function useOutOfSync(): boolean {
  const project = useProject();
  return useMemo(() => isOutOfSync(project), [project]);
}
