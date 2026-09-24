/**
 * Catalog symbol browser shared by the Library dock panel and the 'library'
 * dialog (A key): search box, category groups, keyboard navigation. Picking
 * a row hands the symbol id to `onPick`; the callers set `ui.schematic.placing`.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { store, useProject, useSchematicUi } from '@/store';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/icons';
import { Input } from '@/ui/Input';
import { flattenGroups, groupLibrary, libraryEntries, type LibraryEntry } from './catalogView';

export const CUSTOM_DEVICE_DIALOG = 'custom-device';

export interface LibraryListProps {
  onPick: (symbolId: string) => void;
  autoFocus?: boolean;
  className?: string;
}

/** Set the symbol the canvas should place next (ghost follows the cursor). */
export function startPlacing(symbolId: string): void {
  const s = store.getState();
  if (s.ui.activeTab !== 'schematic') s.setActiveTab('schematic');
  s.patchSchematic({ placing: symbolId, tool: 'select' });
}

export function LibraryList({ onPick, autoFocus = false, className }: LibraryListProps) {
  const project = useProject();
  const placing = useSchematicUi().placing;
  const entries = useMemo(() => libraryEntries(project), [project]);
  const [query, setQuery] = useState('');
  const groups = useMemo(() => groupLibrary(entries, query), [entries, query]);
  const flat = useMemo(() => flattenGroups(groups), [groups]);
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setCursor(0), [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [cursor]);

  const pick = (entry: LibraryEntry | undefined) => {
    if (entry) onPick(entry.symbol.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(flat.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(flat[cursor]);
    }
  };

  let index = -1;
  return (
    <div className={cn('flex h-full min-h-0 w-full flex-col', className)} data-testid="library-list">
      <div className="flex shrink-0 items-center gap-1 border-b border-border p-1">
        <Icon name="search" size={12} className="ml-1 shrink-0 text-fg-muted" />
        <Input
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search name, kind, port type…"
          aria-label="Search library"
          className="flex-1"
        />
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto" role="listbox" aria-label="Catalog symbols">
        {flat.length === 0 ? (
          <EmptyState title="No matching symbols" description="Try a shorter search, or add a custom device." />
        ) : (
          groups.map((g) => (
            <div key={g.category}>
              <div className="sticky top-0 z-10 flex h-5 items-center gap-1 bg-panel-2 px-2 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
                <span className="flex-1 truncate">{g.category}</span>
                <span>{g.entries.length}</span>
              </div>
              {g.entries.map((entry) => {
                index++;
                const i = index;
                const active = placing === entry.symbol.id;
                return (
                  <button
                    key={entry.symbol.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    data-index={i}
                    data-symbol-id={entry.symbol.id}
                    data-active={active || undefined}
                    onClick={() => {
                      setCursor(i);
                      pick(entry);
                    }}
                    onMouseEnter={() => setCursor(i)}
                    className={cn(
                      'flex w-full flex-col gap-0.5 px-2 py-1 text-left outline-none',
                      i === cursor && 'bg-panel-2',
                      active && 'bg-accent/15',
                    )}
                    title={entry.footprint ? `${entry.footprint.model}${entry.footprint.vendor ? ` — ${entry.footprint.vendor}` : ''}` : 'No default physical model'}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-[13px] text-fg">{entry.symbol.name}</span>
                      {entry.heightU !== null && <Badge tone={active ? 'accent' : 'neutral'}>{entry.heightU}U</Badge>}
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-fg-muted">
                      <span className="shrink-0">{entry.symbol.kind}</span>
                      <span className="shrink-0">·</span>
                      <span className="min-w-0 flex-1 truncate">{entry.portSummary}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 border-t border-border p-1">
        <span className="flex-1 truncate px-1 text-[11px] text-fg-muted">{placing ? 'Click the canvas to place · Esc cancels' : 'Click a symbol to place it'}</span>
        <Button size="sm" onClick={() => store.getState().openDialog(CUSTOM_DEVICE_DIALOG)}>
          <Icon name="plus" size={12} />
          Custom device…
        </Button>
      </div>
    </div>
  );
}
