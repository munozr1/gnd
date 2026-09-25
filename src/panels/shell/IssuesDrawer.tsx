/**
 * Bottom-docked issues list (ERC + DRC). Clicking an issue selects its
 * targets and switches to the editor that owns the domain.
 */
import { useMemo } from 'react';
import { indexProject } from '@/model/query';
import type { Id, Issue, IssueTarget, SelectionItem } from '@/model/types';
import { isSelected, store, useIssues, useSelection } from '@/store';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { EmptyState } from '@/ui/EmptyState';
import { IconButton } from '@/ui/IconButton';
import { SeverityIcon } from '@/ui/icons';
import { Toolbar, ToolbarGroup, ToolbarLabel, ToolbarSeparator, ToolbarSpacer } from '@/ui/Toolbar';
import { Tooltip } from '@/ui/Tooltip';
import { setIssuesFilter, toggleIssueSeverity, useIssuesFilter, type FilterableSeverity, type IssueDomainFilter } from './issuesFilter';
import { useChecks } from './useChecks';

export function selectionForTarget(target: IssueTarget): SelectionItem {
  switch (target.kind) {
    case 'component':
      return { kind: 'component', id: target.id };
    case 'link':
      return { kind: 'link', id: target.id };
    case 'rack':
      return { kind: 'rack', id: target.id };
    case 'tray':
      return { kind: 'tray', id: target.id };
    case 'sheet':
      return { kind: 'sheet', id: target.id };
    case 'route':
      // Routes are keyed by link id; selecting the link highlights its route.
      return { kind: 'link', id: target.id };
    case 'cable':
      return { kind: 'cable', id: target.id };
  }
}

/** Sheet holding the first component-ish target, so the schematic can jump there. */
function sheetOfIssue(issue: Issue): Id | null {
  const idx = indexProject(store.getState().project);
  for (const t of issue.targets) {
    if (t.kind === 'sheet') return t.id;
    if (t.kind === 'component') {
      const c = idx.component(t.id);
      if (c) return c.sch.sheetId;
    }
    if (t.kind === 'link' || t.kind === 'route') {
      const l = idx.link(t.id);
      const c = l && idx.component(l.a.componentId);
      if (c) return c.sch.sheetId;
    }
  }
  return null;
}

/** Select the issue's targets and show them in the owning editor. */
export function focusIssue(issue: Issue): void {
  const s = store.getState();
  const editor = issue.domain === 'erc' ? 'schematic' : 'layout';
  if (issue.domain === 'erc') {
    const sheetId = sheetOfIssue(issue);
    if (sheetId && sheetId !== s.ui.activeSheetId) s.setActiveSheet(sheetId);
  }
  // Selects, switches tab and asks the editor to zoom to the targets.
  s.revealSelection(issue.targets.map(selectionForTarget), editor);
}

/** Short human label for an issue's targets: 'SW1:eth1/49, SW2'. */
export function targetLabels(issue: Issue): string {
  const idx = indexProject(store.getState().project);
  const labels: string[] = [];
  for (const t of issue.targets) {
    switch (t.kind) {
      case 'component': {
        const c = idx.component(t.id);
        labels.push(c ? (t.portId ? `${c.ref}:${t.portId}` : c.ref) : t.id);
        break;
      }
      case 'link':
      case 'route': {
        const l = idx.link(t.id);
        labels.push(l ? idx.linkLabel(l) : t.id);
        break;
      }
      case 'rack':
        labels.push(idx.rack(t.id)?.name ?? t.id);
        break;
      case 'tray':
        labels.push(idx.project.trays.find((tr) => tr.id === t.id)?.name ?? t.id);
        break;
      case 'sheet':
        labels.push(idx.project.sheets.find((sh) => sh.id === t.id)?.name ?? t.id);
        break;
      case 'cable':
        labels.push(idx.cable(t.id)?.label ?? t.id);
        break;
    }
  }
  return labels.slice(0, 3).join(', ') + (labels.length > 3 ? ` +${labels.length - 3}` : '');
}

const DOMAIN_OPTIONS: { value: IssueDomainFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'erc', label: 'ERC' },
  { value: 'drc', label: 'DRC' },
];

const SEVERITIES: FilterableSeverity[] = ['error', 'warning', 'info'];

function IssueRow({ issue, selected }: { issue: Issue; selected: boolean }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => focusIssue(issue)}
        data-issue-id={issue.id}
        data-selected={selected || undefined}
        className={cn(
          'flex h-6 w-full items-center gap-2 px-2 text-left text-[13px] outline-none hover:bg-panel-2 focus-visible:bg-panel-2',
          selected && 'bg-accent/15',
        )}
      >
        <SeverityIcon severity={issue.severity} />
        <Badge tone={issue.domain === 'erc' ? 'accent' : 'info'} className="w-9 justify-center">
          {issue.domain.toUpperCase()}
        </Badge>
        <span className="mono w-40 shrink-0 truncate text-[11px] text-fg-muted">{issue.rule}</span>
        <span className="min-w-0 flex-1 truncate text-fg">{issue.message}</span>
        <span className="mono max-w-[40%] shrink-0 truncate text-[11px] text-fg-muted">{targetLabels(issue)}</span>
      </button>
    </li>
  );
}

export function IssuesDrawer() {
  const erc = useIssues('erc');
  const drc = useIssues('drc');
  const filter = useIssuesFilter();
  const selection = useSelection();
  const { runChecks, running } = useChecks();

  const inDomain = useMemo(
    () => (filter.domain === 'erc' ? erc : filter.domain === 'drc' ? drc : [...erc, ...drc]),
    [erc, drc, filter.domain],
  );
  const counts = useMemo(() => {
    const c: Record<FilterableSeverity, number> = { error: 0, warning: 0, info: 0 };
    for (const i of inDomain) if (i.severity !== 'ignore') c[i.severity]++;
    return c;
  }, [inDomain]);
  const visible = useMemo(
    () => inDomain.filter((i) => i.severity !== 'ignore' && filter.severities[i.severity]),
    [inDomain, filter.severities],
  );

  const close = () => store.getState().setIssuesDrawerOpen(false);

  return (
    <section className="flex h-full min-h-0 flex-col bg-panel" aria-label="Issues">
      <Toolbar>
        <ToolbarLabel>Issues</ToolbarLabel>
        <ToolbarGroup role="radiogroup" aria-label="Domain">
          {DOMAIN_OPTIONS.map((o) => (
            <Button
              key={o.value}
              variant="ghost"
              role="radio"
              aria-checked={filter.domain === o.value}
              active={filter.domain === o.value}
              onClick={() => setIssuesFilter({ domain: o.value })}
            >
              {o.label}
            </Button>
          ))}
        </ToolbarGroup>
        <ToolbarSeparator />
        <ToolbarGroup aria-label="Severity">
          {SEVERITIES.map((sev) => (
            <Tooltip key={sev} content={`${filter.severities[sev] ? 'Hide' : 'Show'} ${sev}s`}>
              <Button
                variant="ghost"
                aria-pressed={filter.severities[sev]}
                active={filter.severities[sev]}
                onClick={() => toggleIssueSeverity(sev)}
                className="tabular-nums"
              >
                <SeverityIcon severity={sev} size={12} />
                {counts[sev]}
              </Button>
            </Tooltip>
          ))}
        </ToolbarGroup>
        <ToolbarSpacer />
        <Button variant="ghost" onClick={() => void runChecks()} disabled={running}>
          {running ? 'Running…' : 'Run checks'}
        </Button>
        <IconButton label="Close issues" icon="close" onClick={close} />
      </Toolbar>
      <div className="min-h-0 flex-1 overflow-auto">
        {visible.length === 0 ? (
          <EmptyState
            icon="ok"
            title={inDomain.length === 0 ? 'No issues' : 'No issues match the filter'}
            description={inDomain.length === 0 ? 'ERC and DRC run automatically as you edit.' : undefined}
          />
        ) : (
          <ul role="list" className="py-0.5">
            {visible.map((issue) => (
              <IssueRow
                key={`${issue.domain}:${issue.id}`}
                issue={issue}
                selected={issue.targets.some((t) => isSelected(selection, selectionForTarget(t)))}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
