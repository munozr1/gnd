/**
 * Adversarial tests for the sync module: every row of the F8 table, partial
 * (checked-subset) application, stale plans, footprint fit edge cases,
 * back-annotation acceptance and ref uniqueness.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createComponent, createLink, createRack, createWaypoint } from '@/model/factories';
import { indexProject } from '@/model/query';
import type { BackAnnotation, Id, Project, Route, SyncChange } from '@/model/types';
import { applySyncPlan } from './apply';
import { acceptBackAnnotation, proposePortSwap, proposeRefRename, validateRefRename } from './backAnnotate';
import { changeKey, computeSyncPlan, footprintFits, isOutOfSync } from './diff';
import {
  GPU_4U_FP,
  SERVER_1U_FP,
  SERVER_2U_FP,
  SERVER_SYM,
  addRoute,
  buildFabric,
  edit,
  place,
  placementOf,
  rackDef,
  symbol,
  syncAll,
} from './testFixtures';

const LEAF_FP = 'fp.leaf-switch-48x25-8x100';
const SPINE_FP = 'fp.spine-switch-32x400';
const RACK_48U = 'rack.tall-48u';

const apply = (project: Project, changes: readonly SyncChange[]) => {
  let summary!: ReturnType<typeof applySyncPlan>;
  const next = produce(project, (d) => {
    summary = applySyncPlan(d, changes);
  });
  return { next, summary };
};

const propose = (project: Project, fn: (draft: Project) => BackAnnotation) => {
  let annotation!: BackAnnotation;
  const next = produce(project, (d) => {
    annotation = fn(d);
  });
  return { next, annotation };
};

const accept = (project: Project, id: string) => {
  let result!: ReturnType<typeof acceptBackAnnotation>;
  const next = produce(project, (d) => {
    result = acceptBackAnnotation(d, id);
  });
  return { next, result };
};

const component = (p: Project, id: Id) => p.components.find((c) => c.id === id)!;
const link = (p: Project, id: Id) => p.links.find((l) => l.id === id)!;
const kinds = (changes: readonly SyncChange[]) => changes.map((c) => c.kind);

/** A two-segment route: pinned overhead points and an anchored in-rack point with a service loop. */
function addRichRoute(draft: Project, linkId: Id, rackId: Id): Route {
  const inRack = createWaypoint({ x: 50, y: 50 }, true);
  inRack.anchor = { rackId, offset: { x: 50, y: 50 } };
  inRack.serviceLoopM = 1.5;
  const route: Route = {
    linkId,
    aRack: { side: 'left', entry: null, pinned: true },
    bRack: { side: 'right', entry: null, pinned: false },
    segments: [
      { layer: 'in-rack', points: [inRack] },
      {
        layer: 'overhead',
        trayId: null,
        points: [createWaypoint({ x: 100, y: 100 }, true), createWaypoint({ x: 900, y: 100 }, true)],
      },
    ],
  };
  draft.routes[linkId] = route;
  return route;
}

// ---------------------------------------------------------------------------
// F8 table, row by row
// ---------------------------------------------------------------------------

describe('F8 row: new component', () => {
  it('a component deleted and re-created with the same ref is a remove + add (matching is by id, never ref)', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    let newId = '';
    p = edit(p, (d) => {
      d.components = d.components.filter((c) => c.id !== f.serverId);
      d.links = d.links.filter((l) => l.id !== f.downlinkId);
      const again = createComponent(symbol(SERVER_SYM), { sheetId: 'root', pos: { x: 0, y: 0 }, ref: 'SRV1' });
      d.components.push(again);
      newId = again.id;
    });
    const plan = computeSyncPlan(p).changes;
    expect(kinds(plan)).toEqual(['add-component', 'remove-component', 'remove-link']);
    const { next } = apply(p, plan);
    expect(placementOf(next, f.serverId)).toBeUndefined();
    // The new SRV1 does not inherit the old SRV1's slot.
    expect(placementOf(next, newId)).toEqual({ componentId: newId, rackId: null, uPosition: null, face: 'front' });
    expect(next.syncState.components[f.serverId]).toBeUndefined();
    expect(next.syncState.components[newId]).toEqual({ ref: 'SRV1', footprintDefId: SERVER_1U_FP });
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('keeps a slot the user already gave the device in the layout before pressing F8', () => {
    const f = buildFabric();
    const plan = computeSyncPlan(f.project).changes;
    const { next } = apply(f.project, plan);
    expect(placementOf(next, f.leafId)).toEqual({ componentId: f.leafId, rackId: f.rackId, uPosition: 10, face: 'front' });
    expect(next.placements).toHaveLength(3);
  });
});

describe('F8 row: component deleted', () => {
  it('a route survives when its link was re-attached away from the deleted device (not orphaned)', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    let srv2 = '';
    p = edit(p, (d) => {
      addRoute(d, f.downlinkId);
    });
    const before = p.routes[f.downlinkId]!;
    p = edit(p, (d) => {
      const other = createComponent(symbol(SERVER_SYM), { sheetId: 'root', pos: { x: 0, y: 0 }, ref: 'SRV2' });
      d.components.push(other);
      srv2 = other.id;
      // SRV1 goes away; its downlink now lands on SRV2 instead of being deleted.
      d.components = d.components.filter((c) => c.id !== f.serverId);
      link(d, f.downlinkId).a = { componentId: other.id, portId: 'eth0' };
    });
    const plan = computeSyncPlan(p).changes;
    expect(plan).toEqual([
      { kind: 'add-component', componentId: srv2, ref: 'SRV2' },
      { kind: 'remove-component', componentId: f.serverId, ref: 'SRV1', orphanedRouteIds: [] },
      { kind: 'link-endpoint-changed', linkId: f.downlinkId, label: 'SRV2:eth0 — SW1:eth1/1' },
    ]);
    const { next, summary } = apply(p, plan);
    expect(summary).toEqual({ applied: 3, removedRoutes: [], unplaced: [] });
    expect(next.routes[f.downlinkId]?.segments).toEqual(before.segments);
    expect(next.routes[f.downlinkId]?.needsReview).toBe(true);
    expect(next.syncState.links[f.downlinkId]).toEqual({
      a: { componentId: srv2, portId: 'eth0' },
      b: { componentId: f.leafId, portId: 'eth1/1' },
    });
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('the re-attached route also survives when only the component removal is checked', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      addRoute(d, f.downlinkId);
    });
    p = edit(p, (d) => {
      const other = createComponent(symbol(SERVER_SYM), { sheetId: 'root', pos: { x: 0, y: 0 }, ref: 'SRV2' });
      d.components.push(other);
      d.components = d.components.filter((c) => c.id !== f.serverId);
      link(d, f.downlinkId).a = { componentId: other.id, portId: 'eth0' };
    });
    const plan = computeSyncPlan(p).changes;
    const { next } = apply(p, plan.filter((c) => c.kind === 'remove-component'));
    expect(next.routes[f.downlinkId]).toBeDefined();
    expect(next.routes[f.downlinkId]?.needsReview).toBeUndefined();
    // The retarget is still pending, not silently turned into a fresh add.
    expect(kinds(computeSyncPlan(next).changes)).toEqual(['add-component', 'link-endpoint-changed']);
  });

  it('a live link that still references the deleted device is orphaned with it', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      addRoute(d, f.downlinkId);
    });
    // A corrupt schematic: the component is gone but its link was not cleaned up.
    p = edit(p, (d) => {
      d.components = d.components.filter((c) => c.id !== f.serverId);
    });
    const [change] = computeSyncPlan(p).changes;
    expect(change).toEqual({ kind: 'remove-component', componentId: f.serverId, ref: 'SRV1', orphanedRouteIds: [f.downlinkId] });
    const { next, summary } = apply(p, [change!]);
    expect(summary.removedRoutes).toEqual([f.downlinkId]);
    expect(next.routes).toEqual({});
  });

  it('deleting a device with two routed links lists and deletes both routes', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      addRoute(d, f.uplinkId);
      addRoute(d, f.downlinkId);
    });
    p = edit(p, (d) => {
      d.components = d.components.filter((c) => c.id !== f.leafId);
      d.links = [];
    });
    const plan = computeSyncPlan(p).changes;
    const removal = plan.find((c) => c.kind === 'remove-component');
    expect(removal).toMatchObject({ kind: 'remove-component', componentId: f.leafId });
    const orphaned = removal?.kind === 'remove-component' ? removal.orphanedRouteIds : [];
    expect([...orphaned].sort()).toEqual([f.uplinkId, f.downlinkId].sort());
    const { next, summary } = apply(p, plan);
    expect(summary.removedRoutes.sort()).toEqual([f.uplinkId, f.downlinkId].sort());
    expect(next.routes).toEqual({});
    expect(next.placements.map((x) => x.componentId)).toEqual([f.spineId, f.serverId]);
    expect(computeSyncPlan(next).changes).toEqual([]);
  });
});

describe('F8 row: model (footprint) changed', () => {
  describe('footprintFits at the rack top', () => {
    const at = (u: number, rack = 'rack.standard-42u') => {
      const f = buildFabric();
      let p = f.project;
      if (rack !== 'rack.standard-42u') {
        p = edit(p, (d) => {
          const tall = createRack(rackDef(rack), { name: 'R2', pos: { x: 1000, y: 0 } });
          d.racks.push(tall);
          place(d, f.serverId, tall.id, u);
        });
      } else {
        p = edit(p, (d) => place(d, f.serverId, f.rackId, u));
      }
      return { idx: indexProject(p), id: f.serverId };
    };

    it('1U at U42 of a 42U rack fits; 2U does not', () => {
      const { idx, id } = at(42);
      expect(footprintFits(idx, id, SERVER_1U_FP)).toBe(true);
      expect(footprintFits(idx, id, SERVER_2U_FP)).toBe(false);
      expect(footprintFits(idx, id, null)).toBe(true);
    });

    it('2U at U41 fits exactly; 4U at U39 fits exactly and U40 overhangs', () => {
      // Each `at()` builds a fresh fabric with new ids, so an index and an id must come from the same call.
      const u41 = at(41);
      expect(footprintFits(u41.idx, u41.id, SERVER_2U_FP)).toBe(true);
      expect(footprintFits(u41.idx, u41.id, GPU_4U_FP)).toBe(false);
      const u39 = at(39);
      expect(footprintFits(u39.idx, u39.id, GPU_4U_FP)).toBe(true);
      const u40 = at(40);
      expect(footprintFits(u40.idx, u40.id, GPU_4U_FP)).toBe(false);
    });

    it('uses the rack instance height, not a fixed 42U', () => {
      const u45 = at(45, RACK_48U);
      expect(footprintFits(u45.idx, u45.id, GPU_4U_FP)).toBe(true);
      const u46 = at(46, RACK_48U);
      expect(footprintFits(u46.idx, u46.id, GPU_4U_FP)).toBe(false);
    });

    it('a placement below U1 never fits', () => {
      const { idx, id } = at(0);
      expect(footprintFits(idx, id, SERVER_1U_FP)).toBe(false);
    });
  });

  describe('footprintFits with neighbours', () => {
    it('grows into free space above but not into a neighbour, inclusive at both edges', () => {
      const f = buildFabric();
      // SRV1 at U1; SW1 (1U) is the neighbour we move around.
      const withLeafAt = (u: number) => indexProject(edit(f.project, (d) => place(d, f.leafId, f.rackId, u)));
      expect(footprintFits(withLeafAt(5), f.serverId, GPU_4U_FP)).toBe(true); // U1-4 vs U5
      expect(footprintFits(withLeafAt(4), f.serverId, GPU_4U_FP)).toBe(false); // U1-4 vs U4
      expect(footprintFits(withLeafAt(3), f.serverId, SERVER_2U_FP)).toBe(true); // U1-2 vs U3
      expect(footprintFits(withLeafAt(2), f.serverId, SERVER_2U_FP)).toBe(false); // U1-2 vs U2
    });

    it('counts the neighbour with its own height (a 2U spine directly above blocks)', () => {
      const f = buildFabric();
      // SW2 is 2U. Put SRV1 at U18 (1U) and SW2 at U20-21: 2U fits (18-19), 4U does not (18-21).
      const p = edit(f.project, (d) => place(d, f.serverId, f.rackId, 18));
      const idx = indexProject(p);
      expect(footprintFits(idx, f.serverId, SERVER_2U_FP)).toBe(true);
      expect(footprintFits(idx, f.serverId, GPU_4U_FP)).toBe(false);
    });

    it('a pre-existing overlap from a neighbour below is reported as not fitting', () => {
      const f = buildFabric();
      // SW2 (2U) at U11-12, SRV1 at U12.
      const p = edit(f.project, (d) => {
        place(d, f.spineId, f.rackId, 11);
        place(d, f.serverId, f.rackId, 12);
      });
      expect(footprintFits(indexProject(p), f.serverId, SERVER_1U_FP)).toBe(false);
    });

    it('ignores devices in other racks, unplaced devices and the device itself', () => {
      const f = buildFabric();
      const p = edit(f.project, (d) => {
        const other = createRack(rackDef('rack.standard-42u'), { name: 'R2', pos: { x: 1000, y: 0 } });
        d.racks.push(other);
        place(d, f.leafId, other.id, 2); // same U range, different rack
        place(d, f.spineId, f.rackId, null); // rack set but no U: not occupying anything
      });
      const idx = indexProject(p);
      expect(footprintFits(idx, f.serverId, GPU_4U_FP)).toBe(true);
    });

    it('a neighbour without a footprint occupies 1U', () => {
      const f = buildFabric();
      const p = edit(f.project, (d) => {
        component(d, f.leafId).footprintDefId = null;
        place(d, f.leafId, f.rackId, 2);
      });
      expect(footprintFits(indexProject(p), f.serverId, SERVER_2U_FP)).toBe(false);
      expect(footprintFits(indexProject(p), f.serverId, SERVER_1U_FP)).toBe(true);
    });

    it('a component with no placement record at all fits anything', () => {
      const f = buildFabric();
      const p = edit(f.project, (d) => {
        d.placements = d.placements.filter((x) => x.componentId !== f.serverId);
      });
      expect(footprintFits(indexProject(p), f.serverId, GPU_4U_FP)).toBe(true);
    });
  });

  it('shrinking a model always keeps the slot; changing to no model keeps it too', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      component(d, f.spineId).footprintDefId = LEAF_FP; // 2U -> 1U
      component(d, f.leafId).footprintDefId = null;
    });
    const plan = computeSyncPlan(p).changes;
    expect(plan).toEqual([
      { kind: 'footprint-changed', componentId: f.leafId, ref: 'SW1', from: LEAF_FP, to: null, fits: true },
      { kind: 'footprint-changed', componentId: f.spineId, ref: 'SW2', from: SPINE_FP, to: LEAF_FP, fits: true },
    ]);
    const { next, summary } = apply(p, plan);
    expect(summary).toEqual({ applied: 2, removedRoutes: [], unplaced: [] });
    expect(placementOf(next, f.spineId)).toMatchObject({ rackId: f.rackId, uPosition: 20 });
    expect(placementOf(next, f.leafId)).toMatchObject({ rackId: f.rackId, uPosition: 10 });
    expect(next.syncState.components[f.leafId]).toEqual({ ref: 'SW1', footprintDefId: null });
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('a model that collides with a neighbour is unplaced and warned about; the neighbour stays', () => {
    const f = buildFabric();
    let p = edit(f.project, (d) => place(d, f.leafId, f.rackId, 2));
    p = syncAll(p);
    p = edit(p, (d) => {
      component(d, f.serverId).footprintDefId = SERVER_2U_FP;
    });
    const { next, summary } = apply(p, computeSyncPlan(p).changes);
    expect(summary.unplaced).toEqual([f.serverId]);
    expect(placementOf(next, f.serverId)).toMatchObject({ rackId: null, uPosition: null });
    expect(placementOf(next, f.leafId)).toMatchObject({ rackId: f.rackId, uPosition: 2 });
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('keeps the device face when unplacing', () => {
    const f = buildFabric();
    let p = edit(f.project, (d) => {
      place(d, f.serverId, f.rackId, 42);
      placementOf(d, f.serverId)!.face = 'rear';
    });
    p = syncAll(p);
    p = edit(p, (d) => {
      component(d, f.serverId).footprintDefId = GPU_4U_FP;
    });
    const { next } = apply(p, computeSyncPlan(p).changes);
    expect(placementOf(next, f.serverId)).toEqual({ componentId: f.serverId, rackId: null, uPosition: null, face: 'rear' });
  });

  it('re-checks the fit against the layout at apply time, not against the stale plan', () => {
    const f = buildFabric();
    const p = syncAll(f.project);
    const changed = edit(p, (d) => {
      component(d, f.serverId).footprintDefId = GPU_4U_FP;
    });
    // Plan computed with SRV1 at U1 (fits)...
    const plan = computeSyncPlan(changed).changes;
    expect(plan[0]).toMatchObject({ fits: true });
    // ...but the device was moved to the rack top before the plan was applied.
    const moved = edit(changed, (d) => place(d, f.serverId, f.rackId, 42));
    const { next, summary } = apply(moved, plan);
    expect(summary.unplaced).toEqual([f.serverId]);
    expect(placementOf(next, f.serverId)).toMatchObject({ rackId: null, uPosition: null });

    // And the other way round: a plan that said "does not fit" must not unplace a device that now fits.
    const atTop = edit(p, (d) => {
      place(d, f.serverId, f.rackId, 42);
      component(d, f.serverId).footprintDefId = GPU_4U_FP;
    });
    const stalePlan = computeSyncPlan(atTop).changes;
    expect(stalePlan[0]).toMatchObject({ fits: false });
    const movedDown = edit(atTop, (d) => place(d, f.serverId, f.rackId, 1));
    const second = apply(movedDown, stalePlan);
    expect(second.summary.unplaced).toEqual([]);
    expect(placementOf(second.next, f.serverId)).toMatchObject({ rackId: f.rackId, uPosition: 1 });
  });

  it('two neighbours growing in one apply: only the one that really collides is unplaced', () => {
    const f = buildFabric();
    // SW1 (1U) at U1, SRV1 (1U) at U3. Both become 2U: SW1 -> U1-2 fits; SRV1 -> U3-4 fits.
    let p = edit(f.project, (d) => {
      place(d, f.leafId, f.rackId, 1);
      place(d, f.serverId, f.rackId, 3);
    });
    p = syncAll(p);
    p = edit(p, (d) => {
      component(d, f.leafId).footprintDefId = SERVER_2U_FP;
      component(d, f.serverId).footprintDefId = SERVER_2U_FP;
    });
    const { next, summary } = apply(p, computeSyncPlan(p).changes);
    expect(summary.unplaced).toEqual([]);
    expect(placementOf(next, f.leafId)).toMatchObject({ uPosition: 1 });
    expect(placementOf(next, f.serverId)).toMatchObject({ uPosition: 3 });
  });
});

describe('F8 row: new link', () => {
  it('records both ends (with lanes) and never creates a route', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    let id = '';
    p = edit(p, (d) => {
      const l = createLink(
        { componentId: f.leafId, portId: 'eth1/50', lane: 1 },
        { componentId: f.spineId, portId: 'eth1/2' },
        'cbl.mpo-breakout',
      );
      d.links.push(l);
      id = l.id;
    });
    const plan = computeSyncPlan(p).changes;
    expect(plan).toEqual([{ kind: 'add-link', linkId: id, label: 'SW1:eth1/50.1 — SW2:eth1/2' }]);
    const { next } = apply(p, plan);
    expect(next.syncState.links[id]).toEqual({
      a: { componentId: f.leafId, portId: 'eth1/50', lane: 1 },
      b: { componentId: f.spineId, portId: 'eth1/2' },
    });
    expect(Object.keys(next.syncState.links[id]!.b)).not.toContain('lane');
    expect(next.routes[id]).toBeUndefined();
    expect(isOutOfSync(next)).toBe(false);
  });
});

describe('F8 row: link deleted', () => {
  it('deletes a multi-segment route with anchored and pinned waypoints, and reports it', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      addRichRoute(d, f.uplinkId, f.rackId);
      addRoute(d, f.downlinkId);
    });
    p = edit(p, (d) => {
      d.links = d.links.filter((l) => l.id !== f.uplinkId);
    });
    const plan = computeSyncPlan(p).changes;
    expect(plan).toEqual([{ kind: 'remove-link', linkId: f.uplinkId, label: 'SW1:eth1/49 — SW2:eth1/1', hadRoute: true }]);
    const { next, summary } = apply(p, plan);
    expect(summary).toEqual({ applied: 1, removedRoutes: [f.uplinkId], unplaced: [] });
    expect(Object.keys(next.routes)).toEqual([f.downlinkId]);
    expect(next.syncState.links[f.uplinkId]).toBeUndefined();
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('applying the same removal twice reports the route only once', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      addRoute(d, f.uplinkId);
    });
    p = edit(p, (d) => {
      d.links = d.links.filter((l) => l.id !== f.uplinkId);
    });
    const plan = computeSyncPlan(p).changes;
    const { next, summary } = apply(p, [...plan, ...plan]);
    expect(summary.removedRoutes).toEqual([f.uplinkId]);
    expect(next.routes).toEqual({});
  });
});

describe('F8 row: link endpoint changed', () => {
  it('keeps every waypoint (id, position, pinned, anchor, service loop) and the in-rack paths, and flags review', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      addRichRoute(d, f.uplinkId, f.rackId);
    });
    const before = p.routes[f.uplinkId]!;
    p = edit(p, (d) => {
      link(d, f.uplinkId).b = { componentId: f.spineId, portId: 'eth1/9' };
    });
    const { next, summary } = apply(p, computeSyncPlan(p).changes);
    expect(summary).toEqual({ applied: 1, removedRoutes: [], unplaced: [] });
    const after = next.routes[f.uplinkId]!;
    expect(after.needsReview).toBe(true);
    expect(after.segments).toEqual(before.segments);
    expect(after.segments[0]!.points[0]!.id).toBe(before.segments[0]!.points[0]!.id);
    expect(after.aRack).toEqual(before.aRack);
    expect(after.bRack).toEqual(before.bRack);
    expect(next.syncState.links[f.uplinkId]!.b).toEqual({ componentId: f.spineId, portId: 'eth1/9' });
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('moving an end to another device in another rack still keeps the waypoints', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    let srv2 = '';
    p = edit(p, (d) => {
      addRichRoute(d, f.downlinkId, f.rackId);
      const rack2 = createRack(rackDef('rack.standard-42u'), { name: 'R2', pos: { x: 1000, y: 0 } });
      d.racks.push(rack2);
      const other = createComponent(symbol(SERVER_SYM), { sheetId: 'root', pos: { x: 0, y: 0 }, ref: 'SRV2' });
      d.components.push(other);
      place(d, other.id, rack2.id, 5);
      srv2 = other.id;
    });
    p = syncAll(p);
    const before = p.routes[f.downlinkId]!;
    p = edit(p, (d) => {
      link(d, f.downlinkId).a = { componentId: srv2, portId: 'eth1' };
    });
    const plan = computeSyncPlan(p).changes;
    expect(plan).toEqual([{ kind: 'link-endpoint-changed', linkId: f.downlinkId, label: 'SRV2:eth1 — SW1:eth1/1' }]);
    const { next } = apply(p, plan);
    expect(next.routes[f.downlinkId]!.segments).toEqual(before.segments);
    expect(next.routes[f.downlinkId]!.needsReview).toBe(true);
    expect(next.syncState.links[f.downlinkId]!.a).toEqual({ componentId: srv2, portId: 'eth1' });
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('both ends changing at once is one change and one review flag', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      addRoute(d, f.uplinkId);
    });
    p = edit(p, (d) => {
      const l = link(d, f.uplinkId);
      l.a.portId = 'eth1/51';
      l.b.portId = 'eth1/3';
    });
    const plan = computeSyncPlan(p).changes;
    expect(kinds(plan)).toEqual(['link-endpoint-changed']);
    const { next, summary } = apply(p, plan);
    expect(summary.applied).toBe(1);
    expect(next.routes[f.uplinkId]!.needsReview).toBe(true);
    expect(next.syncState.links[f.uplinkId]).toEqual({
      a: { componentId: f.leafId, portId: 'eth1/51' },
      b: { componentId: f.spineId, portId: 'eth1/3' },
    });
  });

  it('a lane added or dropped on an end is an endpoint change', () => {
    const f = buildFabric();
    const p = syncAll(f.project);
    const withLane = edit(p, (d) => {
      link(d, f.uplinkId).a.lane = 0;
    });
    expect(kinds(computeSyncPlan(withLane).changes)).toEqual(['link-endpoint-changed']);
    const synced = syncAll(withLane);
    const dropped = edit(synced, (d) => {
      delete link(d, f.uplinkId).a.lane;
    });
    expect(kinds(computeSyncPlan(dropped).changes)).toEqual(['link-endpoint-changed']);
    expect(computeSyncPlan(syncAll(dropped)).changes).toEqual([]);
  });

  it('does not re-flag a route the user already reviewed when the change is stale', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      addRoute(d, f.uplinkId);
    });
    p = edit(p, (d) => {
      link(d, f.uplinkId).b.portId = 'eth1/7';
    });
    const plan = computeSyncPlan(p).changes;
    const { next: applied } = apply(p, plan);
    expect(applied.routes[f.uplinkId]!.needsReview).toBe(true);
    const reviewed = edit(applied, (d) => {
      delete d.routes[f.uplinkId]!.needsReview;
    });
    const { next, summary } = apply(reviewed, plan);
    expect(summary.applied).toBe(0);
    expect(next.routes[f.uplinkId]!.needsReview).toBeUndefined();
  });
});

describe('F8 row: ref renamed', () => {
  it('touches nothing but the synced ref, even with routes, proposals and lanes around', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      addRoute(d, f.uplinkId);
    });
    const { next: withProposal } = propose(p, (d) => proposePortSwap(d, f.uplinkId, 'a', 'eth1/50'));
    const renamed = edit(withProposal, (d) => {
      component(d, f.serverId).ref = 'HOST1';
    });
    const plan = computeSyncPlan(renamed).changes;
    expect(plan).toEqual([{ kind: 'ref-renamed', componentId: f.serverId, from: 'SRV1', to: 'HOST1' }]);
    const { next, summary } = apply(renamed, plan);
    expect(summary).toEqual({ applied: 1, removedRoutes: [], unplaced: [] });
    expect(next.placements).toBe(renamed.placements);
    expect(next.routes).toBe(renamed.routes);
    expect(next.syncState.links).toBe(renamed.syncState.links);
    expect(next.backAnnotations).toBe(renamed.backAnnotations);
    expect(next.syncState.components[f.serverId]).toEqual({ ref: 'HOST1', footprintDefId: SERVER_1U_FP });
    expect(isOutOfSync(next)).toBe(false);
  });

  it('labels in the plan use live refs, and a removed link is labelled with the last-synced ref of a removed device', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      component(d, f.leafId).ref = 'LEAF1';
      d.components = d.components.filter((c) => c.id !== f.spineId);
      d.links = d.links.filter((l) => l.id !== f.uplinkId);
    });
    const plan = computeSyncPlan(p).changes;
    expect(plan).toEqual([
      { kind: 'remove-component', componentId: f.spineId, ref: 'SW2', orphanedRouteIds: [] },
      { kind: 'ref-renamed', componentId: f.leafId, from: 'SW1', to: 'LEAF1' },
      { kind: 'remove-link', linkId: f.uplinkId, label: 'LEAF1:eth1/49 — SW2:eth1/1', hadRoute: false },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Partial application
// ---------------------------------------------------------------------------

/** A project whose plan holds one change of every kind, all independent of each other. */
function buildSevenKinds() {
  const f = buildFabric();
  let p = syncAll(f.project);
  p = edit(p, (d) => {
    addRoute(d, f.uplinkId);
    addRoute(d, f.downlinkId);
  });
  let srv2 = '';
  let newLinkId = '';
  p = edit(p, (d) => {
    const other = createComponent(symbol(SERVER_SYM), { sheetId: 'root', pos: { x: 0, y: 0 }, ref: 'SRV2' });
    d.components.push(other); // add-component
    srv2 = other.id;
    d.components = d.components.filter((c) => c.id !== f.serverId); // remove-component
    link(d, f.downlinkId).a = { componentId: other.id, portId: 'eth0' }; // link-endpoint-changed (routed)
    component(d, f.spineId).footprintDefId = LEAF_FP; // footprint-changed (2U -> 1U, fits)
    component(d, f.spineId).ref = 'SPINE1'; // ref-renamed
    const nl = createLink({ componentId: other.id, portId: 'eth1' }, { componentId: f.leafId, portId: 'eth1/2' });
    d.links.push(nl); // add-link
    newLinkId = nl.id;
    d.links = d.links.filter((l) => l.id !== f.uplinkId); // remove-link (routed)
  });
  return { ...f, project: p, srv2, newLinkId };
}

const canonical = (p: Project) => ({
  placements: [...p.placements].sort((x, y) => (x.componentId < y.componentId ? -1 : 1)),
  syncState: p.syncState,
  routes: p.routes,
});

function checkInvariants(p: Project, label: string) {
  const live = new Set(p.components.map((c) => c.id));
  const liveLinks = new Set(p.links.map((l) => l.id));
  const syncedComponents = new Set(Object.keys(p.syncState.components));
  const syncedLinks = new Set(Object.keys(p.syncState.links));
  const placed = new Set(p.placements.map((x) => x.componentId));
  for (const x of p.placements) {
    expect(live.has(x.componentId) || syncedComponents.has(x.componentId), `${label}: ghost placement`).toBe(true);
  }
  for (const id of syncedComponents) {
    expect(placed.has(id), `${label}: synced component ${id} has no placement`).toBe(true);
  }
  for (const id of Object.keys(p.routes)) {
    expect(liveLinks.has(id) || syncedLinks.has(id), `${label}: route ${id} belongs to no link`).toBe(true);
  }
  expect(new Set(p.placements.map((x) => x.componentId)).size, `${label}: duplicate placement`).toBe(p.placements.length);
}

describe('partial application of a checked subset', () => {
  it('the plan holds exactly one change of each kind with unique keys', () => {
    const s = buildSevenKinds();
    const plan = computeSyncPlan(s.project).changes;
    expect(kinds(plan)).toEqual([
      'add-component',
      'remove-component',
      'footprint-changed',
      'ref-renamed',
      'add-link',
      'remove-link',
      'link-endpoint-changed',
    ]);
    expect(new Set(plan.map(changeKey)).size).toBe(7);
    expect(plan.find((c) => c.kind === 'remove-component')).toMatchObject({ orphanedRouteIds: [] });
    expect(plan.find((c) => c.kind === 'remove-link')).toMatchObject({ hadRoute: true });
  });

  it('every one of the 128 subsets leaves exactly the unchecked changes pending and converges to the same state', () => {
    const s = buildSevenKinds();
    const plan = computeSyncPlan(s.project).changes;
    const full = canonical(apply(s.project, plan).next);
    for (let mask = 0; mask < 1 << plan.length; mask++) {
      const checked = plan.filter((_, i) => mask & (1 << i));
      const unchecked = plan.filter((_, i) => !(mask & (1 << i)));
      const label = `subset [${checked.map((c) => c.kind).join(', ')}]`;
      const { next, summary } = apply(s.project, checked);
      expect(summary.applied, label).toBe(checked.length);
      checkInvariants(next, label);
      const remaining = computeSyncPlan(next).changes;
      expect(remaining.map(changeKey).sort(), label).toEqual(unchecked.map(changeKey).sort());
      // Unchecked removals must not have happened.
      if (!checked.some((c) => c.kind === 'remove-component')) {
        expect(placementOf(next, s.serverId), label).toMatchObject({ rackId: s.rackId, uPosition: 1 });
      }
      if (!checked.some((c) => c.kind === 'remove-link')) {
        expect(next.routes[s.uplinkId], label).toBeDefined();
      }
      if (!checked.some((c) => c.kind === 'link-endpoint-changed')) {
        expect(next.routes[s.downlinkId]?.needsReview, label).toBeUndefined();
      }
      const { next: final } = apply(next, remaining);
      expect(computeSyncPlan(final).changes, label).toEqual([]);
      expect(canonical(final), label).toEqual(full);
    }
  });

  it('applying nothing changes nothing, even when the schematic has deleted devices', () => {
    const s = buildSevenKinds();
    const { next, summary } = apply(s.project, []);
    expect(summary).toEqual({ applied: 0, removedRoutes: [], unplaced: [] });
    expect(next).toBe(s.project);
  });

  it('an unchecked component removal keeps its rack slot, so undoing the schematic delete restores the device in place', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    const deleted = edit(p, (d) => {
      d.components = d.components.filter((c) => c.id !== f.serverId);
      d.links = d.links.filter((l) => l.id !== f.downlinkId);
      component(d, f.leafId).ref = 'LEAF1';
    });
    const plan = computeSyncPlan(deleted).changes;
    const { next } = apply(deleted, plan.filter((c) => c.kind === 'ref-renamed'));
    expect(placementOf(next, f.serverId)).toEqual({ componentId: f.serverId, rackId: f.rackId, uPosition: 1, face: 'front' });
    // "Undo" the deletion: the device is back where it was and only its link is still pending.
    p = edit(next, (d) => {
      d.components.push(component(deleted === p ? p : f.project, f.serverId));
    });
    expect(placementOf(p, f.serverId)).toMatchObject({ rackId: f.rackId, uPosition: 1 });
    expect(kinds(computeSyncPlan(p).changes)).toEqual(['remove-link']);
  });
});

// ---------------------------------------------------------------------------
// Stale plans
// ---------------------------------------------------------------------------

describe('stale plans', () => {
  it('a remove-component for a device that exists again is skipped and keeps its placement and routes', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      addRoute(d, f.downlinkId);
    });
    const deleted = edit(p, (d) => {
      d.components = d.components.filter((c) => c.id !== f.serverId);
      d.links = d.links.filter((l) => l.id !== f.downlinkId);
    });
    const plan = computeSyncPlan(deleted).changes;
    expect(kinds(plan)).toEqual(['remove-component', 'remove-link']);
    // The deletion was undone before Apply.
    const { next, summary } = apply(p, plan);
    expect(summary).toEqual({ applied: 0, removedRoutes: [], unplaced: [] });
    expect(placementOf(next, f.serverId)).toMatchObject({ rackId: f.rackId, uPosition: 1 });
    expect(next.routes[f.downlinkId]).toBeDefined();
    expect(next.syncState).toEqual(p.syncState);
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('a remove-link for a link that exists again is skipped and keeps its pinned waypoints', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      addRoute(d, f.uplinkId);
    });
    const deleted = edit(p, (d) => {
      d.links = d.links.filter((l) => l.id !== f.uplinkId);
    });
    const plan = computeSyncPlan(deleted).changes;
    const { next, summary } = apply(p, plan);
    expect(summary.applied).toBe(0);
    expect(next.routes[f.uplinkId]).toBe(p.routes[f.uplinkId]);
    expect(next.syncState.links[f.uplinkId]).toBeDefined();
  });

  it('a footprint-changed whose subject vanished is skipped', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    const changed = edit(p, (d) => {
      component(d, f.serverId).footprintDefId = GPU_4U_FP;
    });
    const plan = computeSyncPlan(changed).changes;
    p = edit(p, (d) => {
      d.components = d.components.filter((c) => c.id !== f.serverId);
      d.links = d.links.filter((l) => l.id !== f.downlinkId);
    });
    const { next, summary } = apply(p, plan);
    expect(summary.applied).toBe(0);
    expect(next.syncState.components[f.serverId]).toEqual({ ref: 'SRV1', footprintDefId: SERVER_1U_FP });
  });
});

// ---------------------------------------------------------------------------
// Back-annotation
// ---------------------------------------------------------------------------

describe('back-annotation acceptance updates both the schematic and syncState', () => {
  it('port swap on end b, with the link routed, leaves the layout in sync and the route unflagged', () => {
    const f = buildFabric();
    let p = edit(f.project, (d) => {
      component(d, f.spineId).optics['eth1/1'] = 'xcvr.400g-dr4';
    });
    p = syncAll(p);
    p = edit(p, (d) => {
      addRoute(d, f.uplinkId);
    });
    const { next: proposed, annotation } = propose(p, (d) => proposePortSwap(d, f.uplinkId, 'b', 'eth1/32'));
    const { next, result } = accept(proposed, annotation.id);
    expect(result).toEqual({ ok: true, annotation, unplaced: false });
    expect(link(next, f.uplinkId).b).toEqual({ componentId: f.spineId, portId: 'eth1/32' });
    expect(link(next, f.uplinkId).a).toEqual({ componentId: f.leafId, portId: 'eth1/49' });
    expect(next.syncState.links[f.uplinkId]).toEqual({
      a: { componentId: f.leafId, portId: 'eth1/49' },
      b: { componentId: f.spineId, portId: 'eth1/32' },
    });
    expect(component(next, f.spineId).optics).toEqual({ 'eth1/32': 'xcvr.400g-dr4' });
    expect(next.routes[f.uplinkId]).toBe(p.routes[f.uplinkId]);
    expect(next.backAnnotations).toEqual([]);
    expect(isOutOfSync(next)).toBe(false);
  });

  it('port swap of one breakout lane keeps the lane and leaves the shared optic on the old port', () => {
    const f = buildFabric();
    let p = edit(f.project, (d) => {
      const leaf = component(d, f.leafId);
      leaf.optics['eth1/50'] = 'xcvr.100g-sr4';
      leaf.optics['eth1/51'] = 'xcvr.100g-sr4';
      link(d, f.uplinkId).a = { componentId: f.leafId, portId: 'eth1/50', lane: 0 };
      d.links.push(
        createLink({ componentId: f.leafId, portId: 'eth1/50', lane: 1 }, { componentId: f.spineId, portId: 'eth1/2' }),
      );
    });
    p = syncAll(p);
    const { next: proposed, annotation } = propose(p, (d) => proposePortSwap(d, f.uplinkId, 'a', 'eth1/51'));
    const { next, result } = accept(proposed, annotation.id);
    expect(result).toMatchObject({ ok: true });
    expect(link(next, f.uplinkId).a).toEqual({ componentId: f.leafId, portId: 'eth1/51', lane: 0 });
    expect(next.syncState.links[f.uplinkId]!.a).toEqual({ componentId: f.leafId, portId: 'eth1/51', lane: 0 });
    // Lane 1 still lives on eth1/50, so its optic must stay there.
    expect(component(next, f.leafId).optics).toEqual({ 'eth1/50': 'xcvr.100g-sr4', 'eth1/51': 'xcvr.100g-sr4' });
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('port swap of the last lane on a port takes the optic along', () => {
    const f = buildFabric();
    let p = edit(f.project, (d) => {
      component(d, f.leafId).optics['eth1/50'] = 'xcvr.100g-sr4';
      link(d, f.uplinkId).a = { componentId: f.leafId, portId: 'eth1/50', lane: 3 };
    });
    p = syncAll(p);
    const { next: proposed, annotation } = propose(p, (d) => proposePortSwap(d, f.uplinkId, 'a', 'eth1/52'));
    const { next } = accept(proposed, annotation.id);
    expect(component(next, f.leafId).optics).toEqual({ 'eth1/52': 'xcvr.100g-sr4' });
  });

  it('accepting a swap on a link that was never synced updates the schematic only; F8 then lists it as new', () => {
    const f = buildFabric();
    const { next: proposed, annotation } = propose(f.project, (d) => proposePortSwap(d, f.uplinkId, 'a', 'eth1/50'));
    const { next, result } = accept(proposed, annotation.id);
    expect(result).toMatchObject({ ok: true });
    expect(link(next, f.uplinkId).a.portId).toBe('eth1/50');
    expect(next.syncState.links).toEqual({});
    expect(computeSyncPlan(next).changes.find((c) => c.kind === 'add-link' && c.linkId === f.uplinkId)).toMatchObject({
      label: 'SW1:eth1/50 — SW2:eth1/1',
    });
  });

  it('accepting a swap while the other end has an unapplied schematic change leaves only that end pending', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    const { next: proposed, annotation } = propose(p, (d) => proposePortSwap(d, f.uplinkId, 'a', 'eth1/50'));
    p = edit(proposed, (d) => {
      link(d, f.uplinkId).b.portId = 'eth1/20';
    });
    const { next, result } = accept(p, annotation.id);
    expect(result).toMatchObject({ ok: true });
    expect(next.syncState.links[f.uplinkId]).toEqual({
      a: { componentId: f.leafId, portId: 'eth1/50' },
      b: { componentId: f.spineId, portId: 'eth1/1' },
    });
    expect(computeSyncPlan(next).changes).toEqual([
      { kind: 'link-endpoint-changed', linkId: f.uplinkId, label: 'SW1:eth1/50 — SW2:eth1/20' },
    ]);
  });

  it('accepting a model change that collides with a neighbour unplaces the device and keeps syncState consistent', () => {
    const f = buildFabric();
    let p = edit(f.project, (d) => place(d, f.leafId, f.rackId, 2));
    p = syncAll(p);
    let annotation!: BackAnnotation;
    const proposed = produce(p, (d) => {
      annotation = { id: 'ba1', kind: 'footprint-change', componentId: f.serverId, from: SERVER_1U_FP, to: SERVER_2U_FP };
      d.backAnnotations.push(annotation);
    });
    const { next, result } = accept(proposed, 'ba1');
    expect(result).toEqual({ ok: true, annotation, unplaced: true });
    expect(component(next, f.serverId).footprintDefId).toBe(SERVER_2U_FP);
    expect(placementOf(next, f.serverId)).toMatchObject({ rackId: null, uPosition: null });
    expect(placementOf(next, f.leafId)).toMatchObject({ rackId: f.rackId, uPosition: 2 });
    expect(next.syncState.components[f.serverId]).toEqual({ ref: 'SRV1', footprintDefId: SERVER_2U_FP });
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('a proposal can be accepted only once', () => {
    const f = buildFabric();
    const p = syncAll(f.project);
    const { next: proposed, annotation } = propose(p, (d) => proposeRefRename(d, f.leafId, 'LEAF1'));
    const first = accept(proposed, annotation.id);
    expect(first.result).toMatchObject({ ok: true });
    const second = accept(first.next, annotation.id);
    expect(second.result).toEqual({ ok: false, error: `No pending back-annotation ${annotation.id}` });
    expect(second.next).toBe(first.next);
  });

  it('accepting one proposal leaves unrelated proposals pending', () => {
    const f = buildFabric();
    const p = syncAll(f.project);
    const a = propose(p, (d) => proposeRefRename(d, f.leafId, 'LEAF1'));
    const b = propose(a.next, (d) => proposePortSwap(d, f.uplinkId, 'a', 'eth1/50'));
    const { next, result } = accept(b.next, a.annotation.id);
    expect(result).toMatchObject({ ok: true });
    expect(next.backAnnotations).toEqual([b.annotation]);
    const swapped = accept(next, b.annotation.id);
    expect(swapped.result).toMatchObject({ ok: true });
    expect(swapped.next.backAnnotations).toEqual([]);
    expect(isOutOfSync(swapped.next)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Ref uniqueness
// ---------------------------------------------------------------------------

describe('ref uniqueness', () => {
  it('is enforced after trimming and across sheets', () => {
    const f = buildFabric();
    const p = edit(f.project, (d) => {
      d.sheets.push({ id: 'podA', name: 'Pod A', parentId: 'root' });
      const other = createComponent(symbol(SERVER_SYM), { sheetId: 'podA', pos: { x: 0, y: 0 }, ref: 'SRV7' });
      d.components.push(other);
    });
    expect(validateRefRename(p, f.leafId, ' SW2 ')).toMatch(/already used/);
    expect(validateRefRename(p, f.leafId, 'SRV7')).toMatch(/already used/);
    expect(validateRefRename(p, f.leafId, ' SW1')).toMatch(/already has/);
    expect(validateRefRename(p, f.leafId, 'SW3')).toBeNull();
  });

  it('two proposals for the same new ref: the first accepted wins, the second fails and stays pending', () => {
    const f = buildFabric();
    const p = syncAll(f.project);
    const a = propose(p, (d) => proposeRefRename(d, f.leafId, 'X1'));
    const b = propose(a.next, (d) => proposeRefRename(d, f.spineId, 'X1'));
    expect(b.next.backAnnotations).toHaveLength(2);
    const first = accept(b.next, a.annotation.id);
    expect(first.result).toMatchObject({ ok: true });
    const second = accept(first.next, b.annotation.id);
    expect(second.result).toEqual({ ok: false, error: 'Reference X1 is already used by another component' });
    expect(second.next.backAnnotations).toEqual([b.annotation]);
    expect(second.next.components.map((c) => c.ref)).toEqual(['X1', 'SW2', 'SRV1']);
    expect(second.next.syncState.components[f.leafId]!.ref).toBe('X1');
    expect(second.next.syncState.components[f.spineId]!.ref).toBe('SW2');
  });

  it('a swap of two refs done in the schematic round-trips through F8 without touching placements', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      component(d, f.leafId).ref = 'TMP';
      component(d, f.spineId).ref = 'SW1';
      component(d, f.leafId).ref = 'SW2';
    });
    const { next } = apply(p, computeSyncPlan(p).changes);
    expect(next.syncState.components[f.leafId]!.ref).toBe('SW2');
    expect(next.syncState.components[f.spineId]!.ref).toBe('SW1');
    expect(placementOf(next, f.leafId)).toMatchObject({ uPosition: 10 });
    expect(placementOf(next, f.spineId)).toMatchObject({ uPosition: 20 });
    expect(computeSyncPlan(next).changes).toEqual([]);
  });
});
