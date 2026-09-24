/** Top menu bar: File / Edit / View / Help plus the editable project title. */
import { Fragment, type ReactNode } from 'react';
import type { EditorId, RoutingLayer } from '@/model/types';
import { store, useActiveTab, useCanRedo, useCanUndo, useRedoLabel, useStore, useUndoLabel, type LayoutView, type RatsnestMode, type Viewer3dUi } from '@/store';
import { formatKeys } from '@/store/shortcuts';
import { cn } from '@/ui/cn';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/ui/DropdownMenu';
import { toast } from '@/ui/Toast';
import { exportKindsByGroup, runExport } from './exports';
import { demoTemplates } from '@/model/demo';
import { importProjectFile, newProject, newProjectFromTemplate, saveProjectFile } from './projectActions';
import { PROJECT_PICKER_DIALOG } from './ProjectPicker';
import { ProjectTitle } from './ProjectTitle';
import { SHELL_KEYS } from './shellShortcuts';
import { SHORTCUTS_DIALOG } from './ShortcutsDialog';
import { runChecks } from './useChecks';

function MenuButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        className={cn(
          'h-6 rounded px-2 text-[13px] text-fg-muted outline-none hover:bg-panel-2 hover:text-fg focus-visible:ring-1 focus-visible:ring-accent data-[state=open]:bg-panel-2 data-[state=open]:text-fg',
        )}
      >
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

const LAYOUT_VIEWS: { value: LayoutView; label: string }[] = [
  { value: 'floor', label: 'Floor plan' },
  { value: 'elevation', label: 'Rack elevation' },
  { value: 'split', label: 'Split' },
];
const RATSNEST_MODES: { value: RatsnestMode; label: string }[] = [
  { value: 'all', label: 'All airwires' },
  { value: 'selection', label: 'Selection only' },
  { value: 'none', label: 'Hidden' },
];
const LAYERS: { value: RoutingLayer; label: string }[] = [
  { value: 'overhead', label: 'Overhead tray' },
  { value: 'underfloor', label: 'Underfloor' },
  { value: 'in-rack', label: 'In-rack' },
];
const VIEWER_OPTIONS: { key: keyof Viewer3dUi; label: string }[] = [
  { key: 'showDoors', label: 'Rack doors' },
  { key: 'showOverhead', label: 'Overhead trays' },
  { key: 'showUnderfloor', label: 'Underfloor' },
  { key: 'showCables', label: 'Cables' },
  { key: 'showAirwires', label: 'Airwires' },
  { key: 'showRaisedFloor', label: 'Raised floor' },
];
const EDITOR_TABS: { value: EditorId; label: string; keys: string }[] = [
  { value: 'schematic', label: 'Schematic', keys: SHELL_KEYS.tabSchematic },
  { value: 'layout', label: 'Layout', keys: SHELL_KEYS.tabLayout },
  { value: 'viewer3d', label: '3D viewer', keys: SHELL_KEYS.tabViewer3d },
];

const isEditorId = (v: string): v is EditorId => v === 'schematic' || v === 'layout' || v === 'viewer3d';

function FileMenu() {
  const s = () => store.getState();
  return (
    <MenuButton label="File">
      <DropdownMenuItem onSelect={() => newProject()}>New project</DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>New from template</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {demoTemplates.map((t) => (
            <DropdownMenuItem key={t.id} onSelect={() => newProjectFromTemplate(t)} title={t.description}>
              {t.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuItem onSelect={() => s().openDialog(PROJECT_PICKER_DIALOG)} shortcut={formatKeys(SHELL_KEYS.open)}>
        Open…
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => saveProjectFile()} shortcut={formatKeys(SHELL_KEYS.save)}>
        Save (download JSON)
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void importProjectFile()}>Import JSON…</DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Export</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {exportKindsByGroup().map((g, gi) => (
            <Fragment key={g.group}>
              {gi > 0 && <DropdownMenuSeparator />}
              {g.kinds.map((k) => (
                <DropdownMenuItem key={k.id} onSelect={() => void runExport(k)} title={k.description}>
                  {k.name}
                </DropdownMenuItem>
              ))}
            </Fragment>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </MenuButton>
  );
}

function EditMenu() {
  const activeTab = useActiveTab();
  const canUndo = useCanUndo(activeTab);
  const canRedo = useCanRedo(activeTab);
  const undoLabel = useUndoLabel(activeTab);
  const redoLabel = useRedoLabel(activeTab);
  const s = () => store.getState();
  return (
    <MenuButton label="Edit">
      <DropdownMenuItem disabled={!canUndo} onSelect={() => s().undo(activeTab)} shortcut={formatKeys('mod+z')}>
        Undo{undoLabel ? ` ${undoLabel}` : ''}
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!canRedo} onSelect={() => s().redo(activeTab)} shortcut={formatKeys('mod+shift+z')}>
        Redo{redoLabel ? ` ${redoLabel}` : ''}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() => {
          s().setIssuesDrawerOpen(true);
          void runChecks(['erc'], { notify: true });
        }}
        shortcut={formatKeys(SHELL_KEYS.runErc)}
      >
        Run ERC
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          s().setIssuesDrawerOpen(true);
          void runChecks(['drc'], { notify: true });
        }}
        shortcut={formatKeys(SHELL_KEYS.runDrc)}
      >
        Run DRC
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => s().openDialog('update-layout')} shortcut={formatKeys(SHELL_KEYS.updateLayout)}>
        Update Layout from Schematic…
      </DropdownMenuItem>
    </MenuButton>
  );
}

function ViewMenu() {
  const activeTab = useActiveTab();
  const drawerOpen = useStore((st) => st.ui.issuesDrawerOpen);
  const layout = useStore((st) => st.ui.layout);
  const viewer = useStore((st) => st.ui.viewer3d);
  const s = () => store.getState();
  return (
    <MenuButton label="View">
      <DropdownMenuRadioGroup value={activeTab} onValueChange={(v) => isEditorId(v) && s().setActiveTab(v)}>
        {EDITOR_TABS.map((t) => (
          <DropdownMenuRadioItem key={t.value} value={t.value} shortcut={formatKeys(t.keys)}>
            {t.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem checked={drawerOpen} onCheckedChange={(c) => s().setIssuesDrawerOpen(c === true)} shortcut={formatKeys(SHELL_KEYS.issues)}>
        Issues drawer
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Layout</DropdownMenuLabel>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>View</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={layout.view} onValueChange={(v) => s().setLayoutView(v as LayoutView)}>
            {LAYOUT_VIEWS.map((o) => (
              <DropdownMenuRadioItem key={o.value} value={o.value}>
                {o.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Ratsnest</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={layout.ratsnest} onValueChange={(v) => s().setRatsnestMode(v as RatsnestMode)}>
            {RATSNEST_MODES.map((o) => (
              <DropdownMenuRadioItem key={o.value} value={o.value}>
                {o.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Layers</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {LAYERS.map((l) => (
            <DropdownMenuCheckboxItem
              key={l.value}
              checked={layout.visibleLayers[l.value]}
              onCheckedChange={(c) => s().toggleLayerVisible(l.value, c === true)}
            >
              {l.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>3D viewer</DropdownMenuLabel>
      {VIEWER_OPTIONS.map((o) => (
        <DropdownMenuCheckboxItem key={o.key} checked={viewer[o.key]} onCheckedChange={(c) => s().setViewer3dOption(o.key, c === true)}>
          {o.label}
        </DropdownMenuCheckboxItem>
      ))}
    </MenuButton>
  );
}

function HelpMenu() {
  return (
    <MenuButton label="Help">
      <DropdownMenuItem onSelect={() => store.getState().openDialog(SHORTCUTS_DIALOG)} shortcut={formatKeys(SHELL_KEYS.shortcuts)}>
        Keyboard shortcuts…
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => toast.info('Datacenter EDA — schematic, layout and 3D for datacenter networks.', { title: 'About' })}>
        About
      </DropdownMenuItem>
    </MenuButton>
  );
}

export function MenuBar() {
  return (
    <header className="flex h-7 shrink-0 items-center gap-1 border-b border-border bg-panel px-1">
      <span className="px-2 text-[13px] font-semibold tracking-tight text-fg">Datacenter EDA</span>
      <nav className="flex items-center" aria-label="Main menu">
        <FileMenu />
        <EditMenu />
        <ViewMenu />
        <HelpMenu />
      </nav>
      <div className="flex-1" />
      <ProjectTitle />
    </header>
  );
}
