/**
 * Shared fixtures for the sync tests. Every edit goes through Immer's
 * `produce` so `indexProject`'s identity memo sees a fresh object, exactly as
 * the store does.
 */
import { produce } from 'immer';
import { builtinCatalog } from '@/catalog';
import { createComponent, createLink, createProject, createRack, createWaypoint } from '@/model/factories';
import type { Id, Project, Route, Vec2 } from '@/model/types';
import { applySyncPlan } from './apply';
import { computeSyncPlan } from './diff';

export const LEAF_SYM = 'sym.leaf-switch-48x25-8x100';
export const SPINE_SYM = 'sym.spine-switch-32x400';
export const SERVER_SYM = 'sym.server-1u';
export const SERVER_1U_FP = 'fp.server-1u';
export const SERVER_2U_FP = 'fp.server-2u';
export const GPU_4U_FP = 'fp.gpu-server-4u';
export const RACK_42U = 'rack.standard-42u';
export const OM4 = 'cbl.om4-duplex';

export const symbol = (id: string) => {
  const s = builtinCatalog.symbols.find((x) => x.id === id);
  if (!s) throw new Error(`fixture: no symbol ${id}`);
  return s;
};
export const rackDef = (id: string) => {
  const r = builtinCatalog.racks.find((x) => x.id === id);
  if (!r) throw new Error(`fixture: no rack ${id}`);
  return r;
};

export interface Fabric {
  project: Project;
  rackId: Id;
  /** SW1, leaf at U10. */
  leafId: Id;
  /** SW2, spine (2U) at U20. */
  spineId: Id;
  /** SRV1, 1U server at U1. */
  serverId: Id;
  /** SW1:eth1/49 -> SW2:eth1/1 over OM4. */
  uplinkId: Id;
  /** SRV1:eth0 -> SW1:eth1/1. */
  downlinkId: Id;
}

/** One rack with a leaf, a spine and a server, all placed, nothing synced yet. */
export function buildFabric(): Fabric {
  const project = createProject('fixture', '2026-01-01T00:00:00.000Z');
  const rack = createRack(rackDef(RACK_42U), { name: 'R1', pos: { x: 0, y: 0 } });
  const leaf = createComponent(symbol(LEAF_SYM), { sheetId: 'root', pos: { x: 0, y: 0 }, ref: 'SW1' });
  const spine = createComponent(symbol(SPINE_SYM), { sheetId: 'root', pos: { x: 200, y: 0 }, ref: 'SW2' });
  const server = createComponent(symbol(SERVER_SYM), { sheetId: 'root', pos: { x: 0, y: 200 }, ref: 'SRV1' });
  const uplink = createLink(
    { componentId: leaf.id, portId: 'eth1/49' },
    { componentId: spine.id, portId: 'eth1/1' },
    OM4,
  );
  const downlink = createLink({ componentId: server.id, portId: 'eth0' }, { componentId: leaf.id, portId: 'eth1/1' });
  project.racks.push(rack);
  project.components.push(leaf, spine, server);
  project.links.push(uplink, downlink);
  project.placements.push(
    { componentId: leaf.id, rackId: rack.id, uPosition: 10, face: 'front' },
    { componentId: spine.id, rackId: rack.id, uPosition: 20, face: 'front' },
    { componentId: server.id, rackId: rack.id, uPosition: 1, face: 'front' },
  );
  return {
    project: produce(project, () => {}),
    rackId: rack.id,
    leafId: leaf.id,
    spineId: spine.id,
    serverId: server.id,
    uplinkId: uplink.id,
    downlinkId: downlink.id,
  };
}

export const edit = (project: Project, recipe: (draft: Project) => void): Project => produce(project, recipe);

/** F8 with everything checked. */
export function syncAll(project: Project): Project {
  const plan = computeSyncPlan(project);
  return produce(project, (draft) => {
    applySyncPlan(draft, plan.changes);
  });
}

export function place(draft: Project, componentId: Id, rackId: Id | null, uPosition: number | null): void {
  const p = draft.placements.find((x) => x.componentId === componentId);
  if (p) {
    p.rackId = rackId;
    p.uPosition = uPosition;
  } else {
    draft.placements.push({ componentId, rackId, uPosition, face: 'front' });
  }
}

/** A hand route with one overhead segment of pinned waypoints. */
export function addRoute(draft: Project, linkId: Id, points: Vec2[] = [{ x: 100, y: 100 }, { x: 900, y: 100 }]): Route {
  const route: Route = {
    linkId,
    aRack: { side: 'left', entry: null, pinned: false },
    bRack: { side: 'right', entry: null, pinned: false },
    segments: [{ layer: 'overhead', trayId: null, points: points.map((p) => createWaypoint(p, true)) }],
  };
  draft.routes[linkId] = route;
  return route;
}

export const placementOf = (project: Project, componentId: Id) =>
  project.placements.find((p) => p.componentId === componentId);
