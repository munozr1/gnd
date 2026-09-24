/**
 * A tiny store for the status bar's left slot (mode / coordinates / message)
 * that editors write to without re-rendering the whole app. Zustand-free on
 * purpose: this is transient view chrome, not project or UI state.
 */
import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';

export interface StatusFields {
  /** Current tool / mode, e.g. 'Wire', 'Route: overhead'. */
  mode: string | null;
  /** Pointer position, e.g. 'x 1200  y 600 mm'. */
  coords: string | null;
  /** Free-form hint, e.g. 'Click a pin to start a wire'. */
  message: string | null;
}

export interface StatusBarApi extends StatusFields {
  set(fields: Partial<StatusFields>): void;
  clear(): void;
}

interface StatusStore {
  get(): StatusFields;
  set(fields: Partial<StatusFields>): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

const EMPTY: StatusFields = { mode: null, coords: null, message: null };

function createStatusStore(): StatusStore {
  let fields: StatusFields = EMPTY;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    get: () => fields,
    set: (patch) => {
      const next = { ...fields, ...patch };
      if (next.mode === fields.mode && next.coords === fields.coords && next.message === fields.message) return;
      fields = next;
      emit();
    },
    clear: () => {
      if (fields === EMPTY) return;
      fields = EMPTY;
      emit();
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

const NOOP_STORE: StatusStore = {
  get: () => EMPTY,
  set: () => {},
  clear: () => {},
  subscribe: () => () => {},
};

const StatusBarCtx = createContext<StatusStore | null>(null);

export function StatusBarProvider({ children }: { children: ReactNode }) {
  const [statusStore] = useState(createStatusStore);
  return <StatusBarCtx.Provider value={statusStore}>{children}</StatusBarCtx.Provider>;
}

/** Read and write the status slot. Without a provider it is a harmless no-op (standalone editor tests). */
export function useStatusBar(): StatusBarApi {
  const s = useContext(StatusBarCtx) ?? NOOP_STORE;
  const fields = useSyncExternalStore(s.subscribe, s.get, s.get);
  return useMemo(() => ({ ...fields, set: s.set, clear: s.clear }), [fields, s]);
}

/** Write-only access; does not subscribe, so callers never re-render on status changes. */
export function useStatusBarWriter(): Pick<StatusBarApi, 'set' | 'clear'> {
  const s = useContext(StatusBarCtx) ?? NOOP_STORE;
  return useMemo(() => ({ set: s.set, clear: s.clear }), [s]);
}

/** Publish fields while the calling component is mounted; clears them on unmount. */
export function useStatusBarFields(fields: Partial<StatusFields>): void {
  const { set, clear } = useStatusBarWriter();
  const { mode, coords, message } = fields;
  useEffect(() => {
    set({
      ...(mode !== undefined ? { mode } : {}),
      ...(coords !== undefined ? { coords } : {}),
      ...(message !== undefined ? { message } : {}),
    });
  }, [set, mode, coords, message]);
  useEffect(() => () => clear(), [clear]);
}
