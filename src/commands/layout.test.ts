import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { drcRuleById } from '@/model/drc';
import { ROOT_SHEET_ID, createComponent, createProject } from '@/model/factories';
import { rackRect } from '@/model/geometry';
import * as routing from '@/model/routing';
import { addDevice, addRack, addRoute, routeTwoRacks, standardRack, symbolDef, twoRackFixture } from '@/model/routing/test-fixtures';
import type { FootprintDef, Project } from '@/model/types';
import { emptyHistory, executeCommand, undoCommand, type Command, type History } from '@/store/commands';
import * as layout from './layout';
import { nextFreeFloorPos } from './placement';

const uCollision = drcRuleById('u-collision')!;
const trayDef = builtinCatalog.trays.find((t) => t.id === 'tray.fiber-runway-6')!;
const topEntryDef = builtinCatalog.accessories.find((a) => a.id === 'acc.top-entry')!;
const vcmDef = builtinCatalog.accessories.find((a) => a.id === 'acc.vcm-6')!;

/** Execute one command against a project (fresh history) and return the new project. */
function exec(project: Project, cmd: Command, history: History = emptyHistory(), now = 1000) {
  const r = executeCommand(project, history, cmd, now);
  return { project: r.project, history: r.history, changed: r.changed };
}

const placementOf = (p: Project, componentId: string) => p.placements.find((x) => x.componentId === componentId);

describe('placeComponent', () => {
  it('throws on a U collision and leaves the project untouched', () => {
    const f = twoRackFixture();
    const srv = addDevice(f.project, 'sym.server-1u', 'SRV1');
    const before = structuredClone(f.project);
    // SW1 occupies U40 of R01.
    expect(() => exec(f.project, layout.placeComponent(srv.id, f.r1.id, 40))).toThrow(/SRV1 \(U40\) overlaps SW1 \(U40\)/);
    // SW2 is a 2U spine at U40–U41 of R02.
    expect(() => exec(f.project, layout.placeComponent(srv.id, f.r2.id, 41))).toThrow(/overlaps SW2 \(U40–U41\)/);
    expect(() => exec(f.project, layout.placeComponent(srv.id, f.r1.id, 0))).toThrow(/below U1/);
    expect(() => exec(f.project, layout.placeComponent(f.sw2.id, f.r1.id, 42))).toThrow(/exceeds the 42U height/);
    expect(() => exec(f.project, layout.placeComponent(srv.id, 'nope', 1))).toThrow(/Rack not found/);
    expect(f.project).toEqual(before);
  });

  it('places into a free slot with no DRC u-collision finding, and undo unplaces', () => {
    const f = twoRackFixture();
    const srv = addDevice(f.project, 'sym.server-1u', 'SRV1');
    const r = exec(f.project, layout.placeComponent(srv.id, f.r1.id, 39, 'rear'));
    expect(r.changed).toBe(true);
    expect(placementOf(r.project, srv.id)).toEqual({ componentId: srv.id, rackId: f.r1.id, uPosition: 39, face: 'rear' });
    expect(uCollision.check(r.project)).toEqual([]);
    const u = undoCommand(r.project, r.history, 'layout');
    expect(placementOf(u.project, srv.id)).toEqual({ componentId: srv.id, rackId: null, uPosition: null, face: 'front' });
  });

  it('creates a placement row for a component the layout has not seen', () => {
    const f = twoRackFixture();
    const srv = addDevice(f.project, 'sym.server-1u', 'SRV1');
    f.project.placements = f.project.placements.filter((p) => p.componentId !== srv.id);
    const r = exec(f.project, layout.placeComponent(srv.id, f.r2.id, 1));
    expect(placementOf(r.project, srv.id)).toMatchObject({ rackId: f.r2.id, uPosition: 1 });
  });

  it('moving a 2U device onto its own current range is allowed', () => {
    const f = twoRackFixture();
    const r = exec(f.project, layout.moveDevice(f.sw2.id, f.r2.id, 39));
    expect(placementOf(r.project, f.sw2.id)).toMatchObject({ uPosition: 39 });
  });
});

describe('moveDevice', () => {
  it('re-squares the unpinned end waypoint to the new rack entry and leaves pinned ones alone', () => {
    for (const pinned of [false, true]) {
      const f = twoRackFixture();
      const r3 = addRack(f.project, 'R03', { x: 7000, y: 1000 });
      routeTwoRacks(f, pinned);
      const before = structuredClone(f.project.routes[f.link.id]!);
      const cmd = layout.moveDevice(f.sw1.id, r3.id, 40);
      const r = exec(f.project, cmd);
      expect(cmd.result).toEqual([f.link.id]);
      const route = r.project.routes[f.link.id]!;
      const first = route.segments[0]!.points[0]!;
      const last = route.segments[0]!.points[1]!;
      if (pinned) {
        expect(first.pos).toEqual(before.segments[0]!.points[0]!.pos);
      } else {
        const entry = routing.routeEndFloorPos(r.project, route, 'a')!;
        expect(first.pos.x).toBeCloseTo(entry.x);
        expect(first.pos.y).toBe(500); // slid along the horizontal run; end segment stays vertical
        expect(first.pos.x).not.toBe(1150);
      }
      // The far end did not move.
      expect(last.pos).toEqual(before.segments[0]!.points[1]!.pos);
      expect(route.needsReview).toBeUndefined();
    }
  });

  it('keeps a pinned in-rack path and re-dresses an unpinned one', () => {
    const f = twoRackFixture();
    const r3 = addRack(f.project, 'R03', { x: 7000, y: 1000 });
    const route = routeTwoRacks(f, true);
    route.aRack = { side: 'right', entry: null, pinned: true };
    const r = exec(f.project, layout.moveDevice(f.sw1.id, r3.id, 40));
    expect(r.project.routes[f.link.id]!.aRack).toEqual({ side: 'right', entry: null, pinned: true });

    const g = twoRackFixture();
    const r3b = addRack(g.project, 'R03', { x: 7000, y: 1000 });
    routeTwoRacks(g, true);
    const entryBefore = g.project.routes[g.link.id]!.aRack.entry;
    expect(entryBefore).not.toBeNull(); // R01 has top entries
    const s = exec(g.project, layout.moveDevice(g.sw1.id, r3b.id, 40));
    expect(s.project.routes[g.link.id]!.aRack.entry).toBeNull(); // R03 has none
    expect(s.project.routes[g.link.id]!.aRack.pinned).toBe(false);
  });
});

describe('deleteRacks', () => {
  it('unplaces devices, drops accessories, anchors and fitting references; routes survive; undo restores all', () => {
    const f = twoRackFixture();
    const route = routeTwoRacks(f, true);
    // Anchor a waypoint inside R01 so we can see the anchor go.
    route.segments[0]!.points.unshift({ id: 'inside', pos: { x: 1300, y: 1500 }, pinned: true });
    routing.anchorWaypointsInRacks(f.project, route);
    expect(route.segments[0]!.points[0]!.anchor?.rackId).toBe(f.r1.id);
    expect(route.aRack.entry).not.toBeNull();
    const before = structuredClone(f.project);

    const cmd = layout.deleteRacks(f.r1.id);
    const r = exec(f.project, cmd);
    expect(cmd.result).toEqual({
      rackIds: [f.r1.id],
      unplaced: [f.sw1.id],
      accessoryIds: before.accessories.filter((a) => a.rackId === f.r1.id).map((a) => a.id),
    });
    expect(r.project.racks.map((x) => x.id)).toEqual([f.r2.id]);
    expect(placementOf(r.project, f.sw1.id)).toMatchObject({ rackId: null, uPosition: null });
    expect(placementOf(r.project, f.sw2.id)).toMatchObject({ rackId: f.r2.id, uPosition: 40 });
    expect(r.project.accessories.every((a) => a.rackId === f.r2.id)).toBe(true);
    const after = r.project.routes[f.link.id]!;
    expect(after).toBeDefined();
    expect(after.segments[0]!.points[0]!.anchor).toBeUndefined();
    expect(after.aRack.entry).toBeNull();
    expect(after.bRack.entry).toBe(route.bRack.entry);
    expect(r.project.trays[0]!.fittings.map((x) => x.rackId)).toEqual([undefined, f.r2.id]);

    const u = undoCommand(r.project, r.history, 'layout');
    expect(u.project).toEqual(before);
  });
});

describe('placeInNewFrame', () => {
  const frame12 = builtinCatalog.racks.find((r) => r.id === 'rack.patch-frame-12u')!;

  it('makes a 1U panel its own 12U patch frame named PF-<ref>, placed at U1 front, and returns the rack id', () => {
    const f = twoRackFixture();
    const pp = addDevice(f.project, 'sym.fiber-patch-panel-24lc', 'PP1');
    const cmd = layout.placeInNewFrame(pp.id, { x: 7000, y: 2000 });
    const r = exec(f.project, cmd);
    expect(r.changed).toBe(true);
    const rack = r.project.racks.find((x) => x.id === cmd.result)!;
    expect(rack).toMatchObject({ name: 'PF-PP1', kind: 'patch-frame', heightU: 12, widthMm: 600, depthMm: 120, pos: { x: 7000, y: 2000 }, rotationDeg: 0 });
    expect(r.project.racks.map((x) => x.name)).toEqual(['R01', 'R02', 'PF-PP1']);
    expect(placementOf(r.project, pp.id)).toEqual({ componentId: pp.id, rackId: rack.id, uPosition: 1, face: 'front' });
    expect(uCollision.check(r.project)).toEqual([]);
  });

  it('numbers a second frame for the same ref PF-<ref>-2', () => {
    const f = twoRackFixture();
    const a = addDevice(f.project, 'sym.server-1u', 'PP1'), b = addDevice(f.project, 'sym.server-1u', 'PP1');
    let p = exec(f.project, layout.placeInNewFrame(a.id, { x: 7000, y: 2000 })).project;
    const cmd = layout.placeInNewFrame(b.id, { x: 8000, y: 2000 });
    p = exec(p, cmd).project;
    expect(p.racks.map((x) => x.name)).toEqual(['R01', 'R02', 'PF-PP1', 'PF-PP1-2']);
    expect(placementOf(p, b.id)).toMatchObject({ rackId: cmd.result, uPosition: 1 });
    expect(placementOf(p, a.id)!.rackId).not.toBe(cmd.result);
  });

  it('honours an explicit def, name, rotation and face', () => {
    const f = twoRackFixture();
    const pp = addDevice(f.project, 'sym.server-1u', 'PP1');
    const cmd = layout.placeInNewFrame(pp.id, { x: 7000, y: 2000 }, { defId: 'rack.patch-frame-42u', name: 'Frame A', rotationDeg: 90, face: 'rear' });
    const r = exec(f.project, cmd);
    expect(r.project.racks.find((x) => x.id === cmd.result)).toMatchObject({ name: 'Frame A', kind: 'patch-frame', heightU: 42, rotationDeg: 90 });
    expect(placementOf(r.project, pp.id)).toMatchObject({ rackId: cmd.result, uPosition: 1, face: 'rear' });
    expect(() => exec(f.project, layout.placeInNewFrame(pp.id, undefined, { name: 'R01' }))).toThrow(/already exists/);
    expect(() => exec(f.project, layout.placeInNewFrame(pp.id, undefined, { defId: 'rack.nope' }))).toThrow(/Unknown rack def/);
    expect(() => exec(f.project, layout.placeInNewFrame('nope'))).toThrow(/does not exist/);
  });

  it('defaults to the next free floor spot right of the bottom row, on the grid', () => {
    const f = twoRackFixture();
    const pp = addDevice(f.project, 'sym.server-1u', 'PP1');
    const r = exec(f.project, layout.placeInNewFrame(pp.id));
    const rack = r.project.racks.at(-1)!;
    expect(rack.pos).toEqual(nextFreeFloorPos(f.project, frame12));
    // R02 ends at x = 4600; the next 600 mm grid line past a grid-wide gap is 5400. The row top (1000) snaps down to 600.
    expect(rack.pos).toEqual({ x: 5400, y: 600 });
  });

  it('wraps to a new row when the frame would leave a narrow room', () => {
    const f = twoRackFixture();
    f.project.room.outline = [{ x: 0, y: 0 }, { x: 5500, y: 0 }, { x: 5500, y: 8000 }, { x: 0, y: 8000 }];
    const pp = addDevice(f.project, 'sym.server-1u', 'PP1');
    const r = exec(f.project, layout.placeInNewFrame(pp.id));
    // 5400 + 600 > 5500 → first grid column of the next row below the racks' bottom edge (2070) plus a gap.
    expect(r.project.racks.at(-1)!.pos).toEqual({ x: 600, y: 3000 });
  });

  it('undo removes both the frame and the placement', () => {
    const f = twoRackFixture();
    const pp = addDevice(f.project, 'sym.server-1u', 'PP1');
    const before = structuredClone(f.project);
    const r = exec(f.project, layout.placeInNewFrame(pp.id));
    expect(r.project.racks).toHaveLength(3);
    expect(placementOf(r.project, pp.id)!.rackId).toBe(r.project.racks[2]!.id);
    const u = undoCommand(r.project, r.history, 'layout');
    expect(u.project.racks.map((x) => x.name)).toEqual(['R01', 'R02']);
    expect(placementOf(u.project, pp.id)).toMatchObject({ rackId: null, uPosition: null });
    expect(u.project).toEqual(before);
  });

  it('grows the frame to the 42U patch rack for a tall custom device without a placement row', () => {
    const f = twoRackFixture();
    const fp: FootprintDef = { id: 'fp.custom-20u', model: 'Chassis 20U', kind: 'generic', heightU: 20, depthMm: 250, ports: [] };
    f.project.customCatalog = { ...f.project.customCatalog, footprints: [fp] };
    const c = createComponent(symbolDef('sym.server-1u'), { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: 'BIG1', footprintDefId: fp.id });
    f.project.components.push(c);
    const cmd = layout.placeInNewFrame(c.id);
    const r = exec(f.project, cmd);
    expect(r.project.racks.find((x) => x.id === cmd.result)).toMatchObject({ name: 'PF-BIG1', kind: 'patch-frame', heightU: 42, widthMm: 600, depthMm: 120 });
    expect(placementOf(r.project, c.id)).toEqual({ componentId: c.id, rackId: cmd.result, uPosition: 1, face: 'front' });
    expect(uCollision.check(r.project)).toEqual([]);
    expect(undoCommand(r.project, r.history, 'layout').project.placements.some((p) => p.componentId === c.id)).toBe(false);
  });
});

describe('addRack / addRackArray', () => {
  it('auto-names racks R01, R02, ... filling gaps and rejecting duplicates', () => {
    let p: Project = createProject('t', '2026-01-01T00:00:00.000Z');
    const a = layout.addRack(standardRack, { x: 0, y: 0 });
    p = exec(p, a).project;
    p = exec(p, layout.addRack(standardRack, { x: 1000, y: 0 }, { name: 'R03', row: 'A' })).project;
    p = exec(p, layout.addRack(standardRack, { x: 2000, y: 0 })).project;
    expect(p.racks.map((r) => r.name)).toEqual(['R01', 'R03', 'R02']);
    expect(p.racks[0]!.id).toBe(a.result);
    expect(p.racks[1]!.row).toBe('A');
    expect(() => exec(p, layout.addRack(standardRack, { x: 0, y: 0 }, { name: 'R02' }))).toThrow(/already exists/);
    expect(() => exec(p, layout.renameRack(p.racks[0]!.id, 'R03'))).toThrow(/already exists/);
    expect(exec(p, layout.renameRack(p.racks[0]!.id, ' Core-1 ')).project.racks[0]!.name).toBe('Core-1');
  });

  it('arrays racks along x with the given gap and continues the name sequence', () => {
    const p0 = createProject('t', '2026-01-01T00:00:00.000Z');
    const cmd = layout.addRackArray(standardRack, { origin: { x: 1000, y: 2000 }, count: 3, spacingMm: 100, row: 'A' });
    const r = exec(p0, cmd);
    expect(r.project.racks.map((x) => x.pos)).toEqual([
      { x: 1000, y: 2000 },
      { x: 1700, y: 2000 }, // 600 wide + 100 gap
      { x: 2400, y: 2000 },
    ]);
    expect(r.project.racks.map((x) => x.name)).toEqual(['R01', 'R02', 'R03']);
    expect(r.project.racks.every((x) => x.row === 'A')).toBe(true);
    expect(cmd.result).toEqual(r.project.racks.map((x) => x.id));
    // Butted racks along y, rotated: the pitch is the rotated footprint's height.
    const s = exec(r.project, layout.addRackArray(standardRack, { origin: { x: 0, y: 0 }, count: 2, direction: 'y', rotationDeg: 90 }));
    const added = s.project.racks.slice(3);
    expect(added.map((x) => x.name)).toEqual(['R04', 'R05']);
    expect(added.map((x) => x.pos)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 600 }]);
    expect(added[0]!.rotationDeg).toBe(90);
    expect(() => exec(p0, layout.addRackArray(standardRack, { origin: { x: 0, y: 0 }, count: 0 }))).toThrow(/count/);
  });
});

describe('moveRacks / rotateRack', () => {
  it('carries anchored waypoints with the rack and coalesces drag steps', () => {
    const f = twoRackFixture();
    const route = routeTwoRacks(f, true);
    route.segments[0]!.points.unshift({ id: 'inside', pos: { x: 1300, y: 1500 }, pinned: true });
    routing.anchorWaypointsInRacks(f.project, route);
    const a = exec(f.project, layout.moveRacks([f.r1.id], { x: 100, y: 0 }, 'drag1'), emptyHistory(), 1000);
    const b = exec(a.project, layout.moveRacks([f.r1.id], { x: 100, y: 50 }, 'drag1'), a.history, 1100);
    expect(b.history.layout.undo).toHaveLength(1);
    expect(b.project.racks[0]!.pos).toEqual({ x: 1200, y: 1050 });
    const wp = b.project.routes[f.link.id]!.segments[0]!.points[0]!;
    expect(wp.pos).toEqual({ x: 1500, y: 1550 });
    expect(wp.anchor).toEqual({ rackId: f.r1.id, offset: { x: 300, y: 500 } });
  });

  it('rotates about the footprint centre and turns anchored waypoints', () => {
    const f = twoRackFixture();
    const route = routeTwoRacks(f, true);
    route.segments[0]!.points.unshift({ id: 'inside', pos: { x: 1300, y: 1500 }, pinned: true });
    routing.anchorWaypointsInRacks(f.project, route);
    const before = rackRect(f.r1);
    const r = exec(f.project, layout.rotateRack(f.r1.id));
    const rack = r.project.racks[0]!;
    expect(rack.rotationDeg).toBe(90);
    const after = rackRect(rack);
    expect(after.width).toBe(before.height);
    expect(after.x + after.width / 2).toBeCloseTo(before.x + before.width / 2);
    expect(after.y + after.height / 2).toBeCloseTo(before.y + before.height / 2);
    const wp = r.project.routes[f.link.id]!.segments[0]!.points[0]!;
    // (1300,1500) is (0,-35) from the centre (1300,1535); +90° (y down) turns it into (35,0) → (1335,1535)
    expect(wp.pos.x).toBeCloseTo(1335);
    expect(wp.pos.y).toBeCloseTo(1535);
    expect(wp.anchor?.rackId).toBe(f.r1.id);
  });
});

describe('accessories, trays, keepouts, room', () => {
  it('adds and removes accessories, clearing stale entry references', () => {
    const f = twoRackFixture({ topEntries: false });
    expect(() => exec(f.project, layout.addAccessory(f.r1.id, vcmDef, { side: 'left' }))).toThrow(/already has a vertical manager/);
    const add = layout.addAccessory(f.r1.id, topEntryDef, { side: 'left', face: 'front' });
    const r = exec(f.project, add);
    const acc = r.project.accessories.find((a) => a.id === add.result)!;
    expect(acc).toMatchObject({ rackId: f.r1.id, type: 'top-entry', side: 'left', face: 'front' });
    const s = exec(r.project, layout.setRoute(f.link.id, {
      linkId: f.link.id,
      aRack: { side: 'left', entry: acc.id, pinned: true },
      bRack: { side: 'left', entry: null, pinned: false },
      segments: [{ layer: 'overhead', trayId: f.tray.id, points: [] }],
    }));
    const t = exec(s.project, layout.removeAccessory(acc.id));
    expect(t.project.accessories.some((a) => a.id === acc.id)).toBe(false);
    expect(t.project.routes[f.link.id]!.aRack).toEqual({ side: 'left', entry: null, pinned: true });
  });

  it('adds trays (layer by elevation), edits fittings and detaches routes on delete', () => {
    const f = twoRackFixture();
    routeTwoRacks(f);
    const add = layout.addTray(trayDef, [{ x: 0, y: 3000 }, { x: 5000, y: 3000 }], -150, { name: 'Under A' });
    const r = exec(f.project, add);
    const tray = r.project.trays.find((t) => t.id === add.result)!;
    expect(tray).toMatchObject({ layer: 'underfloor', elevationMm: -150, name: 'Under A', kind: 'fiber-runway' });
    expect(() => exec(r.project, layout.addTray(trayDef, [{ x: 0, y: 0 }], 2600))).toThrow(/two points/);
    const s = exec(r.project, layout.addTrayFitting(tray.id, { at: { x: 1150, y: 3000 }, type: 'waterfall', rackId: f.r1.id }));
    expect(s.project.trays.find((t) => t.id === tray.id)!.fittings).toHaveLength(1);
    const t = exec(s.project, layout.removeTrayFitting(tray.id, 0));
    expect(t.project.trays.find((x) => x.id === tray.id)!.fittings).toEqual([]);
    const u = exec(t.project, layout.setTrayParams(tray.id, { elevationMm: 2700 }));
    expect(u.project.trays.find((x) => x.id === tray.id)!.layer).toBe('overhead');
    const v = exec(u.project, layout.deleteTray(f.tray.id));
    expect(v.project.trays.map((x) => x.id)).toEqual([tray.id]);
    expect(v.project.routes[f.link.id]!.segments[0]!.trayId).toBeNull();
  });

  it('keepouts and room parameters validate their input', () => {
    let p: Project = createProject('t', '2026-01-01T00:00:00.000Z');
    const add = layout.addKeepout({ outline: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }], kind: 'aisle' });
    p = exec(p, add).project;
    expect(p.keepouts[0]).toMatchObject({ id: add.result, name: 'Keepout 1', kind: 'aisle' });
    p = exec(p, layout.moveKeepout(add.result!, { x: 10, y: 5 })).project;
    expect(p.keepouts[0]!.outline[0]).toEqual({ x: 10, y: 5 });
    expect(() => exec(p, layout.addKeepout({ outline: [{ x: 0, y: 0 }] }))).toThrow(/three points/);
    p = exec(p, layout.deleteKeepout(add.result!)).project;
    expect(p.keepouts).toEqual([]);
    expect(() => exec(p, layout.setRoomOutline([{ x: 0, y: 0 }]))).toThrow(/three points/);
    expect(() => exec(p, layout.setRoomParam('ceilingMm', 0))).toThrow(/positive/);
    p = exec(p, layout.setRoomParam('gridMm', 300)).project;
    expect(p.room.gridMm).toBe(300);
  });
});

describe('routes and waypoints', () => {
  it('finishRoute builds a dressed route; waypoint edits clear needsReview and re-anchor', () => {
    const f = twoRackFixture();
    const r = exec(f.project, layout.finishRoute(f.link.id, [{ layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }] }]));
    const route = r.project.routes[f.link.id]!;
    expect(route.segments[0]!.points.every((w) => w.pinned)).toBe(true); // pinWaypointsByDefault
    expect(route.aRack.entry).not.toBeNull();

    const flagged = exec(r.project, { label: 'flag', editor: 'layout', mutate: (d) => { d.routes[f.link.id]!.needsReview = true; } });
    const ins = layout.insertWaypoint(f.link.id, 0, 0, { x: 1300, y: 1500 }, false);
    const s = exec(flagged.project, ins);
    const after = s.project.routes[f.link.id]!;
    expect(after.needsReview).toBeUndefined();
    const wp = after.segments[0]!.points[1]!;
    expect(wp.id).toBe(ins.result);
    expect(wp.anchor?.rackId).toBe(f.r1.id);

    const mv1 = exec(s.project, layout.moveWaypoint(f.link.id, 0, wp.id, { x: 1310, y: 1500 }, { dragId: 'd' }), emptyHistory(), 1000);
    const mv2 = exec(mv1.project, layout.moveWaypoint(f.link.id, 0, wp.id, { x: 1320, y: 1500 }, { dragId: 'd' }), mv1.history, 1200);
    expect(mv2.history.layout.undo).toHaveLength(1);
    expect(mv2.project.routes[f.link.id]!.segments[0]!.points[1]!.pos).toEqual({ x: 1320, y: 1500 });

    const pinned = exec(mv2.project, layout.setPinned(f.link.id, 0, wp.id, true));
    expect(pinned.project.routes[f.link.id]!.segments[0]!.points[1]!.pinned).toBe(true);
    const loop = exec(pinned.project, layout.setServiceLoop(f.link.id, 0, wp.id, 2));
    expect(loop.project.routes[f.link.id]!.segments[0]!.points[1]!.serviceLoopM).toBe(2);
    const unp = exec(loop.project, layout.unpinAll(f.link.id));
    expect(unp.project.routes[f.link.id]!.segments[0]!.points.some((w) => w.pinned)).toBe(false);
    expect(unp.project.routes[f.link.id]!.aRack.pinned).toBe(false);
    const del = exec(unp.project, layout.deleteWaypoint(f.link.id, 0, wp.id));
    expect(del.project.routes[f.link.id]!.segments[0]!.points).toHaveLength(2);
    expect(() => exec(del.project, layout.deleteWaypoint(f.link.id, 0, wp.id))).toThrow(/not found/);
    const un = exec(del.project, layout.unroute(f.link.id));
    expect(un.project.routes[f.link.id]).toBeUndefined();
    expect(() => exec(un.project, layout.straighten(f.link.id))).toThrow(/no route/);
  });

  it('dragSegment is a no-op on pinned ends and straighten reports removals', () => {
    const f = twoRackFixture();
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 2000, y: 500 }, { x: 4150, y: 500 }] },
    ]);
    const pinnedRoute = structuredClone(f.project);
    for (const w of pinnedRoute.routes[f.link.id]!.segments[0]!.points) w.pinned = true;
    const noop = exec(pinnedRoute, layout.dragSegment(f.link.id, 0, 0, { x: 0, y: 100 }));
    expect(noop.changed).toBe(false);

    const r = exec(f.project, layout.dragSegment(f.link.id, 0, 0, { x: 30, y: 100 }));
    const pts = r.project.routes[f.link.id]!.segments[0]!.points;
    expect(pts[0]!.pos).toEqual({ x: 1150, y: 600 });
    expect(pts[1]!.pos).toEqual({ x: 2000, y: 600 });
    const st = layout.straighten(f.link.id);
    const s = exec(f.project, st);
    expect(st.result).toBe(1);
    expect(s.project.routes[f.link.id]!.segments[0]!.points).toHaveLength(2);
  });

  it('setInRackPath validates the entry and pins the end; resetInRackPath unpins', () => {
    const f = twoRackFixture();
    routeTwoRacks(f);
    const entryR2 = f.project.accessories.find((a) => a.rackId === f.r2.id && a.type === 'top-entry')!;
    expect(() => exec(f.project, layout.setInRackPath(f.link.id, 'a', { entry: entryR2.id }))).toThrow(/another rack/);
    expect(() => exec(f.project, layout.setInRackPath(f.link.id, 'a', { entry: 'nope' }))).toThrow(/top-entry/);
    const r = exec(f.project, layout.setInRackPath(f.link.id, 'a', { side: 'right' }));
    expect(r.project.routes[f.link.id]!.aRack).toMatchObject({ side: 'right', pinned: true });
    const s = exec(r.project, layout.resetInRackPath(f.link.id, 'a'));
    expect(s.project.routes[f.link.id]!.aRack.pinned).toBe(false);
  });
});

describe('settings', () => {
  it('patches settings undoably', () => {
    const p = createProject('t', '2026-01-01T00:00:00.000Z');
    const r = exec(p, layout.setProjectSettings({ slackFraction: 0.2, drcSeverities: { 'u-collision': 'warning' } }));
    expect(r.project.settings.slackFraction).toBe(0.2);
    expect(r.project.settings.drcSeverities).toEqual({ 'u-collision': 'warning' });
    expect(r.project.settings.pinWaypointsByDefault).toBe(true);
    expect(undoCommand(r.project, r.history, 'layout').project.settings).toEqual(p.settings);
  });
});
