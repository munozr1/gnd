import { beforeEach, describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { createComponent, createLink, createProject, createRack, ROOT_SHEET_ID } from '@/model/factories';
import type { SelectionItem } from '@/model/types';
import { command, emptyHistory, initialUi, isSelected, store, transaction, useStore } from './index';

const leaf = builtinCatalog.symbols.find((s) => s.id === 'sym.leaf-switch-48x25-8x100')!;
const server = builtinCatalog.symbols.find((s) => s.id === 'sym.server-1u')!;
const rackDef = builtinCatalog.racks.find((r) => r.id === 'rack.standard-42u')!;

const reset = () =>
  useStore.setState({ project: createProject('Untitled', '2026-01-01T00:00:00.000Z'), history: emptyHistory(), ui: initialUi() });

const addComponent = (ref: string) =>
  command('Add component', 'schematic', (d) => {
    d.components.push(createComponent(leaf, { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref }));
  });

beforeEach(reset);

describe('store: commands', () => {
  it('starts with an untitled project, empty history and default ui', () => {
    const s = store.getState();
    expect(s.project.name).toBe('Untitled');
    expect(s.project.sheets[0]!.id).toBe(ROOT_SHEET_ID);
    expect(s.canUndo('schematic')).toBe(false);
    expect(s.ui.activeTab).toBe('schematic');
    expect(s.ui.activeSheetId).toBe(ROOT_SHEET_ID);
  });

  it('execute / undo / redo restore exact state', () => {
    const before = store.getState().project;
    expect(store.getState().execute(addComponent('SW1'))).toBe(true);
    expect(store.getState().execute(addComponent('SW2'))).toBe(true);
    const after = store.getState().project;
    expect(after.components.map((c) => c.ref)).toEqual(['SW1', 'SW2']);
    expect(store.getState().undoLabel('schematic')).toBe('Add component');

    expect(store.getState().undo('schematic')).toBe(true);
    expect(store.getState().undo('schematic')).toBe(true);
    expect(store.getState().project).toEqual(before);
    expect(store.getState().undo('schematic')).toBe(false);

    expect(store.getState().redo('schematic')).toBe(true);
    expect(store.getState().redo('schematic')).toBe(true);
    expect(store.getState().project).toEqual(after);
    expect(store.getState().redo('schematic')).toBe(false);
  });

  it('the project object is frozen after a command (mutations must be commands)', () => {
    store.getState().execute(addComponent('SW1'));
    expect(Object.isFrozen(store.getState().project)).toBe(true);
    expect(Object.isFrozen(store.getState().project.components[0])).toBe(true);
  });

  it('keeps independent stacks per editor', () => {
    const s = store.getState();
    s.execute(addComponent('SW1'));
    s.execute(
      command('Add rack', 'layout', (d) => {
        d.racks.push(createRack(rackDef, { name: 'A1', pos: { x: 0, y: 0 } }));
      }),
    );
    expect(store.getState().canUndo('schematic')).toBe(true);
    expect(store.getState().canUndo('layout')).toBe(true);
    expect(store.getState().canUndo('viewer3d')).toBe(false);

    store.getState().undo('layout');
    expect(store.getState().project.racks).toHaveLength(0);
    expect(store.getState().project.components).toHaveLength(1);
    expect(store.getState().canRedo('layout')).toBe(true);
    expect(store.getState().canUndo('schematic')).toBe(true);
    expect(store.getState().canRedo('schematic')).toBe(false);
  });

  it('coalesces drag-style commands passed a `now` within the window', () => {
    const s = store.getState();
    s.execute(addComponent('SW1'), 1000);
    for (let i = 1; i <= 5; i++) {
      s.execute(
        command('Move', 'schematic', (d) => {
          d.components[0]!.sch.pos.x = i * 10;
        }, 'drag:SW1'),
        2000 + i * 50,
      );
    }
    expect(store.getState().project.components[0]!.sch.pos.x).toBe(50);
    expect(store.getState().history.schematic.undo).toHaveLength(2);
    store.getState().undo('schematic');
    expect(store.getState().project.components[0]!.sch.pos.x).toBe(0);
  });

  it('a transaction is a single undo step', () => {
    store.getState().execute(
      transaction('Add pair', 'schematic', [
        (d) => d.components.push(createComponent(leaf, { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: 'SW1' })),
        (d) => d.components.push(createComponent(server, { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: 'SRV1' })),
      ]),
    );
    expect(store.getState().project.components).toHaveLength(2);
    expect(store.getState().history.schematic.undo).toHaveLength(1);
    store.getState().undo('schematic');
    expect(store.getState().project.components).toHaveLength(0);
  });

  it('records lastError and returns false when a command throws or targets viewer3d', () => {
    const before = store.getState().project;
    expect(
      store.getState().execute(
        command('boom', 'schematic', () => {
          throw new Error('port already used');
        }),
      ),
    ).toBe(false);
    expect(store.getState().ui.lastError).toBe('port already used');
    expect(store.getState().project).toBe(before);

    store.getState().setLastError(null);
    expect(store.getState().execute(command('x', 'viewer3d', () => {}))).toBe(false);
    expect(store.getState().ui.lastError).toMatch(/read-only/);
  });

  it('replaceProject swaps the project and clears history, selection and issues', () => {
    store.getState().execute(addComponent('SW1'));
    const id = store.getState().project.components[0]!.id;
    store.getState().select({ kind: 'component', id });
    store.getState().setIssues('erc', [
      { id: 'i1', rule: 'r', severity: 'error', message: 'm', targets: [], domain: 'erc' },
    ]);

    const loaded = createProject('Loaded');
    loaded.sheets = [{ id: 'sheetX', name: 'Root', parentId: null }];
    store.getState().replaceProject(loaded);

    const s = store.getState();
    expect(s.project).toBe(loaded);
    expect(s.canUndo('schematic')).toBe(false);
    expect(s.canRedo('schematic')).toBe(false);
    expect(s.ui.selection).toEqual([]);
    expect(s.ui.issues.erc).toEqual([]);
    expect(s.ui.activeSheetId).toBe('sheetX');
  });

  it('setProjectMeta updates name/rev without touching history', () => {
    store.getState().execute(addComponent('SW1'));
    store.getState().setProjectMeta({ name: 'DC-1', rev: 'B' });
    expect(store.getState().project.name).toBe('DC-1');
    expect(store.getState().project.rev).toBe('B');
    expect(store.getState().history.schematic.undo).toHaveLength(1);
    store.getState().undo('schematic');
    expect(store.getState().project.name).toBe('DC-1');
    expect(store.getState().project.components).toHaveLength(0);
  });
});

describe('store: ui slice', () => {
  it('select replaces, adds and toggles; clearSelection empties', () => {
    const a: SelectionItem = { kind: 'component', id: 'a' };
    const b: SelectionItem = { kind: 'link', id: 'b' };
    const s = store.getState();
    s.select(a);
    expect(store.getState().ui.selection).toEqual([a]);
    s.select([b], { additive: true });
    expect(store.getState().ui.selection).toEqual([a, b]);
    s.select([a, a], { additive: true });
    expect(store.getState().ui.selection).toEqual([a, b]);
    s.select(a, { toggle: true });
    expect(store.getState().ui.selection).toEqual([b]);
    s.select(a, { toggle: true });
    expect(store.getState().ui.selection).toEqual([b, a]);
    expect(isSelected(store.getState().ui.selection, a)).toBe(true);
    s.select([b]);
    expect(store.getState().ui.selection).toEqual([b]);
    s.clearSelection();
    expect(store.getState().ui.selection).toEqual([]);
  });

  it('prunes selection and hover for objects removed by a command or undo', () => {
    const s = store.getState();
    s.execute(addComponent('SW1'));
    s.execute(addComponent('SW2'));
    const [c1, c2] = store.getState().project.components;
    s.execute(
      command('Link', 'schematic', (d) => {
        d.links.push(createLink({ componentId: c1!.id, portId: 'eth1/49' }, { componentId: c2!.id, portId: 'eth1/49' }));
      }),
    );
    const linkId = store.getState().project.links[0]!.id;
    s.select([
      { kind: 'component', id: c1!.id },
      { kind: 'component', id: c2!.id },
      { kind: 'link', id: linkId },
    ]);
    s.setHovered({ kind: 'link', id: linkId });

    s.undo('schematic'); // removes the link
    expect(store.getState().ui.selection).toEqual([
      { kind: 'component', id: c1!.id },
      { kind: 'component', id: c2!.id },
    ]);
    expect(store.getState().ui.hovered).toBeNull();

    s.execute(
      command('Delete SW2', 'schematic', (d) => {
        d.components = d.components.filter((c) => c.id !== c2!.id);
      }),
    );
    expect(store.getState().ui.selection).toEqual([{ kind: 'component', id: c1!.id }]);
  });

  it('layout, viewer3d, dialog and issue setters', () => {
    const s = store.getState();
    s.setActiveTab('layout');
    s.setActiveSheet('sheet-2');
    s.setLayoutView('split');
    s.setActiveLayer('underfloor');
    s.toggleLayerVisible('overhead');
    s.toggleLayerVisible('in-rack', false);
    s.setRatsnestMode('selection');
    s.setElevationRacks(['r1', 'r2'], 'rear');
    s.setViewer3dOption('showDoors', false);
    s.toggleViewer3dOption('showCables');
    s.setIssues('drc', [{ id: 'd1', rule: 'reach', severity: 'warning', message: 'too long', targets: [], domain: 'drc' }]);
    s.setIssuesDrawerOpen(true);
    s.openDialog('update-layout', { plan: 1 });

    const ui = store.getState().ui;
    expect(ui.activeTab).toBe('layout');
    expect(ui.activeSheetId).toBe('sheet-2');
    expect(ui.layout.view).toBe('split');
    expect(ui.layout.activeLayer).toBe('underfloor');
    expect(ui.layout.visibleLayers).toEqual({ overhead: false, underfloor: true, 'in-rack': false });
    expect(ui.layout.ratsnest).toBe('selection');
    expect(ui.layout.elevationRackIds).toEqual(['r1', 'r2']);
    expect(ui.layout.elevationFace).toBe('rear');
    expect(ui.viewer3d.showDoors).toBe(false);
    expect(ui.viewer3d.showCables).toBe(false);
    expect(ui.issues.drc).toHaveLength(1);
    expect(ui.issuesDrawerOpen).toBe(true);
    expect(ui.activeDialog).toBe('update-layout');
    expect(ui.dialogData).toEqual({ plan: 1 });

    s.closeDialog();
    s.toggleIssuesDrawer();
    expect(store.getState().ui.activeDialog).toBeNull();
    expect(store.getState().ui.dialogData).toBeUndefined();
    expect(store.getState().ui.issuesDrawerOpen).toBe(false);
  });

  it('ui changes are not undoable and leave the project untouched', () => {
    const before = store.getState().project;
    store.getState().select({ kind: 'rack', id: 'x' });
    store.getState().setLayoutView('elevation');
    expect(store.getState().project).toBe(before);
    expect(store.getState().canUndo('schematic')).toBe(false);
    expect(store.getState().canUndo('layout')).toBe(false);
  });
});
