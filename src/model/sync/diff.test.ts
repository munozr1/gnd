import { describe, expect, it } from 'vitest';
import { createComponent, createLink } from '@/model/factories';
import { indexProject } from '@/model/query';
import type { SyncChange } from '@/model/types';
import { changeKey, computeSyncPlan, footprintFits, isOutOfSync, routesTouchingComponent } from './diff';
import {
  GPU_4U_FP,
  SERVER_2U_FP,
  SERVER_SYM,
  addRoute,
  buildFabric,
  edit,
  place,
  symbol,
  syncAll,
} from './testFixtures';

const kinds = (changes: SyncChange[]) => changes.map((c) => c.kind);

describe('computeSyncPlan', () => {
  it('lists every component and link as an add on a never-synced project, components first', () => {
    const f = buildFabric();
    const { changes } = computeSyncPlan(f.project);
    expect(changes).toEqual([
      { kind: 'add-component', componentId: f.leafId, ref: 'SW1' },
      { kind: 'add-component', componentId: f.spineId, ref: 'SW2' },
      { kind: 'add-component', componentId: f.serverId, ref: 'SRV1' },
      { kind: 'add-link', linkId: f.uplinkId, label: 'SW1:eth1/49 — SW2:eth1/1' },
      { kind: 'add-link', linkId: f.downlinkId, label: 'SRV1:eth0 — SW1:eth1/1' },
    ]);
    expect(isOutOfSync(f.project)).toBe(true);
  });

  it('is empty once applied, and an empty project is in sync', () => {
    const f = buildFabric();
    const synced = syncAll(f.project);
    expect(computeSyncPlan(synced).changes).toEqual([]);
    expect(isOutOfSync(synced)).toBe(false);
  });

  it('reports a deleted component with the routes it orphans, plus its deleted links', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      addRoute(d, f.uplinkId);
    });
    p = edit(p, (d) => {
      d.components = d.components.filter((c) => c.id !== f.spineId);
      d.links = d.links.filter((l) => l.id !== f.uplinkId);
    });
    const { changes } = computeSyncPlan(p);
    expect(changes).toEqual([
      { kind: 'remove-component', componentId: f.spineId, ref: 'SW2', orphanedRouteIds: [f.uplinkId] },
      { kind: 'remove-link', linkId: f.uplinkId, label: 'SW1:eth1/49 — SW2:eth1/1', hadRoute: true },
    ]);
  });

  it('reports a deleted link with hadRoute=false when it was never routed', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      d.links = d.links.filter((l) => l.id !== f.downlinkId);
    });
    expect(computeSyncPlan(p).changes).toEqual([
      { kind: 'remove-link', linkId: f.downlinkId, label: 'SRV1:eth0 — SW1:eth1/1', hadRoute: false },
    ]);
  });

  describe('footprint-changed', () => {
    it('fits when the taller model still clears the rack top and its neighbours', () => {
      const f = buildFabric();
      let p = syncAll(f.project);
      p = edit(p, (d) => {
        d.components.find((c) => c.id === f.serverId)!.footprintDefId = SERVER_2U_FP;
      });
      expect(computeSyncPlan(p).changes).toEqual([
        {
          kind: 'footprint-changed',
          componentId: f.serverId,
          ref: 'SRV1',
          from: 'fp.server-1u',
          to: SERVER_2U_FP,
          fits: true,
        },
      ]);
    });

    it('does not fit when a 4U model at U42 of a 42U rack would overhang', () => {
      const f = buildFabric();
      let p = edit(f.project, (d) => place(d, f.serverId, f.rackId, 42));
      p = syncAll(p);
      p = edit(p, (d) => {
        d.components.find((c) => c.id === f.serverId)!.footprintDefId = GPU_4U_FP;
      });
      const [change] = computeSyncPlan(p).changes;
      expect(change).toMatchObject({ kind: 'footprint-changed', to: GPU_4U_FP, fits: false });
    });

    it('does not fit when the taller model would collide with a neighbour', () => {
      const f = buildFabric();
      let p = edit(f.project, (d) => {
        // Neighbour directly above SRV1 (U1).
        const other = createComponent(symbol(SERVER_SYM), { sheetId: 'root', pos: { x: 0, y: 0 }, ref: 'SRV2' });
        d.components.push(other);
        place(d, other.id, f.rackId, 2);
      });
      p = syncAll(p);
      p = edit(p, (d) => {
        d.components.find((c) => c.id === f.serverId)!.footprintDefId = SERVER_2U_FP;
      });
      const [change] = computeSyncPlan(p).changes;
      expect(change).toMatchObject({ kind: 'footprint-changed', componentId: f.serverId, fits: false });
    });

    it('always fits for an unplaced component', () => {
      const f = buildFabric();
      let p = edit(f.project, (d) => place(d, f.serverId, null, null));
      p = syncAll(p);
      p = edit(p, (d) => {
        d.components.find((c) => c.id === f.serverId)!.footprintDefId = GPU_4U_FP;
      });
      const [change] = computeSyncPlan(p).changes;
      expect(change).toMatchObject({ kind: 'footprint-changed', fits: true });
    });

    it('footprintFits uses the candidate model height, not the live one', () => {
      const f = buildFabric();
      const p = syncAll(f.project);
      const idx = indexProject(p);
      // SRV1 at U1, SW1 at U10, SW2 at U20: a 4U model fits any of them without touching a neighbour.
      expect(footprintFits(idx, f.serverId, SERVER_2U_FP)).toBe(true);
      expect(footprintFits(idx, f.serverId, GPU_4U_FP)).toBe(true);
      expect(footprintFits(idx, f.leafId, GPU_4U_FP)).toBe(true);
      expect(footprintFits(idx, f.spineId, GPU_4U_FP)).toBe(true);
    });
  });

  it('reports only ref-renamed when a component is re-annotated', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      d.components.find((c) => c.id === f.leafId)!.ref = 'LEAF1';
    });
    expect(computeSyncPlan(p).changes).toEqual([
      { kind: 'ref-renamed', componentId: f.leafId, from: 'SW1', to: 'LEAF1' },
    ]);
  });

  it('reports link-endpoint-changed for a port, component or lane change on either end', () => {
    const f = buildFabric();
    const p = syncAll(f.project);
    const changedPort = edit(p, (d) => {
      d.links.find((l) => l.id === f.uplinkId)!.a.portId = 'eth1/50';
    });
    expect(computeSyncPlan(changedPort).changes).toEqual([
      { kind: 'link-endpoint-changed', linkId: f.uplinkId, label: 'SW1:eth1/50 — SW2:eth1/1' },
    ]);

    const changedComponent = edit(p, (d) => {
      d.links.find((l) => l.id === f.downlinkId)!.b.componentId = f.spineId;
    });
    expect(kinds(computeSyncPlan(changedComponent).changes)).toEqual(['link-endpoint-changed']);

    const changedLane = edit(p, (d) => {
      d.links.find((l) => l.id === f.uplinkId)!.b.lane = 0;
    });
    expect(kinds(computeSyncPlan(changedLane).changes)).toEqual(['link-endpoint-changed']);
  });

  it('orders changes by group, then schematic order; removals sorted by ref/label', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      // Remove SRV1 (and its downlink), rename SW2, add SRV9 + a link, change SW1 model, retarget the uplink.
      d.components = d.components.filter((c) => c.id !== f.serverId);
      d.links = d.links.filter((l) => l.id !== f.downlinkId);
      d.components.find((c) => c.id === f.spineId)!.ref = 'SPINE1';
      d.components.find((c) => c.id === f.leafId)!.footprintDefId = SERVER_2U_FP;
      const srv = createComponent(symbol(SERVER_SYM), { sheetId: 'root', pos: { x: 0, y: 0 }, ref: 'SRV9' });
      d.components.push(srv);
      d.links.push(createLink({ componentId: srv.id, portId: 'eth0' }, { componentId: f.leafId, portId: 'eth1/2' }));
      d.links.find((l) => l.id === f.uplinkId)!.b.portId = 'eth1/2';
    });
    expect(kinds(computeSyncPlan(p).changes)).toEqual([
      'add-component',
      'remove-component',
      'footprint-changed',
      'ref-renamed',
      'add-link',
      'remove-link',
      'link-endpoint-changed',
    ]);
  });

  it('sorts removed components by their last-synced ref', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      d.components = [];
      d.links = [];
    });
    const refs = computeSyncPlan(p)
      .changes.filter((c) => c.kind === 'remove-component')
      .map((c) => (c.kind === 'remove-component' ? c.ref : ''));
    expect(refs).toEqual(['SRV1', 'SW1', 'SW2']);
  });

  it('labels a removed link with the last-synced refs when its components are gone too', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      d.components = d.components.filter((c) => c.id !== f.serverId && c.id !== f.leafId);
      d.links = d.links.filter((l) => l.id !== f.downlinkId && l.id !== f.uplinkId);
    });
    const removed = computeSyncPlan(p).changes.find((c) => c.kind === 'remove-link' && c.linkId === f.downlinkId);
    expect(removed).toMatchObject({ label: 'SRV1:eth0 — SW1:eth1/1', hadRoute: false });
  });
});

describe('routesTouchingComponent', () => {
  it('finds routes via live links and via last-synced links', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      addRoute(d, f.uplinkId);
      addRoute(d, f.downlinkId);
    });
    expect(routesTouchingComponent(p, f.leafId).sort()).toEqual([f.uplinkId, f.downlinkId].sort());
    expect(routesTouchingComponent(p, f.spineId)).toEqual([f.uplinkId]);
    const gone = edit(p, (d) => {
      d.links = [];
    });
    expect(routesTouchingComponent(gone, f.spineId)).toEqual([f.uplinkId]);
  });
});

describe('changeKey', () => {
  it('is unique per change and stable across recomputation', () => {
    const f = buildFabric();
    let p = syncAll(f.project);
    p = edit(p, (d) => {
      const leaf = d.components.find((c) => c.id === f.leafId)!;
      leaf.ref = 'LEAF1';
      leaf.footprintDefId = SERVER_2U_FP;
    });
    const keys = computeSyncPlan(p).changes.map(changeKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual([`footprint-changed:${f.leafId}`, `ref-renamed:${f.leafId}`]);
    expect(computeSyncPlan(p).changes.map(changeKey)).toEqual(keys);
  });
});
