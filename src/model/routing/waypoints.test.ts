import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createWaypoint } from '../factories';
import type { Route, Tray } from '../types';
import { rackEntryPoints } from './positions';
import { addRack, addRoute, place, routeTwoRacks, twoRackFixture } from './test-fixtures';
import {
  anchorWaypointsInRacks,
  deleteWaypoint,
  dragSegment,
  dropsOf,
  findWaypoint,
  insertWaypoint,
  moveWaypoint,
  newRouteFromPoints,
  onEndpointMoved,
  onRackMoved,
  setAllPinned,
  setPinned,
  snapWaypoint,
  straighten,
} from './waypoints';

const route = (pts: { x: number; y: number; pinned?: boolean }[]): Route => ({
  linkId: 'l',
  aRack: { side: 'left', entry: null, pinned: false },
  bRack: { side: 'left', entry: null, pinned: false },
  segments: [{ layer: 'overhead', trayId: null, points: pts.map((p) => createWaypoint(p, p.pinned ?? false)) }],
});
const positions = (r: Route, seg = 0) => r.segments[seg]!.points.map((w) => ({ x: w.pos.x, y: w.pos.y }));

describe('insert / delete / find', () => {
  it('inserts after an index, at the start with -1, and deletes by id', () => {
    const r = route([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    const mid = insertWaypoint(r, 0, 0, { x: 50, y: 0 })!;
    const first = insertWaypoint(r, 0, -1, { x: -10, y: 0 })!;
    expect(positions(r)).toEqual([{ x: -10, y: 0 }, { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }]);
    expect(findWaypoint(r, mid.id)).toMatchObject({ segIdx: 0, idx: 2 });
    expect(deleteWaypoint(r, 0, first.id)).toBe(true);
    expect(deleteWaypoint(r, 0, 'nope')).toBe(false);
    expect(insertWaypoint(r, 3, 0, { x: 0, y: 0 })).toBeNull();
    expect(positions(r)).toHaveLength(3);
  });
});

describe('moveWaypoint', () => {
  it('slides unpinned neighbours to keep adjacent segments orthogonal', () => {
    const r = route([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }]);
    const b = r.segments[0]!.points[1]!;
    expect(moveWaypoint(r, 0, b.id, { x: 120, y: 30 }, { keepOrthogonal: true })).toBe(true);
    // A (horizontal neighbour) follows in y; C (vertical neighbour) follows in x.
    expect(positions(r)).toEqual([{ x: 0, y: 30 }, { x: 120, y: 30 }, { x: 120, y: 100 }, { x: 200, y: 100 }]);
  });

  it('never moves pinned neighbours and leaves diagonals alone without keepOrthogonal', () => {
    const r = route([{ x: 0, y: 0, pinned: true }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    const b = r.segments[0]!.points[1]!;
    moveWaypoint(r, 0, b.id, { x: 120, y: 30 }, { keepOrthogonal: true });
    expect(positions(r)).toEqual([{ x: 0, y: 0 }, { x: 120, y: 30 }, { x: 120, y: 100 }]);
    moveWaypoint(r, 0, b.id, { x: 50, y: 50 });
    expect(positions(r)).toEqual([{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 120, y: 100 }]);
    expect(moveWaypoint(r, 0, 'nope', { x: 0, y: 0 })).toBe(false);
  });
});

describe('dragSegment', () => {
  it('moves both endpoints perpendicular to the segment', () => {
    const r = route([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    expect(dragSegment(r, 0, 0, { x: 30, y: 25 })).toBe(true);
    expect(positions(r)).toEqual([{ x: 0, y: 25 }, { x: 100, y: 25 }, { x: 100, y: 100 }]);
    expect(dragSegment(r, 0, 1, { x: -10, y: 99 })).toBe(true);
    expect(positions(r)).toEqual([{ x: 0, y: 25 }, { x: 90, y: 25 }, { x: 90, y: 100 }]);
  });

  it('refuses when an endpoint is pinned or missing', () => {
    const r = route([{ x: 0, y: 0 }, { x: 100, y: 0, pinned: true }]);
    expect(dragSegment(r, 0, 0, { x: 0, y: 10 })).toBe(false);
    expect(dragSegment(r, 0, 1, { x: 0, y: 10 })).toBe(false);
    expect(positions(r)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  });
});

describe('pinning and straighten', () => {
  it('pins one or all waypoints', () => {
    const r = route([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    const [a, b] = r.segments[0]!.points as [ReturnType<typeof createWaypoint>, ReturnType<typeof createWaypoint>];
    expect(setPinned(r, 0, a.id, true)).toBe(1);
    expect(a.pinned).toBe(true);
    expect(b.pinned).toBe(false);
    expect(setPinned(r, 0, 'all', true)).toBe(2);
    expect(b.pinned).toBe(true);
    setAllPinned(r, false);
    expect(r.segments[0]!.points.every((w) => !w.pinned)).toBe(true);
    expect(r.aRack.pinned).toBe(false);
  });

  it('drops collinear and duplicate unpinned waypoints but keeps pinned ones', () => {
    const r = route([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0, pinned: true },
      { x: 150, y: 0 },
      { x: 150, y: 100 },
      { x: 150, y: 200 },
    ]);
    expect(straighten(r)).toBe(3);
    expect(positions(r)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 200 }]);
  });
});

describe('snapWaypoint', () => {
  const tray: Tray = {
    id: 't',
    kind: 'basket',
    layer: 'overhead',
    points: [{ x: 0, y: 500 }, { x: 1000, y: 500 }],
    widthMm: 200,
    depthMm: 60,
    elevationMm: 2600,
    fittings: [],
  };

  it('prefers cable points, then tray centrelines, then the grid', () => {
    const base = { gridMm: 100, trays: [tray], otherRoutePoints: [{ x: 512, y: 490 }], toleranceMm: 30 };
    expect(snapWaypoint({ x: 520, y: 480 }, base)).toEqual({ pos: { x: 512, y: 490 }, snappedTo: 'cable' });
    expect(snapWaypoint({ x: 300, y: 480 }, base)).toEqual({ pos: { x: 300, y: 500 }, snappedTo: 'tray', trayId: 't' });
    expect(snapWaypoint({ x: 333, y: 160 }, base)).toEqual({ pos: { x: 300, y: 200 }, snappedTo: 'grid' });
    expect(snapWaypoint({ x: 333, y: 160 }, { ...base, gridMm: 0 })).toEqual({ pos: { x: 333, y: 160 }, snappedTo: 'none' });
  });
});

describe('anchoring', () => {
  it('anchors waypoints inside a rack or its managers by offset from the rack position', () => {
    const f = twoRackFixture();
    const r = addRoute(f.project, f.link.id, [
      { layer: 'overhead', points: [{ x: 1150, y: 1535 }, { x: 900, y: 1200 }, { x: 1150, y: 500 }] },
    ]);
    anchorWaypointsInRacks(f.project, r);
    const [inRack, inManager, outside] = r.segments[0]!.points;
    expect(inRack!.anchor).toEqual({ rackId: f.r1.id, offset: { x: 150, y: 535 } });
    expect(inManager!.anchor).toEqual({ rackId: f.r1.id, offset: { x: -100, y: 200 } });
    expect(outside!.anchor).toBeUndefined();
  });

  it('moving a rack translates its anchored waypoints, pinned or not', () => {
    const f = twoRackFixture();
    const r = addRoute(f.project, f.link.id, [
      { layer: 'overhead', pinned: true, points: [{ x: 1150, y: 1535 }, { x: 1150, y: 500 }, { x: 4150, y: 500 }] },
    ]);
    r.segments[0]!.points[1]!.pinned = false;
    anchorWaypointsInRacks(f.project, r);
    const next = produce(f.project, (draft) => {
      draft.racks[0]!.pos = { x: 1500, y: 1300 };
      expect(onRackMoved(draft, f.r1.id, { x: 500, y: 300 })).toBe(1);
    });
    const pts = positions(next.routes[f.link.id]!);
    expect(pts).toEqual([{ x: 1650, y: 1835 }, { x: 1150, y: 500 }, { x: 4150, y: 500 }]);
    expect(next.routes[f.link.id]!.segments[0]!.points[0]!.anchor?.offset).toEqual({ x: 150, y: 535 });
  });
});

describe('onEndpointMoved', () => {
  it('keeps pinned waypoints exactly in place and re-squares the unpinned end waypoint', () => {
    const f = twoRackFixture();
    const r3 = addRack(f.project, 'R03', { x: 7000, y: 1000 });
    const r = addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }] },
    ]);
    r.segments[0]!.points[1]!.pinned = true;
    const before = positions(r);
    expect(before[0]).toEqual({ x: 1150, y: 500 });
    // Move SW1 to another rack (and U).
    const next = produce(f.project, (draft) => {
      place(draft, f.sw1.id, r3.id, 10);
      expect(onEndpointMoved(draft, f.link.id, 'a')).toBe(true);
    });
    const after = next.routes[f.link.id]!;
    const pts = positions(after);
    expect(pts[1]).toEqual({ x: 4150, y: 500 });
    // R03 has no managers or entries; the auto side for eth1/49 is left → entry at the roof quarter point.
    const entry = rackEntryPoints(next, r3).topLeft;
    expect(pts[0]).toEqual({ x: entry.x, y: 500 });
    expect(after.aRack.side).toBe('left');
    expect(after.aRack.entry).toBeNull();
    // Moving to another U in the same rack leaves the squared waypoint alone.
    const again = produce(next, (draft) => {
      place(draft, f.sw1.id, r3.id, 20);
      onEndpointMoved(draft, f.link.id, 'a');
    });
    expect(positions(again.routes[f.link.id]!)).toEqual(pts);
  });

  it('leaves a pinned adjacent waypoint and a pinned in-rack path untouched', () => {
    const f = twoRackFixture();
    const r3 = addRack(f.project, 'R03', { x: 7000, y: 1000 });
    const r = routeTwoRacks(f, true);
    r.aRack = { side: 'right', entry: null, pinned: true };
    const next = produce(f.project, (draft) => {
      place(draft, f.sw1.id, r3.id, 10);
      onEndpointMoved(draft, f.link.id, 'a');
    });
    const after = next.routes[f.link.id]!;
    expect(positions(after)).toEqual([{ x: 1150, y: 500 }, { x: 4150, y: 500 }]);
    expect(after.aRack).toEqual({ side: 'right', entry: null, pinned: true });
  });

  it('re-squares the B end against its vertical neighbour', () => {
    const f = twoRackFixture();
    const r = addRoute(f.project, f.link.id, [
      {
        layer: 'overhead',
        trayId: f.tray.id,
        points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }, { x: 4150, y: 800 }],
      },
    ]);
    r.segments[0]!.points[0]!.pinned = true;
    r.segments[0]!.points[1]!.pinned = true;
    const next = produce(f.project, (draft) => {
      draft.racks[1]!.pos = { x: 4000, y: 2000 };
      onEndpointMoved(draft, f.link.id, 'b');
    });
    // Neighbour is vertical (same x) → the end waypoint slides in y to the new entry y.
    expect(positions(next.routes[f.link.id]!)).toEqual([{ x: 1150, y: 500 }, { x: 4150, y: 500 }, { x: 4150, y: 2535 }]);
    expect(onEndpointMoved(next, 'nope', 'a')).toBe(false);
  });
});

describe('newRouteFromPoints and dropsOf', () => {
  it('builds a route with pinned-by-default waypoints, auto-dressed ends, and anchors', () => {
    const f = twoRackFixture();
    const r = newRouteFromPoints(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 1535 }, { x: 1150, y: 500 }, { x: 4150, y: 500 }] },
      { layer: 'in-rack', points: [{ x: 4150, y: 1535 }] },
    ])!;
    expect(r.linkId).toBe(f.link.id);
    expect(r.segments).toHaveLength(2);
    expect(r.segments[0]!.trayId).toBe(f.tray.id);
    expect(r.segments[1]!.trayId).toBeNull();
    expect(r.segments.flatMap((s) => s.points).every((w) => w.pinned)).toBe(true);
    expect(r.aRack.side).toBe('left');
    expect(r.aRack.entry).not.toBeNull();
    expect(r.segments[0]!.points[0]!.anchor?.rackId).toBe(f.r1.id);
    expect(r.segments[1]!.points[0]!.anchor?.rackId).toBe(f.r2.id);
    const unpinned = newRouteFromPoints(f.project, f.link.id, [{ layer: 'overhead', points: [{ x: 0, y: 0 }] }], false)!;
    expect(unpinned.segments[0]!.points[0]!.pinned).toBe(false);
    expect(newRouteFromPoints(f.project, 'nope', [])).toBeNull();
    expect(dropsOf(r)).toEqual([{ pos: { x: 4150, y: 500 }, fromLayer: 'overhead', toLayer: 'in-rack', segmentIndex: 0 }]);
  });
});
