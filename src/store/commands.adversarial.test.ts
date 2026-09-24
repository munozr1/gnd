/**
 * Adversarial tests for the command / undo / redo layer: interleaved editors,
 * coalescing edge cases, the history cap and patch replay exactness.
 */
import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { createComponent, createLink, createProject, createRack, ROOT_SHEET_ID } from '@/model/factories';
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
  transaction,
  undoCommand,
  type Command,
  type History,
} from './commands';

const leaf = builtinCatalog.symbols.find((s) => s.id === 'sym.leaf-switch-48x25-8x100')!;
const rackDef = builtinCatalog.racks.find((r) => r.id === 'rack.standard-42u')!;

type State = { project: Project; history: History };

const addComponent = (ref: string, x = 0): Command =>
  command(`Add ${ref}`, 'schematic', (d) => {
    d.components.push(createComponent(leaf, { sheetId: ROOT_SHEET_ID, pos: { x, y: 0 }, ref }));
  });

const addRack = (name: string): Command =>
  command(`Add rack ${name}`, 'layout', (d) => {
    d.racks.push(createRack(rackDef, { name, pos: { x: 0, y: 0 } }));
  });

const moveComponent = (i: number, x: number, key?: string): Command =>
  command('Move component', 'schematic', (d) => {
    d.components[i]!.sch.pos.x = x;
  }, key);

const moveRack = (i: number, x: number, key?: string): Command =>
  command('Move rack', 'layout', (d) => {
    d.racks[i]!.pos.x = x;
  }, key);

const exec = (s: State, cmd: Command, now: number): State => {
  const r = executeCommand(s.project, s.history, cmd, now);
  return { project: r.project, history: r.history };
};
const undo = (s: State, editor: 'schematic' | 'layout'): State => {
  const r = undoCommand(s.project, s.history, editor);
  return { project: r.project, history: r.history };
};
const redo = (s: State, editor: 'schematic' | 'layout'): State => {
  const r = redoCommand(s.project, s.history, editor);
  return { project: r.project, history: r.history };
};

const fresh = (): State => ({ project: createProject('t', '2026-01-01T00:00:00.000Z'), history: emptyHistory() });

describe('interleaved editors', () => {
  it('undoing each editor in any order restores the exact original project', () => {
    const s0 = fresh();
    let s = s0;
    let t = 1000;
    s = exec(s, addComponent('SW1'), (t += 5000));
    s = exec(s, addRack('A1'), (t += 5000));
    s = exec(s, addComponent('SW2', 100), (t += 5000));
    s = exec(s, moveRack(0, 1200), (t += 5000));
    s = exec(s, moveComponent(0, 300), (t += 5000));
    s = exec(s, addRack('A2'), (t += 5000));
    const full = s.project;
    expect(s.history.schematic.undo).toHaveLength(3);
    expect(s.history.layout.undo).toHaveLength(3);

    // layout first, then schematic
    let a = s;
    for (let i = 0; i < 3; i++) a = undo(a, 'layout');
    expect(a.project.racks).toEqual([]);
    expect(a.project.components.map((c) => c.ref)).toEqual(['SW1', 'SW2']);
    expect(a.project.components[0]!.sch.pos.x).toBe(300);
    for (let i = 0; i < 3; i++) a = undo(a, 'schematic');
    expect(a.project).toEqual(s0.project);
    expect(canUndoHistory(a.history, 'schematic')).toBe(false);
    expect(canUndoHistory(a.history, 'layout')).toBe(false);

    // redo in the opposite interleaving lands on the same final project
    let b = a;
    b = redo(b, 'schematic');
    b = redo(b, 'layout');
    b = redo(b, 'layout');
    b = redo(b, 'schematic');
    b = redo(b, 'schematic');
    b = redo(b, 'layout');
    expect(b.project).toEqual(full);
    expect(canRedoHistory(b.history, 'schematic')).toBe(false);
    expect(canRedoHistory(b.history, 'layout')).toBe(false);

    // alternating undo
    let c = s;
    c = undo(c, 'schematic');
    c = undo(c, 'layout');
    c = undo(c, 'schematic');
    c = undo(c, 'layout');
    c = undo(c, 'schematic');
    c = undo(c, 'layout');
    expect(c.project).toEqual(s0.project);
  });

  it('a redo in one editor still applies after the other editor changed the project', () => {
    let s = fresh();
    s = exec(s, addComponent('SW1'), 1000);
    s = exec(s, addRack('A1'), 2000);
    s = undo(s, 'layout');
    s = exec(s, addComponent('SW2'), 3000);
    s = exec(s, moveComponent(1, 50), 9000);
    expect(canRedoHistory(s.history, 'layout')).toBe(true);
    s = redo(s, 'layout');
    expect(s.project.racks.map((r) => r.name)).toEqual(['A1']);
    expect(s.project.components.map((c) => c.ref)).toEqual(['SW1', 'SW2']);
    expect(s.project.components[1]!.sch.pos.x).toBe(50);
  });

  it('a schematic command never clears the layout redo stack and vice versa', () => {
    let s = fresh();
    s = exec(s, addComponent('SW1'), 1000);
    s = exec(s, addRack('A1'), 2000);
    s = undo(s, 'schematic');
    s = undo(s, 'layout');
    expect(canRedoHistory(s.history, 'schematic')).toBe(true);
    expect(canRedoHistory(s.history, 'layout')).toBe(true);
    s = exec(s, addComponent('SW9'), 3000);
    expect(canRedoHistory(s.history, 'schematic')).toBe(false);
    expect(canRedoHistory(s.history, 'layout')).toBe(true);
    s = redo(s, 'layout');
    expect(s.project.racks.map((r) => r.name)).toEqual(['A1']);
    expect(s.project.components.map((c) => c.ref)).toEqual(['SW9']);
    s = undo(s, 'layout');
    s = exec(s, addRack('B1'), 4000);
    expect(canRedoHistory(s.history, 'layout')).toBe(false);
    expect(canUndoHistory(s.history, 'schematic')).toBe(true);
    expect(s.project.racks.map((r) => r.name)).toEqual(['B1']);
  });
});

describe('coalescing edge cases', () => {
  it('merges at exactly the window boundary and not one ms later', () => {
    let s = fresh();
    s = exec(s, addComponent('SW1'), 1000);
    s = exec(s, moveComponent(0, 10, 'drag'), 5000);
    s = exec(s, moveComponent(0, 20, 'drag'), 5000 + COALESCE_WINDOW_MS);
    expect(s.history.schematic.undo).toHaveLength(2);
    s = exec(s, moveComponent(0, 30, 'drag'), 5000 + COALESCE_WINDOW_MS + COALESCE_WINDOW_MS + 1);
    expect(s.history.schematic.undo).toHaveLength(3);
  });

  it('the window slides: a long drag keeps merging as long as each step is within the window', () => {
    let s = fresh();
    s = exec(s, addComponent('SW1'), 1000);
    let t = 5000;
    for (let i = 1; i <= 20; i++) s = exec(s, moveComponent(0, i, 'drag'), (t += COALESCE_WINDOW_MS - 1));
    expect(s.history.schematic.undo).toHaveLength(2);
    expect(s.project.components[0]!.sch.pos.x).toBe(20);
    const u = undo(s, 'schematic');
    expect(u.project.components[0]!.sch.pos.x).toBe(0);
    expect(redo(u, 'schematic').project).toEqual(s.project);
  });

  it('does not merge when the clock goes backwards', () => {
    let s = fresh();
    s = exec(s, addComponent('SW1'), 1000);
    s = exec(s, moveComponent(0, 10, 'drag'), 5000);
    s = exec(s, moveComponent(0, 20, 'drag'), 4900);
    expect(s.history.schematic.undo).toHaveLength(3);
  });

  it('a merged entry that adds and then edits an object undoes and redoes exactly', () => {
    const s0 = fresh();
    let s = s0;
    s = exec(
      s,
      command('Place', 'schematic', (d) => {
        d.components.push(createComponent(leaf, { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: 'SW1' }));
      }, 'place'),
      1000,
    );
    s = exec(
      s,
      command('Place', 'schematic', (d) => {
        d.components[0]!.sch.pos = { x: 40, y: 60 };
        d.components[0]!.value = 'leaf-a';
      }, 'place'),
      1100,
    );
    s = exec(
      s,
      command('Place', 'schematic', (d) => {
        delete d.components[0]!.value;
        d.components[0]!.optics['eth1/49'] = 'xcvr.100g-sr4';
      }, 'place'),
      1200,
    );
    expect(s.history.schematic.undo).toHaveLength(1);
    const final = s.project;
    let u = undo(s, 'schematic');
    expect(u.project).toEqual(s0.project);
    expect(u.project.components).toHaveLength(0);
    let r = redo(u, 'schematic');
    expect(r.project).toEqual(final);
    u = undo(r, 'schematic');
    expect(u.project).toEqual(s0.project);
    r = redo(u, 'schematic');
    expect(r.project).toEqual(final);
  });

  it('a merged entry covering array splices replays exactly', () => {
    let s = fresh();
    s = exec(s, addComponent('SW1'), 1000);
    s = exec(s, addComponent('SW2'), 2000);
    s = exec(s, addComponent('SW3'), 3000);
    const before = s.project;
    s = exec(
      s,
      command('Delete', 'schematic', (d) => {
        d.components.splice(0, 1);
      }, 'del'),
      9000,
    );
    s = exec(
      s,
      command('Delete', 'schematic', (d) => {
        d.components.splice(1, 1);
      }, 'del'),
      9100,
    );
    s = exec(
      s,
      command('Delete', 'schematic', (d) => {
        d.components = d.components.filter((c) => c.ref !== 'SW2');
      }, 'del'),
      9200,
    );
    expect(s.project.components).toEqual([]);
    expect(s.history.schematic.undo).toHaveLength(4);
    const u = undo(s, 'schematic');
    expect(u.project).toEqual(before);
    expect(redo(u, 'schematic').project).toEqual(s.project);
  });

  it('does not merge into the entry exposed by an undo (an undone command intervened)', () => {
    let s = fresh();
    s = exec(s, addComponent('SW1'), 1000);
    s = exec(s, moveComponent(0, 10, 'nudge'), 5000);
    s = exec(
      s,
      command('Rotate', 'schematic', (d) => {
        d.components[0]!.sch.rotation = 90;
      }),
      5050,
    );
    s = undo(s, 'schematic');
    expect(s.project.components[0]!.sch.rotation).toBe(0);
    s = exec(s, moveComponent(0, 20, 'nudge'), 5100);
    // The two nudges were not consecutive commands: undo must revert only the second one.
    expect(s.history.schematic.undo).toHaveLength(3);
    const u = undo(s, 'schematic');
    expect(u.project.components[0]!.sch.pos.x).toBe(10);
  });

  it('a no-op command between two keyed commands does not break the chain or clear redo', () => {
    let s = fresh();
    s = exec(s, addComponent('SW1'), 1000);
    s = exec(s, addComponent('SW2'), 2000);
    s = undo(s, 'schematic');
    expect(canRedoHistory(s.history, 'schematic')).toBe(true);
    const r = executeCommand(s.project, s.history, command('noop', 'schematic', () => {}), 3000);
    expect(r.changed).toBe(false);
    expect(r.history).toBe(s.history);
    expect(canRedoHistory(r.history, 'schematic')).toBe(true);
  });

  it('a mutation that ends where it started produces no entry and keeps the project identity', () => {
    let s = fresh();
    s = exec(s, addComponent('SW1'), 1000);
    const r = executeCommand(
      s.project,
      s.history,
      command('wiggle', 'schematic', (d) => {
        d.components[0]!.sch.pos.x = 99;
        d.components[0]!.sch.pos.x = 0;
      }),
      2000,
    );
    expect(r.changed).toBe(false);
    expect(r.project).toBe(s.project);
    expect(r.history.schematic.undo).toHaveLength(1);
  });

  it('same key in different editors never merges across stacks', () => {
    let s = fresh();
    s = exec(s, addComponent('SW1'), 1000);
    s = exec(s, addRack('A1'), 1001);
    s = exec(s, moveComponent(0, 10, 'drag'), 2000);
    s = exec(s, moveRack(0, 10, 'drag'), 2010);
    s = exec(s, moveComponent(0, 20, 'drag'), 2020);
    s = exec(s, moveRack(0, 20, 'drag'), 2030);
    expect(s.history.schematic.undo).toHaveLength(2);
    expect(s.history.layout.undo).toHaveLength(2);
    const u = undo(undo(s, 'schematic'), 'layout');
    expect(u.project.components[0]!.sch.pos.x).toBe(0);
    expect(u.project.racks[0]!.pos.x).toBe(0);
  });
});

describe('history cap', () => {
  it('coalesced steps do not count against the cap and the cap never drops a merged tail', () => {
    let s = fresh();
    s = exec(s, addComponent('SW1'), 0);
    let t = 10_000;
    for (let i = 1; i < HISTORY_CAP; i++) s = exec(s, moveComponent(0, i, `k${i}`), (t += 10_000));
    expect(s.history.schematic.undo).toHaveLength(HISTORY_CAP);
    // 500 coalesced steps into the last entry: still HISTORY_CAP entries, oldest intact.
    for (let i = 0; i < 500; i++) s = exec(s, moveComponent(0, 1000 + i, `k${HISTORY_CAP - 1}`), (t += 10));
    expect(s.history.schematic.undo).toHaveLength(HISTORY_CAP);
    expect(s.history.schematic.undo[0]!.label).toBe('Add SW1');
    // One more distinct command evicts exactly the oldest.
    s = exec(s, moveComponent(0, -1, 'last'), (t += 10_000));
    expect(s.history.schematic.undo).toHaveLength(HISTORY_CAP);
    expect(s.history.schematic.undo[0]!.label).toBe('Move component');
    expect(s.history.schematic.undo[0]!.coalesceKey).toBe('k1');
  });

  it('undo + redo never grows a stack past the cap', () => {
    let s = fresh();
    for (let i = 0; i < HISTORY_CAP + 10; i++) {
      s = exec(
        s,
        command(`g${i}`, 'layout', (d) => {
          d.room.gridMm = 1000 + i;
        }),
        i * 1000,
      );
    }
    for (let i = 0; i < 50; i++) s = undo(s, 'layout');
    expect(s.history.layout.undo).toHaveLength(HISTORY_CAP - 50);
    expect(s.history.layout.redo).toHaveLength(50);
    for (let i = 0; i < 50; i++) s = redo(s, 'layout');
    expect(s.history.layout.undo).toHaveLength(HISTORY_CAP);
    expect(s.history.layout.redo).toHaveLength(0);
    expect(s.project.room.gridMm).toBe(1000 + HISTORY_CAP + 9);
  });
});

describe('atomicity and patch replay', () => {
  it('a transaction that throws midway applies nothing', () => {
    const s = fresh();
    const tx = transaction('Fabric', 'schematic', [
      (d) => d.components.push(createComponent(leaf, { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: 'SW1' })),
      () => {
        throw new Error('port already used');
      },
      (d) => d.components.push(createComponent(leaf, { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: 'SW2' })),
    ]);
    expect(() => executeCommand(s.project, s.history, tx, 1)).toThrow('port already used');
    expect(s.project.components).toHaveLength(0);
  });

  it('links and their routes across editors undo/redo exactly', () => {
    const s0 = fresh();
    let s = s0;
    s = exec(s, addComponent('SW1'), 1000);
    s = exec(s, addComponent('SW2'), 2000);
    s = exec(
      s,
      command('Link', 'schematic', (d) => {
        const [a, b] = d.components;
        d.links.push(createLink({ componentId: a!.id, portId: 'eth1/49' }, { componentId: b!.id, portId: 'eth1/49' }));
      }),
      3000,
    );
    const linkId = s.project.links[0]!.id;
    s = exec(
      s,
      command('Route', 'layout', (d) => {
        d.routes[linkId] = {
          linkId,
          aRack: { side: 'left', entry: null, pinned: false },
          bRack: { side: 'right', entry: null, pinned: false },
          segments: [{ layer: 'overhead', points: [{ id: 'w1', pos: { x: 1, y: 2 }, pinned: true }] }],
        };
      }),
      4000,
    );
    s = exec(
      s,
      command('Pin', 'layout', (d) => {
        d.routes[linkId]!.segments[0]!.points[0]!.pos = { x: 5, y: 6 };
        d.routes[linkId]!.needsReview = true;
      }, 'wp'),
      5000,
    );
    const full = s.project;
    let u = undo(s, 'layout');
    expect(u.project.routes[linkId]!.segments[0]!.points[0]!.pos).toEqual({ x: 1, y: 2 });
    expect(u.project.routes[linkId]!.needsReview).toBeUndefined();
    u = undo(u, 'layout');
    expect(u.project.routes).toEqual({});
    u = undo(u, 'schematic');
    expect(u.project.links).toEqual([]);
    let r = redo(u, 'layout');
    r = redo(r, 'layout');
    r = redo(r, 'schematic');
    expect(r.project).toEqual(full);
  });

  it('results are deeply frozen so accidental mutation throws in strict mode', () => {
    let s = fresh();
    s = exec(s, addComponent('SW1'), 1000);
    expect(Object.isFrozen(s.project.components[0]!.sch.pos)).toBe(true);
    const u = undo(s, 'schematic');
    expect(Object.isFrozen(u.project)).toBe(true);
    const r = redo(u, 'schematic');
    expect(Object.isFrozen(r.project.components[0])).toBe(true);
  });
});
