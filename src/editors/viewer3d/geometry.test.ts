import { describe, expect, it } from 'vitest';
import { buildPodProject } from '@/model/demo/pod';
import { indexProject } from '@/model/query';
import { portWorldPos, rackLocalToFloor, routePath3d, U_MM } from '@/model/routing';
import { buildPhysicalScene, boxCorners, metres, roomGrid } from './geometry';

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
