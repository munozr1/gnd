import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { routeJacket, trunkFixture } from '@/io/exports/test-fixtures';
import { resolveCable } from '@/model/cables';
import { createComponent, createLink, createProject, createRack, ROOT_SHEET_ID } from '@/model/factories';
import { routeOwner } from '@/model/routing';
import type { Project } from '@/model/types';
import {
  clearPersistence,
  deleteProject,
  downloadJson,
  getLastOpened,
  listProjects,
  loadProject,
  markProjectClean,
  parseProject,
  ProjectParseError,
  readJsonFile,
  saveProjectNow,
  serializeProject,
  setLastOpened,
  startAutosave,
  type ProjectStoreLike,
} from './index';
import { CURRENT_PROJECT_VERSION, migrate } from './migrations';

const leaf = builtinCatalog.symbols.find((s) => s.id === 'sym.leaf-switch-48x25-8x100')!;
const rackDef = builtinCatalog.racks.find((r) => r.id === 'rack.standard-42u')!;

/** A project with something in every layer so roundtrips are meaningful. */
function fixture(name = 'DC'): Project {
  const p = createProject(name, '2026-01-01T00:00:00.000Z');
  const a = createComponent(leaf, { sheetId: ROOT_SHEET_ID, pos: { x: 10, y: 20 }, ref: 'SW1' });
  const b = createComponent(leaf, { sheetId: ROOT_SHEET_ID, pos: { x: 300, y: 20 }, ref: 'SW2', value: 'leaf-b' });
  p.components.push(a, b);
  const link = createLink({ componentId: a.id, portId: 'eth1/49' }, { componentId: b.id, portId: 'eth1/49' }, 'cbl.om4-duplex');
  link.sch.wirePoints.push({ x: 150, y: 20 });
  p.links.push(link);
  const rack = createRack(rackDef, { name: 'A1', pos: { x: 600, y: 600 }, row: 'A' });
  p.racks.push(rack);
  p.placements.push({ componentId: a.id, rackId: rack.id, uPosition: 40, face: 'front' }, { componentId: b.id, rackId: null, uPosition: null, face: 'front' });
  p.routes[link.id] = {
    linkId: link.id,
    aRack: { side: 'left', entry: null, pinned: false },
    bRack: { side: 'right', entry: null, pinned: false },
    segments: [{ layer: 'overhead', points: [{ id: 'w1', pos: { x: 1, y: 2 }, pinned: true }] }],
  };
  p.settings.slackFraction = 0.2;
  return p;
}

/** Minimal store double with zustand-like subscribe semantics. */
function fakeStore(initial: Project): ProjectStoreLike & { set(project: Project): void } {
  let state = { project: initial };
  const listeners = new Set<(s: { project: Project }, prev: { project: Project }) => void>();
  return {
    getState: () => state,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    set: (project) => {
      const prev = state;
      state = { project };
      listeners.forEach((l) => l(state, prev));
    },
  };
}

beforeEach(async () => {
  await clearPersistence();
});

describe('IndexedDB persistence', () => {
  it('saves and loads a project exactly (except the save stamp)', async () => {
    const p = fixture();
    const saved = await saveProjectNow(p, '2026-02-02T00:00:00.000Z');
    expect(saved.updatedAt).toBe('2026-02-02T00:00:00.000Z');
    const loaded = await loadProject(p.id);
    expect(loaded).toEqual({ ...p, updatedAt: '2026-02-02T00:00:00.000Z' });
    expect(loaded).not.toBe(p);
  });

  it('returns null for unknown ids', async () => {
    expect(await loadProject('nope')).toBeNull();
  });

  it('maintains the picker index, newest first', async () => {
    const a = fixture('A');
    const b = fixture('B');
    await saveProjectNow(a, '2026-01-01T00:00:00.000Z');
    await saveProjectNow(b, '2026-01-02T00:00:00.000Z');
    expect((await listProjects()).map((s) => s.name)).toEqual(['B', 'A']);
    await saveProjectNow({ ...a, name: 'A2', rev: 'C' }, '2026-01-03T00:00:00.000Z');
    const list = await listProjects();
    expect(list.map((s) => s.name)).toEqual(['A2', 'B']);
    expect(list[0]).toEqual({ id: a.id, name: 'A2', rev: 'C', createdAt: a.createdAt, updatedAt: '2026-01-03T00:00:00.000Z' });
  });

  it('deleteProject removes the record, index entry and lastOpened', async () => {
    const a = fixture('A');
    await saveProjectNow(a);
    await setLastOpened(a.id);
    expect(await getLastOpened()).toBe(a.id);
    await deleteProject(a.id);
    expect(await loadProject(a.id)).toBeNull();
    expect(await listProjects()).toEqual([]);
    expect(await getLastOpened()).toBeNull();
  });

  it('lastOpened can be cleared', async () => {
    await setLastOpened('x');
    await setLastOpened(null);
    expect(await getLastOpened()).toBeNull();
  });
});

describe('autosave', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces project changes and writes after 1 s', async () => {
    const p0 = fixture('Auto');
    const s = fakeStore(p0);
    const onSaved = vi.fn();
    const handle = startAutosave(s, { onSaved });

    s.set({ ...p0, name: 'Auto 1' });
    await vi.advanceTimersByTimeAsync(600);
    s.set({ ...p0, name: 'Auto 2' });
    await vi.advanceTimersByTimeAsync(600);
    expect(handle.isPending()).toBe(true);
    expect(await listProjects()).toEqual([]);

    await vi.advanceTimersByTimeAsync(500);
    expect(handle.isPending()).toBe(false);
    await handle.flush(); // waits for the write the timer kicked off
    expect(onSaved).toHaveBeenCalledOnce();
    expect((await loadProject(p0.id))?.name).toBe('Auto 2');
    expect(await getLastOpened()).toBe(p0.id);
    handle.stop();
  });

  it('does not re-save a project that was just loaded, but does after an edit', async () => {
    const p0 = fixture('Loaded');
    await saveProjectNow(p0, '2026-01-01T00:00:00.000Z');
    const loaded = (await loadProject(p0.id))!;
    const s = fakeStore(createProject('Untitled'));
    const onSaved = vi.fn();
    const handle = startAutosave(s, { onSaved });

    s.set(loaded);
    await vi.advanceTimersByTimeAsync(1500);
    await handle.flush();
    expect(onSaved).not.toHaveBeenCalled();
    expect((await listProjects()).find((x) => x.id === p0.id)?.updatedAt).toBe('2026-01-01T00:00:00.000Z');

    s.set({ ...loaded, name: 'Edited' });
    await vi.advanceTimersByTimeAsync(1500);
    await handle.flush();
    expect(onSaved).toHaveBeenCalledOnce();
    expect((await loadProject(p0.id))?.name).toBe('Edited');
    handle.stop();
  });

  it('flushes pending edits when switching to another project, and on flush()', async () => {
    const a = fixture('A');
    const b = fixture('B');
    const s = fakeStore(a);
    const handle = startAutosave(s);
    s.set({ ...a, name: 'A edited' });
    await vi.advanceTimersByTimeAsync(100);
    s.set(b);
    expect(handle.isPending()).toBe(true); // b is now the pending one
    await handle.flush();
    expect((await loadProject(a.id))?.name).toBe('A edited');
    expect((await loadProject(b.id))?.name).toBe('B');
    expect(handle.isPending()).toBe(false);
    handle.stop();
  });

  it('stop() cancels a pending save and reports errors through onError', async () => {
    const a = fixture('A');
    const s = fakeStore(a);
    const handle = startAutosave(s);
    s.set({ ...a, name: 'never' });
    handle.stop();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await loadProject(a.id)).toBeNull();

    const onError = vi.fn();
    const bad = startAutosave(s, { onError });
    // A non-cloneable value makes the structured clone (and therefore the write) fail.
    s.set({ ...a, name: 'bad', settings: { ...a.settings, ercSeverities: { fn: (() => 1) as never } } });
    await vi.advanceTimersByTimeAsync(1500);
    await bad.flush();
    expect(onError).toHaveBeenCalledOnce();
    bad.stop();
  });

  it('accepts the real app store and saves after a command', async () => {
    const { store, command } = await import('@/store');
    const p0 = fixture('Real');
    store.getState().replaceProject(p0);
    const handle = startAutosave(store);
    store.getState().execute(
      command('Rename', 'schematic', (d) => {
        d.name = 'Real edited';
      }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    await handle.flush();
    expect((await loadProject(p0.id))?.name).toBe('Real edited');
    handle.stop();
  });

  it('markProjectClean suppresses saving that object', async () => {
    const a = fixture('A');
    const s = fakeStore(createProject('x'));
    const handle = startAutosave(s);
    markProjectClean(a);
    s.set(a);
    await vi.advanceTimersByTimeAsync(1500);
    await handle.flush();
    expect(await loadProject(a.id)).toBeNull();
    handle.stop();
  });
});

describe('JSON', () => {
  it('serialize -> parse roundtrips exactly', () => {
    const p = fixture();
    const json = serializeProject(p);
    expect(parseProject(json)).toEqual(p);
    expect(serializeProject(p, { updatedAt: '2030-01-01T00:00:00.000Z', pretty: false })).toContain('"updatedAt":"2030-01-01T00:00:00.000Z"');
  });

  it('rejects garbage', () => {
    expect(() => parseProject('not json')).toThrow(ProjectParseError);
    expect(() => parseProject('[]')).toThrow(ProjectParseError);
    expect(() => parseProject('null')).toThrow(ProjectParseError);
    expect(() => parseProject('{"id":"x"}')).toThrow(/name/);
    expect(() => parseProject('{"id":"x","name":"n"}')).toThrow(/sheets/);
    expect(() => parseProject('{"id":"x","name":"n","sheets":[],"components":[{"id":1}],"links":[]}')).toThrow(/components\[0\]/);
    expect(() => parseProject('{"id":"x","name":"n","sheets":[],"components":[],"links":[],"racks":{}}')).toThrow(/racks/);
    expect(() => migrate({ id: 'x', name: 'n', sheets: [], components: [], links: [], version: CURRENT_PROJECT_VERSION + 1 })).toThrow(/newer/);
    expect(() => migrate({ id: 'x', name: 'n', sheets: [], components: [], links: [], version: 'one' })).toThrow(/version/);
  });

  it('fills defaults for optional fields so older files load', () => {
    const minimal = { id: 'p1', name: 'Old', sheets: [], components: [], links: [] };
    const p = migrate(minimal, '2026-03-03T00:00:00.000Z');
    const fresh = createProject('Old', '2026-03-03T00:00:00.000Z');
    expect(p).toEqual({ ...fresh, id: 'p1' });
    expect(p.version).toBe(CURRENT_PROJECT_VERSION);
    expect(p.version).toBe(2);
    expect(p.sheets).toEqual([{ id: ROOT_SHEET_ID, name: 'Root', parentId: null }]);
  });

  it('merges partial settings/room/catalog over defaults and normalises components/links', () => {
    const p = migrate({
      id: 'p1',
      name: 'Partial',
      version: 1,
      sheets: [{ id: 'root', name: 'Root', parentId: null }],
      components: [{ id: 'c1', ref: 'SW1', symbolDefId: leaf.id, sch: { pos: { x: 0, y: 0 }, rotation: 0, sheetId: 'root' } }],
      links: [{ id: 'l1', a: { componentId: 'c1', portId: 'eth1/1' }, b: { componentId: 'c1', portId: 'eth1/2' } }],
      room: { gridMm: 610 },
      settings: { slackFraction: 0.3 },
      customCatalog: { symbols: [] },
      syncState: { components: { c1: { ref: 'SW1', footprintDefId: null } } },
    });
    expect(p.room.gridMm).toBe(610);
    expect(p.room.ceilingMm).toBe(3000);
    expect(p.settings.slackFraction).toBe(0.3);
    expect(p.settings.trayFillWarn).toBe(0.5);
    expect(p.customCatalog).toEqual({ symbols: [], footprints: [], transceivers: [], cables: [] });
    expect(p.syncState.links).toEqual({});
    expect(p.components[0]).toMatchObject({ footprintDefId: null, optics: {} });
    expect(p.links[0]).toMatchObject({ cableDefId: null, sch: { wirePoints: [] } });
  });

  it('rejects a file from a newer schema (version 3)', () => {
    const v3 = { ...createProject('Future', '2026-03-03T00:00:00.000Z'), version: 3 };
    expect(() => parseProject(JSON.stringify(v3))).toThrow(ProjectParseError);
    expect(() => parseProject(JSON.stringify(v3))).toThrow(/version 3 is newer/);
  });

  it('readJsonFile parses a File', async () => {
    const p = fixture('FromFile');
    const file = new File([serializeProject(p)], 'dc.json', { type: 'application/json' });
    expect(await readJsonFile(file)).toEqual(p);
    await expect(readJsonFile(new File(['{'], 'bad.json'))).rejects.toThrow(ProjectParseError);
  });

  it('downloadJson triggers an anchor download of the serialized project', async () => {
    const p = fixture('My DC / v2');
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('my-dc-v2.dceda.json');
      expect(this.href).toBe('blob:fake');
    });
    try {
      downloadJson(p);
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(click).toHaveBeenCalledOnce();
      expect(document.querySelector('a[download]')).toBeNull();
      await new Promise((r) => setTimeout(r, 0)); // let the deferred revoke run
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('migration v1 → v2 (configurable fiber cables)', () => {
  /**
   * A v1 file as the app wrote it before configurable cables: no `cables`,
   * a custom OM4 LC ↔ LC definition with only the legacy vocabulary, routes
   * without an owner (plus, from an interim dev build, a jacket route that
   * already says 'cable' and a corrupt owner that must not survive).
   */
  const v1 = () => ({
    id: 'p1',
    name: 'Old',
    version: 1,
    rev: 'B',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    sheets: [{ id: 'root', name: 'Root', parentId: null }],
    components: [
      { id: 'c1', ref: 'SW1', symbolDefId: leaf.id, footprintDefId: null, optics: {}, sch: { pos: { x: 0, y: 0 }, rotation: 0, sheetId: 'root' } },
      { id: 'c2', ref: 'SW2', symbolDefId: leaf.id, footprintDefId: null, optics: {}, sch: { pos: { x: 300, y: 0 }, rotation: 0, sheetId: 'root' } },
    ],
    links: [{ id: 'l1', a: { componentId: 'c1', portId: 'eth1/1' }, b: { componentId: 'c2', portId: 'eth1/1' }, cableDefId: 'cbl.custom.om4-lc', sch: { wirePoints: [] } }],
    routes: {
      l1: { linkId: 'l1', aRack: { side: 'left', entry: null, pinned: false }, bRack: { side: 'right', entry: null, pinned: false }, segments: [] },
      cbl1: { linkId: 'cbl1', owner: 'cable', aRack: { side: 'left', entry: null, pinned: false }, bRack: { side: 'left', entry: null, pinned: false }, segments: [] },
      l2: { linkId: 'l2', owner: 'bogus', aRack: { side: 'left', entry: null, pinned: false }, bRack: { side: 'left', entry: null, pinned: false }, segments: [] },
    },
    customCatalog: {
      symbols: [],
      footprints: [],
      transceivers: [],
      cables: [
        { id: 'cbl.custom.om4-lc', name: 'OM4 LC cord', media: 'OM4', mediaClass: 'fiber', endA: 'LC', endB: 'LC', color: '#2dd4bf', bendRadiusMm: 30, diameterMm: 2 },
        { id: 'cbl.custom.mpo-lc', name: 'MPO breakout', media: 'OM4', mediaClass: 'fiber', endA: 'MPO-12', endB: 'LC', color: '#2dd4bf', bendRadiusMm: 30, diameterMm: 3, breakout: { fanout: 4 } },
        { id: 'cbl.custom.cat6', name: 'Cat6a', media: 'Cat6a', mediaClass: 'copper', endA: 'RJ45', endB: 'RJ45', color: '#60a5fa', bendRadiusMm: 30, diameterMm: 6 },
      ],
    },
  });

  it('upgrades the custom fiber definitions, defaults cables to [] and keeps links as they were', () => {
    const p = parseProject(JSON.stringify(v1()));
    expect(p.version).toBe(2);
    expect(p.cables).toEqual([]);
    expect(p.links).toEqual(v1().links);

    const lc = p.customCatalog.cables.find((c) => c.id === 'cbl.custom.om4-lc')!;
    expect(lc).toMatchObject({
      name: 'OM4 LC cord',
      media: 'OM4',
      endA: 'LC',
      endB: 'LC',
      fiberCount: 2,
      fiberType: 'OM4',
      sideA: { connector: 'LC-duplex' },
      sideB: { connector: 'LC-duplex' },
      polarity: 'A',
    });
    const resolved = resolveCable(lc);
    if ('error' in resolved) throw new Error(resolved.error);
    expect(resolved.kind).toBe('straight');
    expect(resolved.channels).toBe(1);
    expect(resolved.sideA.legs).toHaveLength(1);
    expect(resolved.sideB.legs).toHaveLength(1);
    expect(resolved.displayName).toBe('2F OM4 LC-duplex ↔ LC-duplex');

    expect(p.customCatalog.cables.find((c) => c.id === 'cbl.custom.mpo-lc')).toMatchObject({
      fiberCount: 8,
      sideA: { connector: 'MPO-8' },
      sideB: { connector: 'LC-duplex' },
      polarity: 'B',
      breakout: { fanout: 4 },
    });
    // Copper stays exactly as it was.
    expect(p.customCatalog.cables.find((c) => c.id === 'cbl.custom.cat6')).toEqual(v1().customCatalog.cables[2]);
  });

  it("routes default to the 'link' owner, keep 'cable' and drop anything else", () => {
    const p = parseProject(JSON.stringify(v1()));
    expect(p.routes.l1).not.toHaveProperty('owner');
    expect(routeOwner(p.routes.l1!)).toBe('link');
    expect(p.routes.cbl1?.owner).toBe('cable');
    expect(p.routes.l2).not.toHaveProperty('owner');
    expect(routeOwner(p.routes.l2!)).toBe('link');
  });

  it('is idempotent: a migrated file re-parsed is unchanged, and a file without a version counts as v1', () => {
    const once = parseProject(JSON.stringify(v1()));
    expect(parseProject(serializeProject(once))).toEqual(once);
    const { version, ...unversioned } = v1();
    void version;
    expect(parseProject(JSON.stringify(unversioned))).toEqual(once);
  });

  it('round-trips a v2 project with installed cables and a jacket route exactly (JSON and IndexedDB)', async () => {
    const f = trunkFixture();
    const project = routeJacket(f.project, f.cable.id);
    expect(project.version).toBe(2);
    expect(project.cables).toHaveLength(1);
    expect(project.routes[f.cable.id]?.owner).toBe('cable');
    expect(project.links.filter((l) => l.cableId === f.cable.id)).toHaveLength(4);

    expect(parseProject(serializeProject(project))).toEqual(project);

    const saved = await saveProjectNow(project, '2026-02-02T00:00:00.000Z');
    expect(await loadProject(project.id)).toEqual({ ...project, updatedAt: '2026-02-02T00:00:00.000Z' });
    expect(saved.cables).toBe(project.cables);
  });
});
