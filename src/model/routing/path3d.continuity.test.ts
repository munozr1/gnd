/**
 * Adversarial tests for the 3D pathway: no NaN, consecutive points connected
 * and axis-aligned (horizontal runs or vertical drops), contiguous layer and
 * breakdown ranges, and correct end points across exotic route shapes.
 */
import { describe, expect, it } from 'vitest';
import type { Rotation } from '../types';
import { routePath3d, type RoutePath3d } from './path3d';
import { dist3, portWorldPos } from './positions';
import { addDevice, addLink, addRoute, addTray, twoRackFixture, type TwoRackFixture } from './test-fixtures';
import { dropsOf } from './waypoints';

function assertWellFormed(path: RoutePath3d): void {
  const n = path.points.length;
  expect(n).toBeGreaterThanOrEqual(2);
  for (const p of path.points) {
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
    expect(Number.isFinite(p.z)).toBe(true);
  }
  for (let i = 1; i < n; i++) {
    const a = path.points[i - 1]!;
    const b = path.points[i]!;
    expect(dist3(a, b)).toBeGreaterThan(1e-6);
    // Every elevation change is a pure vertical: a drop or a rise, never a slope.
    if (Math.abs(a.y - b.y) > 1e-6) {
      expect(Math.abs(a.x - b.x)).toBeLessThan(1e-6);
      expect(Math.abs(a.z - b.z)).toBeLessThan(1e-6);
    }
  }
  // Layer ranges tile [0, n-1] without gaps or overlap.
  const layers = path.segmentsByLayer;
  expect(layers.length).toBeGreaterThan(0);
  expect(layers[0]!.from).toBe(0);
  expect(layers[layers.length - 1]!.to).toBe(n - 1);
  for (let i = 0; i < layers.length; i++) {
    expect(layers[i]!.to).toBeGreaterThan(layers[i]!.from);
    if (i > 0) expect(layers[i]!.from).toBe(layers[i - 1]!.to);
  }
  // Breakdown ranges are contiguous and ordered.
  const { inRackA, rise, tray, drop, inRackB } = path.parts;
  expect(inRackA[0]).toBe(0);
  expect(inRackA[1]).toBe(rise[0]);
  expect(rise[1]).toBe(tray[0]);
  expect(tray[1]).toBe(drop[0]);
  expect(drop[1]).toBe(inRackB[0]);
  expect(inRackB[1]).toBe(n - 1);
  for (const r of [inRackA, rise, tray, drop, inRackB]) expect(r[1]).toBeGreaterThanOrEqual(r[0]);
}

function assertEndsAtPorts(f: TwoRackFixture, path: RoutePath3d, linkA = f.sw1.id, portA = 'eth1/49', linkB = f.sw2.id, portB = 'eth1/1'): void {
  expect(path.points[0]).toEqual(portWorldPos(f.project, linkA, portA));
  expect(path.points[path.points.length - 1]).toEqual(portWorldPos(f.project, linkB, portB));
}

describe('routePath3d well-formedness', () => {
  it('standard overhead route', () => {
    const f = twoRackFixture();
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }] },
    ]);
    const path = routePath3d(f.project, f.link.id)!;
    assertWellFormed(path);
    assertEndsAtPorts(f, path);
    expect(path.segmentsByLayer.map((s) => s.layer)).toEqual(['in-rack', 'overhead', 'in-rack']);
  });

  it('duplicate consecutive waypoints collapse instead of producing zero-length steps', () => {
    const f = twoRackFixture();
    addRoute(f.project, f.link.id, [
      {
        layer: 'overhead',
        trayId: f.tray.id,
        points: [{ x: 1150, y: 1535 }, { x: 1150, y: 1535 }, { x: 1150, y: 500 }, { x: 1150, y: 500 }, { x: 4150, y: 500 }, { x: 4150, y: 1535 }],
      },
    ]);
    const path = routePath3d(f.project, f.link.id)!;
    assertWellFormed(path);
    assertEndsAtPorts(f, path);
    // A's entry, the two tray corners, and B's entry: 5 + 2 + 5 with both entry waypoints deduplicated.
    expect(path.points).toHaveLength(12);
  });

  it('empty segments in the middle and at both ends', () => {
    const f = twoRackFixture();
    addRoute(f.project, f.link.id, [
      { layer: 'in-rack', points: [] },
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }] },
      { layer: 'underfloor', points: [] },
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 4150, y: 500 }] },
      { layer: 'in-rack', points: [] },
    ]);
    const path = routePath3d(f.project, f.link.id)!;
    assertWellFormed(path);
    assertEndsAtPorts(f, path);
    expect(path.segmentsByLayer.map((s) => s.layer)).toEqual(['in-rack', 'overhead', 'in-rack']);
    expect(dropsOf(f.project.routes[f.link.id]!)).toHaveLength(0);
  });

  it('overhead → in-rack → overhead dips to the floor and climbs back', () => {
    const f = twoRackFixture();
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 2500, y: 500 }] },
      { layer: 'in-rack', points: [{ x: 2500, y: 500 }, { x: 3000, y: 500 }] },
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 3000, y: 500 }, { x: 4150, y: 500 }] },
    ]);
    const path = routePath3d(f.project, f.link.id)!;
    assertWellFormed(path);
    assertEndsAtPorts(f, path);
    expect(path.segmentsByLayer.map((s) => s.layer)).toEqual(['in-rack', 'overhead', 'in-rack', 'overhead', 'in-rack']);
    const ys = path.points.map((p) => p.y);
    expect(ys).toContain(0);
    expect(ys.filter((y) => y === 2600).length).toBeGreaterThanOrEqual(4);
  });

  it('underfloor from end to end dresses both racks through the bottom entry', () => {
    const f = twoRackFixture();
    const under = addTray(f.project, 'tray.basket-300', [{ x: 1300, y: 1535 }, { x: 4300, y: 1535 }], -150);
    addRoute(f.project, f.link.id, [
      { layer: 'underfloor', trayId: under.id, points: [{ x: 1300, y: 1535 }, { x: 4300, y: 1535 }] },
    ]);
    const path = routePath3d(f.project, f.link.id)!;
    assertWellFormed(path);
    assertEndsAtPorts(f, path);
    expect(path.segmentsByLayer.map((s) => s.layer)).toEqual(['in-rack', 'underfloor', 'in-rack']);
    expect(Math.min(...path.points.map((p) => p.y))).toBe(-150);
    expect(Math.max(...path.points.map((p) => p.y))).toBeLessThan(42 * 44.45 + 100);
  });

  it('same-rack link with no segments stays inside the rack', () => {
    const f = twoRackFixture();
    const srv = addDevice(f.project, 'sym.server-1u', 'SRV1', { rackId: f.r1.id, u: 10 });
    const link = addLink(f.project, [f.sw1, 'eth1/1'], [srv, 'eth0'], 'cbl.om4-duplex');
    addRoute(f.project, link.id, []);
    const path = routePath3d(f.project, link.id)!;
    assertWellFormed(path);
    assertEndsAtPorts(f, path, f.sw1.id, 'eth1/1', srv.id, 'eth0');
    expect(path.segmentsByLayer.every((s) => s.layer === 'in-rack')).toBe(true);
    expect(Math.max(...path.points.map((p) => p.y))).toBeLessThan(42 * 44.45 + 100);
  });

  it('same-rack link through the tray with a single waypoint on the entry', () => {
    const f = twoRackFixture();
    const srv = addDevice(f.project, 'sym.server-1u', 'SRV1', { rackId: f.r1.id, u: 10 });
    const link = addLink(f.project, [f.sw1, 'eth1/1'], [srv, 'eth0'], 'cbl.om4-duplex');
    addRoute(f.project, link.id, [{ layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 1535 }] }]);
    const path = routePath3d(f.project, link.id)!;
    assertWellFormed(path);
    assertEndsAtPorts(f, path, f.sw1.id, 'eth1/1', srv.id, 'eth0');
    expect(path.points.filter((p) => p.y === 2600)).toHaveLength(1);
  });

  it('a route with no waypoints whose only segments are on different layers still drops vertically', () => {
    const f = twoRackFixture();
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [] },
      { layer: 'underfloor', points: [] },
    ]);
    const path = routePath3d(f.project, f.link.id)!;
    assertWellFormed(path);
    assertEndsAtPorts(f, path);
  });

  it('rotated racks at both ends', () => {
    for (const [ra, rb] of [
      [90, 270],
      [180, 180],
      [270, 90],
      [90, 0],
    ] as [Rotation, Rotation][]) {
      const f = twoRackFixture();
      f.r1.rotationDeg = ra;
      f.r2.rotationDeg = rb;
      addRoute(f.project, f.link.id, [
        { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1535, y: 500 }, { x: 4535, y: 500 }] },
      ]);
      const path = routePath3d(f.project, f.link.id)!;
      assertWellFormed(path);
      assertEndsAtPorts(f, path);
    }
  });

  it('a mid-route drop lands exactly under the last waypoint of the leaving segment', () => {
    const f = twoRackFixture();
    const under = addTray(f.project, 'tray.basket-200', [{ x: 2000, y: 500 }, { x: 4150, y: 500 }], -150);
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 2000, y: 700 }] },
      { layer: 'underfloor', trayId: under.id, points: [{ x: 2300, y: 700 }, { x: 4150, y: 500 }] },
    ]);
    const path = routePath3d(f.project, f.link.id)!;
    assertWellFormed(path);
    const drops = dropsOf(f.project.routes[f.link.id]!);
    expect(drops).toEqual([{ pos: { x: 2000, y: 700 }, fromLayer: 'overhead', toLayer: 'underfloor', segmentIndex: 0 }]);
    const i = path.points.findIndex((p) => p.x === 2000 && p.z === 700 && p.y === 2600);
    expect(i).toBeGreaterThan(0);
    expect(path.points[i + 1]).toEqual({ x: 2000, y: -150, z: 700 });
    expect(path.points[i + 2]).toEqual({ x: 2300, y: -150, z: 700 });
  });

  it('a tray segment whose trayId is stale falls back to the layer default elevation', () => {
    const f = twoRackFixture();
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: 'gone', points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }] },
    ]);
    const path = routePath3d(f.project, f.link.id)!;
    assertWellFormed(path);
    const overhead = path.segmentsByLayer.find((s) => s.layer === 'overhead')!;
    for (let i = overhead.from; i <= overhead.to; i++) expect(path.points[i]!.y).toBe(2400);
  });

  it('the rise and drop ranges are exactly one vertical step each for an overhead route', () => {
    const f = twoRackFixture();
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }] },
    ]);
    const path = routePath3d(f.project, f.link.id)!;
    const { rise, drop } = path.parts;
    expect(rise[1] - rise[0]).toBe(1);
    expect(drop[1] - drop[0]).toBe(1);
    const r0 = path.points[rise[0]]!;
    const r1 = path.points[rise[1]]!;
    expect(r0.x).toBe(r1.x);
    expect(r0.z).toBe(r1.z);
    expect(r1.y - r0.y).toBeCloseTo(2600 - (42 * 44.45 + 100), 6);
    const d0 = path.points[drop[0]]!;
    const d1 = path.points[drop[1]]!;
    expect(d0.x).toBe(d1.x);
    expect(d0.z).toBe(d1.z);
    expect(d0.y - d1.y).toBeCloseTo(2600 - (42 * 44.45 + 100), 6);
  });
});
