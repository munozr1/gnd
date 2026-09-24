/**
 * Adversarial tests for cable lengths: rounding boundaries, slack settings,
 * vertical components at drops, and estimated vs routed behaviour.
 */
import { describe, expect, it } from 'vitest';
import { manhattan } from '../geometry';
import { STANDARD_LENGTHS_M, estimatedLengthM, linkLengthM, roundToStandard, routedLengthM } from './length';
import { routePath3d } from './path3d';
import { U_MM, polyline3dLength, portElevationMm, portFloorPos, rackTopMm } from './positions';
import { addDevice, addLink, addRoute, addTray, place, routeTwoRacks, twoRackFixture } from './test-fixtures';

const TOP = 42 * U_MM + 100;
const ELEV_A = 39 * U_MM + 26; // SW1 eth1/49
const ELEV_B = 39 * U_MM + 8; // SW2 eth1/1

describe('roundToStandard boundaries', () => {
  it('returns each standard length exactly at and a hair above itself', () => {
    for (const s of STANDARD_LENGTHS_M) {
      expect(roundToStandard(s)).toBe(s);
      expect(roundToStandard(s + 5e-7)).toBe(s);
      expect(roundToStandard(s - 1e-3)).toBe(s);
    }
  });

  it('steps up to the next standard just past the tolerance', () => {
    expect(roundToStandard(1.00001)).toBe(2);
    expect(roundToStandard(2.001)).toBe(3);
    expect(roundToStandard(3.001)).toBe(5);
    expect(roundToStandard(5.001)).toBe(7);
    expect(roundToStandard(7.001)).toBe(10);
    expect(roundToStandard(10.001)).toBe(15);
    expect(roundToStandard(15.001)).toBe(20);
    expect(roundToStandard(20.001)).toBe(30);
    expect(roundToStandard(30.001)).toBe(35);
    expect(roundToStandard(35)).toBe(35);
    expect(roundToStandard(35.001)).toBe(40);
  });

  it('never rounds down and always lands on a standard or a 5 m multiple', () => {
    for (let m = 0.01; m < 80; m += 0.137) {
      const r = roundToStandard(m);
      expect(r).toBeGreaterThanOrEqual(m - 1e-6);
      const ok = STANDARD_LENGTHS_M.includes(r) || (r > 30 && Math.abs(r / 5 - Math.round(r / 5)) < 1e-9);
      expect(ok).toBe(true);
      // Never skips a shorter standard that would have fit.
      for (const s of STANDARD_LENGTHS_M) if (s >= m + 1e-6) expect(r).toBeLessThanOrEqual(s);
    }
  });

  it('treats non-positive values as the shortest standard', () => {
    expect(roundToStandard(0)).toBe(1);
    expect(roundToStandard(-4)).toBe(1);
    expect(roundToStandard(1e-9)).toBe(1);
  });
});

describe('slack', () => {
  it('applies the project slack settings, not hard-coded 10% / 0.5 m', () => {
    const f = twoRackFixture();
    routeTwoRacks(f);
    f.project.settings.slackFraction = 0.25;
    f.project.settings.slackPerEndM = 1.5;
    const len = routedLengthM(f.project, f.link.id)!;
    expect(len.withSlackM).toBeCloseTo(len.rawM * 1.25 + 3, 9);
    expect(len.standardM).toBe(roundToStandard(len.withSlackM));
    expect(len.standardM).toBeGreaterThanOrEqual(len.withSlackM);
    const est = estimatedLengthM(f.project, f.link.id)!;
    expect(est.withSlackM).toBeCloseTo(est.rawM * 1.25 + 3, 9);
  });

  it('zero slack leaves withSlack equal to raw and still rounds up', () => {
    const f = twoRackFixture();
    routeTwoRacks(f);
    f.project.settings.slackFraction = 0;
    f.project.settings.slackPerEndM = 0;
    const len = routedLengthM(f.project, f.link.id)!;
    expect(len.withSlackM).toBeCloseTo(len.rawM, 12);
    expect(len.standardM).toBeGreaterThanOrEqual(len.rawM);
  });

  it('sums service loops across every segment and never counts them in raw', () => {
    const f = twoRackFixture();
    const under = addTray(f.project, 'tray.basket-200', [{ x: 2000, y: 500 }, { x: 4150, y: 500 }], -150);
    const route = addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 2000, y: 500 }] },
      { layer: 'underfloor', trayId: under.id, points: [{ x: 2000, y: 500 }, { x: 4150, y: 500 }] },
    ]);
    const before = routedLengthM(f.project, f.link.id)!;
    route.segments[0]!.points[1]!.serviceLoopM = 1.5;
    route.segments[1]!.points[0]!.serviceLoopM = 0.5;
    route.segments[1]!.points[1]!.serviceLoopM = 2;
    const after = routedLengthM(f.project, f.link.id)!;
    expect(after.serviceLoopM).toBe(4);
    expect(after.rawM).toBe(before.rawM);
    expect(after.withSlackM).toBeCloseTo(before.withSlackM + 4, 9);
    expect(after.breakdown).toEqual(before.breakdown);
  });
});

describe('vertical components', () => {
  it('counts the full drop between an overhead and an underfloor segment plus both rack ends', () => {
    const f = twoRackFixture();
    const under = addTray(f.project, 'tray.basket-200', [{ x: 2000, y: 500 }, { x: 4150, y: 500 }], -150);
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 2000, y: 500 }] },
      { layer: 'underfloor', trayId: under.id, points: [{ x: 2000, y: 500 }, { x: 4150, y: 500 }] },
    ]);
    const len = routedLengthM(f.project, f.link.id)!;
    const b = len.breakdown;
    // A: manager up to the roof, rise to the tray. Mid-route: 2600 → -150. B: bottom entry -150 → 0, then up the manager to the port.
    const expectedVertical = (TOP - ELEV_A) + (2600 - TOP) + (2600 + 150) + 150 + ELEV_B;
    expect(b.verticalTotal).toBeCloseTo(expectedVertical / 1000, 9);
    expect(b.rise).toBeCloseTo((2600 - TOP) / 1000, 9);
    expect(b.drop).toBeCloseTo(0.15, 9);
    // The mid-route drop is part of the tray run.
    expect(b.tray).toBeGreaterThan(2.75);
    expect(b.inRackA + b.rise + b.tray + b.drop + b.inRackB).toBeCloseTo(len.rawM, 9);
    // Vertical can never exceed the geometric path.
    expect(b.verticalTotal).toBeLessThanOrEqual(len.rawM + 1e-9);
  });

  it('a route that climbs to the tray and immediately drops back into the same rack still counts both verticals', () => {
    const f = twoRackFixture();
    const srv = addDevice(f.project, 'sym.server-1u', 'SRV1', { rackId: f.r1.id, u: 10 });
    const link = addLink(f.project, [f.sw1, 'eth1/1'], [srv, 'eth0'], 'cbl.om4-duplex');
    addRoute(f.project, link.id, [{ layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 1535 }] }]);
    const len = routedLengthM(f.project, link.id)!;
    const b = len.breakdown;
    const ea = portElevationMm(f.project, f.sw1.id, 'eth1/1')!;
    const eb = portElevationMm(f.project, srv.id, 'eth0')!;
    expect(b.rise).toBeCloseTo((2600 - TOP) / 1000, 9);
    expect(b.drop).toBeCloseTo((2600 - TOP) / 1000, 9);
    expect(b.tray).toBeCloseTo(0, 9);
    expect(b.verticalTotal).toBeCloseTo(((TOP - ea) + (2600 - TOP) + (2600 - TOP) + (TOP - eb)) / 1000, 9);
    expect(b.inRackA + b.rise + b.tray + b.drop + b.inRackB).toBeCloseTo(len.rawM, 9);
  });

  it('keeps the breakdown contiguous when the last waypoint coincides with the far entry', () => {
    const f = twoRackFixture();
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }, { x: 4150, y: 1535 }] },
    ]);
    const len = routedLengthM(f.project, f.link.id)!;
    const path = routePath3d(f.project, f.link.id)!;
    const b = len.breakdown;
    expect(b.inRackA + b.rise + b.tray + b.drop + b.inRackB).toBeCloseTo(len.rawM, 9);
    expect(len.rawM).toBeCloseTo(polyline3dLength(path.points) / 1000, 9);
    // Tray = 1.035 m out from A's entry column, 3 m along, 1.035 m back over B's entry.
    expect(b.tray).toBeCloseTo(3 + 2 * 1.035, 9);
    expect(b.drop).toBeCloseTo((2600 - TOP) / 1000, 9);
  });

  it('uses the tray elevation of the segment, not the layer default, for the rise', () => {
    const f = twoRackFixture();
    const high = addTray(f.project, 'tray.fiber-runway-6', [{ x: 500, y: 500 }, { x: 5000, y: 500 }], 2900);
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: high.id, points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }] },
    ]);
    const len = routedLengthM(f.project, f.link.id)!;
    expect(len.breakdown.rise).toBeCloseTo((2900 - TOP) / 1000, 9);
    expect(len.breakdown.drop).toBeCloseTo((2900 - TOP) / 1000, 9);
  });
});

describe('estimated vs routed', () => {
  it('estimate follows the room ceiling for the default tray elevation', () => {
    const f = twoRackFixture();
    f.project.room.ceilingMm = 4000;
    const est = estimatedLengthM(f.project, f.link.id)!;
    const pa = portFloorPos(f.project, f.sw1.id, 'eth1/49')!;
    const pb = portFloorPos(f.project, f.sw2.id, 'eth1/1')!;
    expect(est.est).toBe(true);
    expect(est.breakdown.rise).toBeCloseTo((3400 - ELEV_A) / 1000, 9);
    expect(est.breakdown.drop).toBeCloseTo((3400 - ELEV_B) / 1000, 9);
    expect(est.rawM).toBeCloseTo((manhattan(pa, pb) + (3400 - ELEV_A) + (3400 - ELEV_B)) / 1000, 9);
    expect(est.breakdown.inRackA).toBe(0);
    expect(est.breakdown.inRackB).toBe(0);
    expect(est.serviceLoopM).toBe(0);
  });

  it('estimate is symmetric in the link direction', () => {
    const f = twoRackFixture();
    const rev = addLink(f.project, [f.sw2, 'eth1/2'], [f.sw1, 'eth1/50'], 'cbl.om4-mpo-trunk');
    // Same ports geometrically: eth1/50 on the leaf is 1 slot right of eth1/49; use identical ones instead.
    const fwd = addLink(f.project, [f.sw1, 'eth1/51'], [f.sw2, 'eth1/3'], 'cbl.om4-mpo-trunk');
    const back = addLink(f.project, [f.sw2, 'eth1/3'], [f.sw1, 'eth1/51'], 'cbl.om4-mpo-trunk');
    expect(estimatedLengthM(f.project, fwd.id)!.rawM).toBeCloseTo(estimatedLengthM(f.project, back.id)!.rawM, 12);
    expect(estimatedLengthM(f.project, rev.id)).not.toBeNull();
  });

  it('a route with empty segments is still "routed", not estimated', () => {
    const f = twoRackFixture();
    addRoute(f.project, f.link.id, [{ layer: 'overhead', trayId: f.tray.id, points: [] }]);
    const len = linkLengthM(f.project, f.link.id)!;
    expect(len.est).toBe(false);
    expect(Number.isFinite(len.rawM)).toBe(true);
    expect(len.rawM).toBeGreaterThan(0);
    expect(len.breakdown.rise).toBeCloseTo((2600 - TOP) / 1000, 9);
  });

  it('routed length is null (and linkLengthM falls back to null) when either end is unplaced', () => {
    const f = twoRackFixture();
    routeTwoRacks(f);
    place(f.project, f.sw2.id, null, null);
    expect(routedLengthM(f.project, f.link.id)).toBeNull();
    expect(estimatedLengthM(f.project, f.link.id)).toBeNull();
    expect(linkLengthM(f.project, f.link.id)).toBeNull();
  });

  it('is null for an unknown link', () => {
    const f = twoRackFixture();
    expect(routedLengthM(f.project, 'nope')).toBeNull();
    expect(estimatedLengthM(f.project, 'nope')).toBeNull();
    expect(linkLengthM(f.project, 'nope')).toBeNull();
  });

  it('raw routed length is never below the straight-line 3D distance between the ports', () => {
    const f = twoRackFixture();
    routeTwoRacks(f);
    const len = routedLengthM(f.project, f.link.id)!;
    const path = routePath3d(f.project, f.link.id)!;
    const a = path.points[0]!;
    const b = path.points[path.points.length - 1]!;
    expect(len.rawM * 1000).toBeGreaterThanOrEqual(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    expect(rackTopMm(f.r1)).toBeCloseTo(TOP, 9);
  });
});
