/**
 * Adversarial tests for waypoint editing: pinned waypoints never move under
 * automatic adjustments, unpinned neighbours re-square, segment drags are
 * blocked by pinned ends, and anchoring survives rack moves and rotations.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createWaypoint } from '../factories';
import { rectContains } from '../geometry';
import type { Route, Vec2 } from '../types';
import { routeEndFloorPos } from './path3d';
import { managerFloorCenter, rackEntryPoints, rackFloorRect } from './positions';
import { addRack, addRoute, place, twoRackFixture } from './test-fixtures';
import {
  anchorWaypointsInRacks,
  dragSegment,
  insertWaypoint,
  moveWaypoint,
  onEndpointMoved,
  onRackMoved,
  setPinned,
  straighten,
} from './waypoints';

const route = (pts: { x: number; y: number; pinned?: boolean }[]): Route => ({
  linkId: 'l',
  aRack: { side: 'left', entry: null, pinned: false },
  bRack: { side: 'left', entry: null, pinned: false },
  segments: [{ layer: 'overhead', trayId: null, points: pts.map((p) => createWaypoint(p, p.pinned ?? false)) }],
});
const positions = (r: Route, seg = 0): Vec2[] => r.segments[seg]!.points.map((w) => ({ x: w.pos.x, y: w.pos.y }));
const orthogonal = (a: Vec2, b: Vec2): boolean => Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6;

describe('moveWaypoint pinned semantics', () => {
  it('moves only the target when both neighbours are pinned', () => {
    const r = route([{ x: 0, y: 0, pinned: true }, { x: 100, y: 0 }, { x: 100, y: 100, pinned: true }]);
    const mid = r.segments[0]!.points[1]!;
    expect(moveWaypoint(r, 0, mid.id, { x: 130, y: 40 }, { keepOrthogonal: true })).toBe(true);
    expect(positions(r)).toEqual([{ x: 0, y: 0 }, { x: 130, y: 40 }, { x: 100, y: 100 }]);
  });

  it('adjusts only the one neighbour of an end waypoint', () => {
    const r = route([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    const first = r.segments[0]!.points[0]!;
    moveWaypoint(r, 0, first.id, { x: 10, y: 50 }, { keepOrthogonal: true });
    expect(positions(r)).toEqual([{ x: 10, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 100 }]);
    const last = r.segments[0]!.points[2]!;
    moveWaypoint(r, 0, last.id, { x: 200, y: 120 }, { keepOrthogonal: true });
    expect(positions(r)).toEqual([{ x: 10, y: 50 }, { x: 200, y: 50 }, { x: 200, y: 120 }]);
  });

  it('leaves a diagonal neighbour alone even with keepOrthogonal', () => {
    const r = route([{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 100, y: 150 }]);
    const mid = r.segments[0]!.points[1]!;
    moveWaypoint(r, 0, mid.id, { x: 120, y: 60 }, { keepOrthogonal: true });
    expect(positions(r)).toEqual([{ x: 0, y: 0 }, { x: 120, y: 60 }, { x: 120, y: 150 }]);
  });

  it('slides both neighbours of a straight run', () => {
    const r = route([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
    const mid = r.segments[0]!.points[1]!;
    moveWaypoint(r, 0, mid.id, { x: 100, y: 30 }, { keepOrthogonal: true });
    expect(positions(r)).toEqual([{ x: 0, y: 30 }, { x: 100, y: 30 }, { x: 200, y: 30 }]);
  });

  it('a user may still drag a pinned waypoint directly and its pin survives', () => {
    const r = route([{ x: 0, y: 0 }, { x: 100, y: 0, pinned: true }]);
    const p = r.segments[0]!.points[1]!;
    expect(moveWaypoint(r, 0, p.id, { x: 100, y: 20 })).toBe(true);
    expect(p.pos).toEqual({ x: 100, y: 20 });
    expect(p.pinned).toBe(true);
  });

  it('fails for a missing segment without touching anything', () => {
    const r = route([{ x: 0, y: 0 }]);
    expect(moveWaypoint(r, 1, r.segments[0]!.points[0]!.id, { x: 5, y: 5 })).toBe(false);
    expect(positions(r)).toEqual([{ x: 0, y: 0 }]);
  });
});

describe('dragSegment', () => {
  it('rejects out-of-range indices', () => {
    const r = route([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(dragSegment(r, 0, 1, { x: 0, y: 10 })).toBe(false);
    expect(dragSegment(r, 0, -1, { x: 0, y: 10 })).toBe(false);
    expect(dragSegment(r, 1, 0, { x: 0, y: 10 })).toBe(false);
    expect(positions(r)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
  });

  it('discards the parallel component entirely', () => {
    const r = route([{ x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }]);
    expect(dragSegment(r, 0, 0, { x: 0, y: 40 })).toBe(true);
    expect(positions(r)).toEqual([{ x: 100, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }]);
    expect(dragSegment(r, 0, 0, { x: -25, y: 999 })).toBe(true);
    expect(positions(r)).toEqual([{ x: 75, y: 0 }, { x: 75, y: 100 }, { x: 200, y: 100 }]);
  });

  it('projects onto the normal of a diagonal segment', () => {
    const r = route([{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    expect(dragSegment(r, 0, 0, { x: 10, y: 0 })).toBe(true);
    const [p0, p1] = positions(r);
    expect(p0!.x).toBeCloseTo(5, 9);
    expect(p0!.y).toBeCloseTo(-5, 9);
    expect(p1!.x).toBeCloseTo(105, 9);
    expect(p1!.y).toBeCloseTo(95, 9);
  });

  it('is blocked when the far end is pinned even if the near end is free', () => {
    const r = route([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100, pinned: true }, { x: 200, y: 100 }]);
    expect(dragSegment(r, 0, 1, { x: 30, y: 0 })).toBe(false);
    expect(dragSegment(r, 0, 2, { x: 0, y: 30 })).toBe(false);
    expect(dragSegment(r, 0, 0, { x: 0, y: 30 })).toBe(true);
    expect(positions(r)).toEqual([{ x: 0, y: 30 }, { x: 100, y: 30 }, { x: 100, y: 100 }, { x: 200, y: 100 }]);
  });

  it('leaves neighbouring orthogonal segments orthogonal', () => {
    const r = route([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 200 }]);
    dragSegment(r, 0, 1, { x: 5, y: -60 });
    const p = positions(r);
    expect(p).toEqual([{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 300, y: 40 }, { x: 300, y: 200 }]);
    for (let i = 1; i < p.length; i++) expect(orthogonal(p[i - 1]!, p[i]!)).toBe(true);
  });
});

describe('insert / pin / straighten edge cases', () => {
  it('clamps insert positions', () => {
    const r = route([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    insertWaypoint(r, 0, 99, { x: 200, y: 0 });
    insertWaypoint(r, 0, -99, { x: -100, y: 0 });
    expect(positions(r)).toEqual([{ x: -100, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 0 }]);
  });

  it('setPinned reports zero for an unknown id or segment', () => {
    const r = route([{ x: 0, y: 0 }]);
    expect(setPinned(r, 0, 'nope', true)).toBe(0);
    expect(setPinned(r, 3, 'all', true)).toBe(0);
    expect(r.segments[0]!.points[0]!.pinned).toBe(false);
  });

  it('straighten keeps a U-turn and never removes the end waypoints', () => {
    const r = route([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }]);
    expect(straighten(r)).toBe(0);
    expect(positions(r)).toHaveLength(3);
    const dup = route([{ x: 0, y: 0 }, { x: 0, y: 0 }]);
    expect(straighten(dup)).toBe(0);
    expect(positions(dup)).toHaveLength(2);
  });

  it('straighten drops a duplicate of the first point but keeps a pinned duplicate', () => {
    const r = route([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(straighten(r)).toBe(1);
    const p = route([{ x: 0, y: 0 }, { x: 0, y: 0, pinned: true }, { x: 100, y: 0 }]);
    expect(straighten(p)).toBe(0);
  });
});

describe('onRackMoved and anchoring', () => {
  it('never moves pinned or unpinned waypoints that are not anchored to the moved rack', () => {
    const f = twoRackFixture();
    const r = addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }, { x: 4150, y: 1535 }] },
    ]);
    r.segments[0]!.points[0]!.pinned = true;
    anchorWaypointsInRacks(f.project, r);
    // Only the last waypoint (inside R02) is anchored, to R02.
    expect(r.segments[0]!.points.map((w) => w.anchor?.rackId)).toEqual([undefined, undefined, f.r2.id]);
    const next = produce(f.project, (draft) => {
      draft.racks[0]!.pos = { x: 1600, y: 1000 };
      expect(onRackMoved(draft, f.r1.id, { x: 600, y: 0 })).toBe(0);
    });
    expect(positions(next.routes[f.link.id]!)).toEqual([{ x: 1150, y: 500 }, { x: 4150, y: 500 }, { x: 4150, y: 1535 }]);
    const moved = produce(next, (draft) => {
      draft.racks[1]!.pos = { x: 4000, y: 1600 };
      expect(onRackMoved(draft, f.r2.id, { x: 0, y: 600 })).toBe(1);
    });
    expect(positions(moved.routes[f.link.id]!)).toEqual([{ x: 1150, y: 500 }, { x: 4150, y: 500 }, { x: 4150, y: 2135 }]);
    expect(onRackMoved(moved, 'unknown-rack', { x: 1, y: 1 })).toBe(0);
  });

  it('anchors inside a rotated footprint and keeps the waypoint inside after a move', () => {
    const f = twoRackFixture();
    f.r1.rotationDeg = 90; // footprint becomes 1070 wide × 600 deep at the same top-left
    const inside = { x: 1900, y: 1500 }; // inside the rotated rect, outside the unrotated one
    const outside = { x: 1300, y: 1900 }; // inside the unrotated rect, outside the rotated one
    const r = addRoute(f.project, f.link.id, [{ layer: 'in-rack', points: [inside, outside] }]);
    anchorWaypointsInRacks(f.project, r);
    const [a, b] = r.segments[0]!.points;
    expect(a!.anchor).toEqual({ rackId: f.r1.id, offset: { x: 900, y: 500 } });
    expect(b!.anchor).toBeUndefined();
    const next = produce(f.project, (draft) => {
      draft.racks[0]!.pos = { x: 1300, y: 1250 };
      expect(onRackMoved(draft, f.r1.id, { x: 300, y: 250 })).toBe(1);
    });
    const rack = next.racks[0]!;
    const wp = next.routes[f.link.id]!.segments[0]!.points[0]!;
    expect(wp.pos).toEqual({ x: 2200, y: 1750 });
    expect(rectContains(rackFloorRect(rack), wp.pos)).toBe(true);
    expect(wp.anchor?.offset).toEqual({ x: 900, y: 500 });
  });

  it('anchors inside a rotated manager column', () => {
    const f = twoRackFixture();
    f.r1.rotationDeg = 270; // front faces +x; the viewer's-left manager lies at y in [1600, 1752]
    const r = addRoute(f.project, f.link.id, [{ layer: 'in-rack', points: [{ x: 1500, y: 1700 }, { x: 1500, y: 900 }] }]);
    anchorWaypointsInRacks(f.project, r);
    expect(r.segments[0]!.points[0]!.anchor?.rackId).toBe(f.r1.id);
    expect(r.segments[0]!.points[1]!.anchor?.rackId).toBe(f.r1.id);
    const stray = createWaypoint({ x: 1500, y: 1800 });
    r.segments[0]!.points.push(stray);
    anchorWaypointsInRacks(f.project, r);
    expect(stray.anchor).toBeUndefined();
  });

  it('clears a stale anchor once the waypoint has left every rack', () => {
    const f = twoRackFixture();
    const r = addRoute(f.project, f.link.id, [{ layer: 'in-rack', points: [{ x: 1300, y: 1500 }] }]);
    anchorWaypointsInRacks(f.project, r);
    const wp = r.segments[0]!.points[0]!;
    expect(wp.anchor?.rackId).toBe(f.r1.id);
    wp.pos = { x: 3000, y: 100 };
    anchorWaypointsInRacks(f.project, r);
    expect(wp.anchor).toBeUndefined();
  });
});

describe('onEndpointMoved re-squaring', () => {
  it('produces an orthogonal end segment for every rotation of the destination rack', () => {
    for (const rot of [0, 90, 180, 270] as const) {
      const f = twoRackFixture();
      const r3 = addRack(f.project, 'R03', { x: 7000, y: 1000 }, rot);
      const r = addRoute(f.project, f.link.id, [
        { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }] },
      ]);
      r.segments[0]!.points[1]!.pinned = true;
      const next = produce(f.project, (draft) => {
        place(draft, f.sw1.id, r3.id, 10);
        expect(onEndpointMoved(draft, f.link.id, 'a')).toBe(true);
      });
      const after = next.routes[f.link.id]!;
      const ref = routeEndFloorPos(next, after, 'a')!;
      const [wp, pinned] = positions(after);
      expect(pinned).toEqual({ x: 4150, y: 500 });
      expect(orthogonal(ref, wp!)).toBe(true);
      // The inward segment was horizontal, so the end segment must be vertical.
      expect(wp!.y).toBe(500);
      expect(wp!.x).toBeCloseTo(ref.x, 9);
      expect(rectContains(rackFloorRect(next.racks[2]!), ref)).toBe(true);
    }
  });

  it('re-squares to the new entry when the rack rotates in place, leaving pinned points alone', () => {
    const f = twoRackFixture();
    const r = addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }] },
    ]);
    r.segments[0]!.points[1]!.pinned = true;
    const next = produce(f.project, (draft) => {
      draft.racks[0]!.rotationDeg = 90;
      onEndpointMoved(draft, f.link.id, 'a');
    });
    const entry = rackEntryPoints(next, next.racks[0]!).topLeft;
    expect(entry).toEqual({ x: 1535, y: 1150 });
    expect(positions(next.routes[f.link.id]!)).toEqual([{ x: 1535, y: 500 }, { x: 4150, y: 500 }]);
  });

  it('uses the preceding segment when the last segment is empty', () => {
    const f = twoRackFixture();
    const r = addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }] },
      { layer: 'in-rack', points: [] },
    ]);
    r.segments[0]!.points[0]!.pinned = true;
    const next = produce(f.project, (draft) => {
      draft.racks[1]!.pos = { x: 5000, y: 1000 };
      expect(onEndpointMoved(draft, f.link.id, 'b')).toBe(true);
    });
    expect(positions(next.routes[f.link.id]!, 0)).toEqual([{ x: 1150, y: 500 }, { x: 5150, y: 500 }]);
    expect(next.routes[f.link.id]!.segments[1]!.points).toHaveLength(0);
  });

  it('uses the following segment when the first segment is empty', () => {
    const f = twoRackFixture();
    const r = addRoute(f.project, f.link.id, [
      { layer: 'in-rack', points: [] },
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }] },
    ]);
    r.segments[1]!.points[1]!.pinned = true;
    const next = produce(f.project, (draft) => {
      draft.racks[0]!.pos = { x: 2000, y: 1000 };
      expect(onEndpointMoved(draft, f.link.id, 'a')).toBe(true);
    });
    expect(positions(next.routes[f.link.id]!, 1)).toEqual([{ x: 2150, y: 500 }, { x: 4150, y: 500 }]);
  });

  it('survives a route with no waypoints at all and still re-dresses the in-rack end', () => {
    const f = twoRackFixture();
    addRoute(f.project, f.link.id, [{ layer: 'overhead', points: [] }]);
    const next = produce(f.project, (draft) => {
      place(draft, f.sw1.id, f.r1.id, 40, 'rear');
      expect(onEndpointMoved(draft, f.link.id, 'a')).toBe(true);
    });
    // eth1/49 is on the left half; facing rear it lands on the rack's right side (fiber → left when both managers exist).
    expect(next.routes[f.link.id]!.aRack.side).toBe('left');
    expect(next.routes[f.link.id]!.aRack.pinned).toBe(false);
  });

  it('squares an in-rack end against the manager column', () => {
    const f = twoRackFixture();
    const r = addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }] },
      { layer: 'in-rack', points: [{ x: 4150, y: 1535 }] },
    ]);
    r.segments[0]!.points.forEach((w) => (w.pinned = true));
    const next = produce(f.project, (draft) => {
      draft.racks[1]!.pos = { x: 4000, y: 1300 };
      onEndpointMoved(draft, f.link.id, 'b');
    });
    const after = next.routes[f.link.id]!;
    const ref = routeEndFloorPos(next, after, 'b')!;
    expect(ref).toEqual(managerFloorCenter(next, f.r2.id, after.bRack.side));
    const wp = after.segments[1]!.points[0]!.pos;
    expect(orthogonal(ref, wp)).toBe(true);
    expect(positions(after, 0)).toEqual([{ x: 1150, y: 500 }, { x: 4150, y: 500 }]);
  });

  it('rack move followed by endpoint update keeps the tray waypoint pinned in place', () => {
    const f = twoRackFixture();
    const r = addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }, { x: 4150, y: 1535 }] },
    ]);
    r.segments[0]!.points[0]!.pinned = true;
    r.segments[0]!.points[1]!.pinned = true;
    anchorWaypointsInRacks(f.project, r);
    const next = produce(f.project, (draft) => {
      draft.racks[1]!.pos = { x: 4600, y: 1300 };
      onRackMoved(draft, f.r2.id, { x: 600, y: 300 });
      onEndpointMoved(draft, f.link.id, 'b');
    });
    const after = next.routes[f.link.id]!;
    const pts = positions(after);
    expect(pts[0]).toEqual({ x: 1150, y: 500 });
    expect(pts[1]).toEqual({ x: 4150, y: 500 });
    // The anchored end waypoint followed the rack by its offset and now sits on the new entry, so the
    // end segment is orthogonal without moving it (spec: unpinned end waypoints re-square so the END
    // segment stays orthogonal). Its inward neighbour is pinned and never moves, so that interior
    // segment goes diagonal rather than the waypoint being dragged back out of the rack, which would
    // break the anchor that made the in-rack dressing survive the move.
    const ref = routeEndFloorPos(next, after, 'b')!;
    expect(ref).toEqual({ x: 4750, y: 1835 });
    expect(orthogonal(ref, pts[2]!)).toBe(true);
    expect(pts[2]).toEqual({ x: 4750, y: 1835 });
    expect(after.segments[0]!.points[2]!.anchor).toEqual({ rackId: f.r2.id, offset: { x: 150, y: 535 } });
  });
});
