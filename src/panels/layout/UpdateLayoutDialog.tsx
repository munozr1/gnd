/**
 * Update Layout from Schematic (F8): the KiCad "Update PCB" dialog. Diffs the
 * schematic against the layout's sync state, lists every change grouped by
 * kind with a checkbox each, and applies the checked subset as one undoable
 * command.
 */
import { useEffect, useMemo, useState } from 'react';
import { layout } from '@/commands';
import { indexProject, type ProjectIndex } from '@/model/query';
import { changeKey, computeSyncPlan } from '@/model/sync';
import type { Project, SyncChange } from '@/model/types';
import { store, useActiveDialog, useProject } from '@/store';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Dialog, DialogContent } from '@/ui/Dialog';
import { EmptyState } from '@/ui/EmptyState';
import { toast } from '@/ui/Toast';
import { run } from './shared';

export const UPDATE_LAYOUT_DIALOG = 'update-layout';

type Kind = SyncChange['kind'];

interface GroupDef {
  kind: Kind;
  title: string;
}

const SECTIONS: { title: string; groups: GroupDef[] }[] = [
  {
    title: 'Components',
    groups: [
      { kind: 'add-component', title: 'Added' },
      { kind: 'remove-component', title: 'Removed' },
      { kind: 'footprint-changed', title: 'Model changed' },
      { kind: 'ref-renamed', title: 'Renamed' },
    ],
  },
  {
    title: 'Links',
    groups: [
      { kind: 'add-link', title: 'Added' },
      { kind: 'remove-link', title: 'Removed' },
      { kind: 'link-endpoint-changed', title: 'Endpoint changed' },
    ],
  },
];

export interface ChangeDescription {
  text: string;
  /** Muted trailing detail ('→ Unplaced bin'). */
  detail?: string;
  /** Inline warning ('will be unplaced: 4U does not fit at U42'). */
  warning?: string;
}

const modelName = (idx: ProjectIndex, id: string | null): string => (id === null ? 'no model' : (idx.catalog.footprint(id)?.model ?? id));

/** Human description of one sync change, with the warnings the spec calls for. */
export function describeChange(project: Project, change: SyncChange): ChangeDescription {
  const idx = indexProject(project);
  switch (change.kind) {
    case 'add-component': {
      const c = idx.component(change.componentId);
      const model = c ? modelName(idx, c.footprintDefId) : undefined;
      return { text: change.ref, detail: `${model ? `${model} · ` : ''}→ Unplaced bin` };
    }
    case 'remove-component': {
      const n = change.orphanedRouteIds.length;
      return {
        text: change.ref,
        detail: 'placement removed',
        ...(n > 0 ? { warning: `orphaned routes: ${n}` } : {}),
      };
    }
    case 'footprint-changed': {
      const text = `${change.ref}: ${modelName(idx, change.from)} → ${modelName(idx, change.to)}`;
      const placement = idx.placement(change.componentId);
      const placed = placement && placement.rackId !== null && placement.uPosition !== null;
      if (!placed) return { text, detail: 'unplaced' };
      const h = idx.catalog.footprint(change.to)?.heightU ?? 1;
      return change.fits
        ? { text, detail: `keeps U${placement.uPosition}` }
        : { text, warning: `will be unplaced: ${h}U does not fit at U${placement.uPosition}` };
    }
    case 'ref-renamed':
      return { text: `${change.from} → ${change.to}`, detail: 'labels only' };
    case 'add-link': {
      const link = idx.link(change.linkId);
      const placedEnd = (id: string) => {
        const p = idx.placement(id);
        return !!p && p.rackId !== null;
      };
      const both = link ? placedEnd(link.a.componentId) && placedEnd(link.b.componentId) : false;
      return { text: change.label, detail: both ? 'airwire' : 'no airwire until both ends are placed' };
    }
    case 'remove-link':
      return { text: change.label, ...(change.hadRoute ? { warning: 'route will be removed' } : { detail: 'no route' }) };
    case 'link-endpoint-changed':
      return {
        text: change.label,
        detail: project.routes[change.linkId] ? 'route kept, flagged for review' : 'no route',
      };
  }
}

export function UpdateLayoutDialog() {
  const open = useActiveDialog() === UPDATE_LAYOUT_DIALOG;
  const project = useProject();
  const plan = useMemo(() => (open ? computeSyncPlan(project) : { changes: [] }), [open, project]);
  // Keys the user unchecked; changes that appear while the dialog is open default to checked.
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (open) setUnchecked(new Set());
  }, [open]);

  const keyed = useMemo(() => plan.changes.map((c) => ({ change: c, key: changeKey(c) })), [plan]);
  const byKind = useMemo(() => {
    const m = new Map<Kind, { change: SyncChange; key: string }[]>();
    for (const k of keyed) {
      const arr = m.get(k.change.kind);
      if (arr) arr.push(k);
      else m.set(k.change.kind, [k]);
    }
    return m;
  }, [keyed]);

  const isChecked = (key: string) => !unchecked.has(key);
  const setKeys = (keys: readonly string[], checked: boolean) =>
    setUnchecked((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (checked) next.delete(k);
        else next.add(k);
      }
      return next;
    });

  const selectedCount = keyed.filter((k) => isChecked(k.key)).length;
  const close = () => store.getState().closeDialog();

  const apply = () => {
    const changes = keyed.filter((k) => isChecked(k.key)).map((k) => k.change);
    if (changes.length === 0) return;
    const cmd = layout.applySyncPlan(changes);
    if (!run(cmd)) return;
    const r = cmd.result;
    const parts = [`Applied ${r?.applied ?? changes.length} change${(r?.applied ?? changes.length) === 1 ? '' : 's'}`];
    if (r && r.removedRoutes.length > 0) parts.push(`${r.removedRoutes.length} route${r.removedRoutes.length === 1 ? '' : 's'} removed`);
    if (r && r.unplaced.length > 0) parts.push(`${r.unplaced.length} device${r.unplaced.length === 1 ? '' : 's'} unplaced`);
    const message = parts.join(', ');
    if (r && (r.removedRoutes.length > 0 || r.unplaced.length > 0)) toast.warning(message, { title: 'Layout updated' });
    else toast.ok(message, { title: 'Layout updated' });
    close();
  };

  const allKeys = keyed.map((k) => k.key);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        title="Update Layout from Schematic"
        width="lg"
        bodyClassName="p-0"
        description={
          keyed.length === 0
            ? undefined
            : `${keyed.length} change${keyed.length === 1 ? '' : 's'} detected. Matching is by component id, so re-annotation never breaks placements.`
        }
        footer={
          <>
            <span className="mr-auto text-[12px] text-fg-muted" data-testid="sync-selected-count">
              {selectedCount} of {keyed.length} selected
            </span>
            <Button variant="ghost" disabled={keyed.length === 0} onClick={() => setKeys(allKeys, true)}>
              Select all
            </Button>
            <Button variant="ghost" disabled={keyed.length === 0} onClick={() => setKeys(allKeys, false)}>
              Select none
            </Button>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" disabled={selectedCount === 0} onClick={apply} data-testid="sync-apply">
              Apply
            </Button>
          </>
        }
      >
        {keyed.length === 0 ? (
          <EmptyState icon="ok" title="Layout is up to date" description="The schematic has no changes the layout has not applied." />
        ) : (
          <div className="flex flex-col" data-testid="sync-plan">
            {SECTIONS.map((section) => {
              const groups = section.groups.filter((g) => (byKind.get(g.kind)?.length ?? 0) > 0);
              if (groups.length === 0) return null;
              return (
                <section key={section.title} className="border-b border-border last:border-b-0">
                  <h3 className="sticky top-0 z-10 bg-panel-2 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
                    {section.title}
                  </h3>
                  {groups.map((g) => {
                    const rows = byKind.get(g.kind) ?? [];
                    const keys = rows.map((r) => r.key);
                    const on = keys.filter(isChecked).length;
                    const state: boolean | 'indeterminate' = on === 0 ? false : on === keys.length ? true : 'indeterminate';
                    return (
                      <div key={g.kind} data-sync-group={g.kind}>
                        <div className="flex h-6 items-center gap-2 bg-panel px-3">
                          <Checkbox
                            checked={state}
                            aria-label={`Select all ${g.title.toLowerCase()} ${section.title.toLowerCase()}`}
                            onCheckedChange={(v) => setKeys(keys, v === true)}
                          />
                          <span className="text-[12px] font-medium text-fg">{g.title}</span>
                          <Badge>{rows.length}</Badge>
                          <span className="flex-1" />
                          <button type="button" className="text-[11px] text-fg-muted hover:text-fg" onClick={() => setKeys(keys, true)}>
                            all
                          </button>
                          <button type="button" className="text-[11px] text-fg-muted hover:text-fg" onClick={() => setKeys(keys, false)}>
                            none
                          </button>
                        </div>
                        <ul>
                          {rows.map(({ change, key }) => {
                            const d = describeChange(project, change);
                            return (
                              <li
                                key={key}
                                data-change-key={key}
                                data-checked={isChecked(key)}
                                className="flex min-h-6 items-center gap-2 px-3 py-0.5 hover:bg-panel-2"
                              >
                                <Checkbox checked={isChecked(key)} aria-label={d.text} onCheckedChange={(v) => setKeys([key], v === true)} />
                                <span className="mono min-w-0 flex-1 truncate text-[12px] text-fg" title={d.text}>
                                  {d.text}
                                  {d.detail && <span className="ml-2 font-sans text-[11px] text-fg-muted">{d.detail}</span>}
                                </span>
                                {d.warning && (
                                  <Badge tone="warning" data-testid="sync-warning">
                                    {d.warning}
                                  </Badge>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
