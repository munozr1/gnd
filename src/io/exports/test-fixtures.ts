/**
 * Fixture builders shared by the export tests. Not a test file.
 */
import { produce } from 'immer';
import { builtinCatalog } from '@/catalog';
import { autoFillCableSide, plugCableLeg } from '@/model/cables';
import { createCable } from '@/model/factories';
import { newRouteFromPoints } from '@/model/routing';
import { addDevice, fresh, twoRackFixture, type TwoRackFixture } from '@/model/routing/test-fixtures';
import type { Cable, Component, Id, Project } from '@/model/types';

export const TRUNK_DEF = builtinCatalog.cables.find((c) => c.id === 'cbl.om4-8f-mpo8-4lc')!;
export const PANEL = 'sym.fiber-patch-panel-24lc';

export interface TrunkFixture extends TwoRackFixture {
  panel: Component;
  /** 8F MPO-8 → 4×LC trunk, eth1/50 → f1..f4, fully plugged. */
  cable: Cable;
}

/**
 * The routing two-rack fixture (leaf SW1 in R01 U40, spine SW2 in R02 U40,
 * one plain link on eth1/49, a runway over the row) plus an LC panel PP1 in
 * R02 U10 and an installed 8F MPO-8 → 4×LC trunk CBL1 plugged SW1 eth1/50
 * (100G-SR4) → PP1 f1..f4. The trunk owns four lane links.
 */
export function trunkFixture(): TrunkFixture {
  const f = twoRackFixture();
  const panel = addDevice(f.project, PANEL, 'PP1', { rackId: f.r2.id, u: 10 });
  f.sw1.optics['eth1/50'] = 'xcvr.100g-sr4';
  const cable = createCable(TRUNK_DEF, 'CBL1');
  f.project.cables.push(cable);
  const project = produce(fresh(f.project), (d) => {
    plugCableLeg(d, cable.id, 'A', 0, { componentId: f.sw1.id, portId: 'eth1/50' });
    autoFillCableSide(d, cable.id, 'B', { componentId: panel.id, portId: 'f1' });
  });
  return { ...f, project, panel, cable: project.cables.find((c) => c.id === cable.id)! };
}

/** A jacket route for a cable: up R01's left entry to the runway, along it and down R02's left entry, waypoints pinned. */
export function routeJacket(project: Project, cableId: Id, pinned = true): Project {
  return produce(project, (d) => {
    const tray = d.trays[0]!;
    const route = newRouteFromPoints(d, cableId, [{ layer: 'overhead', trayId: tray.id, points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }] }], pinned);
    if (!route) throw new Error('no route');
    d.routes[cableId] = route;
  });
}

/** Add another trunk of the same definition: side A on `portA` (given a 100G-SR4), side B auto-filled from `firstB`; unplugged when omitted. */
export function addTrunk(project: Project, label: string, opts: { sw: Component; portA?: string; panel: Component; firstB?: string; lengthM?: number }): { project: Project; cable: Cable } {
  const cable = createCable(TRUNK_DEF, label);
  if (opts.lengthM !== undefined) cable.lengthM = opts.lengthM;
  const next = produce(project, (d) => {
    if (opts.portA) d.components.find((c) => c.id === opts.sw.id)!.optics[opts.portA] = 'xcvr.100g-sr4';
    d.cables.push(cable);
    if (opts.portA) plugCableLeg(d, cable.id, 'A', 0, { componentId: opts.sw.id, portId: opts.portA });
    if (opts.firstB) autoFillCableSide(d, cable.id, 'B', { componentId: opts.panel.id, portId: opts.firstB });
  });
  return { project: next, cable: next.cables.find((c) => c.id === cable.id)! };
}
