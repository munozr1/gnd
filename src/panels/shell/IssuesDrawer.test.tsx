import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { createComponent, createLink, createProject, createSheet, ROOT_SHEET_ID } from '@/model/factories';
import type { Issue } from '@/model/types';
import { emptyHistory, initialUi, useStore } from '@/store';
import { TooltipProvider } from '@/ui/Tooltip';
import { click, mount, text, type Mounted } from '@/ui/testing';
import { IssuesDrawer, focusIssue, selectionForTarget, targetLabels } from './IssuesDrawer';
import { resetIssuesFilter, setIssuesFilter } from './issuesFilter';

const leaf = builtinCatalog.symbols.find((s) => s.id === 'sym.leaf-switch-48x25-8x100')!;
const spine = builtinCatalog.symbols.find((s) => s.id === 'sym.spine-switch-32x400')!;

let mounted: Mounted | null = null;

function fixture() {
  const project = createProject('Test', '2026-01-01T00:00:00.000Z');
  const pod = createSheet('Pod A', ROOT_SHEET_ID, { x: 0, y: 0 });
  project.sheets.push(pod);
  const sw1 = createComponent(leaf, { sheetId: pod.id, pos: { x: 0, y: 0 }, ref: 'SW1' });
  const sw2 = createComponent(spine, { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: 'SW2' });
  project.components.push(sw1, sw2);
  const link = createLink({ componentId: sw1.id, portId: 'eth1/49' }, { componentId: sw2.id, portId: 'eth1/1' });
  project.links.push(link);
  const issues: Issue[] = [
    {
      id: 'e1',
      rule: 'missing-optic',
      severity: 'warning',
      message: 'SW1:eth1/49 has no optic',
      targets: [{ kind: 'component', id: sw1.id, portId: 'eth1/49' }],
      domain: 'erc',
    },
    {
      id: 'd1',
      rule: 'unplaced-component',
      severity: 'error',
      message: 'SW2 is not placed',
      targets: [{ kind: 'component', id: sw2.id }],
      domain: 'drc',
    },
    { id: 'd2', rule: 'unrouted-link', severity: 'info', message: 'link unrouted', targets: [{ kind: 'route', id: link.id }], domain: 'drc' },
  ];
  return { project, pod, sw1, sw2, link, issues };
}

beforeEach(() => {
  resetIssuesFilter();
  const f = fixture();
  useStore.setState({ project: f.project, history: emptyHistory(), ui: { ...initialUi(), issues: { erc: [f.issues[0]!], drc: [f.issues[1]!, f.issues[2]!] } } });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const render = () =>
  mount(
    <TooltipProvider>
      <IssuesDrawer />
    </TooltipProvider>,
  );

describe('IssuesDrawer', () => {
  it('lists ERC and DRC issues sorted as given and filters by domain and severity', () => {
    mounted = render();
    const rows = () => [...mounted!.container.querySelectorAll('[data-issue-id]')].map((r) => r.getAttribute('data-issue-id'));
    expect(rows()).toEqual(['e1', 'd1', 'd2']);

    const domainButtons = [...mounted.container.querySelectorAll('[role="radio"]')];
    click(domainButtons.find((b) => text(b) === 'DRC'));
    expect(rows()).toEqual(['d1', 'd2']);

    const infoToggle = [...mounted.container.querySelectorAll('[aria-pressed]')][2];
    click(infoToggle);
    expect(rows()).toEqual(['d1']);
  });

  it('clicking an issue selects its targets and switches to the owning editor and sheet', () => {
    const s = useStore.getState();
    const project = s.project;
    const ercIssue = s.ui.issues.erc[0]!;
    const targetId = (ercIssue.targets[0] as { id: string }).id;

    s.setActiveTab('layout');
    mounted = render();
    click(mounted.container.querySelector('[data-issue-id="e1"]'));
    expect(useStore.getState().ui.activeTab).toBe('schematic');
    expect(useStore.getState().ui.selection).toEqual([{ kind: 'component', id: targetId }]);
    const podSheet = project.sheets.find((sh) => sh.name === 'Pod A')!;
    expect(useStore.getState().ui.activeSheetId).toBe(podSheet.id);
    expect(mounted.container.querySelector('[data-issue-id="e1"]')?.getAttribute('data-selected')).toBe('true');

    click(mounted.container.querySelector('[data-issue-id="d1"]'));
    expect(useStore.getState().ui.activeTab).toBe('layout');
  });

  it('maps route targets to link selection and labels targets by ref', () => {
    const s = useStore.getState();
    const routeIssue = s.ui.issues.drc[1]!;
    const linkId = (routeIssue.targets[0] as { id: string }).id;
    expect(selectionForTarget({ kind: 'route', id: linkId })).toEqual({ kind: 'link', id: linkId });
    expect(targetLabels(routeIssue)).toBe('SW1:eth1/49 — SW2:eth1/1');
    expect(targetLabels(s.ui.issues.erc[0]!)).toBe('SW1:eth1/49');
    focusIssue(routeIssue);
    expect(useStore.getState().ui.selection).toEqual([{ kind: 'link', id: linkId }]);
  });

  it('status-bar preselection of a domain is honoured', () => {
    setIssuesFilter({ domain: 'erc' });
    mounted = render();
    expect([...mounted.container.querySelectorAll('[data-issue-id]')]).toHaveLength(1);
  });
});
