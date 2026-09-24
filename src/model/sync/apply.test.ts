import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createComponent, createLink } from '@/model/factories';
import type { Project, SyncChange } from '@/model/types';
import { applySyncPlan } from './apply';
import { computeSyncPlan, isOutOfSync } from './diff';
import {
  GPU_4U_FP,
  SERVER_2U_FP,
  SERVER_SYM,
  addRoute,
  buildFabric,
  edit,
  place,
  placementOf,
  symbol,
  syncAll,
} from './testFixtures';

const apply = (project: Project, changes: SyncChange[]) => {
  let summary!: ReturnType<typeof applySyncPlan>;
  const next = produce(project, (d) => {
    summary = applySyncPlan(d, changes);
  });
  return { next, summary };
};

describe('applySyncPlan', () => {
  it('round trip: adds create unplaced placements and populate syncState; the plan is then empty', () => {
    const f = buildFabric();
    // Start with no placements at all, as the layout would after the first F8.
    const p = edit(f.project, (d) => {
      d.placements = [];
    });
    const plan = computeSyncPlan(p);
    const { next, summary } = apply(p, plan.changes);
    expect(summary).toEqual({ applied: 5, removedRoutes: [], unplaced: [] });
    expect(next.placements).toEqual([
      { componentId: f.leafId, rackId: null, uPosition: null, face: 'front' },
      { componentId: f.spineId, rackId: null, uPosition: null, face: 'front' },
      { componentId: f.serverId, rackId: null, uPosition: null, face: 'front' },
    ]);
    expect(next.syncState.components).toEqual({
      [f.leafId]: { ref: 'SW1', footprintDefId: 'fp.leaf-switch-48x25-8x100' },
      [f.spineId]: { ref: 'SW2', footprintDefId: 'fp.spine-switch-32x400' },
      [f.serverId]: { ref: 'SRV1', footprintDefId: 'fp.server-1u' },
    });
    expect(next.syncState.links).toEqual({
      [f.uplinkId]: { a: { componentId: f.leafId, portId: 'eth1/49' }, b: { componentId: f.spineId, portId: 'eth1/1' } },
      [f.downlinkId]: { a: { componentId: f.serverId, portId: 'eth0' }, b: { componentId: f.leafId, portId: 'eth1/1' } },
    });
    expect(next.routes).toEqual({});
    expect(computeSyncPlan(next).changes).toEqual([]);
    expect(isOutOfSync(next)).toBe(false);
  });

  it('applies only the checked subset', () => {
    const f = buildFabric();
    const plan = computeSyncPlan(f.project);
    const onlyComponents = plan.changes.filter((c) => c.kind === 'add-component');
    const { next, summary } = apply(f.project, onlyComponents);
    expect(summary.applied).toBe(3);
    expect(computeSyncPlan(next).changes.map((c) => c.kind)).toEqual(['add-link', 'add-link']);
  });

  it('does not duplicate a placement that already exists', () => {
    const f = buildFabric();
    const next = syncAll(f.project);
    expect(next.placements).toHaveLength(3);
    expect(placementOf(next, f.leafId)).toMatchObject({ rackId: f.rackId, uPosition: 10 });
  });

  it('remove-component drops the placement, its routes and its syncState entry', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      addRoute(d, f.uplinkId);
      addRoute(d, f.downlinkId);
    });
    p = edit(p, (d) => {
      d.components = d.components.filter((c) => c.id !== f.leafId);
      d.links = d.links.filter((l) => l.id !== f.uplinkId && l.id !== f.downlinkId);
    });
    const plan = computeSyncPlan(p);
    const removeComponent = plan.changes.filter((c) => c.kind === 'remove-component');
    expect(removeComponent).toHaveLength(1);
    const { next, summary } = apply(p, removeComponent);
    expect(summary.applied).toBe(1);
    expect(summary.removedRoutes.sort()).toEqual([f.uplinkId, f.downlinkId].sort());
    expect(placementOf(next, f.leafId)).toBeUndefined();
    expect(next.placements).toHaveLength(2);
    expect(next.routes).toEqual({});
    expect(next.syncState.components[f.leafId]).toBeUndefined();
    // Links to a removed device cannot survive in the layout, so their sync entries go with it.
    expect(next.syncState.links[f.uplinkId]).toBeUndefined();
    expect(next.syncState.links[f.downlinkId]).toBeUndefined();
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('removing both the component and its links in one apply reports each route once', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      addRoute(d, f.uplinkId);
    });
    p = edit(p, (d) => {
      d.components = d.components.filter((c) => c.id !== f.spineId);
      d.links = d.links.filter((l) => l.id !== f.uplinkId);
    });
    const { next, summary } = apply(p, computeSyncPlan(p).changes);
    expect(summary).toEqual({ applied: 2, removedRoutes: [f.uplinkId], unplaced: [] });
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('footprint-changed keeps rack and U when the new model fits', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      d.components.find((c) => c.id === f.serverId)!.footprintDefId = SERVER_2U_FP;
    });
    const { next, summary } = apply(p, computeSyncPlan(p).changes);
    expect(summary).toEqual({ applied: 1, removedRoutes: [], unplaced: [] });
    expect(placementOf(next, f.serverId)).toEqual({ componentId: f.serverId, rackId: f.rackId, uPosition: 1, face: 'front' });
    expect(next.syncState.components[f.serverId]).toEqual({ ref: 'SRV1', footprintDefId: SERVER_2U_FP });
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('footprint-changed unplaces the device when a 4U model at U42 cannot fit', () => {
    const f = buildFabric();
    let p = edit(f.project, (d) => place(d, f.serverId, f.rackId, 42));
    p = syncAll(p);
    p = edit(p, (d) => {
      d.components.find((c) => c.id === f.serverId)!.footprintDefId = GPU_4U_FP;
    });
    const plan = computeSyncPlan(p);
    expect(plan.changes[0]).toMatchObject({ kind: 'footprint-changed', fits: false });
    const { next, summary } = apply(p, plan.changes);
    expect(summary).toEqual({ applied: 1, removedRoutes: [], unplaced: [f.serverId] });
    expect(placementOf(next, f.serverId)).toEqual({ componentId: f.serverId, rackId: null, uPosition: null, face: 'front' });
    expect(next.syncState.components[f.serverId]?.footprintDefId).toBe(GPU_4U_FP);
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('remove-link deletes the route together with its pinned waypoints', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      addRoute(d, f.uplinkId, [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 700 }]);
    });
    expect(p.routes[f.uplinkId]?.segments[0]?.points.every((w) => w.pinned)).toBe(true);
    p = edit(p, (d) => {
      d.links = d.links.filter((l) => l.id !== f.uplinkId);
    });
    const plan = computeSyncPlan(p);
    expect(plan.changes).toEqual([
      { kind: 'remove-link', linkId: f.uplinkId, label: 'SW1:eth1/49 — SW2:eth1/1', hadRoute: true },
    ]);
    const { next, summary } = apply(p, plan.changes);
    expect(summary).toEqual({ applied: 1, removedRoutes: [f.uplinkId], unplaced: [] });
    expect(next.routes[f.uplinkId]).toBeUndefined();
    expect(next.syncState.links[f.uplinkId]).toBeUndefined();
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('link-endpoint-changed keeps the route, flags it for review and re-syncs the ends', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      addRoute(d, f.uplinkId);
    });
    p = edit(p, (d) => {
      d.links.find((l) => l.id === f.uplinkId)!.b.portId = 'eth1/7';
    });
    const { next, summary } = apply(p, computeSyncPlan(p).changes);
    expect(summary).toEqual({ applied: 1, removedRoutes: [], unplaced: [] });
    const route = next.routes[f.uplinkId];
    expect(route?.needsReview).toBe(true);
    expect(route?.segments[0]?.points).toHaveLength(2);
    expect(next.syncState.links[f.uplinkId]).toEqual({
      a: { componentId: f.leafId, portId: 'eth1/49' },
      b: { componentId: f.spineId, portId: 'eth1/7' },
    });
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('link-endpoint-changed without a route just re-syncs', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      d.links.find((l) => l.id === f.downlinkId)!.a.lane = 2;
    });
    const { next } = apply(p, computeSyncPlan(p).changes);
    expect(next.routes).toEqual({});
    expect(next.syncState.links[f.downlinkId]?.a).toEqual({ componentId: f.serverId, portId: 'eth0', lane: 2 });
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('re-annotation only updates syncState refs and leaves placements and routes untouched', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      addRoute(d, f.uplinkId);
    });
    const before = p;
    p = edit(p, (d) => {
      const leaf = d.components.find((c) => c.id === f.leafId)!;
      const spine = d.components.find((c) => c.id === f.spineId)!;
      // Swap refs: SW1 <-> SW2. Matching is by id so the layout must not care.
      leaf.ref = 'SW2';
      spine.ref = 'SW1';
    });
    const plan = computeSyncPlan(p);
    expect(plan.changes).toEqual([
      { kind: 'ref-renamed', componentId: f.leafId, from: 'SW1', to: 'SW2' },
      { kind: 'ref-renamed', componentId: f.spineId, from: 'SW2', to: 'SW1' },
    ]);
    const { next, summary } = apply(p, plan.changes);
    expect(summary).toEqual({ applied: 2, removedRoutes: [], unplaced: [] });
    expect(next.placements).toBe(before.placements);
    expect(next.routes).toBe(before.routes);
    expect(next.syncState.components[f.leafId]?.ref).toBe('SW2');
    expect(next.syncState.components[f.spineId]?.ref).toBe('SW1');
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('skips stale changes whose subject no longer exists and does not count them', () => {
    const f = buildFabric();
    const staleAdd: SyncChange = { kind: 'add-component', componentId: 'nope', ref: 'X' };
    const staleLink: SyncChange = { kind: 'add-link', linkId: 'nope', label: 'X' };
    const staleRename: SyncChange = { kind: 'ref-renamed', componentId: f.leafId, from: 'SW1', to: 'SW9' };
    const { next, summary } = apply(f.project, [staleAdd, staleLink, staleRename]);
    expect(summary.applied).toBe(0);
    expect(next.placements).toBe(f.project.placements);
    expect(next.syncState).toEqual({ components: {}, links: {} });
  });

  it('prunes placements for components that no longer exist', () => {
    const f = buildFabric();
    const p = edit(f.project, (d) => {
      d.placements.push({ componentId: 'ghost', rackId: f.rackId, uPosition: 30, face: 'rear' });
    });
    const { next } = apply(p, []);
    expect(next.placements.map((x) => x.componentId)).toEqual([f.leafId, f.spineId, f.serverId]);
  });

  it('a device added after the first sync lands in the unplaced bin and its link becomes an airwire', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    let newId = '';
    let newLinkId = '';
    p = edit(p, (d) => {
      const srv = createComponent(symbol(SERVER_SYM), { sheetId: 'root', pos: { x: 0, y: 0 }, ref: 'SRV2' });
      const link = createLink({ componentId: srv.id, portId: 'eth0' }, { componentId: f.leafId, portId: 'eth1/2' });
      d.components.push(srv);
      d.links.push(link);
      newId = srv.id;
      newLinkId = link.id;
    });
    const plan = computeSyncPlan(p);
    expect(plan.changes.map((c) => c.kind)).toEqual(['add-component', 'add-link']);
    const { next } = apply(p, plan.changes);
    expect(placementOf(next, newId)).toEqual({ componentId: newId, rackId: null, uPosition: null, face: 'front' });
    expect(next.routes[newLinkId]).toBeUndefined();
    expect(next.syncState.links[newLinkId]).toBeDefined();
  });
});
