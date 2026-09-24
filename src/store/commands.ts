/**
 * Command model and per-editor undo/redo built on Immer patches.
 *
 * Everything here is pure: (project, history) in, (project, history) out. The
 * Zustand store in ./index.ts wires these to state; tests drive them directly.
 * Each executed command records the patches Immer produced plus their
 * inverses, so history stores deltas rather than snapshots.
 */
import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import type { EditorId, Project } from '@/model/types';

enablePatches();

export interface Command {
  /** Shown in Edit > Undo "<label>". */
  label: string;
  /** Which editor's history this belongs to. 'viewer3d' is read-only and rejected. */
  editor: EditorId;
  /** Mutate the Immer draft in place. Return value is ignored. */
  mutate(draft: Project): void;
  /**
   * Consecutive commands with the same key, executed within
   * COALESCE_WINDOW_MS of each other, merge into one history entry
   * (drags, typing, nudges). Only the most recently *executed* command can
   * absorb the next one: an undo or redo in between breaks the chain, so a
   * command never merges into an entry that an undo exposed or a redo
   * restored.
   */
  coalesceKey?: string;
}

export type UndoableEditor = Exclude<EditorId, 'viewer3d'>;

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  coalesceKey?: string;
  /** Timestamp (ms) of the last command merged into this entry. */
  at: number;
}

export interface EditorHistory {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

export type History = Record<UndoableEditor, EditorHistory>;

export const HISTORY_CAP = 200;
export const COALESCE_WINDOW_MS = 500;

export const emptyHistory = (): History => ({
  schematic: { undo: [], redo: [] },
  layout: { undo: [], redo: [] },
});

export const isUndoableEditor = (editor: EditorId): editor is UndoableEditor =>
  editor === 'schematic' || editor === 'layout';

export interface StepResult {
  project: Project;
  history: History;
  /** false when nothing happened (empty stack, no-op command). */
  changed: boolean;
  /** Label of the entry that was executed / undone / redone. */
  label: string | null;
}

const unchanged = (project: Project, history: History): StepResult => ({
  project,
  history,
  changed: false,
  label: null,
});

/** Build a command from a single mutator. */
export function command(
  label: string,
  editor: EditorId,
  mutate: (draft: Project) => void,
  coalesceKey?: string,
): Command {
  return coalesceKey === undefined ? { label, editor, mutate } : { label, editor, mutate, coalesceKey };
}

/** Run several mutators, in order, as one undoable entry. */
export function transaction(
  label: string,
  editor: EditorId,
  fns: ReadonlyArray<(draft: Project) => void>,
  coalesceKey?: string,
): Command {
  return command(
    label,
    editor,
    (draft) => {
      for (const fn of fns) fn(draft);
    },
    coalesceKey,
  );
}

/**
 * Execute a command against `project`, returning the new project and history.
 * Throws if the command targets a read-only editor or if `mutate` throws; in
 * both cases the inputs are untouched.
 */
export function executeCommand(
  project: Project,
  history: History,
  cmd: Command,
  now: number = Date.now(),
): StepResult {
  if (!isUndoableEditor(cmd.editor)) {
    throw new Error(`Editor '${cmd.editor}' is read-only; commands must target 'schematic' or 'layout'`);
  }
  const editor = cmd.editor;
  const [next, patches, inversePatches] = produceWithPatches(project, (draft) => {
    cmd.mutate(draft);
  });
  if (patches.length === 0) return unchanged(project, history);

  const stack = history[editor];
  const last = stack.undo[stack.undo.length - 1];
  const merge =
    cmd.coalesceKey !== undefined &&
    last !== undefined &&
    last.coalesceKey === cmd.coalesceKey &&
    now >= last.at &&
    now - last.at <= COALESCE_WINDOW_MS;

  let undo: HistoryEntry[];
  if (merge) {
    const merged: HistoryEntry = {
      label: cmd.label,
      patches: [...last.patches, ...patches],
      inversePatches: [...inversePatches, ...last.inversePatches],
      coalesceKey: cmd.coalesceKey,
      at: now,
    };
    undo = [...stack.undo.slice(0, -1), merged];
  } else {
    const entry: HistoryEntry = { label: cmd.label, patches, inversePatches, at: now };
    if (cmd.coalesceKey !== undefined) entry.coalesceKey = cmd.coalesceKey;
    undo = [...stack.undo, entry];
    if (undo.length > HISTORY_CAP) undo = undo.slice(undo.length - HISTORY_CAP);
  }

  return {
    project: next,
    history: { ...history, [editor]: { undo, redo: [] } },
    changed: true,
    label: cmd.label,
  };
}

/**
 * Strip the coalesce key from the entry now on top of the undo stack. That
 * entry is no longer the most recently executed command (an undo or redo
 * intervened), so a later same-key command must start a fresh entry instead
 * of merging into it.
 */
function sealTop(undo: HistoryEntry[]): HistoryEntry[] {
  const top = undo[undo.length - 1];
  if (top === undefined || top.coalesceKey === undefined) return undo;
  const sealed: HistoryEntry = {
    label: top.label,
    patches: top.patches,
    inversePatches: top.inversePatches,
    at: top.at,
  };
  return [...undo.slice(0, -1), sealed];
}

export function undoCommand(project: Project, history: History, editor: EditorId): StepResult {
  if (!isUndoableEditor(editor)) return unchanged(project, history);
  const stack = history[editor];
  const entry = stack.undo[stack.undo.length - 1];
  if (!entry) return unchanged(project, history);
  return {
    project: applyPatches(project, entry.inversePatches),
    history: {
      ...history,
      // The entry this undo exposes was not the last command executed, so it
      // must not absorb the next same-key command.
      [editor]: { undo: sealTop(stack.undo.slice(0, -1)), redo: [...stack.redo, entry] },
    },
    changed: true,
    label: entry.label,
  };
}

export function redoCommand(project: Project, history: History, editor: EditorId): StepResult {
  if (!isUndoableEditor(editor)) return unchanged(project, history);
  const stack = history[editor];
  const entry = stack.redo[stack.redo.length - 1];
  if (!entry) return unchanged(project, history);
  // A redone entry was not the last command executed either, so it must not
  // absorb the next same-key command.
  return {
    project: applyPatches(project, entry.patches),
    history: {
      ...history,
      [editor]: { undo: sealTop([...stack.undo, entry]), redo: stack.redo.slice(0, -1) },
    },
    changed: true,
    label: entry.label,
  };
}

export const canUndoHistory = (history: History, editor: EditorId): boolean =>
  isUndoableEditor(editor) && history[editor].undo.length > 0;

export const canRedoHistory = (history: History, editor: EditorId): boolean =>
  isUndoableEditor(editor) && history[editor].redo.length > 0;

export const undoLabelOf = (history: History, editor: EditorId): string | null =>
  isUndoableEditor(editor) ? (history[editor].undo[history[editor].undo.length - 1]?.label ?? null) : null;

export const redoLabelOf = (history: History, editor: EditorId): string | null =>
  isUndoableEditor(editor) ? (history[editor].redo[history[editor].redo.length - 1]?.label ?? null) : null;
