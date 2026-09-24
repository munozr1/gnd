/**
 * The shared application store: one Project, per-editor undo/redo history and
 * a non-undoable UI slice. Model mutations go through `execute(command)`;
 * everything else is a plain `set`.
 */
import { create, type StoreApi } from 'zustand';
import { createProject, ROOT_SHEET_ID } from '@/model/factories';
import { indexProject, type ProjectIndex } from '@/model/query';
import type { EditorId, Face, Id, Issue, Project, RoutingLayer, SelectionItem } from '@/model/types';
import {
  canRedoHistory,
  canUndoHistory,
  emptyHistory,
  executeCommand,
  redoCommand,
  redoLabelOf,
  undoCommand,
  undoLabelOf,
  type Command,
  type History,
  type StepResult,
} from './commands';
import { dedupeSelection, isSelected, mergeSelection, pruneSelection, selectionItemExists, toggleSelection } from './selection';

export type {
  Command,
  EditorHistory,
  History,
  HistoryEntry,
  StepResult,
  UndoableEditor,
} from './commands';
export { command, transaction, emptyHistory, HISTORY_CAP, COALESCE_WINDOW_MS, isUndoableEditor } from './commands';
export * from './selection';

// ---------------------------------------------------------------------------
// UI slice
// ---------------------------------------------------------------------------

export type LayoutView = 'floor' | 'elevation' | 'split';
export type RatsnestMode = 'all' | 'selection' | 'none';
export type IssueDomain = 'erc' | 'drc';

/** A one-shot request for an editor to move its viewport; the editor clears it after handling. */
export type ViewportRequest =
  | { kind: 'fit' }
  | { kind: 'rect'; rect: { x: number; y: number; width: number; height: number } }
  | { kind: 'items'; items: SelectionItem[] };

export type SchematicTool = 'select' | 'wire' | 'label' | 'breakout' | 'move';

export interface SchematicUi {
  /** SymbolDef id being placed from the library (ghost follows the cursor), or null. */
  placing: string | null;
  tool: SchematicTool;
  viewportRequest: ViewportRequest | null;
  /** Component to focus in the model-assignment dialog. */
  assignFocus: Id | null;
}

export type LayoutTool = 'select' | 'route' | 'room' | 'keepout' | 'tray' | 'rack' | 'measure';

export type LayoutPlacing =
  | { kind: 'rack'; defId: string }
  | { kind: 'tray'; defId: string; elevationMm: number }
  | { kind: 'keepout' }
  | null;

export interface LayoutUi {
  view: LayoutView;
  activeLayer: RoutingLayer;
  visibleLayers: Record<RoutingLayer, boolean>;
  ratsnest: RatsnestMode;
  /** Racks shown in the elevation view. */
  elevationRackIds: Id[];
  elevationFace: Face;
  /** Elevation view follows the floor-plan selection. */
  elevationFollowsSelection: boolean;
  tool: LayoutTool;
  /** Library item being placed on the floor (ghost follows the cursor). */
  placing: LayoutPlacing;
  /** Link whose route is being drawn by the route tool. */
  routingLinkId: Id | null;
  viewportRequest: ViewportRequest | null;
  /** Floor grid snap in mm (0 = off). */
  snapMm: number;
}

export interface Viewer3dUi {
  showDoors: boolean;
  showOverhead: boolean;
  showUnderfloor: boolean;
  showCables: boolean;
  showAirwires: boolean;
  showRaisedFloor: boolean;
  /** Walk (WASD) mode instead of orbit. */
  walkMode: boolean;
  /** Frame the current selection; the viewer clears it after handling. */
  frameRequest: boolean;
}

export interface UiState {
  activeTab: EditorId;
  activeSheetId: Id;
  /** Cross-editor selection: an item selected anywhere is highlighted everywhere. */
  selection: SelectionItem[];
  hovered: SelectionItem | null;
  schematic: SchematicUi;
  layout: LayoutUi;
  viewer3d: Viewer3dUi;
  issues: Record<IssueDomain, Issue[]>;
  issuesDrawerOpen: boolean;
  /** e.g. 'update-layout', 'assign-models', 'fabric', 'place-by-rule', 'project-picker', 'custom-device'. */
  activeDialog: string | null;
  /** Optional payload for the active dialog (ids to edit, etc.). */
  dialogData: unknown;
  lastError: string | null;
}

export interface SelectOptions {
  /** Add to the current selection instead of replacing it. */
  additive?: boolean;
  /** Flip membership of each item (shift-click). Implies additive. */
  toggle?: boolean;
}

export const initialUi = (): UiState => ({
  activeTab: 'schematic',
  activeSheetId: ROOT_SHEET_ID,
  selection: [],
  hovered: null,
  schematic: {
    placing: null,
    tool: 'select',
    viewportRequest: null,
    assignFocus: null,
  },
  layout: {
    view: 'floor',
    activeLayer: 'overhead',
    visibleLayers: { overhead: true, underfloor: true, 'in-rack': true },
    ratsnest: 'all',
    elevationRackIds: [],
    elevationFace: 'front',
    elevationFollowsSelection: true,
    tool: 'select',
    placing: null,
    routingLinkId: null,
    viewportRequest: null,
    snapMm: 100,
  },
  viewer3d: {
    showDoors: true,
    showOverhead: true,
    showUnderfloor: true,
    showCables: true,
    showAirwires: true,
    showRaisedFloor: true,
    walkMode: false,
    frameRequest: false,
  },
  issues: { erc: [], drc: [] },
  issuesDrawerOpen: false,
  activeDialog: null,
  dialogData: undefined,
  lastError: null,
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface StoreState {
  project: Project;
  history: History;
  ui: UiState;

  /** Run a command. Returns false when it changed nothing or threw (see ui.lastError). */
  execute(cmd: Command, now?: number): boolean;
  undo(editor: EditorId): boolean;
  redo(editor: EditorId): boolean;
  canUndo(editor: EditorId): boolean;
  canRedo(editor: EditorId): boolean;
  undoLabel(editor: EditorId): string | null;
  redoLabel(editor: EditorId): string | null;
  /** Swap in a loaded project; clears history, selection and issues. */
  replaceProject(project: Project): void;
  /** Not undoable: project name / revision. */
  setProjectMeta(meta: { name?: string; rev?: string }): void;

  setActiveTab(tab: EditorId): void;
  setActiveSheet(sheetId: Id): void;
  select(items: SelectionItem | readonly SelectionItem[], opts?: SelectOptions): void;
  clearSelection(): void;
  setHovered(item: SelectionItem | null): void;
  setLayoutView(view: LayoutView): void;
  setActiveLayer(layer: RoutingLayer): void;
  toggleLayerVisible(layer: RoutingLayer, visible?: boolean): void;
  setRatsnestMode(mode: RatsnestMode): void;
  setElevationRacks(rackIds: readonly Id[], face?: Face): void;
  setElevationFace(face: Face): void;
  setViewer3dOption(key: keyof Viewer3dUi, value: boolean): void;
  toggleViewer3dOption(key: keyof Viewer3dUi): void;
  setIssues(domain: IssueDomain, issues: Issue[]): void;
  setIssuesDrawerOpen(open: boolean): void;
  toggleIssuesDrawer(): void;
  openDialog(id: string, data?: unknown): void;
  closeDialog(): void;
  setLastError(message: string | null): void;
  /** Escape hatch for UI fields without a dedicated setter. */
  patchUi(partial: Partial<UiState>): void;
  patchSchematic(partial: Partial<SchematicUi>): void;
  patchLayout(partial: Partial<LayoutUi>): void;
  patchViewer3d(partial: Partial<Viewer3dUi>): void;
  /** Ask an editor to move its viewport (fit / rect / items). */
  requestViewport(editor: 'schematic' | 'layout', request: ViewportRequest | null): void;
  /** Select items and bring them into view in the editor that owns them. */
  revealSelection(items: readonly SelectionItem[], editor?: EditorId): void;
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Prune selection/hover that point at objects the new project no longer has. */
function uiAfterProjectChange(ui: UiState, project: Project): UiState {
  const selection = pruneSelection(project, ui.selection);
  const hovered = ui.hovered && !selectionItemExists(project, ui.hovered) ? null : ui.hovered;
  if (selection === ui.selection && hovered === ui.hovered) return ui;
  return { ...ui, selection, hovered };
}

export const useStore = create<StoreState>()((set, get) => {
  const applyStep = (step: StepResult): boolean => {
    if (!step.changed) return false;
    set((s) => ({
      project: step.project,
      history: step.history,
      ui: uiAfterProjectChange(s.ui, step.project),
    }));
    return true;
  };
  const patchUi = (partial: Partial<UiState>) => set((s) => ({ ui: { ...s.ui, ...partial } }));
  const patchLayout = (partial: Partial<LayoutUi>) =>
    set((s) => ({ ui: { ...s.ui, layout: { ...s.ui.layout, ...partial } } }));
  const patchSchematic = (partial: Partial<SchematicUi>) =>
    set((s) => ({ ui: { ...s.ui, schematic: { ...s.ui.schematic, ...partial } } }));
  const patchViewer3d = (partial: Partial<Viewer3dUi>) =>
    set((s) => ({ ui: { ...s.ui, viewer3d: { ...s.ui.viewer3d, ...partial } } }));

  return {
    project: createProject('Untitled'),
    history: emptyHistory(),
    ui: initialUi(),

    execute: (cmd, now) => {
      const { project, history } = get();
      let step: StepResult;
      try {
        step = executeCommand(project, history, cmd, now);
      } catch (err) {
        patchUi({ lastError: errorMessage(err) });
        return false;
      }
      return applyStep(step);
    },
    undo: (editor) => {
      const { project, history } = get();
      return applyStep(undoCommand(project, history, editor));
    },
    redo: (editor) => {
      const { project, history } = get();
      return applyStep(redoCommand(project, history, editor));
    },
    canUndo: (editor) => canUndoHistory(get().history, editor),
    canRedo: (editor) => canRedoHistory(get().history, editor),
    undoLabel: (editor) => undoLabelOf(get().history, editor),
    redoLabel: (editor) => redoLabelOf(get().history, editor),

    replaceProject: (project) =>
      set((s) => {
        const rootSheet = project.sheets.find((sh) => sh.parentId === null) ?? project.sheets[0];
        return {
          project,
          history: emptyHistory(),
          ui: {
            ...s.ui,
            activeSheetId: rootSheet?.id ?? ROOT_SHEET_ID,
            selection: [],
            hovered: null,
            issues: { erc: [], drc: [] },
            lastError: null,
          },
        };
      }),
    setProjectMeta: (meta) =>
      set((s) => ({
        project: {
          ...s.project,
          ...(meta.name !== undefined ? { name: meta.name } : {}),
          ...(meta.rev !== undefined ? { rev: meta.rev } : {}),
        },
      })),

    setActiveTab: (activeTab) => patchUi({ activeTab }),
    setActiveSheet: (activeSheetId) => patchUi({ activeSheetId }),
    select: (items, opts) => {
      const list = Array.isArray(items) ? (items as readonly SelectionItem[]) : [items as SelectionItem];
      set((s) => {
        const current = s.ui.selection;
        const next = opts?.toggle
          ? toggleSelection(current, list)
          : opts?.additive
            ? mergeSelection(current, list)
            : dedupeSelection(list);
        return next === current ? s : { ui: { ...s.ui, selection: next } };
      });
    },
    clearSelection: () => set((s) => (s.ui.selection.length === 0 ? s : { ui: { ...s.ui, selection: [] } })),
    setHovered: (hovered) => set((s) => (s.ui.hovered === hovered ? s : { ui: { ...s.ui, hovered } })),
    setLayoutView: (view) => patchLayout({ view }),
    setActiveLayer: (activeLayer) => patchLayout({ activeLayer }),
    toggleLayerVisible: (layer, visible) =>
      set((s) => {
        const layers = s.ui.layout.visibleLayers;
        const next = visible ?? !layers[layer];
        return { ui: { ...s.ui, layout: { ...s.ui.layout, visibleLayers: { ...layers, [layer]: next } } } };
      }),
    setRatsnestMode: (ratsnest) => patchLayout({ ratsnest }),
    setElevationRacks: (rackIds, face) =>
      patchLayout({ elevationRackIds: [...rackIds], ...(face !== undefined ? { elevationFace: face } : {}) }),
    setElevationFace: (elevationFace) => patchLayout({ elevationFace }),
    setViewer3dOption: (key, value) =>
      set((s) => ({ ui: { ...s.ui, viewer3d: { ...s.ui.viewer3d, [key]: value } } })),
    toggleViewer3dOption: (key) =>
      set((s) => ({ ui: { ...s.ui, viewer3d: { ...s.ui.viewer3d, [key]: !s.ui.viewer3d[key] } } })),
    setIssues: (domain, issues) => set((s) => ({ ui: { ...s.ui, issues: { ...s.ui.issues, [domain]: issues } } })),
    setIssuesDrawerOpen: (issuesDrawerOpen) => patchUi({ issuesDrawerOpen }),
    toggleIssuesDrawer: () => set((s) => ({ ui: { ...s.ui, issuesDrawerOpen: !s.ui.issuesDrawerOpen } })),
    openDialog: (activeDialog, dialogData) => patchUi({ activeDialog, dialogData }),
    closeDialog: () => patchUi({ activeDialog: null, dialogData: undefined }),
    setLastError: (lastError) => patchUi({ lastError }),
    patchUi,
    patchSchematic,
    patchLayout,
    patchViewer3d,
    requestViewport: (editor, request) =>
      editor === 'schematic' ? patchSchematic({ viewportRequest: request }) : patchLayout({ viewportRequest: request }),
    revealSelection: (items, editor) => {
      const list = dedupeSelection(items);
      const target: EditorId =
        editor ??
        (list.some((i) => i.kind === 'rack' || i.kind === 'tray' || i.kind === 'waypoint' || i.kind === 'keepout' || i.kind === 'accessory')
          ? 'layout'
          : 'schematic');
      set((s) => ({ ui: { ...s.ui, selection: list, activeTab: target } }));
      if (target === 'viewer3d') patchViewer3d({ frameRequest: true });
      else if (target === 'schematic') patchSchematic({ viewportRequest: { kind: 'items', items: list } });
      else patchLayout({ viewportRequest: { kind: 'items', items: list } });
    },
  };
});

/** Imperative access for non-React code: store.getState(), store.setState(), store.subscribe(). */
export const store: StoreApi<StoreState> = useStore;

declare global {
  interface Window {
    /** Dev/e2e hook: the live store. */
    __dcStore?: StoreApi<StoreState>;
  }
}
if (typeof window !== 'undefined') window.__dcStore = store;

// ---------------------------------------------------------------------------
// Selector hooks
// ---------------------------------------------------------------------------

export const useProject = (): Project => useStore((s) => s.project);
/** Memoised ProjectIndex for the current project. */
export const useProjectIndex = (): ProjectIndex => indexProject(useStore((s) => s.project));
export const useUi = (): UiState => useStore((s) => s.ui);
export const useSelection = (): SelectionItem[] => useStore((s) => s.ui.selection);
export const useIsSelected = (item: SelectionItem | null | undefined): boolean =>
  useStore((s) => (item ? isSelected(s.ui.selection, item) : false));
export const useHovered = (): SelectionItem | null => useStore((s) => s.ui.hovered);
export const useActiveTab = (): EditorId => useStore((s) => s.ui.activeTab);
export const useActiveSheetId = (): Id => useStore((s) => s.ui.activeSheetId);
export const useCanUndo = (editor: EditorId): boolean => useStore((s) => canUndoHistory(s.history, editor));
export const useCanRedo = (editor: EditorId): boolean => useStore((s) => canRedoHistory(s.history, editor));
export const useUndoLabel = (editor: EditorId): string | null => useStore((s) => undoLabelOf(s.history, editor));
export const useRedoLabel = (editor: EditorId): string | null => useStore((s) => redoLabelOf(s.history, editor));
export const useActiveDialog = (): string | null => useStore((s) => s.ui.activeDialog);
export const useSchematicUi = (): SchematicUi => useStore((s) => s.ui.schematic);
export const useLayoutUi = (): LayoutUi => useStore((s) => s.ui.layout);
export const useViewer3dUi = (): Viewer3dUi => useStore((s) => s.ui.viewer3d);
export const useIssues = (domain: IssueDomain): Issue[] => useStore((s) => s.ui.issues[domain]);
