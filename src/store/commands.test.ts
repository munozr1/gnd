import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { createComponent, createProject, ROOT_SHEET_ID } from '@/model/factories';
import type { Project } from '@/model/types';
import {
  canRedoHistory,
  canUndoHistory,
  command,
  COALESCE_WINDOW_MS,
  emptyHistory,
  executeCommand,
  HISTORY_CAP,
  redoCommand,
  redoLabelOf,
  transaction,
  undoCommand,
  undoLabelOf,
  type History,
} from './commands';

const leaf = builtinCatalog.symbols.find((s) => s.id === 'sym.leaf-switch-48x25-8x100')!;

const addComponent = (name: string) =>
  command('Add component', 'schematic', (draft) => {
    draft.components.push(createComponent(leaf, { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: name }));
  });

const move = (i: number, x: number, key = 'move') =>
  command('Move', 'schematic', (draft) => {
    draft.components[i]!.sch.pos.x = x;
  }, key);

function run(project: Project, history: History, ...cmds: Parameters<typeof executeCommand>[2][]) {
  let now = 10_000;
  for (const c of cmds) {
    const r = executeCommand(project, history, c, (now += COALESCE_WINDOW_MS * 2));
    project = r.project;
    history = r.history;
  }
  return { project, history };
}

describe('executeCommand / undo / redo', () => {
  it('applies the mutation and records one history entry', () => {
    const p0 = createProject('t', '2026-01-01T00:00:00.000Z');
    const r = executeCommand(p0, emptyHistory(), addComponent('SW1'), 1);
    expect(r.changed).toBe(true);
    expect(r.label).toBe('Add component');
    expect(r.project.components).toHaveLength(1);
    expect(p0.components).toHaveLength(0);
    expect(r.history.schematic.undo).toHaveLength(1);
    expect(r.history.schematic.redo).toHaveLength(0);
    expect(r.history.layout.undo).toHaveLength(0);
    expect(undoLabelOf(r.history, 'schematic')).toBe('Add component');
  });

  it('undo restores the exact prior state and redo re-applies it', () => {
    const p0 = createProject('t', '2026-01-01T00:00:00.000Z');
    const a = run(p0, emptyHistory(), addComponent('SW1'), addComponent('SW2'), move(0, 120));
    expect(a.project.components[0]!.sch.pos.x).toBe(120);

    const u1 = undoCommand(a.project, a.history, 'schematic');
    expect(u1.label).toBe('Move');
    expect(u1.project.components[0]!.sch.pos.x).toBe(0);
    expect(redoLabelOf(u1.history, 'schematic')).toBe('Move');

    const u2 = undoCommand(u1.project, u1.history, 'schematic');
    const u3 = undoCommand(u2.project, u2.history, 'schematic');
    expect(u3.project).toEqual(p0);
    expect(canUndoHistory(u3.history, 'schematic')).toBe(false);
    expect(canRedoHistory(u3.history, 'schematic')).toBe(true);

    const u4 = undoCommand(u3.project, u3.history, 'schematic');
    expect(u4.changed).toBe(false);
    expect(u4.project).toBe(u3.project);

    let r = redoCommand(u3.project, u3.history, 'schematic');
    r = redoCommand(r.project, r.history, 'schematic');
    r = redoCommand(r.project, r.history, 'schematic');
    expect(r.project).toEqual(a.project);
    expect(canRedoHistory(r.history, 'schematic')).toBe(false);
    expect(redoCommand(r.project, r.history, 'schematic').changed).toBe(false);
  });

  it('a new command clears the redo stack of its editor only', () => {
    const p0 = createProject('t');
    const a = run(p0, emptyHistory(), addComponent('SW1'));
    const l = executeCommand(
      a.project,
      a.history,
      command('Grid', 'layout', (d) => {
        d.room.gridMm = 610;
      }),
      1,
    );
    const lu = undoCommand(l.project, l.history, 'layout');
    expect(lu.history.layout.redo).toHaveLength(1);
    const s = executeCommand(lu.project, lu.history, addComponent('SW2'), 2);
    expect(s.history.layout.redo).toHaveLength(1);
    expect(s.history.schematic.redo).toHaveLength(0);
  });

  it('a command that changes nothing does not create an entry', () => {
    const p0 = createProject('t');
    const r = executeCommand(p0, emptyHistory(), command('noop', 'schematic', () => {}), 1);
    expect(r.changed).toBe(false);
    expect(r.project).toBe(p0);
    expect(r.history.schematic.undo).toHaveLength(0);
  });

  it('rejects commands targeting the read-only 3D viewer and leaves inputs untouched', () => {
    const p0 = createProject('t');
    const h = emptyHistory();
    expect(() =>
      executeCommand(p0, h, command('x', 'viewer3d', (d) => {
        d.name = 'changed';
      })),
    ).toThrow(/read-only/);
    expect(p0.name).toBe('t');
    expect(undoCommand(p0, h, 'viewer3d').changed).toBe(false);
    expect(canUndoHistory(h, 'viewer3d')).toBe(false);
  });

  it('a throwing mutator leaves the project untouched', () => {
    const p0 = createProject('t');
    expect(() =>
      executeCommand(p0, emptyHistory(), command('boom', 'schematic', (d) => {
        d.name = 'partial';
        throw new Error('invariant');
      })),
    ).toThrow('invariant');
    expect(p0.name).toBe('t');
  });
});

describe('per-editor history', () => {
  it('schematic and layout stacks are independent', () => {
    const p0 = createProject('t');
    const s = executeCommand(p0, emptyHistory(), addComponent('SW1'), 1);
    const l = executeCommand(
      s.project,
      s.history,
      command('Grid', 'layout', (d) => {
        d.room.gridMm = 610;
      }),
      2,
    );
    expect(l.history.schematic.undo).toHaveLength(1);
    expect(l.history.layout.undo).toHaveLength(1);

    const u = undoCommand(l.project, l.history, 'layout');
    expect(u.project.room.gridMm).toBe(600);
    expect(u.project.components).toHaveLength(1);
    expect(u.history.schematic.undo).toHaveLength(1);
    expect(u.history.layout.undo).toHaveLength(0);

    const u2 = undoCommand(u.project, u.history, 'schematic');
    expect(u2.project.components).toHaveLength(0);
    expect(u2.history.layout.redo).toHaveLength(1);
  });
});

describe('coalescing', () => {
  it('merges consecutive same-key commands within the window into one entry', () => {
    const p0 = createProject('t');
    let r = executeCommand(p0, emptyHistory(), addComponent('SW1'), 1000);
    r = executeCommand(r.project, r.history, move(0, 10), 2000);
    r = executeCommand(r.project, r.history, move(0, 20), 2000 + 100);
    r = executeCommand(r.project, r.history, move(0, 30), 2000 + 400);
    expect(r.project.components[0]!.sch.pos.x).toBe(30);
    expect(r.history.schematic.undo).toHaveLength(2);

    const u = undoCommand(r.project, r.history, 'schematic');
    expect(u.project.components[0]!.sch.pos.x).toBe(0);
    const re = redoCommand(u.project, u.history, 'schematic');
    expect(re.project.components[0]!.sch.pos.x).toBe(30);
  });

  it('does not merge outside the window, across keys, or without a key', () => {
    const p0 = createProject('t');
    let r = executeCommand(p0, emptyHistory(), addComponent('SW1'), 1000);
    r = executeCommand(r.project, r.history, move(0, 10), 2000);
    r = executeCommand(r.project, r.history, move(0, 20), 2000 + COALESCE_WINDOW_MS + 1);
    expect(r.history.schematic.undo).toHaveLength(3);
    r = executeCommand(r.project, r.history, move(0, 30, 'other'), 2000 + COALESCE_WINDOW_MS + 2);
    expect(r.history.schematic.undo).toHaveLength(4);
    r = executeCommand(
      r.project,
      r.history,
      command('Move', 'schematic', (d) => {
        d.components[0]!.sch.pos.x = 40;
      }),
      2000 + COALESCE_WINDOW_MS + 3,
    );
    expect(r.history.schematic.undo).toHaveLength(5);
  });

  it('never merges into an entry that was redone', () => {
    const p0 = createProject('t');
    let r = executeCommand(p0, emptyHistory(), addComponent('SW1'), 1000);
    r = executeCommand(r.project, r.history, move(0, 10), 2000);
    const u = undoCommand(r.project, r.history, 'schematic');
    const re = redoCommand(u.project, u.history, 'schematic');
    const after = executeCommand(re.project, re.history, move(0, 20), 2001);
    expect(after.history.schematic.undo).toHaveLength(3);
  });
});

describe('transaction', () => {
  it('runs several mutators as one undoable entry', () => {
    const p0 = createProject('t');
    const tx = transaction('Add two', 'schematic', [
      (d) => d.components.push(createComponent(leaf, { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: 'SW1' })),
      (d) => d.components.push(createComponent(leaf, { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: 'SW2' })),
      (d) => {
        d.name = 'renamed';
      },
    ]);
    const r = executeCommand(p0, emptyHistory(), tx, 1);
    expect(r.project.components.map((c) => c.ref)).toEqual(['SW1', 'SW2']);
    expect(r.project.name).toBe('renamed');
    expect(r.history.schematic.undo).toHaveLength(1);
    const u = undoCommand(r.project, r.history, 'schematic');
    expect(u.project).toEqual(p0);
  });
});

describe('history cap', () => {
  it(`keeps at most ${HISTORY_CAP} entries per editor, dropping the oldest`, () => {
    const p0 = createProject('t');
    let project = p0;
    let history = emptyHistory();
    for (let i = 0; i < HISTORY_CAP + 25; i++) {
      const r = executeCommand(
        project,
        history,
        command(`set ${i}`, 'schematic', (d) => {
          d.room.gridMm = i;
        }),
        i * 1000,
      );
      project = r.project;
      history = r.history;
    }
    expect(history.schematic.undo).toHaveLength(HISTORY_CAP);
    expect(history.schematic.undo[0]!.label).toBe('set 25');
    // Undo everything that is left; we land on the state after the dropped commands.
    for (let i = 0; i < HISTORY_CAP; i++) {
      const u = undoCommand(project, history, 'schematic');
      project = u.project;
      history = u.history;
    }
    expect(project.room.gridMm).toBe(24);
    expect(canUndoHistory(history, 'schematic')).toBe(false);
  });
});
