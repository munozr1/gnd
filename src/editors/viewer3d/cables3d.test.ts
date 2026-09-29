import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { autoFillCableSide, connectorById, furcationDefaultFloorPos, plugCableLeg, resolveCableOf, unplugCableLeg } from '@/model/cables';
import { createCable, createProject, createRack, createWaypoint } from '@/model/factories';
import { portElevationMm, portWorldPos, routePath3d } from '@/model/routing';
import { LEAF, PANEL_LC, place } from '@/model/schematic/testUtils';
import type { Project, Route } from '@/model/types';
import { BOOT_COLOR, BOOT_LENGTH_MM, JACKET_STUB_MM, LEG_STUB_MM, PLATE_MM, PORT_STANDOFF_MM, STUB_COLOR, buildInstalledCable3d } from './cables3d';
import { buildPhysicalScene, metres, type V3 } from './geometry';

const TRUNK = 'cbl.om4-8f-mpo8-4lc';
const standardRack = builtinCatalog.racks[0]!;
const B_PORTS = ['f1', 'f2', 'f3', 'f4'];

/**
 * Leaf SW1 (SR4 in eth1/49) in rack A01 and LC panel PP1 in A02, 3 m apart on a
 * row, both front-facing +z; an 8F MPO-8 → 4×LC trunk plugged eth1/49 → f1..f4.
 * Both racks are at rotation 0, so a front face's outward normal is world +z.
 */
function connected(opts: { panelRack?: string; plugA?: boolean; legsB?: number } = {}) {
  const p0 = createProject('t', '2026-01-01T00:00:00.000Z');
  const leaf = place(p0, LEAF, { x: 0, y: 0 }, { ref: 'SW1' });
  leaf.optics['eth1/49'] = 'xcvr.100g-sr4';
  const panel = place(p0, PANEL_LC, { x: 600, y: 0 }, { ref: 'PP1' });
  const r1 = createRack(standardRack, { name: 'A01', pos: { x: 1000, y: 1000 } });
  const r2 = createRack(builtinCatalog.racks.find((r) => r.id === (opts.panelRack ?? standardRack.id))!, { name: 'A02', pos: { x: 4000, y: 1000 } });
  p0.racks.push(r1, r2);
  p0.placements.push({ componentId: leaf.id, rackId: r1.id, uPosition: 40, face: 'front' }, { componentId: panel.id, rackId: r2.id, uPosition: 10, face: 'front' });
  const cable = createCable(builtinCatalog.cables.find((c) => c.id === TRUNK)!, 'CBL1');
  p0.cables.push(cable);
  const p: Project = produce(p0, (d) => {
    if (opts.plugA !== false) plugCableLeg(d, cable.id, 'A', 0, { componentId: leaf.id, portId: 'eth1/49' });
    autoFillCableSide(d, cable.id, 'B', { componentId: panel.id, portId: 'f1' });
    for (let leg = opts.legsB ?? 4; leg < 4; leg++) unplugCableLeg(d, cable.id, 'B', leg);
  });
  return { p, cable: p.cables[0]!, leaf, panel };
}

const close = (a: V3, b: V3, digits = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v: V3) => Math.hypot(...v);
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lengthMm = (part: { size: V3 }) => Math.round(part.size[2] * 1000);
/** Where side B's furcation lands: the default floor point at the mean elevation of the plugged panel ports. */
function furcationB(p: Project, cable: Project['cables'][number], panelId: string, ports: string[]): V3 {
  const floor = furcationDefaultFloorPos(p, cable, 'B')!;
  const elevation = ports.reduce((s, id) => s + portElevationMm(p, panelId, id)!, 0) / ports.length;
  return metres({ x: floor.x, y: elevation, z: floor.y });
}

/** A hand-routed overhead run between the two racks, keyed by `id` (a link id, or a cable id for a jacket route). */
const overheadRoute = (id: string, owner?: 'cable'): Route => ({
  linkId: id,
  ...(owner ? { owner } : {}),
  aRack: { side: 'left', entry: null, pinned: false },
  bRack: { side: 'left', entry: null, pinned: false },
  segments: [{ layer: 'overhead', trayId: null, points: [createWaypoint({ x: 1150, y: 500 }), createWaypoint({ x: 4150, y: 500 })] }],
});
const bootEndOf = (boot: { position: V3; direction: V3 }): V3 => [boot.position[0] + boot.direction[0] * 0.03, boot.position[1] + boot.direction[1] * 0.03, boot.position[2] + boot.direction[2] * 0.03];

describe('buildInstalledCable3d', () => {
  it('draws a trunk as one jacket, one boot, four legs and connector shapes that all target the cable', () => {
    const { p, cable, leaf, panel } = connected();
    const scene = buildInstalledCable3d(p, cable)!;
    const resolved = resolveCableOf(p, cable)!;
    expect(scene.target).toEqual({ kind: 'cable', id: cable.id });
    expect(scene.label).toBe('CBL1');
    // Jacket: leaves the switch port perpendicular to the face (+z), then straight to the furcation; unrouted.
    const a = portWorldPos(p, leaf.id, 'eth1/49')!;
    const furcation = furcationB(p, cable, panel.id, B_PORTS);
    expect(scene.routed).toBe(false);
    expect(scene.layers).toEqual([]);
    expect(scene.jacket.points).toHaveLength(3);
    close(scene.jacket.points[0]!, metres(a));
    close(scene.jacket.points[1]!, metres({ x: a.x, y: a.y, z: a.z + PORT_STANDOFF_MM }));
    close(scene.jacket.points[2]!, furcation);
    expect(scene.jacket.radius).toBeCloseTo(resolved.diameterMm / 2000, 9);
    expect(scene.jacket.color).toBe(resolved.color);
    // Boot: the last 60 mm of the jacket, ending at the furcation, twice the jacket's radius, continuing the jacket's last segment.
    expect(scene.boots).toHaveLength(1);
    const boot = scene.boots[0]!;
    expect(boot.side).toBe('B');
    expect(boot.color).toBe(BOOT_COLOR);
    close(bootEndOf(boot), furcation);
    expect(boot.length).toBeCloseTo(BOOT_LENGTH_MM / 1000, 9);
    expect(boot.radius).toBeCloseTo(scene.jacket.radius * 2, 9);
    const last = sub(furcation, scene.jacket.points[1]!), direction: V3 = [last[0] / len(last), last[1] / len(last), last[2] / len(last)];
    close(boot.direction, direction);
    // Legs: one per LC leg, from the boot's far end (the furcation point), standing off the panel face, into f1..f4.
    const bootEnd: V3 = [boot.position[0] + direction[0] * 0.03, boot.position[1] + direction[1] * 0.03, boot.position[2] + direction[2] * 0.03];
    expect(scene.legs.map((l) => [l.side, l.leg, l.label, l.plugged])).toEqual([['B', 0, '1', true], ['B', 1, '2', true], ['B', 2, '3', true], ['B', 3, '4', true]]);
    scene.legs.forEach((leg, i) => {
      const port = portWorldPos(p, panel.id, B_PORTS[i]!)!;
      expect(leg.points).toHaveLength(3);
      close(leg.points[0]!, bootEnd);
      close(leg.points[1]!, metres({ x: port.x, y: port.y, z: port.z + PORT_STANDOFF_MM }));
      close(leg.points[2]!, metres(port));
      expect(leg.radius).toBeCloseTo(0.001, 9);
      expect(leg.color).toBe(resolved.color);
    });
    // Connectors: an MPO box 20 mm out of the switch port; a pair of LC ferrules 5 mm apart across each panel port.
    const mpo = scene.connectors.filter((c) => lengthMm(c) === 20);
    expect(mpo).toHaveLength(1);
    close(mpo[0]!.position, metres({ x: a.x, y: a.y, z: a.z + 10 }));
    expect(mpo[0]!.size.map((v) => Math.round(v * 1000))).toEqual([12, 6, 20]);
    expect(mpo[0]!.color).toBe(connectorById('MPO-8')!.color);
    expect(mpo[0]!.rotation).toBe(-0);
    const lc = scene.connectors.filter((c) => lengthMm(c) === 12);
    expect(lc).toHaveLength(8);
    B_PORTS.forEach((id, i) => {
      const port = portWorldPos(p, panel.id, id)!, pair = lc.slice(2 * i, 2 * i + 2);
      expect((pair[0]!.position[0] + pair[1]!.position[0]) / 2).toBeCloseTo(port.x / 1000, 9);
      expect(Math.abs(pair[0]!.position[0] - pair[1]!.position[0])).toBeCloseTo(0.005, 9);
      for (const ferrule of pair) {
        expect(ferrule.position[1]).toBeCloseTo(port.y / 1000, 9);
        expect(ferrule.position[2]).toBeCloseTo((port.z + 6) / 1000, 9);
        expect(ferrule.size.map((v) => Math.round(v * 1000))).toEqual([4, 4, 12]);
        expect(ferrule.color).toBe(connectorById('LC-duplex')!.color);
      }
    });
    expect(scene.connectors).toHaveLength(9);
    expect(scene.connectors.every((c) => c.target.kind === 'cable' && c.target.id === cable.id)).toBe(true);
  });

  it('draws a dim 150 mm stub for every leg without a port, fanned apart from the boot', () => {
    const { p, cable, panel } = connected({ legsB: 2 });
    const scene = buildInstalledCable3d(p, cable)!;
    expect(scene.legs.map((l) => l.plugged)).toEqual([true, true, false, false]);
    const boot = scene.boots[0]!;
    close(bootEndOf(boot), furcationB(p, cable, panel.id, ['f1', 'f2']));
    const bootEnd: V3 = [boot.position[0] + boot.direction[0] * 0.03, boot.position[1] + boot.direction[1] * 0.03, boot.position[2] + boot.direction[2] * 0.03];
    const stubs = scene.legs.filter((l) => !l.plugged);
    for (const stub of stubs) {
      expect(stub.points).toHaveLength(2);
      close(stub.points[0]!, bootEnd);
      const v = sub(stub.points[1]!, stub.points[0]!);
      expect(len(v)).toBeCloseTo(LEG_STUB_MM / 1000, 9);
      expect(dot(v, boot.direction) / len(v)).toBeGreaterThan(0.99);
      expect(stub.color).toBe(STUB_COLOR);
    }
    expect(len(sub(stubs[0]!.points[1]!, stubs[1]!.points[1]!))).toBeGreaterThan(0.01);
    // Only the plugged ports get connector shapes.
    expect(scene.connectors.filter((c) => lengthMm(c) === 12)).toHaveLength(4);
    expect(scene.connectors.filter((c) => lengthMm(c) === 20)).toHaveLength(1);
  });

  it('follows the route of a link the cable owns, still ending at the furcation boot', () => {
    const { p: p0, cable, panel } = connected();
    const link = p0.links.find((l) => l.cableId === cable.id)!;
    const p = produce(p0, (d) => { d.routes[link.id] = overheadRoute(link.id); });
    const before = buildInstalledCable3d(p0, cable)!, scene = buildInstalledCable3d(p, cable)!;
    const path = routePath3d(p, link.id)!;
    expect(scene.routed).toBe(true);
    expect(scene.layers).toEqual(['overhead']);
    expect(path.points.length).toBeGreaterThan(4);
    expect(scene.jacket.points).toHaveLength(path.points.length);
    expect(scene.jacket.points.slice(0, -1)).toEqual(path.points.slice(0, -1).map(metres));
    expect(scene.jacket.points).not.toEqual(before.jacket.points);
    // The jacket climbs to the overhead layer on its way.
    expect(Math.max(...scene.jacket.points.map((q) => q[1]))).toBeGreaterThan(Math.max(...before.jacket.points.map((q) => q[1])) + 0.5);
    const furcation = furcationB(p, cable, panel.id, B_PORTS);
    close(scene.jacket.points.at(-1)!, furcation);
    close(bootEndOf(scene.boots[0]!), furcation);
    // The boot now continues the in-rack drop rather than the airwire, and the legs still land on their ports.
    expect(scene.boots[0]!.direction).not.toEqual(before.boots[0]!.direction);
    scene.legs.forEach((leg, i) => close(leg.points.at(-1)!, metres(portWorldPos(p, panel.id, B_PORTS[i]!)!)));
  });

  it('sketches a cable whose side A has no position as a jacket stub out of the fanned side', () => {
    const { p, cable, panel } = connected({ plugA: false });
    const scene = buildInstalledCable3d(p, cable)!;
    const ports = B_PORTS.map((id) => portWorldPos(p, panel.id, id)!);
    const centroid: V3 = metres({ x: ports.reduce((s, q) => s + q.x, 0) / 4, y: ports.reduce((s, q) => s + q.y, 0) / 4, z: ports.reduce((s, q) => s + q.z, 0) / 4 });
    // The furcation sits the breakout length (0.5 m) straight out of the panel face, the jacket a further 300 mm on.
    const boot = scene.boots[0]!;
    close(bootEndOf(boot), [centroid[0], centroid[1], centroid[2] + 0.5]);
    expect(scene.jacket.points).toHaveLength(2);
    close(scene.jacket.points[1]!, bootEndOf(boot));
    close(scene.jacket.points[0]!, [centroid[0], centroid[1], centroid[2] + 0.5 + JACKET_STUB_MM / 1000]);
    close(boot.direction, [0, 0, -1]);
    expect(scene.legs.every((l) => l.plugged)).toBe(true);
    expect(scene.connectors.filter((c) => lengthMm(c) === 20)).toHaveLength(0);
    expect(scene.connectors).toHaveLength(8);
  });

  it("follows the cable's own jacket route (owner 'cable', keyed by the cable id) and changes the jacket path", () => {
    const { p: p0, cable, panel } = connected();
    const p = produce(p0, (d) => { d.routes[cable.id] = overheadRoute(cable.id, 'cable'); });
    const before = buildInstalledCable3d(p0, cable)!, scene = buildInstalledCable3d(p, cable)!;
    const path = routePath3d(p, cable.id)!;
    expect(scene.routed).toBe(true);
    expect(scene.layers).toEqual(['overhead']);
    // The jacket is the route's 3D pathway, which the owner seam already ends at the furcation point.
    expect(path.points.length).toBeGreaterThan(4);
    expect(scene.jacket.points).toHaveLength(path.points.length);
    expect(scene.jacket.points.slice(0, -1)).toEqual(path.points.slice(0, -1).map(metres));
    close(scene.jacket.points.at(-1)!, metres(path.points.at(-1)!));
    expect(scene.jacket.points).not.toEqual(before.jacket.points);
    expect(Math.max(...scene.jacket.points.map((q) => q[1]))).toBeGreaterThan(Math.max(...before.jacket.points.map((q) => q[1])) + 0.5);
    const furcation = furcationB(p, cable, panel.id, B_PORTS);
    close(scene.jacket.points.at(-1)!, furcation);
    close(bootEndOf(scene.boots[0]!), furcation);
    scene.legs.forEach((leg) => close(leg.points[0]!, bootEndOf(scene.boots[0]!)));
    scene.legs.forEach((leg, i) => close(leg.points.at(-1)!, metres(portWorldPos(p, panel.id, B_PORTS[i]!)!)));
  });

  it("prefers the cable's own route over a route of a link it owns", () => {
    const { p: p0, cable } = connected();
    const link = p0.links.find((l) => l.cableId === cable.id)!;
    const p = produce(p0, (d) => {
      d.routes[cable.id] = overheadRoute(cable.id, 'cable');
      d.routes[link.id] = { ...overheadRoute(link.id), segments: [{ layer: 'underfloor', trayId: null, points: [createWaypoint({ x: 1150, y: 500 }), createWaypoint({ x: 4150, y: 500 })] }] };
    });
    const scene = buildInstalledCable3d(p, cable)!;
    expect(scene.layers).toEqual(['overhead']);
    expect(scene.jacket.points.slice(0, -1)).toEqual(routePath3d(p, cable.id)!.points.slice(0, -1).map(metres));
  });

  it('puts the boot at a pinned furcation point (legs re-dress to it) and ignores an unpinned stored one', () => {
    const { p: p0, cable, panel } = connected();
    const at = { x: 3500, y: 2200 };
    const pinned = produce(p0, (d) => { d.cables[0]!.furcation = { B: { pos: at, pinned: true } }; });
    const unpinned = produce(p0, (d) => { d.cables[0]!.furcation = { B: { pos: at, pinned: false } }; });
    const base = buildInstalledCable3d(p0, cable)!, scene = buildInstalledCable3d(pinned, pinned.cables[0]!)!;
    const elevation = B_PORTS.reduce((s, id) => s + portElevationMm(p0, panel.id, id)!, 0) / B_PORTS.length;
    close(bootEndOf(scene.boots[0]!), metres({ x: at.x, y: elevation, z: at.y }));
    close(scene.jacket.points.at(-1)!, bootEndOf(scene.boots[0]!));
    expect(scene.jacket.points.at(-1)).not.toEqual(base.jacket.points.at(-1));
    scene.legs.forEach((leg) => close(leg.points[0]!, bootEndOf(scene.boots[0]!)));
    scene.legs.forEach((leg, i) => close(leg.points.at(-1)!, metres(portWorldPos(p0, panel.id, B_PORTS[i]!)!)));
    // The jacket still leaves the switch port the same way; only the far end moved.
    expect(scene.jacket.points.slice(0, 2)).toEqual(base.jacket.points.slice(0, 2));
    expect(buildInstalledCable3d(unpinned, unpinned.cables[0]!)!.boots[0]!.position).toEqual(base.boots[0]!.position);
  });

  it('stamps the cable target on every part so that clicking any of them selects the whole cable', () => {
    const { p, cable } = connected({ legsB: 3 });
    const scene = buildInstalledCable3d(p, cable)!;
    const target = { kind: 'cable', id: cable.id };
    expect(scene.target).toEqual(target);
    expect(scene.jacket.target).toEqual(target);
    expect(scene.boots).toHaveLength(1);
    expect(scene.legs).toHaveLength(4);
    expect(scene.connectors).toHaveLength(1 + 3 * 2);
    for (const part of [...scene.boots, ...scene.legs, ...scene.connectors]) expect(part.target).toEqual(target);
  });

  it('draws a straight duplex cable port to port with no boot, no legs and an LC pair at each end', () => {
    const p0 = createProject('t', '2026-01-01T00:00:00.000Z');
    const pp1 = place(p0, PANEL_LC, { x: 0, y: 0 }, { ref: 'PP1' }), pp2 = place(p0, PANEL_LC, { x: 600, y: 0 }, { ref: 'PP2' });
    const r1 = createRack(standardRack, { name: 'A01', pos: { x: 1000, y: 1000 } }), r2 = createRack(standardRack, { name: 'A02', pos: { x: 4000, y: 1000 } });
    p0.racks.push(r1, r2);
    p0.placements.push({ componentId: pp1.id, rackId: r1.id, uPosition: 10, face: 'front' }, { componentId: pp2.id, rackId: r2.id, uPosition: 10, face: 'front' });
    const cable = createCable(builtinCatalog.cables.find((c) => c.id === 'cbl.om4-duplex')!, 'CBL1');
    p0.cables.push(cable);
    const p = produce(p0, (d) => {
      plugCableLeg(d, cable.id, 'A', 0, { componentId: pp1.id, portId: 'f1' });
      plugCableLeg(d, cable.id, 'B', 0, { componentId: pp2.id, portId: 'f3' });
    });
    const scene = buildInstalledCable3d(p, p.cables[0]!)!;
    const a = portWorldPos(p, pp1.id, 'f1')!, b = portWorldPos(p, pp2.id, 'f3')!;
    expect(scene.boots).toEqual([]);
    expect(scene.legs).toEqual([]);
    expect(scene.routed).toBe(false);
    expect(scene.jacket.points).toHaveLength(4);
    close(scene.jacket.points[0]!, metres(a));
    close(scene.jacket.points[1]!, metres({ x: a.x, y: a.y, z: a.z + PORT_STANDOFF_MM }));
    close(scene.jacket.points[2]!, metres({ x: b.x, y: b.y, z: b.z + PORT_STANDOFF_MM }));
    close(scene.jacket.points[3]!, metres(b));
    expect(scene.jacket.radius).toBeCloseTo(0.001, 9);
    expect(scene.jacket.color).toBe('#2dd4bf');
    expect(scene.connectors).toHaveLength(4);
    expect(scene.connectors.every((c) => lengthMm(c) === 12 && c.color === connectorById('LC-duplex')!.color)).toBe(true);
    // The link the cable owns is drawn by the cable, not as an airwire.
    const physical = buildPhysicalScene(p);
    expect(p.links.filter((l) => l.cableId === cable.id)).toHaveLength(1);
    expect(physical.cables).toEqual([]);
    expect(physical.installed.map((c) => c.id)).toEqual([cable.id]);
  });

  it('is null for a cable with no placed end', () => {
    const { p: p0, cable } = connected();
    const p = produce(p0, (d) => { d.placements = []; });
    expect(buildInstalledCable3d(p, cable)).toBeNull();
    expect(buildPhysicalScene(p).installed).toEqual([]);
  });
});

describe('buildPhysicalScene with installed cables', () => {
  it('lists the installed cable and no longer draws the links it owns as airwires', () => {
    const { p, cable } = connected();
    expect(p.links.filter((l) => l.cableId === cable.id)).toHaveLength(4);
    const scene = buildPhysicalScene(p);
    expect(scene.installed.map((c) => c.id)).toEqual([cable.id]);
    expect(scene.cables).toEqual([]);
    expect(scene.installed[0]!.target).toEqual({ kind: 'cable', id: cable.id });
  });

  it('lands legs on a patch wall proud of the faceplate, in place of the pigtail a plain link would get', () => {
    const { p, cable, panel } = connected({ panelRack: 'rack.patch-frame-12u' });
    const scene = buildPhysicalScene(p);
    const panelParts = scene.ports.filter((x) => 'id' in x.target && x.target.id === panel.id);
    expect(panelParts).toHaveLength(48);
    expect(panelParts.filter((x) => lengthMm(x) === 70)).toEqual([]);
    const installed = scene.installed.find((c) => c.id === cable.id)!;
    B_PORTS.forEach((id, i) => {
      const port = portWorldPos(p, panel.id, id)!;
      expect(installed.legs[i]!.points.at(-1)![2]).toBeCloseTo((port.z + PLATE_MM) / 1000, 9);
    });
    // The LC ferrules start at the faceplate's outer surface too.
    const lc = installed.connectors.filter((c) => lengthMm(c) === 12);
    expect(lc[0]!.position[2]).toBeCloseTo((portWorldPos(p, panel.id, 'f1')!.z + PLATE_MM + 6) / 1000, 9);
  });
});
