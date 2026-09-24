/**
 * Runs ERC / DRC and writes the results into `ui.issues`. `runChecks` is the
 * on-demand entry point (menus, shortcuts, buttons) and `useLiveChecks`
 * re-runs both domains, debounced, on every project change.
 *
 * The rules run synchronously on the current project; `runChecks` still
 * returns a Promise so callers are unaffected if checks later move off the
 * main thread.
 */
import { useCallback, useEffect, useState } from 'react';
import { runDrc } from '@/model/drc';
import { runErc } from '@/model/erc';
import type { Issue, Project } from '@/model/types';
import { store } from '@/store';
import { toast } from '@/ui/Toast';
import { errorMessage } from './format';

export type CheckDomain = 'erc' | 'drc';
export const CHECK_DOMAINS: readonly CheckDomain[] = ['erc', 'drc'];
export const LIVE_CHECK_DEBOUNCE_MS = 600;

const runners: Record<CheckDomain, (project: Project) => Issue[]> = {
  erc: (project) => runErc(project),
  drc: (project) => runDrc(project),
};

export interface RunChecksOptions {
  /** Defaults to the store's current project. */
  project?: Project;
  /** Toast when a domain's rules throw (on-demand runs). */
  notify?: boolean;
}

/** Per domain: the issues found, or null when that domain was not requested or threw. */
export type CheckResults = Record<CheckDomain, Issue[] | null>;

export async function runChecks(domains: readonly CheckDomain[] = CHECK_DOMAINS, opts: RunChecksOptions = {}): Promise<CheckResults> {
  const results: CheckResults = { erc: null, drc: null };
  const project = opts.project ?? store.getState().project;
  for (const domain of domains) {
    const name = domain.toUpperCase();
    try {
      const issues = runners[domain](project);
      results[domain] = issues;
      store.getState().setIssues(domain, issues);
    } catch (err) {
      console.error(`[checks] ${name} failed`, err);
      if (opts.notify) toast.error(`${name} failed: ${errorMessage(err)}`);
    }
  }
  return results;
}

/** On-demand checks with a `running` flag for buttons. */
export function useChecks(): { runChecks: (domains?: readonly CheckDomain[]) => Promise<CheckResults>; running: boolean } {
  const [running, setRunning] = useState(false);
  const run = useCallback(async (domains: readonly CheckDomain[] = CHECK_DOMAINS) => {
    setRunning(true);
    try {
      return await runChecks(domains, { notify: true });
    } finally {
      setRunning(false);
    }
  }, []);
  return { runChecks: run, running };
}

/** Re-run both check domains `debounceMs` after the project last changed (and once on mount). */
export function useLiveChecks(debounceMs: number = LIVE_CHECK_DEBOUNCE_MS): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (!disposed) void runChecks(CHECK_DOMAINS, { notify: false });
      }, debounceMs);
    };
    schedule();
    const unsubscribe = store.subscribe((s, prev) => {
      if (s.project !== prev.project) schedule();
    });
    return () => {
      disposed = true;
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [debounceMs]);
}
