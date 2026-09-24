import { useMemo } from 'react';
import type { Issue, Project } from '@/model/types';
import { useIssues, useProject, useStore } from '@/store';
import { cn } from '@/ui/cn';
import { SeverityIcon } from '@/ui/icons';
import { Tooltip } from '@/ui/Tooltip';
import { setIssuesFilter } from './issuesFilter';
import { useSaveState, type SaveState } from './saveState';
import { useStatusBar } from './StatusBarContext';

/** Links that have no route yet, over all links. */
export function countUnrouted(project: Project): { unrouted: number; total: number } {
  let unrouted = 0;
  for (const link of project.links) if (!project.routes[link.id]) unrouted++;
  return { unrouted, total: project.links.length };
}

export interface SeverityCounts {
  error: number;
  warning: number;
  info: number;
}

export function countBySeverity(issues: readonly Issue[]): SeverityCounts {
  const c: SeverityCounts = { error: 0, warning: 0, info: 0 };
  for (const i of issues) {
    if (i.severity === 'error') c.error++;
    else if (i.severity === 'warning') c.warning++;
    else if (i.severity === 'info') c.info++;
  }
  return c;
}

const SAVE_LABEL: Record<SaveState, { text: string; className: string }> = {
  idle: { text: '', className: '' },
  dirty: { text: 'Unsaved changes', className: 'text-fg-muted' },
  saved: { text: 'Saved', className: 'text-ok' },
  error: { text: 'Autosave failed', className: 'text-error' },
};

function IssueCounts({ domain, issues, active }: { domain: 'erc' | 'drc'; issues: readonly Issue[]; active: boolean }) {
  const counts = useMemo(() => countBySeverity(issues), [issues]);
  const open = () => {
    setIssuesFilter({ domain });
    const s = useStore.getState();
    s.setIssuesDrawerOpen(true);
  };
  const clean = counts.error === 0 && counts.warning === 0 && counts.info === 0;
  return (
    <Tooltip content={`${domain.toUpperCase()}: ${counts.error} errors, ${counts.warning} warnings, ${counts.info} info`}>
      <button
        type="button"
        onClick={open}
        aria-label={`${domain.toUpperCase()} issues`}
        className={cn(
          'flex h-5 items-center gap-1 rounded px-1.5 outline-none hover:bg-panel-2 focus-visible:ring-1 focus-visible:ring-accent',
          active && 'bg-panel-2 text-fg',
        )}
      >
        <span className="font-medium uppercase">{domain}</span>
        {clean ? (
          <SeverityIcon severity="ignore" size={12} />
        ) : (
          <>
            {counts.error > 0 && (
              <span className="flex items-center gap-0.5">
                <SeverityIcon severity="error" size={12} />
                {counts.error}
              </span>
            )}
            {counts.warning > 0 && (
              <span className="flex items-center gap-0.5">
                <SeverityIcon severity="warning" size={12} />
                {counts.warning}
              </span>
            )}
            {counts.info > 0 && (
              <span className="flex items-center gap-0.5">
                <SeverityIcon severity="info" size={12} />
                {counts.info}
              </span>
            )}
          </>
        )}
      </button>
    </Tooltip>
  );
}

export function StatusBar() {
  const { mode, coords, message } = useStatusBar();
  const project = useProject();
  const { unrouted, total } = useMemo(() => countUnrouted(project), [project]);
  const erc = useIssues('erc');
  const drc = useIssues('drc');
  const drawerOpen = useStore((s) => s.ui.issuesDrawerOpen);
  const saveState = useSaveState();
  const save = SAVE_LABEL[saveState];

  return (
    <footer className="flex h-6 shrink-0 items-center gap-2 border-t border-border bg-panel px-2 text-xs text-fg-muted" role="status">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {mode && <span className="shrink-0 font-medium text-fg">{mode}</span>}
        {coords && <span className="mono shrink-0 tabular-nums">{coords}</span>}
        {message && <span className="truncate">{message}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="tabular-nums" data-testid="unrouted">
          Unrouted: <span className={cn('font-medium', unrouted > 0 ? 'text-warning' : 'text-fg')}>{unrouted}</span> / {total}
        </span>
        <span className="h-3 w-px bg-border" />
        <IssueCounts domain="erc" issues={erc} active={drawerOpen} />
        <IssueCounts domain="drc" issues={drc} active={drawerOpen} />
        {save.text && (
          <>
            <span className="h-3 w-px bg-border" />
            <span className={save.className} data-testid="save-state">
              {save.text}
            </span>
          </>
        )}
      </div>
    </footer>
  );
}
