/**
 * Renders the registered dock panels, toolbars and dialogs for the active
 * editor. Feature modules register into '@/panels/registry'; this is the
 * only place that reads it.
 */
import { useSyncExternalStore, type ReactNode } from 'react';
import type { EditorId } from '@/model/types';
import { store, useStore } from '@/store';
import { Panel } from '@/ui/Panel';
import { SplitPane } from '@/ui/SplitPane';
import {
  dialogById,
  panelsFor,
  registryVersion,
  subscribeRegistry,
  toolbarsFor,
  type DockSide,
} from '@/panels/registry';

export function useRegistryVersion(): number {
  return useSyncExternalStore(subscribeRegistry, registryVersion, registryVersion);
}

function DockColumn({ editor, side }: { editor: EditorId; side: DockSide }) {
  useRegistryVersion();
  const panels = panelsFor(editor, side);
  if (panels.length === 0) return null;
  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-panel">
      {panels.map((p) => (
        <Panel key={p.id} title={p.title} collapsible defaultCollapsed={p.collapsed ?? false} className="min-h-0 flex-1">
          <p.component />
        </Panel>
      ))}
    </div>
  );
}

export function EditorToolbars({ editor }: { editor: EditorId }) {
  useRegistryVersion();
  const bars = toolbarsFor(editor);
  if (bars.length === 0) return null;
  return (
    <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-panel px-1">
      {bars.map((t) => (
        <t.component key={t.id} />
      ))}
    </div>
  );
}

export function RegisteredDialogs() {
  useRegistryVersion();
  const active = useStore((s) => s.ui.activeDialog);
  const reg = dialogById(active);
  if (!reg) return null;
  return <reg.component />;
}

/**
 * Wraps an editor with its left/right docks and toolbar strip. Docks are
 * resizable; a side with no registered panels collapses to nothing.
 */
export function EditorFrame({ editor, children }: { editor: EditorId; children: ReactNode }) {
  useRegistryVersion();
  const left = panelsFor(editor, 'left').length > 0;
  const right = panelsFor(editor, 'right').length > 0;
  const centre = (
    <div className="flex h-full min-h-0 w-full flex-col">
      <EditorToolbars editor={editor} />
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
  const withRight = right ? (
    <SplitPane className="h-full" direction="horizontal" primary="second" defaultSize={300} minSize={200} minSecondarySize={300}>
      {centre}
      <DockColumn editor={editor} side="right" />
    </SplitPane>
  ) : (
    centre
  );
  return left ? (
    <SplitPane className="h-full" direction="horizontal" primary="first" defaultSize={260} minSize={180} minSecondarySize={300}>
      <DockColumn editor={editor} side="left" />
      {withRight}
    </SplitPane>
  ) : (
    withRight
  );
}

/** Convenience for feature code that wants to open a registered dialog. */
export function openDialog(id: string, data?: unknown) {
  store.getState().openDialog(id, data);
}
