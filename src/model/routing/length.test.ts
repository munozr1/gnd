import { describe, expect, it } from 'vitest';
import { manhattan } from '../geometry';
import { STANDARD_LENGTHS_M, estimatedLengthM, linkLengthM, roundToStandard, routedLengthM } from './length';
import { routePath3d } from './path3d';
import { polyline3dLength, portFloorPos } from './positions';
import { place, routeTwoRacks, twoRackFixture } from './test-fixtures';

describe('roundToStandard', () => {
  it('ceils to the next standard length', () => {
    expect(STANDARD_LENGTHS_M).toEqual([1, 2, 3, 5, 7, 10, 15, 20, 30]);
    expect(roundToStandard(4.2)).toBe(5);
    expect(roundToStandard(0.4)).toBe(1);
    expect(roundToStandard(1)).toBe(1);
    expect(roundToStandard(3.0000001)).toBe(3);
    expect(roundToStandard(7.1)).toBe(10);
    expect(roundToStandard(30)).toBe(30);
    expect(roundToStandard(0)).toBe(1);
  });

  it('ceils to 5 m multiples above 30 m', () => {
    expect(roundToStandard(30.1)).toBe(35);
    expect(roundToStandard(47)).toBe(50);
    expect(roundToStandard(120)).toBe(120);
    expect(roundToStandard(120.5)).toBe(125);
  });
});

describe('routedLengthM', () => {
  it('measures the 3D path, adds slack, and rounds to a standard length', () => {
    const f = twoRackFixture();
    routeTwoRacks(f);
    const len = routedLengthM(f.project, f.link.id)!;
    const path = routePath3d(f.project, f.link.id)!;
    expect(len.est).toBe(false);
    expect(len.rawM).toBeCloseTo(polyline3dLength(path.points) / 1000, 9);
    expect(len.withSlackM).toBeCloseTo(len.rawM * 1.1 + 1, 9);
    expect(len.standardM).toBe(roundToStandard(len.withSlackM));
    const b = len.breakdown;
    expect(b.inRackA + b.rise + b.tray + b.drop + b.inRackB).toBeCloseTo(len.rawM, 9);
    expect(b.rise).toBeCloseTo((2600 - (42 * 44.45 + 100)) / 1000, 9);
    expect(b.drop).toBeCloseTo(b.rise, 9);
    // 3 m along the tray plus the 1.035 m from each entry column (y = 1535) out to the tray (y = 500).
    expect(b.tray).toBeCloseTo(3 + 2 * 1.035, 9);
    expect(b.verticalTotal).toBeGreaterThan(b.rise + b.drop);
  });

  it('adds service loops to the slack', () => {
    const f = twoRackFixture();
    const route = routeTwoRacks(f);
    const before = routedLengthM(f.project, f.link.id)!;
    route.segments[0]!.points[0]!.serviceLoopM = 2;
    const after = routedLengthM(f.project, f.link.id)!;
    expect(after.rawM).toBe(before.rawM);
    expect(after.serviceLoopM).toBe(2);
    expect(after.withSlackM).toBeCloseTo(before.withSlackM + 2, 9);
  });

  it('is null without a route', () => {
    const f = twoRackFixture();
    expect(routedLengthM(f.project, f.link.id)).toBeNull();
  });
});

describe('estimatedLengthM / linkLengthM', () => {
  it('estimates Manhattan floor distance plus the vertical to the default tray elevation', () => {
    const f = twoRackFixture();
    const est = estimatedLengthM(f.project, f.link.id)!;
    const pa = portFloorPos(f.project, f.sw1.id, 'eth1/49')!;
    const pb = portFloorPos(f.project, f.sw2.id, 'eth1/1')!;
    const ea = 39 * 44.45 + 26;
    const eb = 39 * 44.45 + 8;
    const expected = (manhattan(pa, pb) + (2400 - ea) + (2400 - eb)) / 1000;
    expect(est.est).toBe(true);
    expect(est.rawM).toBeCloseTo(expected, 9);
    expect(est.breakdown.tray).toBeCloseTo(manhattan(pa, pb) / 1000, 9);
    expect(est.breakdown.verticalTotal).toBeCloseTo(((2400 - ea) + (2400 - eb)) / 1000, 9);
    expect(est.standardM).toBe(roundToStandard(est.withSlackM));
  });

  it('linkLengthM prefers the routed length and falls back to the estimate', () => {
    const f = twoRackFixture();
    expect(linkLengthM(f.project, f.link.id)!.est).toBe(true);
    routeTwoRacks(f);
    expect(linkLengthM(f.project, f.link.id)!.est).toBe(false);
    place(f.project, f.sw1.id, null, null);
    expect(linkLengthM(f.project, f.link.id)).toBeNull();
  });
});
