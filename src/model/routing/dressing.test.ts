import { describe, expect, it } from 'vitest';
import { createProject } from '../factories';
import { autoInRackPath, inRackPolyline3d, managerFor, nearerSide } from './dressing';
import { U_MM, rackTopMm } from './positions';
import { addAccessory, addDevice, addLink, addRack, place, twoRackFixture } from './test-fixtures';

describe('autoInRackPath', () => {
  it('picks the nearer manager by faceplate half and the top entry on that side', () => {
    const { project, sw1, r1 } = twoRackFixture();
    const leftEntry = project.accessories.find((a) => a.rackId === r1.id && a.type === 'top-entry' && a.side === 'left')!;
    const rightEntry = project.accessories.find((a) => a.rackId === r1.id && a.type === 'top-entry' && a.side === 'right')!;
    expect(autoInRackPath(project, sw1.id, 'eth1/1')).toEqual({ side: 'left', entry: leftEntry.id, pinned: false });
    expect(autoInRackPath(project, sw1.id, 'eth1/48')).toEqual({ side: 'right', entry: rightEntry.id, pinned: false });
  });

  it('honours a forced side', () => {
    const { project, sw1 } = twoRackFixture();
    expect(autoInRackPath(project, sw1.id, 'eth1/1', { forceSide: 'right' }).side).toBe('right');
  });

  it('separates copper and fiber onto opposite managers when both exist', () => {
    const { project, sw1, sw2 } = twoRackFixture();
    // eth1/48 is on the right half; its link is fiber → left when separating.
    addLink(project, [sw1, 'eth1/48'], [sw2, 'eth1/2'], 'cbl.om4-duplex');
    // eth1/1 is on the left half; a DAC is copper → right.
    addLink(project, [sw1, 'eth1/1'], [sw2, 'eth1/3'], 'cbl.dac-25g');
    expect(autoInRackPath(project, sw1.id, 'eth1/48').side).toBe('left');
    expect(autoInRackPath(project, sw1.id, 'eth1/1').side).toBe('right');
    expect(autoInRackPath(project, sw1.id, 'eth1/1', { mediaClass: 'fiber' }).side).toBe('left');
    project.settings.separateCopperFiber = false;
    expect(autoInRackPath(project, sw1.id, 'eth1/48').side).toBe('right');
    expect(autoInRackPath(project, sw1.id, 'eth1/1').side).toBe('left');
  });

  it('uses the only fitted manager when just one side has one', () => {
    const p = createProject();
    const r = addRack(p, 'R', { x: 0, y: 0 });
    addAccessory(p, r.id, 'vcm', { side: 'right' });
    const sw = addDevice(p, 'sym.leaf-switch-48x25-8x100', 'SW1', { rackId: r.id, u: 1 });
    expect(autoInRackPath(p, sw.id, 'eth1/1').side).toBe('right');
    expect(autoInRackPath(p, sw.id, 'eth1/1').entry).toBeNull();
  });

  it('mirrors sides for rear-face ports', () => {
    expect(nearerSide(10, 482.6, 'front')).toBe('left');
    expect(nearerSide(10, 482.6, 'rear')).toBe('right');
    const p = createProject();
    const r = addRack(p, 'R', { x: 0, y: 0 });
    const pp = addDevice(p, 'sym.fiber-patch-panel-24lc', 'PP1', { rackId: r.id, u: 1 });
    expect(autoInRackPath(p, pp.id, 'r1').side).toBe('right');
    expect(autoInRackPath(p, pp.id, 'f1').side).toBe('left');
    place(p, pp.id, r.id, 1, 'rear');
    expect(autoInRackPath(p, pp.id, 'f1').side).toBe('right');
  });

  it('prefers a top entry whose face matches the port', () => {
    const p = createProject();
    const r = addRack(p, 'R', { x: 0, y: 0 });
    const rear = addAccessory(p, r.id, 'top-entry', { side: 'left', face: 'rear' });
    const front = addAccessory(p, r.id, 'top-entry', { side: 'left', face: 'front' });
    const sw = addDevice(p, 'sym.leaf-switch-48x25-8x100', 'SW1', { rackId: r.id, u: 1 });
    expect(autoInRackPath(p, sw.id, 'eth1/1').entry).toBe(front.id);
    // Facing rear, the right-half port eth1/48 lands on the rack's left side, on the rear face.
    place(p, sw.id, r.id, 1, 'rear');
    const rearPath = autoInRackPath(p, sw.id, 'eth1/48');
    expect(rearPath.side).toBe('left');
    expect(rearPath.entry).toBe(rear.id);
  });

  it('still returns a well-formed path for an unplaced component', () => {
    const { project, sw1 } = twoRackFixture();
    place(project, sw1.id, null, null);
    expect(autoInRackPath(project, sw1.id, 'eth1/1')).toEqual({ side: 'left', entry: null, pinned: false });
  });

  it('managerFor finds the vcm on a side', () => {
    const { project, r1 } = twoRackFixture();
    expect(managerFor(project, r1.id, 'left')?.type).toBe('vcm');
    expect(managerFor(project, r1.id, 'left')?.side).toBe('left');
    const p = createProject();
    expect(managerFor(p, 'x', 'left')).toBeUndefined();
  });
});

describe('inRackPolyline3d', () => {
  it('runs port → manager → rack top → entry → tray elevation for an overhead tray', () => {
    const { project, sw1, r1 } = twoRackFixture();
    const path = autoInRackPath(project, sw1.id, 'eth1/49');
    const pts = inRackPolyline3d(project, sw1.id, 'eth1/49', path, 2600)!;
    const elev = 39 * U_MM + 26;
    const top = rackTopMm(r1);
    expect(pts).toHaveLength(5);
    expect(pts[0]!.y).toBeCloseTo(elev, 6);
    expect(pts[0]!.z).toBeCloseTo(2070, 6);
    expect(pts[1]).toEqual({ x: 924, y: elev, z: 1535 });
    expect(pts[2]).toEqual({ x: 924, y: top, z: 1535 });
    expect(pts[3]).toEqual({ x: 1150, y: top, z: 1535 });
    expect(pts[4]).toEqual({ x: 1150, y: 2600, z: 1535 });
  });

  it('drops through the bottom entry for an underfloor tray', () => {
    const { project, sw1 } = twoRackFixture();
    const path = autoInRackPath(project, sw1.id, 'eth1/49');
    const pts = inRackPolyline3d(project, sw1.id, 'eth1/49', path, -150)!;
    expect(pts).toHaveLength(5);
    expect(pts[2]).toEqual({ x: 924, y: 0, z: 1535 });
    expect(pts[3]).toEqual({ x: 1300, y: 0, z: 1535 });
    expect(pts[4]).toEqual({ x: 1300, y: -150, z: 1535 });
  });

  it('stays in the manager for an in-rack elevation', () => {
    const { project, sw1 } = twoRackFixture();
    const path = autoInRackPath(project, sw1.id, 'eth1/49');
    const pts = inRackPolyline3d(project, sw1.id, 'eth1/49', path, 500)!;
    expect(pts).toHaveLength(3);
    expect(pts[2]).toEqual({ x: 924, y: 500, z: 1535 });
  });

  it('is null for an unplaced end', () => {
    const { project, sw1 } = twoRackFixture();
    place(project, sw1.id, null, null);
    expect(inRackPolyline3d(project, sw1.id, 'eth1/49', { side: 'left', entry: null, pinned: false }, 2600)).toBeNull();
  });
});
