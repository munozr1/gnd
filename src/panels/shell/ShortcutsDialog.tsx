/** Help > Keyboard shortcuts: every shortcut currently registered, grouped by editor. */
import { useMemo } from 'react';
import type { EditorId } from '@/model/types';
import { store, useActiveDialog } from '@/store';
import { formatKeys, listShortcuts, type ShortcutDef } from '@/store/shortcuts';
import { Dialog, DialogContent } from '@/ui/Dialog';
import { EmptyState } from '@/ui/EmptyState';
import { Kbd } from '@/ui/Kbd';

export const SHORTCUTS_DIALOG = 'shortcuts';

const GROUP_ORDER: (EditorId | 'global')[] = ['global', 'schematic', 'layout', 'viewer3d'];
const GROUP_TITLE: Record<EditorId | 'global', string> = {
  global: 'Everywhere',
  schematic: 'Schematic editor',
  layout: 'Layout editor',
  viewer3d: '3D viewer',
};

const labelOf = (s: ShortcutDef): string => s.description ?? s.id;

export function groupShortcuts(defs: readonly ShortcutDef[]): { group: EditorId | 'global'; title: string; items: ShortcutDef[] }[] {
  const byGroup = new Map<EditorId | 'global', ShortcutDef[]>();
  for (const d of defs) {
    const g = d.editor ?? 'global';
    const arr = byGroup.get(g);
    if (arr) arr.push(d);
    else byGroup.set(g, [d]);
  }
  return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({
    group: g,
    title: GROUP_TITLE[g],
    items: (byGroup.get(g) ?? []).slice().sort((a, b) => labelOf(a).localeCompare(labelOf(b))),
  }));
}

const keysOf = (s: ShortcutDef): string[] => (Array.isArray(s.keys) ? s.keys : [s.keys]);

export function ShortcutsDialog() {
  const open = useActiveDialog() === SHORTCUTS_DIALOG;
  const groups = useMemo(() => (open ? groupShortcuts(listShortcuts()) : []), [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && store.getState().closeDialog()}>
      <DialogContent title="Keyboard shortcuts" width="md" bodyClassName="p-0">
        {groups.length === 0 ? (
          <EmptyState icon="keyboard" title="No shortcuts registered" />
        ) : (
          groups.map((g) => (
            <section key={g.group} className="border-b border-border last:border-b-0">
              <h3 className="sticky top-0 bg-panel-2 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">{g.title}</h3>
              <ul>
                {g.items.map((s) => (
                  <li key={s.id} className="flex h-7 items-center gap-3 px-3">
                    <span className="min-w-0 flex-1 truncate text-fg">{labelOf(s)}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {keysOf(s).map((k, i) => (
                        <span key={k} className="flex items-center gap-1">
                          {i > 0 && <span className="text-[11px] text-fg-muted">or</span>}
                          <Kbd>{formatKeys(k)}</Kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </DialogContent>
    </Dialog>
  );
}
