/**
 * App start: keyboard listener, autosave, and reopening the last project (or
 * creating one). Also surfaces `ui.lastError` as toasts.
 */
import { useEffect, useState } from 'react';
import { getLastOpened, loadProject, startAutosave } from '@/io/persistence';
import { createProject } from '@/model/factories';
import { store } from '@/store';
import { installShortcutListener } from '@/store/shortcuts';
import { toast } from '@/ui/Toast';
import { errorMessage } from './format';
import { registerAutosave } from './projectActions';
import { setSaveState } from './saveState';
import { registerShellShortcuts } from './shellShortcuts';

export interface BootstrapState {
  /** False until the last-opened project has been loaded (or a new one created). */
  ready: boolean;
  error: string | null;
}

async function loadInitial(): Promise<'loaded' | 'created'> {
  const lastId = await getLastOpened();
  const saved = lastId ? await loadProject(lastId) : null;
  if (saved) {
    store.getState().replaceProject(saved);
    setSaveState('saved');
    return 'loaded';
  }
  store.getState().replaceProject(createProject());
  return 'created';
}

let initialLoad: Promise<'loaded' | 'created'> | null = null;

/**
 * Reopen the last project or create a new one. Shared across callers so a
 * double-invoked effect (StrictMode) cannot create two projects.
 */
export function loadInitialProject(): Promise<'loaded' | 'created'> {
  initialLoad ??= loadInitial().catch((err: unknown) => {
    initialLoad = null;
    throw err;
  });
  return initialLoad;
}

export function useAppBootstrap(): BootstrapState {
  const [state, setState] = useState<BootstrapState>({ ready: false, error: null });

  useEffect(() => {
    const uninstallKeys = installShortcutListener(window);
    const unregisterShell = registerShellShortcuts();

    const autosave = startAutosave(store, {
      onSaved: () => setSaveState('saved'),
      onError: (err) => {
        setSaveState('error');
        toast.error(`Autosave failed: ${errorMessage(err)}`);
      },
    });
    registerAutosave(autosave);

    const unsubscribe = store.subscribe((s, prev) => {
      if (s.project !== prev.project) setSaveState('dirty');
      if (s.ui.lastError && s.ui.lastError !== prev.ui.lastError) toast.error(s.ui.lastError);
    });

    let cancelled = false;
    loadInitialProject()
      .then(() => {
        if (!cancelled) setState({ ready: true, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = errorMessage(err);
        toast.error(`Could not load the last project: ${message}`);
        store.getState().replaceProject(createProject());
        setState({ ready: true, error: message });
      });

    return () => {
      cancelled = true;
      unsubscribe();
      registerAutosave(null);
      autosave.stop();
      unregisterShell();
      uninstallKeys();
    };
  }, []);

  return state;
}
