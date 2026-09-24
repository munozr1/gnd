import { describe, expect, it } from 'vitest';
import { cableOffsetInTray, cablesInTray, managerFill, routesUsingManager, trayCableSlots, trayFill } from './fill';
import { addLink, addRoute, addTray, routeTwoRacks, twoRackFixture } from './test-fixtures';

const area = (d: number) => Math.PI * (d / 2) ** 2;

describe('trayFill', () => {
  it('sums cable cross-sections over the tray area', () => {
    const f = twoRackFixture();
    routeTwoRacks(f);
    const l2 = addLink(f.project, [f.sw1, 'eth1/50'], [f.sw2, 'eth1/2'], 'cbl.om4-duplex');
    addRoute(f.project, l2.id, [{ layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }] }]);
    const l3 = addLink(f.project, [f.sw1, 'eth1/51'], [f.sw2, 'eth1/3'], null);
    addRoute(f.project, l3.id, [{ layer: 'overhead', trayId: 'other', points: [{ x: 1150, y: 500 }] }]);
    const fill = trayFill(f.project, f.tray.id)!;
    expect(fill.areaMm2).toBe(152 * 50);
    expect(fill.cableCount).toBe(2);
    expect(fill.usedMm2).toBeCloseTo(area(3.5) + area(2), 9);
    expect(fill.fraction).toBeCloseTo((area(3.5) + area(2)) / (152 * 50), 9);
    expect(cablesInTray(f.project, f.tray.id)).toEqual([f.link.id, l2.id]);
    expect(trayFill(f.project, 'missing')).toBeNull();
  });

  it('defaults the diameter to 3 mm for links without a cable', () => {
    const f = twoRackFixture();
    const l = addLink(f.project, [f.sw1, 'eth1/50'], [f.sw2, 'eth1/2'], null);
    addRoute(f.project, l.id, [{ layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }] }]);
    expect(trayFill(f.project, f.tray.id)!.usedMm2).toBeCloseTo(area(3), 9);
  });
});

describe('managerFill', () => {
  it('counts routes that use the side on either end', () => {
    const f = twoRackFixture();
    const route = routeTwoRacks(f);
    const fill = managerFill(f.project, f.r1.id, route.aRack.side);
    expect(fill.areaMm2).toBe(152 * 100);
    expect(fill.cableCount).toBe(1);
    expect(fill.usedMm2).toBeCloseTo(area(3.5), 9);
    expect(routesUsingManager(f.project, f.r2.id, route.bRack.side)).toEqual([f.link.id]);
    const other = route.aRack.side === 'left' ? 'right' : 'left';
    expect(managerFill(f.project, f.r1.id, other).cableCount).toBe(0);
  });
});

describe('cable slots', () => {
  it('packs cables side by side, centred, and stacks when the width is exceeded', () => {
    const f = twoRackFixture();
    const tray = addTray(f.project, 'tray.fiber-runway-4', [{ x: 0, y: 0 }, { x: 100, y: 0 }], 2600);
    tray.widthMm = 10;
    const ids = [f.link.id];
    addRoute(f.project, f.link.id, [{ layer: 'overhead', trayId: tray.id, points: [{ x: 0, y: 0 }] }]);
    for (const port of ['eth1/50', 'eth1/51'] as const) {
      const l = addLink(f.project, [f.sw1, port], [f.sw2, port], 'cbl.om4-mpo-trunk');
      addRoute(f.project, l.id, [{ layer: 'overhead', trayId: tray.id, points: [{ x: 0, y: 0 }] }]);
      ids.push(l.id);
    }
    const slots = trayCableSlots(f.project, tray.id);
    // Two 3.5 mm cables with a 1 mm gap = 8 mm fit; the third stacks.
    expect(slots.get(ids[0]!)).toMatchObject({ row: 0, index: 0, lateralMm: -4 + 1.75, verticalMm: 1.75 });
    expect(slots.get(ids[1]!)).toMatchObject({ row: 0, index: 1, lateralMm: -4 + 3.5 + 1 + 1.75 });
    expect(slots.get(ids[2]!)).toMatchObject({ row: 1, index: 2, lateralMm: 0, verticalMm: 3.5 + 1 + 1.75 });
    expect(cableOffsetInTray(f.project, tray.id, ids[2]!)!.row).toBe(1);
    expect(cableOffsetInTray(f.project, tray.id, 'nope')).toBeNull();
  });
});
