/**
 * Shared plumbing for the command factories: commands that hand back a
 * result (new ids, counts, summaries) once executed, and small helpers used
 * by both the schematic and layout vocabularies.
 */
import { current, isDraft } from 'immer';
import type { EditorId, Id, Project } from '@/model/types';
import type { Command } from '@/store/commands';

/**
 * A command whose mutator also produces a value. `result` is undefined until
 * the command has been executed; it must be plain data (ids, counts, copies),
 * never an Immer draft object, because drafts are revoked once the recipe ends.
 *
 *   const cmd = addComponent(symbolId, sheetId, pos);
 *   if (store.getState().execute(cmd)) select({ kind: 'component', id: cmd.result! });
 */
export interface ResultCommand<T> extends Command {
  result: T | undefined;
}

export function resultCommand<T>(
  label: string,
  editor: EditorId,
  run: (draft: Project) => T,
  coalesceKey?: string,
): ResultCommand<T> {
  const cmd: ResultCommand<T> = {
    label,
    editor,
    result: undefined,
    mutate(draft) {
      cmd.result = run(draft);
    },
  };
  if (coalesceKey !== undefined) cmd.coalesceKey = coalesceKey;
  return cmd;
}

/**
 * Read-safe view of a project that may be an Immer draft. Readers that use
 * the memoised `indexProject` must not be handed a draft (its identity does
 * not change as it is mutated); `current()` gives a fresh plain snapshot.
 */
export const snapshot = (project: Project): Project => (isDraft(project) ? (current(project) as Project) : project);

export const asArray = <T>(x: T | readonly T[]): readonly T[] => (Array.isArray(x) ? (x as readonly T[]) : [x as T]);

/** 'component' / '3 components'. */
export const plural = (n: number, singular: string, pluralForm = `${singular}s`): string =>
  n === 1 ? singular : `${n} ${pluralForm}`;

/** Stable coalesce key for a drag: one per drag id, or per object set when the caller has none (nudges). */
export const dragKey = (prefix: string, ids: readonly Id[], dragId?: string): string =>
  `${prefix}:${dragId ?? [...ids].sort().join(',')}`;

/** Natural ordering: 'R2' < 'R10', 'SRV9' < 'SRV10'; case-insensitive. */
export function compareNatural(a: string, b: string): number {
  const re = /(\d+)|(\D+)/g;
  const xa = a.match(re) ?? [];
  const xb = b.match(re) ?? [];
  const n = Math.min(xa.length, xb.length);
  for (let i = 0; i < n; i++) {
    const pa = xa[i]!;
    const pb = xb[i]!;
    const na = /^\d+$/.test(pa);
    const nb = /^\d+$/.test(pb);
    if (na && nb) {
      const d = Number(pa) - Number(pb);
      if (d !== 0) return d;
    } else {
      const d = pa.toLowerCase().localeCompare(pb.toLowerCase());
      if (d !== 0) return d;
    }
  }
  return xa.length - xb.length;
}
