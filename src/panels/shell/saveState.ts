/** Autosave status shown in the status bar. Module-level so persistence callbacks can set it. */
import { useSyncExternalStore } from 'react';

export type SaveState = 'idle' | 'dirty' | 'saved' | 'error';

let state: SaveState = 'idle';
const listeners = new Set<() => void>();

export function setSaveState(next: SaveState): void {
  if (next === state) return;
  state = next;
  listeners.forEach((l) => l());
}

export const getSaveState = (): SaveState => state;

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSaveState(): SaveState {
  return useSyncExternalStore(subscribe, getSaveState, getSaveState);
}
