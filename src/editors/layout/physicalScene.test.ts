import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { autoFillCableSide, furcationDefaultFloorPos, plugCableLeg } from '@/model/cables';
import { createCable } from '@/model/factories';
import { newRouteFromPoints, portFloorPos, routePath3d } from '@/model/routing';
import { addDevice, fresh, twoRackFixture } from '@/model/routing/test-fixtures';
import type { Cable, Project } from '@/model/types';
import { floorCables, floorLinks, physicalSelectionBounds, selectedRackIds } from './physicalScene';

const TRUNK = builtinCatalog.cables.find((c) => c.id === 'cbl.om4-8f-mpo8-4lc')!;

/** The two-rack fixture plus an LC panel in R02 U10 and an 8F MPO-8 → 4×LC trunk plugged SW1:eth1/50 → PP1:f1..f4. */
function trunkFixture() {
  const f = twoRackFixture();
  const panel = addDevice(f.project, 'sym.fiber-patch-panel-24lc', 'PP1', { rackId: f.r2.id, u: 10 });
  // The fixture link already uses eth1/49; the trunk takes the next SR4 uplink.
  f.sw1.optics['eth1/50'] = 'xcvr.100g-sr4';
  const cable = createCable(TRUNK, 'CBL1');
  f.project.cables.push(cable);
  const project = produce(fresh(f.project), (d) => {
    plugCableLeg(d, cable.id, 'A', 0, { componentId: f.sw1.id, portId: 'eth1/50' });
    autoFillCableSide(d, cable.id, 'B', { componentId: panel.id, portId: 'f1' });
  });
  return { ...f, project, panel, cable: project.cables[0]! };
}

const routeJacket = (project: Project, cable: Cable): Project =>
  produce(project, (d) => {
    const route = newRouteFromPoints(d, cable.id, [{ layer: 'overhead', trayId: d.trays[0]!.id, points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }] }], true);
    d.routes[cable.id] = route!;
  });

describe('floorCables', () => {
  it('draws an unrouted trunk as one airwire to the furcation plus a leg per port, and hides its links from floorLinks', () => {
    const { project, cable, sw1, panel, r1, r2, link } = trunkFixture();
    const [entry, ...rest] = floorCables(project);
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ label: 'CBL1', fiberCount: 8, color: TRUNK.color, routed: false, layers: [] });
    const furcation = furcationDefaultFloorPos(project, cable, 'B')!;
    expect(entry!.jacket).toEqual([portFloorPos(project, sw1.id, 'eth1/50'), furcation]);
    expect(entry!.furcations).toEqual([{ side: 'B', pos: furcation, pinned: false }]);
    expect(entry!.legs.map((l) => l.ref.portId)).toEqual(['f1', 'f2', 'f3', 'f4']);
    for (const leg of entry!.legs) expect(leg.points).toEqual([furcation, portFloorPos(project, panel.id, leg.ref.portId)]);
    expect(entry!.rackIds.sort()).toEqual([r1.id, r2.id].sort());
    // The four channel links belong to the cable; only the fixture's plain link is an airwire of its own.
    expect(floorLinks(project).map((l) => l.link.id)).toEqual([link.id]);
  });

  it('follows the jacket route once routed and reports the pinned furcation as a square', () => {
    const { project: p0, cable } = trunkFixture();
    const pinnedAt = { x: 4300, y: 1500 };
    const project = produce(routeJacket(p0, cable), (d) => {
      d.cables[0]!.furcation = { B: { pos: pinnedAt, pinned: true } };
    });
    const entry = floorCables(project)[0]!;
    expect(entry.routed).toBe(true);
    expect(entry.layers).toEqual(['overhead']);
    expect(entry.jacket).toEqual(routePath3d(project, cable.id)!.points.map((p) => ({ x: p.x, y: p.z })));
    expect(entry.jacket.at(-1)).toEqual(pinnedAt);
    expect(entry.furcations).toEqual([{ side: 'B', pos: pinnedAt, pinned: true }]);
    expect(entry.legs.every((l) => l.points[0]!.x === pinnedAt.x && l.points[0]!.y === pinnedAt.y)).toBe(true);
  });

  it('draws nothing for a cable with no placed port, and an unpinned stored furcation is ignored', () => {
    const { project: p0, cable, panel, sw1 } = trunkFixture();
    const unplaced = produce(p0, (d) => {
      for (const p of d.placements) if (p.componentId === panel.id || p.componentId === sw1.id) { p.rackId = null; p.uPosition = null; }
      d.cables[0]!.furcation = { B: { pos: { x: 1, y: 2 }, pinned: false } };
    });
    expect(floorCables(unplaced)).toEqual([]);
    expect(floorCables(p0)[0]!.furcations[0]!.pinned).toBe(false);
    expect(cable.id).toBe(p0.cables[0]!.id);
  });

  it('a selected cable selects the racks of its legs and has floor bounds', () => {
    const { project, cable, r1, r2 } = trunkFixture();
    expect(selectedRackIds(project, [{ kind: 'cable', id: cable.id }]).sort()).toEqual([r1.id, r2.id].sort());
    const bounds = physicalSelectionBounds(project, [{ kind: 'cable', id: cable.id }])!;
    expect(bounds).not.toBeNull();
    expect(bounds.width).toBeGreaterThan(3000);
  });
});
