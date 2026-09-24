/**
 * Fixture builders shared by the routing and DRC tests. Not a test file.
 */
import { builtinCatalog } from '@/catalog';
import {
  ROOT_SHEET_ID,
  createComponent,
  createLink,
  createPlacement,
  createProject,
  createRack,
  createTray,
  createWaypoint,
  newId,
} from '../factories';
import type {
  Component,
  Face,
  Id,
  Link,
  Project,
  Rack,
  RackAccessory,
  RackAccessoryType,
  Rotation,
  Route,
  RoutingLayer,
  Side,
  Tray,
  TrayFitting,
  Vec2,
} from '../types';
import { autoInRackPath } from './dressing';

export const symbolDef = (id: string) => {
  const s = builtinCatalog.symbols.find((x) => x.id === id);
  if (!s) throw new Error(`no symbol ${id}`);
  return s;
};
export const trayDef = (id: string) => {
  const t = builtinCatalog.trays.find((x) => x.id === id);
  if (!t) throw new Error(`no tray def ${id}`);
  return t;
};
export const standardRack = builtinCatalog.racks.find((r) => r.id === 'rack.standard-42u')!;

export function addRack(project: Project, name: string, pos: Vec2, rotationDeg: Rotation = 0): Rack {
  const rack = createRack(standardRack, { name, pos });
  rack.rotationDeg = rotationDeg;
  project.racks.push(rack);
  return rack;
}

export function addDevice(
  project: Project,
  symbolId: string,
  ref: string,
  opts: { rackId?: Id; u?: number; face?: Face; optics?: Record<string, string> } = {},
): Component {
  const c = createComponent(symbolDef(symbolId), { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref });
  if (opts.optics) c.optics = { ...opts.optics };
  project.components.push(c);
  const p = createPlacement(c.id);
  if (opts.rackId !== undefined && opts.u !== undefined) {
    p.rackId = opts.rackId;
    p.uPosition = opts.u;
  }
  p.face = opts.face ?? 'front';
  project.placements.push(p);
  return c;
}

export function place(project: Project, componentId: Id, rackId: Id | null, u: number | null, face: Face = 'front'): void {
  const p = project.placements.find((x) => x.componentId === componentId);
  if (!p) throw new Error('no placement');
  p.rackId = rackId;
  p.uPosition = u;
  p.face = face;
}

export function addLink(
  project: Project,
  a: [Component, string],
  b: [Component, string],
  cableDefId: string | null = 'cbl.om4-mpo-trunk',
): Link {
  const link = createLink({ componentId: a[0].id, portId: a[1] }, { componentId: b[0].id, portId: b[1] }, cableDefId);
  project.links.push(link);
  return link;
}

export function addAccessory(
  project: Project,
  rackId: Id,
  type: RackAccessoryType,
  opts: { side?: Side | 'center'; face?: Face; widthMm?: number } = {},
): RackAccessory {
  const acc: RackAccessory = { id: newId(), rackId, type, ...opts };
  project.accessories.push(acc);
  return acc;
}

export function addTray(
  project: Project,
  defId: string,
  points: Vec2[],
  elevationMm: number,
  fittings: TrayFitting[] = [],
): Tray {
  const tray = createTray(trayDef(defId), points, elevationMm);
  tray.fittings = fittings;
  project.trays.push(tray);
  return tray;
}

export interface SegmentSpec {
  layer: RoutingLayer;
  trayId?: Id | null;
  points: Vec2[];
  pinned?: boolean;
}

/**
 * `indexProject` memoises per object identity and these fixtures mutate the
 * project in place, so readers called after a mutation must index a fresh
 * shallow copy (the nested arrays and objects are shared).
 */
export const fresh = (project: Project): Project => ({ ...project });

export function removePlacement(project: Project, componentId: Id): void {
  const i = project.placements.findIndex((p) => p.componentId === componentId);
  if (i >= 0) project.placements.splice(i, 1);
}

export function addRoute(project: Project, linkId: Id, segments: SegmentSpec[]): Route {
  const link = project.links.find((l) => l.id === linkId);
  if (!link) throw new Error('no link');
  const view = fresh(project);
  const route: Route = {
    linkId,
    aRack: autoInRackPath(view, link.a.componentId, link.a.portId),
    bRack: autoInRackPath(view, link.b.componentId, link.b.portId),
    segments: segments.map((s) => ({
      layer: s.layer,
      trayId: s.trayId ?? null,
      points: s.points.map((p) => createWaypoint(p, s.pinned ?? false)),
    })),
  };
  project.routes[linkId] = route;
  return route;
}

export interface TwoRackFixture {
  project: Project;
  r1: Rack;
  r2: Rack;
  sw1: Component;
  sw2: Component;
  link: Link;
  tray: Tray;
}

/**
 * Two 42U racks on a row (R01 at (1000,1000), R02 at `rack2X`), each with left
 * and right managers and top entries; a leaf in R01 U40 and a spine in R02
 * U40 joined by a 100G-SR4 link on an OM4 MPO trunk; a fiber runway at
 * 2600 mm running above the row at y = 500 with waterfalls over both racks.
 */
export function twoRackFixture(opts: { rack2X?: number; managers?: boolean; topEntries?: boolean } = {}): TwoRackFixture {
  const project = createProject('fixture', '2026-01-01T00:00:00.000Z');
  const rack2X = opts.rack2X ?? 4000;
  const r1 = addRack(project, 'R01', { x: 1000, y: 1000 });
  const r2 = addRack(project, 'R02', { x: rack2X, y: 1000 });
  for (const r of [r1, r2]) {
    if (opts.managers !== false) {
      addAccessory(project, r.id, 'vcm', { side: 'left', widthMm: 152 });
      addAccessory(project, r.id, 'vcm', { side: 'right', widthMm: 152 });
    }
    if (opts.topEntries !== false) {
      addAccessory(project, r.id, 'top-entry', { side: 'left' });
      addAccessory(project, r.id, 'top-entry', { side: 'right' });
    }
  }
  const sw1 = addDevice(project, 'sym.leaf-switch-48x25-8x100', 'SW1', {
    rackId: r1.id,
    u: 40,
    optics: { 'eth1/49': 'xcvr.100g-sr4' },
  });
  const sw2 = addDevice(project, 'sym.spine-switch-32x400', 'SW2', {
    rackId: r2.id,
    u: 40,
    optics: { 'eth1/1': 'xcvr.100g-sr4' },
  });
  const link = addLink(project, [sw1, 'eth1/49'], [sw2, 'eth1/1'], 'cbl.om4-mpo-trunk');
  const tray = addTray(
    project,
    'tray.fiber-runway-6',
    [
      { x: 500, y: 500 },
      { x: rack2X + 1000, y: 500 },
    ],
    2600,
    [
      { at: { x: 1150, y: 500 }, type: 'waterfall', rackId: r1.id },
      { at: { x: rack2X + 150, y: 500 }, type: 'waterfall', rackId: r2.id },
    ],
  );
  return { project, r1, r2, sw1, sw2, link, tray };
}

/** Standard overhead route for the two-rack fixture: up from R01's left entry to the tray, along it, down at R02's left entry. */
export function routeTwoRacks(f: TwoRackFixture, pinned = false): Route {
  return addRoute(f.project, f.link.id, [
    {
      layer: 'overhead',
      trayId: f.tray.id,
      pinned,
      points: [
        { x: 1150, y: 500 },
        { x: f.r2.pos.x + 150, y: 500 },
      ],
    },
  ]);
}
