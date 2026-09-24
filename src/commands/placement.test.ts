import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { ROOT_SHEET_ID, createComponent, createProject, createRack } from '@/model/factories';
import { addDevice, addRack, symbolDef, twoRackFixture } from '@/model/routing/test-fixtures';
import type { FootprintDef, Project } from '@/model/types';
import { defaultFrameDefId, frameNameFor, isPatchFrame, nextFreeFloorPos } from './placement';

const frame12 = builtinCatalog.racks.find((r) => r.id === 'rack.patch-frame-12u')!;
const frame42 = builtinCatalog.racks.find((r) => r.id === 'rack.patch-frame-42u')!;
const empty = () => createProject('t', '2026-01-01T00:00:00.000Z');

/** A component on a custom footprint of `heightU`, registered in the project's custom catalog. */
function customDevice(project: Project, ref: string, heightU: number) {
  const fp: FootprintDef = { id: `fp.custom-${heightU}u`, model: `Custom ${heightU}U`, kind: 'generic', heightU, depthMm: 250, ports: [] };
  project.customCatalog = { ...project.customCatalog, footprints: [...project.customCatalog.footprints, fp] };
  const c = createComponent(symbolDef('sym.server-1u'), { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref, footprintDefId: fp.id });
  project.components.push(c);
  return c;
}

describe('isPatchFrame / defaultFrameDefId', () => {
  it('treats a missing kind as a device rack', () => {
    expect(isPatchFrame({})).toBe(false);
    expect(isPatchFrame({ kind: 'rack' })).toBe(false);
    expect(isPatchFrame(createRack(frame12, { name: 'PF', pos: { x: 0, y: 0 } }))).toBe(true);
    expect(isPatchFrame(createRack(frame42, { name: 'PF', pos: { x: 0, y: 0 } }))).toBe(true);
  });

  it('picks the smallest patch frame that fits the device, capped at the tallest', () => {
    const f = twoRackFixture();
    expect(defaultFrameDefId(f.project, addDevice(f.project, 'sym.fiber-patch-panel-24lc', 'PP1'))).toBe('rack.patch-frame-12u');
    expect(defaultFrameDefId(f.project, f.sw2)).toBe('rack.patch-frame-12u'); // 2U spine
    expect(defaultFrameDefId(f.project, customDevice(f.project, 'C12', 12))).toBe('rack.patch-frame-12u');
    expect(defaultFrameDefId(f.project, customDevice(f.project, 'C13', 13))).toBe('rack.patch-frame-42u');
    expect(defaultFrameDefId(f.project, customDevice(f.project, 'C50', 50))).toBe('rack.patch-frame-42u');
  });
});

describe('frameNameFor', () => {
  it('uses PF-<ref>, then the next free -N suffix', () => {
    const p = empty();
    expect(frameNameFor(p, 'PP1')).toBe('PF-PP1');
    addRack(p, 'PF-PP1', { x: 0, y: 0 });
    expect(frameNameFor(p, 'PP1')).toBe('PF-PP1-2');
    addRack(p, 'PF-PP1-2', { x: 0, y: 0 });
    addRack(p, 'PF-PP1-3', { x: 0, y: 0 });
    expect(frameNameFor(p, 'PP1')).toBe('PF-PP1-4');
    expect(frameNameFor(p, 'PP2')).toBe('PF-PP2');
    expect(frameNameFor(p, 'PP?')).toBe('PF-PP?');
  });
});

describe('nextFreeFloorPos', () => {
  it('starts one grid cell in from the room origin on an empty floor', () => {
    const p = empty();
    expect(nextFreeFloorPos(p, frame12)).toEqual({ x: 600, y: 600 });
    p.room.gridMm = 500;
    expect(nextFreeFloorPos(p, frame12)).toEqual({ x: 500, y: 500 });
    p.room.gridMm = 0; // unset grid falls back to 600 mm
    expect(nextFreeFloorPos(p, frame12)).toEqual({ x: 600, y: 600 });
  });

  it('goes right of the bottom row on the grid, ignoring rows above', () => {
    const p = empty();
    addRack(p, 'R01', { x: 1000, y: 1000 });
    addRack(p, 'R02', { x: 4000, y: 1000 });
    // Right edge 4600 + a 600 mm gap → 5200, rounded up to the grid → 5400; row top 1000 snaps down to 600.
    expect(nextFreeFloorPos(p, frame12)).toEqual({ x: 5400, y: 600 });
    addRack(p, 'R03', { x: 1000, y: 3000 });
    // Only the bottom row (R03, right edge 1600) counts now.
    expect(nextFreeFloorPos(p, frame12)).toEqual({ x: 2400, y: 3000 });
  });

  it('measures a rotated rack by its rotated footprint', () => {
    const p = empty();
    addRack(p, 'R01', { x: 1000, y: 1000 }, 90); // 1070 wide on the floor → right edge 2070
    expect(nextFreeFloorPos(p, frame12)).toEqual({ x: 3000, y: 600 });
  });

  it('wraps to a new row when the frame would cross the room\'s right edge', () => {
    const p = empty();
    addRack(p, 'R01', { x: 1000, y: 1000 });
    addRack(p, 'R02', { x: 4000, y: 1000 });
    p.room.outline = [{ x: 0, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 8000 }, { x: 0, y: 8000 }];
    expect(nextFreeFloorPos(p, frame12)).toEqual({ x: 5400, y: 600 }); // 5400 + 600 fits exactly
    p.room.outline = [{ x: 0, y: 0 }, { x: 5500, y: 0 }, { x: 5500, y: 8000 }, { x: 0, y: 8000 }];
    // Bottom edge 2070 + a gap → 2670, rounded up to the grid → 3000, back at the first grid column.
    expect(nextFreeFloorPos(p, frame12)).toEqual({ x: 600, y: 3000 });
    expect(nextFreeFloorPos({ ...p, room: { ...p.room, gridMm: 500 } }, frame12)).toEqual({ x: 500, y: 3000 });
  });
});
