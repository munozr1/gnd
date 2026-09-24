/**
 * Panel / dialog / toolbar registry. Editors and feature modules register
 * their UI here at module load; the shell renders whatever is registered for
 * the active editor. Keeps App.tsx free of per-feature imports and lets
 * features live in their own directories.
 */
import type { ComponentType } from 'react';
import type { EditorId } from '@/model/types';

export type DockSide = 'left' | 'right';

export interface PanelRegistration {
  id: string;
  /** Editor tab this panel belongs to; 'all' shows on every tab. */
  editor: EditorId | 'all';
  side: DockSide;
  title: string;
  component: ComponentType;
  /** Lower first. */
  order?: number;
  /** Start collapsed. */
  collapsed?: boolean;
}

export interface DialogRegistration {
  /** Matches ui.activeDialog. */
  id: string;
  component: ComponentType;
}

export interface ToolbarRegistration {
  id: string;
  editor: EditorId | 'all';
  component: ComponentType;
  order?: number;
}

const panels = new Map<string, PanelRegistration>();
const dialogs = new Map<string, DialogRegistration>();
const toolbars = new Map<string, ToolbarRegistration>();
const listeners = new Set<() => void>();
let version = 0;

function bump() {
  version++;
  for (const l of listeners) l();
}

export function registerPanel(reg: PanelRegistration): () => void {
  panels.set(reg.id, reg);
  bump();
  return () => {
    panels.delete(reg.id);
    bump();
  };
}

export function registerDialog(reg: DialogRegistration): () => void {
  dialogs.set(reg.id, reg);
  bump();
  return () => {
    dialogs.delete(reg.id);
    bump();
  };
}

export function registerToolbar(reg: ToolbarRegistration): () => void {
  toolbars.set(reg.id, reg);
  bump();
  return () => {
    toolbars.delete(reg.id);
    bump();
  };
}

const byOrder = <T extends { order?: number; id: string }>(a: T, b: T) =>
  (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id);

export function panelsFor(editor: EditorId, side: DockSide): PanelRegistration[] {
  return [...panels.values()].filter((p) => (p.editor === editor || p.editor === 'all') && p.side === side).sort(byOrder);
}

export function toolbarsFor(editor: EditorId): ToolbarRegistration[] {
  return [...toolbars.values()].filter((t) => t.editor === editor || t.editor === 'all').sort(byOrder);
}

export function dialogById(id: string | null): DialogRegistration | undefined {
  return id ? dialogs.get(id) : undefined;
}

export function allDialogs(): DialogRegistration[] {
  return [...dialogs.values()];
}

/** Subscribe to registry changes (for useSyncExternalStore). */
export function subscribeRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function registryVersion(): number {
  return version;
}
