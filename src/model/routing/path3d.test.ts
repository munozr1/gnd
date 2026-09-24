import { describe, expect, it } from 'vitest';
import { bundleKey, bundles, defaultLayerElevationMm, routeEndFloorPos, routePath3d, segmentElevationMm } from './path3d';
import { rackTopMm } from './positions';
import { addRoute, addTray, place, routeTwoRacks, twoRackFixture } from './test-fixtures';

describe('elevations', () => {
  it('uses the tray elevation or the layer default', () => {
    const { project, tray } = twoRackFixture();
    expect(defaultLayerElevationMm(project.room, 'overhead')).toBe(2400);
    expect(defaultLayerElevationMm(project.room, 'underfloor')).toBe(-150);
    expect(defaultLayerElevationMm(project.room, 'in-rack')).toBe(0);
    expect(segmentElevationMm(project, { layer: 'overhead', trayId: tray.id })).toBe(2600);
    expect(segmentElevationMm(project, { layer: 'overhead', trayId: 'missing' })).toBe(2400);
    expect(segmentElevationMm(project, { layer: 'underfloor' })).toBe(-150);
  });
});

describe('routePath3d', () => {
  it('joins the in-rack polylines through the tray waypoints at the tray elevation', () => {
    const f = twoRackFixture();
    routeTwoRacks(f);
    const path = routePath3d(f.project, f.link.id)!;
    expect(path).not.toBeNull();
    // A: 5 pts; two tray waypoints (the tray runs at y = 500, off the entry columns); B reversed: 5 pts.
    expect(path.points).toHaveLength(5 + 2 + 5);
    expect(path.segmentsByLayer.map((s) => s.layer)).toEqual(['in-rack', 'overhead', 'in-rack']);
    const overhead = path.segmentsByLayer[1]!;
    for (let i = overhead.from; i <= overhead.to; i++) expect(path.points[i]!.y).toBe(2600);
    expect(path.points[0]!.y).toBeCloseTo(39 * 44.45 + 26, 6);
    expect(path.points[path.points.length - 1]!.y).toBeCloseTo(39 * 44.45 + 8, 6);
    // Ranges are contiguous.
    const { inRackA, rise, tray, drop, inRackB } = path.parts;
    expect(inRackA[0]).toBe(0);
    expect(inRackA[1]).toBe(rise[0]);
    expect(rise[1]).toBe(tray[0]);
    expect(tray[1]).toBe(drop[0]);
    expect(drop[1]).toBe(inRackB[0]);
    expect(inRackB[1]).toBe(path.points.length - 1);
    expect(path.points[rise[0]]!.y).toBeCloseTo(rackTopMm(f.r1), 6);
    expect(path.points[rise[1]]!.y).toBe(2600);
  });

  it('inserts a vertical drop where consecutive segments change elevation', () => {
    const f = twoRackFixture();
    const under = addTray(
      f.project,
      'tray.basket-200',
      [
        { x: 2000, y: 500 },
        { x: 4150, y: 500 },
      ],
      -150,
    );
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 2000, y: 500 }] },
      { layer: 'underfloor', trayId: under.id, points: [{ x: 2000, y: 500 }, { x: 4150, y: 500 }] },
    ]);
    const path = routePath3d(f.project, f.link.id)!;
    const drop = path.points.findIndex((p, i) => i > 0 && p.x === 2000 && p.z === 500 && p.y === -150);
    expect(drop).toBeGreaterThan(0);
    expect(path.points[drop - 1]).toEqual({ x: 2000, y: 2600, z: 500 });
    expect(path.segmentsByLayer.map((s) => s.layer)).toEqual(['in-rack', 'overhead', 'underfloor', 'in-rack']);
    // B end is dressed through the bottom entry.
    const last = path.points[path.points.length - 1]!;
    expect(last.y).toBeCloseTo(39 * 44.45 + 8, 6);
    expect(path.points[path.parts.drop[1]]).toEqual({ x: f.r2.pos.x + 300, y: 0, z: 1535 });
  });

  it('handles a route with no waypoints', () => {
    const f = twoRackFixture();
    addRoute(f.project, f.link.id, []);
    const path = routePath3d(f.project, f.link.id)!;
    expect(path.points.length).toBeGreaterThan(2);
    expect(path.segmentsByLayer.every((s) => s.layer === 'in-rack')).toBe(true);
  });

  it('is null without a route or with an unplaced end', () => {
    const f = twoRackFixture();
    expect(routePath3d(f.project, f.link.id)).toBeNull();
    routeTwoRacks(f);
    place(f.project, f.sw2.id, null, null);
    expect(routePath3d(f.project, f.link.id)).toBeNull();
  });
});

describe('routeEndFloorPos and bundles', () => {
  it('returns the entry point on the route side for each end', () => {
    const f = twoRackFixture();
    const route = routeTwoRacks(f);
    expect(routeEndFloorPos(f.project, route, 'a')).toEqual({ x: 1150, y: 1535 });
    expect(routeEndFloorPos(f.project, route, 'b')).toEqual({ x: f.r2.pos.x + 150, y: 1535 });
    route.bRack.side = 'right';
    expect(routeEndFloorPos(f.project, route, 'b')).toEqual({ x: f.r2.pos.x + 450, y: 1535 });
  });

  it('groups routes by rack and manager side', () => {
    const f = twoRackFixture();
    const route = routeTwoRacks(f);
    const b = bundles(f.project);
    expect(b.get(bundleKey(f.r1.id, route.aRack.side))).toEqual([f.link.id]);
    expect(b.get(bundleKey(f.r2.id, route.bRack.side))).toEqual([f.link.id]);
    expect(b.size).toBe(2);
  });
});
