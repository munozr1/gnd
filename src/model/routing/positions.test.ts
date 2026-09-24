import { describe, expect, it } from 'vitest';
import { createProject } from '../factories';
import {
  DEFAULT_DEVICE_WIDTH_MM,
  U_MM,
  managerFloorCenter,
  managerFloorRect,
  portElevationMm,
  portFloorPos,
  portWorldPos,
  rackCenter,
  rackEntryPoints,
  rackFloorRect,
  rackFrontDir,
  rackTopMm,
} from './positions';
import { addAccessory, addDevice, addRack, place, twoRackFixture } from './test-fixtures';

const inset = (600 - DEFAULT_DEVICE_WIDTH_MM) / 2;

describe('rack geometry', () => {
  it('front faces +y at rotation 0 and rotates with the rack', () => {
    const p = createProject();
    const r = addRack(p, 'R', { x: 0, y: 0 });
    expect(rackFrontDir(r)).toEqual({ x: 0, y: 1 });
    r.rotationDeg = 90;
    expect(rackFrontDir(r)).toEqual({ x: -1, y: 0 });
    r.rotationDeg = 180;
    expect(rackFrontDir(r)).toEqual({ x: -0, y: -1 });
    r.rotationDeg = 270;
    expect(rackFrontDir(r)).toEqual({ x: 1, y: -0 });
  });

  it('computes the floor rect and centre', () => {
    const p = createProject();
    const r = addRack(p, 'R', { x: 1000, y: 1000 });
    expect(rackFloorRect(r)).toEqual({ x: 1000, y: 1000, width: 600, height: 1070 });
    expect(rackCenter(r)).toEqual({ x: 1300, y: 1535 });
    expect(rackTopMm(r)).toBeCloseTo(42 * U_MM + 100, 6);
  });
});

describe('port positions', () => {
  it('puts a front port on the front edge, offset by the faceplate x', () => {
    const { project, sw1 } = twoRackFixture();
    const pos = portFloorPos(project, sw1.id, 'eth1/1');
    expect(pos).not.toBeNull();
    expect(pos!.x).toBeCloseTo(1000 + inset + 24.610416666666666, 6);
    expect(pos!.y).toBeCloseTo(2070, 6);
  });

  it('puts a rear port on the rear edge, mirrored across the width', () => {
    const p = createProject();
    const r = addRack(p, 'R', { x: 1000, y: 1000 });
    const pp = addDevice(p, 'sym.fiber-patch-panel-24lc', 'PP1', { rackId: r.id, u: 10 });
    const pos = portFloorPos(p, pp.id, 'r1');
    expect(pos!.y).toBeCloseTo(1000, 6);
    expect(pos!.x).toBeCloseTo(1600 - (inset + 29.22083333333333), 6);
  });

  it('flips a front port to the rear edge when the device is placed facing rear', () => {
    const { project, sw1 } = twoRackFixture();
    place(project, sw1.id, project.racks[0]!.id, 40, 'rear');
    const pos = portFloorPos(project, sw1.id, 'eth1/1');
    expect(pos!.y).toBeCloseTo(1000, 6);
    expect(pos!.x).toBeCloseTo(1600 - (inset + 24.610416666666666), 6);
  });

  it('follows the rack rotation', () => {
    const { project, sw1, r1 } = twoRackFixture();
    r1.rotationDeg = 90;
    const pos = portFloorPos(project, sw1.id, 'eth1/1');
    expect(pos!.x).toBeCloseTo(1000, 6);
    expect(pos!.y).toBeCloseTo(1000 + inset + 24.610416666666666, 6);
  });

  it('elevation is the U base plus the faceplate y', () => {
    const { project, sw1 } = twoRackFixture();
    expect(portElevationMm(project, sw1.id, 'eth1/49')).toBeCloseTo(39 * U_MM + 26, 6);
    const w = portWorldPos(project, sw1.id, 'eth1/49')!;
    const f = portFloorPos(project, sw1.id, 'eth1/49')!;
    expect(w).toEqual({ x: f.x, y: 39 * U_MM + 26, z: f.y });
  });

  it('returns null for unplaced components and unknown ports', () => {
    const { project, sw1 } = twoRackFixture();
    expect(portFloorPos(project, sw1.id, 'nope')).toBeNull();
    place(project, sw1.id, null, null);
    expect(portFloorPos(project, sw1.id, 'eth1/1')).toBeNull();
    expect(portElevationMm(project, sw1.id, 'eth1/1')).toBeNull();
    expect(portWorldPos(project, sw1.id, 'eth1/1')).toBeNull();
  });
});

describe('rack entry points and managers', () => {
  it('defaults to the roof quarter points and the footprint centre', () => {
    const p = createProject();
    const r = addRack(p, 'R', { x: 1000, y: 1000 });
    const e = rackEntryPoints(p, r);
    expect(e.topLeft).toEqual({ x: 1150, y: 1535 });
    expect(e.topRight).toEqual({ x: 1450, y: 1535 });
    expect(e.bottom).toEqual({ x: 1300, y: 1535 });
  });

  it('shifts a top entry toward the face of its accessory', () => {
    const p = createProject();
    const r = addRack(p, 'R', { x: 1000, y: 1000 });
    addAccessory(p, r.id, 'top-entry', { side: 'left', face: 'front' });
    addAccessory(p, r.id, 'top-entry', { side: 'right', face: 'rear' });
    const e = rackEntryPoints(p, r);
    expect(e.topLeft).toEqual({ x: 1150, y: 1000 + 802.5 });
    expect(e.topRight).toEqual({ x: 1450, y: 1000 + 267.5 });
  });

  it('places a fitted manager beside the rack and falls back to the rail without one', () => {
    const p = createProject();
    const r = addRack(p, 'R', { x: 1000, y: 1000 });
    expect(managerFloorCenter(p, r.id, 'left')).toEqual({ x: 1040, y: 1535 });
    expect(managerFloorRect(p, r.id, 'left')).toBeNull();
    addAccessory(p, r.id, 'vcm', { side: 'left', widthMm: 152 });
    expect(managerFloorCenter(p, r.id, 'left')).toEqual({ x: 924, y: 1535 });
    expect(managerFloorRect(p, r.id, 'left')).toEqual({ x: 848, y: 1000, width: 152, height: 1070 });
    addAccessory(p, r.id, 'vcm', { side: 'right' });
    expect(managerFloorCenter(p, r.id, 'right')).toEqual({ x: 1676, y: 1535 });
  });
});
