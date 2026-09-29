import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { autoFillCableSide, furcationDefaultFloorPos, plugCableLeg } from '../cables';
import { unroutedLink } from '../drc/rules/unrouted-link';
import { createCable } from '../factories';
import { indexProject } from '../query';
import type { Cable, Project } from '../types';
import { cableLegs3d, furcationWorldPos, linkRoutedByCable, resolveEndsOf, resolveRouteEnds, routeFloorEndpoints, routeLabel, routeSelection } from './owner';
import { routeEndFloorPos, routePath3d } from './path3d';
import { portElevationMm, portFloorPos, portWorldPos } from './positions';
import { addDevice, addRack, fresh, place, routeTwoRacks, twoRackFixture } from './test-fixtures';
import { newRouteFromPoints, onEndpointMoved } from './waypoints';

const TRUNK = builtinCatalog.cables.find((c) => c.id === 'cbl.om4-8f-mpo8-4lc')!;
const PANEL = 'sym.fiber-patch-panel-24lc';

/**
 * Leaf SW1 in R01 U40 and LC panel PP1 in R02 U10 (the two-rack fixture's
 * racks, 3 m apart, with managers and top entries), joined by an 8F MPO-8 →
 * 4×LC trunk plugged eth1/50 (SR4) → f1..f4. The fixture's own eth1/49 link stays.
 */
function trunkFixture() {
  const f = twoRackFixture();
  const panel = addDevice(f.project, PANEL, 'PP1', { rackId: f.r2.id, u: 10 });
  // The fixture link already uses eth1/49; the trunk takes the next SR4 uplink.
  f.sw1.optics['eth1/50'] = 'xcvr.100g-sr4';
  const cable = createCable(TRUNK, 'CBL1');
  f.project.cables.push(cable);
  const project = produce(fresh(f.project), (d) => {
    plugCableLeg(d, cable.id, 'A', 0, { componentId: f.sw1.id, portId: 'eth1/50' });
    autoFillCableSide(d, cable.id, 'B', { componentId: panel.id, portId: 'f1' });
  });
  return { ...f, project, panel, cable: project.cables.find((c) => c.id === cable.id)! };
}

/** A jacket route for the trunk: up R01's left entry to the runway, along it and down R02's left entry, waypoints pinned. */
function routeJacket(project: Project, cable: Cable, pinned = true): Project {
  return produce(project, (d) => {
    const tray = d.trays[0]!;
    const route = newRouteFromPoints(d, cable.id, [{ layer: 'overhead', trayId: tray.id, points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }] }], pinned);
    if (!route) throw new Error('no route');
    d.routes[cable.id] = route;
  });
}

describe('resolveEndsOf / resolveRouteEnds', () => {
  it('resolves a link route exactly as before: its two ends, its cable def, no furcation', () => {
    const f = twoRackFixture();
    const route = routeTwoRacks(f);
    const idx = indexProject(fresh(f.project));
    const ends = resolveRouteEnds(idx, route)!;
    expect(ends.owner).toBe('link');
    expect(ends.a).toEqual(f.link.a);
    expect(ends.b).toEqual(f.link.b);
    expect(ends.link?.id).toBe(f.link.id);
    expect(ends.cableDef?.id).toBe('cbl.om4-mpo-trunk');
    expect(ends.cable).toBeUndefined();
    expect(ends.furcationA).toBeUndefined();
    expect(ends.furcationB).toBeUndefined();
    expect(routeLabel(idx, ends)).toBe(idx.linkLabel(f.link));
    expect(routeSelection(route)).toEqual({ kind: 'link', id: f.link.id });
  });

  it('resolves a cable id to the jacket: side A port → side B furcation, with the cable and its definition', () => {
    const { project, cable, sw1, panel } = trunkFixture();
    const idx = indexProject(project);
    const ends = resolveEndsOf(idx, cable.id)!;
    expect(ends.owner).toBe('cable');
    expect(ends.a).toEqual({ componentId: sw1.id, portId: 'eth1/50' });
    expect(ends.b).toEqual({ componentId: panel.id, portId: 'f1' });
    expect(ends.cable?.id).toBe(cable.id);
    expect(ends.link).toBeUndefined();
    expect(ends.cableDef?.id).toBe(TRUNK.id);
    // Side A is a single MPO leg (no fan-out); side B fans into four LC legs at the default breakout point.
    expect(ends.furcationA).toBeUndefined();
    expect(ends.furcationB).toEqual(furcationDefaultFloorPos(project, cable, 'B'));
    expect(routeLabel(idx, ends)).toBe('CBL1');
    expect(routeSelection({ linkId: cable.id, owner: 'cable' })).toEqual({ kind: 'cable', id: cable.id });
  });

  it('honours an explicit owner and returns null for the wrong one, an unknown id or an unplugged side', () => {
    const { project, cable, link } = trunkFixture();
    const idx = indexProject(project);
    expect(resolveEndsOf(idx, cable.id, 'cable')?.owner).toBe('cable');
    expect(resolveEndsOf(idx, cable.id, 'link')).toBeNull();
    expect(resolveEndsOf(idx, link.id, 'link')?.owner).toBe('link');
    expect(resolveEndsOf(idx, link.id, 'cable')).toBeNull();
    expect(resolveEndsOf(idx, 'nope')).toBeNull();
    const unplugged = produce(project, (d) => {
      const c = d.cables[0]!;
      for (const p of c.plugs) if (p.side === 'B') { p.componentId = null; p.portId = null; }
    });
    expect(resolveEndsOf(indexProject(unplugged), cable.id)).toBeNull();
  });
});

describe('cable jacket routes', () => {
  it('routeFloorEndpoints runs from side A\'s port to side B\'s furcation point', () => {
    const { project, cable, sw1 } = trunkFixture();
    const ep = routeFloorEndpoints(project, cable.id)!;
    expect(ep.start).toEqual(portFloorPos(project, sw1.id, 'eth1/50'));
    expect(ep.end).toEqual(furcationDefaultFloorPos(project, cable, 'B'));
    expect(ep.ends.owner).toBe('cable');
  });

  it('newRouteFromPoints stores the cable as the route owner and routePath3d ends at the furcation', () => {
    const { project: p0, cable, panel } = trunkFixture();
    const project = routeJacket(p0, cable);
    const route = project.routes[cable.id]!;
    expect(route.linkId).toBe(cable.id);
    expect(route.owner).toBe('cable');
    expect(route.segments[0]!.points.every((wp) => wp.pinned)).toBe(true);
    const path = routePath3d(project, cable.id)!;
    expect(path).not.toBeNull();
    const furcation = furcationWorldPos(project, cable, 'B')!;
    const last = path.points[path.points.length - 1]!;
    expect(last.x).toBeCloseTo(furcation.x, 6);
    expect(last.z).toBeCloseTo(furcation.z, 6);
    // The furcation sits at the mean elevation of the panel ports it fans into.
    const elev = ['f1', 'f2', 'f3', 'f4'].reduce((s, id) => s + portElevationMm(project, panel.id, id)!, 0) / 4;
    expect(last.y).toBeCloseTo(elev, 6);
    // It still climbs to the runway in between.
    expect(path.points.some((pt) => pt.y === 2600)).toBe(true);
    // The jacket never enters R02: it drops from the runway straight to the furcation point (the legs are dressed from
    // there), so the B end aims at the furcation rather than at R02's top entry like a link route would.
    expect(routeEndFloorPos(project, route, 'b')).toEqual(furcationDefaultFloorPos(project, cable, 'B'));
    expect(routeEndFloorPos(project, route, 'b')).not.toEqual(routeEndFloorPos(project, { ...route, owner: undefined, linkId: project.links[0]!.id }, 'b'));
    const beforeLast = path.points[path.points.length - 2]!;
    expect({ x: beforeLast.x, z: beforeLast.z }).toEqual({ x: last.x, z: last.z });
    expect(beforeLast.y).toBe(2600);
    expect(path.parts.inRackB).toEqual([path.points.length - 1, path.points.length - 1]);
  });

  it('routePath3d for the fixture link is unchanged by the seam', () => {
    const f = twoRackFixture();
    routeTwoRacks(f);
    const path = routePath3d(f.project, f.link.id)!;
    expect(path.points).toHaveLength(12);
    expect(path.points[0]).toEqual(portWorldPos(f.project, f.sw1.id, 'eth1/49'));
  });

  it('counts the links of a routed cable as routed (status bar + unrouted-link rule)', () => {
    const { project: p0, cable } = trunkFixture();
    const idx = indexProject(p0);
    const owned = idx.linksOfCable(cable.id);
    expect(owned).toHaveLength(4);
    expect(owned.every((l) => !linkRoutedByCable(p0, l))).toBe(true);
    // Before: the fixture link plus the four channel links are unrouted airwires.
    expect(unroutedLink.check(p0).map((x) => x.key).sort()).toEqual([...owned.map((l) => l.id), p0.links[0]!.id].sort());
    const project = routeJacket(p0, cable);
    expect(owned.every((l) => linkRoutedByCable(project, l))).toBe(true);
    expect(unroutedLink.check(project).map((x) => x.key)).toEqual([p0.links[0]!.id]);
  });

  it('cableLegs3d runs one leg from the furcation to each plugged, placed port of a fanned side', () => {
    const { project, cable, panel } = trunkFixture();
    const legs = cableLegs3d(project, cable);
    expect(legs.map((l) => `${l.side}${l.leg}:${l.ref.portId}`)).toEqual(['B0:f1', 'B1:f2', 'B2:f3', 'B3:f4']);
    const from = furcationWorldPos(project, cable, 'B')!;
    for (const leg of legs) {
      expect(leg.points[0]).toEqual(from);
      expect(leg.points[1]).toEqual(portWorldPos(project, panel.id, leg.ref.portId));
    }
  });
});

describe('moving a cable end', () => {
  it('re-dresses the jacket end but leaves pinned waypoints and a pinned furcation alone', () => {
    const { project: p0, cable, panel, r2 } = trunkFixture();
    const pinnedAt = { x: 4300, y: 1500 };
    const routed = produce(routeJacket(p0, cable), (d) => {
      d.cables[0]!.furcation = { B: { pos: pinnedAt, pinned: true } };
    });
    const before = routed.routes[cable.id]!.segments[0]!.points.map((wp) => ({ ...wp.pos }));
    // Move the panel up the rack: the B end (its first leg) moves, so the jacket's B dressing is recomputed.
    const moved = produce(routed, (d) => {
      place(d, panel.id, r2.id, 30);
      expect(onEndpointMoved(d, cable.id, 'b')).toBe(true);
    });
    expect(moved.routes[cable.id]!.segments[0]!.points.map((wp) => wp.pos)).toEqual(before);
    expect(resolveEndsOf(indexProject(moved), cable.id)?.furcationB).toEqual(pinnedAt);
    const path = routePath3d(moved, cable.id)!;
    const last = path.points[path.points.length - 1]!;
    expect({ x: last.x, y: last.z }).toEqual(pinnedAt);
    // The legs follow the ports to their new U.
    expect(cableLegs3d(moved, cable).map((l) => l.points[1]!.y)).toEqual(['f1', 'f2', 'f3', 'f4'].map((id) => portElevationMm(moved, panel.id, id)));
  });

  it('an unpinned furcation follows the ports to another rack', () => {
    const { project, cable, panel } = trunkFixture();
    const before = furcationDefaultFloorPos(project, cable, 'B')!;
    const moved = produce(project, (d) => {
      const r3 = addRack(d, 'R03', { x: 7000, y: 1000 });
      place(d, panel.id, r3.id, 10);
    });
    const after = furcationDefaultFloorPos(moved, cable, 'B')!;
    expect(after).not.toEqual(before);
    expect(after.x).toBeGreaterThan(before.x + 2000);
    expect(resolveEndsOf(indexProject(moved), cable.id)?.furcationB).toEqual(after);
  });
});
