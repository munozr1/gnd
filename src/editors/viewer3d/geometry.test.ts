import { describe, expect, it } from 'vitest';
import { buildPodProject } from '@/model/demo/pod';
import { indexProject } from '@/model/query';
import { portWorldPos, rackCenter, rackLocalToFloor, rackTopMm, routePath3d, U_MM } from '@/model/routing';
import { builtinCatalog } from '@/catalog';
import { ROOT_SHEET_ID, createComponent, createPlacement, createProject, createRack } from '@/model/factories';
import { addDevice, addLink, addRack, symbolDef } from '@/model/routing/test-fixtures';
import { buildPhysicalScene, boxCorners, metres, roomGrid, type BoxPart } from './geometry';

describe('physical scene from Pod A', () => {
  it('includes every placed device and separates real routes from airwires', () => {
    const project = buildPodProject(), scene = buildPhysicalScene(project);
    expect(scene.labels).toHaveLength(6);
    expect(scene.devices).toHaveLength(42);
    expect(scene.cables.filter((c) => c.routed)).toHaveLength(20);
    expect(scene.cables.filter((c) => !c.routed)).toHaveLength(60);
    for (const cable of scene.cables) {
      const link = project.links.find((l) => l.id === cable.id)!;
      expect(cable.points[0]).toEqual(metres(portWorldPos(project, link.a.componentId, link.a.portId)!));
      expect(cable.points.at(-1)).toEqual(metres(portWorldPos(project, link.b.componentId, link.b.portId)!));
      if (cable.routed) expect(cable.points).toEqual(routePath3d(project, cable.id)!.points.map(metres));
    }
  });
  it.each([0, 90, 180, 270] as const)('keeps rear-facing devices and ports aligned in a %i degree rack', (angle) => {
    const project = buildPodProject(), placement = project.placements[0]!;
    placement.face = 'rear'; placement.uPosition = 10;
    const rack = project.racks.find((r) => r.id === placement.rackId)!; rack.rotationDeg = angle;
    const idx = indexProject(project), c = idx.component(placement.componentId)!, fp = idx.footprintOf(c)!;
    const scene = buildPhysicalScene(project), box = scene.devices.find((d) => 'id' in d.target && d.target.id === c.id)!;
    const p = rackLocalToFloor(rack, { across: rack.widthMm / 2, depth: Math.min(fp.depthMm, rack.depthMm) / 2 });
    expect(box.position).toEqual([p.x / 1000, (9 * U_MM + fp.heightU * U_MM / 2) / 1000, p.y / 1000]);
    expect(box.rotation).toBe(-angle * Math.PI / 180);
    const ports = scene.ports.filter((d) => 'id' in d.target && d.target.id === c.id);
    expect(ports.map((d) => d.position)).toEqual(fp.ports.map((port) => metres(portWorldPos(project, c.id, port.id)!)));
  });
  it('omits unplaced devices and their cable geometry', () => {
    const project = buildPodProject(), placement = project.placements[0]!;
    placement.rackId = null; placement.uPosition = null;
    const scene = buildPhysicalScene(project);
    expect(scene.devices).toHaveLength(41);
    const missing = new Set(project.links.filter((l) => [l.a.componentId, l.b.componentId].includes(placement.componentId)).map((l) => l.id));
    expect(scene.cables.every((c) => !missing.has(c.id))).toBe(true);
    expect(scene.cables.length).toBe(80 - missing.size);
  });
});

 it('clips the floor grid to a concave room instead of its bounding square', () => {
  const project = buildPodProject();
  project.room.outline = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 1000, y: 1000 }, { x: 1000, y: 2000 }, { x: 0, y: 2000 }];
  project.room.gridMm = 500;
  const points = roomGrid(project);
  for (let i = 0; i < points.length; i += 6) {
    const x = (points[i]! + points[i + 3]!) / 2, z = (points[i + 2]! + points[i + 5]!) / 2;
    expect(x >= 0 && z >= 0 && x <= 2 && z <= 2 && (x <= 1 || z <= 1)).toBe(true);
  }
  expect(points.length).toBeGreaterThan(0);
});

it('frames the full height and rotated footprint of a rack', () => {
  const project = buildPodProject(), rack = project.racks[0]!;
  rack.rotationDeg = 90;
  const points = buildPhysicalScene(project).frames.filter((p) => 'id' in p.target && p.target.id === rack.id).flatMap(boxCorners);
  const range = (axis: number) => Math.max(...points.map((p) => p[axis]!)) - Math.min(...points.map((p) => p[axis]!));
  expect(range(0)).toBeCloseTo(rack.depthMm / 1000);
  expect(range(1)).toBeCloseTo((rack.heightU * U_MM + 100) / 1000);
  expect(range(2)).toBeCloseTo(rack.widthMm / 1000);
});

it('builds a patch frame as a patch-panel wall: slab, end feet and cap, a faceplate on each face and pigtails on connected ports', () => {
  const project = createProject('t', '2026-01-01T00:00:00.000Z'), rack = addRack(project, 'R01', { x: 1000, y: 1000 });
  const frameDef = builtinCatalog.racks.find((r) => r.id === 'rack.patch-frame-12u')!;
  const frame = createRack(frameDef, { name: 'PF-PP1', pos: { x: 2000, y: 1000 } });
  project.racks.push(frame);
  const pp = createComponent(symbolDef('sym.fiber-patch-panel-24lc'), { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: 'PP1', footprintDefId: 'fp.fiber-patch-panel-24lc' });
  project.components.push(pp);
  project.placements.push({ ...createPlacement(pp.id), rackId: frame.id, uPosition: 1 });
  const sw = addDevice(project, 'sym.leaf-switch-48x25-8x100', 'SW1', { rackId: rack.id, u: 40 });
  addLink(project, [pp, 'f1'], [sw, 'eth1/1'], 'cbl.om4-duplex');
  addLink(project, [sw, 'eth1/2'], [pp, 'r1'], 'cbl.os2-duplex');
  const scene = buildPhysicalScene(project), of = (parts: BoxPart[], id: string) => parts.filter((p) => 'id' in p.target && p.target.id === id);
  // The device rack keeps its posts, bars, door and single device box.
  expect(scene.doors.map((d) => d.target)).toEqual([{ kind: 'rack', id: rack.id }]);
  expect(of(scene.frames, rack.id).map((p) => p.color)).toEqual(['#52687b', '#52687b', '#52687b', '#52687b', '#344a5c', '#344a5c']);
  expect(of(scene.devices, sw.id)).toHaveLength(1);
  expect(scene.cables).toHaveLength(2);
  // The frame is a wall: slab, a foot at each end and cap; no posts and no door.
  const wall = of(scene.frames, frame.id), top = rackTopMm(frame), centre = rackCenter(frame), mmFromCentreZ = (p: BoxPart) => p.position[2] * 1000 - centre.y;
  expect(wall.map((p) => p.color)).toEqual(['#4b6074', '#2f3d4b', '#2f3d4b', '#5d7488']);
  expect(wall[0]!.size).toEqual([0.6, top / 1000, 0.12]);
  expect(wall[0]!.position[0]).toBeCloseTo(centre.x / 1000, 9);
  expect(wall[0]!.position[1]).toBeCloseTo(top / 2000, 9);
  expect(mmFromCentreZ(wall[0]!)).toBeCloseTo(0, 6);
  // U1 starts at the floor, so the feet stay outside the 482.6 mm panel and never bury the bottom faceplate or its ports.
  for (const foot of [wall[1]!, wall[2]!]) {
    expect(foot.size).toEqual([0.05, 0.04, 0.24]);
    expect(Math.abs(foot.position[0] * 1000 - centre.x) - 25).toBeGreaterThanOrEqual(482.6 / 2);
  }
  // One faceplate proud of each face: ±(depth / 2 + 5) mm from the wall centre along the depth axis (rotation 0 → world z).
  const plates = of(scene.devices, pp.id);
  expect(plates.map((p) => p.color)).toEqual(['#7d8ea3', '#7d8ea3']);
  expect(plates.every((p) => p.rotation === 0)).toBe(true); // -0 at rotation 0
  expect(plates.map(mmFromCentreZ).map((z) => Math.round(z))).toEqual([65, -65]);
  expect(plates.map((p) => p.size)).toEqual([[482.6 / 1000, (U_MM - 4) / 1000, 0.01], [482.6 / 1000, (U_MM - 4) / 1000, 0.01]]);
  for (const plate of plates) { expect(plate.position[0]).toBeCloseTo(centre.x / 1000, 9); expect(plate.position[1]).toBeCloseTo(U_MM / 2000, 9); }
  // The 48 port studs sit on the outer surface of the 10 mm faceplate (±70 mm from the wall centre), not buried at the wall face.
  const studs = of(scene.ports, pp.id).filter((p) => p.size[2] === 0.008);
  expect(studs).toHaveLength(48);
  expect(studs.map(mmFromCentreZ).map((z) => Math.round(z))).toEqual([...Array<number>(24).fill(70), ...Array<number>(24).fill(-70)]);
  expect(studs[0]!.position[0]).toBeCloseTo(portWorldPos(project, pp.id, 'f1')!.x / 1000, 9);
  expect(studs[24]!.position[0]).toBeCloseTo(portWorldPos(project, pp.id, 'r1')!.x / 1000, 9);
  expect(studs.map((p) => p.color).filter((c) => c === '#66ead3')).toHaveLength(2);
  // Every connected port grows a pigtail in its cable's colour that leaves the faceplate and points away from its face.
  const stubs = of(scene.ports, pp.id).filter((p) => p.size[2] === 0.07);
  expect(of(scene.ports, pp.id)).toHaveLength(48 + 2);
  expect(stubs.map((p) => p.size)).toEqual([[0.006, 0.006, 0.07], [0.006, 0.006, 0.07]]);
  const front = stubs.find((p) => p.color === '#2dd4bf')!, rear = stubs.find((p) => p.color === '#facc15')!;
  expect(mmFromCentreZ(front)).toBeCloseTo(60 + 10 + 35, 6);
  expect(mmFromCentreZ(rear)).toBeCloseTo(-(60 + 10 + 35), 6);
  expect(front.position[0]).toBeCloseTo(portWorldPos(project, pp.id, 'f1')!.x / 1000, 9);
  expect(rear.position[0]).toBeCloseTo(portWorldPos(project, pp.id, 'r1')!.x / 1000, 9);
  expect(scene.labels.map((l) => l.text)).toEqual(['R01', 'PF-PP1']);
});
