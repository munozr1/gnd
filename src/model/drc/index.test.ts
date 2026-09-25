import { describe, expect, it, vi } from 'vitest';
import { isOutOfSync } from '@/model/sync/diff';
import { createProject } from '../factories';
import { routedLengthM } from '../routing/length';
import {
  addAccessory,
  addDevice,
  addLink,
  addRack,
  addRoute,
  addTray,
  fresh,
  place,
  removePlacement,
  routeTwoRacks,
  twoRackFixture,
} from '../routing/test-fixtures';
import { drcRuleById, drcRules, runDrc } from './index';
import { bendRadius } from './rules/bend-radius';
import { clearance } from './rules/clearance';
import { managerOverfill } from './rules/manager-overfill';
import { missingManager } from './rules/missing-manager';
import { missingWaterfall } from './rules/missing-waterfall';
import { outOfSync } from './rules/out-of-sync';
import { reachExceeded } from './rules/reach-exceeded';
import { trayClearance } from './rules/tray-clearance';
import { trayMedia } from './rules/tray-media';
import { trayOverfill } from './rules/tray-overfill';
import { uCollision } from './rules/u-collision';
import { unplacedComponent } from './rules/unplaced-component';
import { unroutedLink } from './rules/unrouted-link';
import { wrongFace } from './rules/wrong-face';

vi.mock('@/model/sync/diff', () => ({
  isOutOfSync: vi.fn(() => false),
  computeSyncPlan: vi.fn(() => ({ changes: [] })),
}));

describe('u-collision', () => {
  it('flags overlapping U ranges, overflow, and placements below U1', () => {
    const p = createProject();
    const r = addRack(p, 'R01', { x: 0, y: 0 });
    const a = addDevice(p, 'sym.spine-switch-32x400', 'SW1', { rackId: r.id, u: 10 }); // 2U: 10–11
    const b = addDevice(p, 'sym.server-1u', 'SRV1', { rackId: r.id, u: 11 });
    addDevice(p, 'sym.server-1u', 'SRV2', { rackId: r.id, u: 12 });
    const top = addDevice(p, 'sym.gpu-server-4u', 'SRV3', { rackId: r.id, u: 40 }); // 40–43 > 42
    const low = addDevice(p, 'sym.server-1u', 'SRV4', { rackId: r.id, u: 0 });
    const findings = uCollision.check(p);
    expect(findings.map((f) => f.key)).toEqual(
      expect.arrayContaining([`overlap:${a.id}:${b.id}`, `overflow:${top.id}`, `below:${low.id}`]),
    );
    expect(findings).toHaveLength(3);
    expect(findings.find((f) => f.key?.startsWith('overlap'))!.message).toContain('SW1 (U10–U11) overlaps SRV1 (U11)');
  });

  it('is clean when devices stack without touching', () => {
    const p = createProject();
    const r = addRack(p, 'R01', { x: 0, y: 0 });
    addDevice(p, 'sym.spine-switch-32x400', 'SW1', { rackId: r.id, u: 41 });
    addDevice(p, 'sym.server-1u', 'SRV1', { rackId: r.id, u: 40 });
    expect(uCollision.check(p)).toEqual([]);
  });
});

describe('unplaced-component / unrouted-link', () => {
  it('flags components without a placement and placed-but-unrouted links', () => {
    const f = twoRackFixture();
    expect(unplacedComponent.check(f.project)).toEqual([]);
    expect(unroutedLink.check(f.project)).toHaveLength(1);
    routeTwoRacks(f);
    expect(unroutedLink.check(f.project)).toEqual([]);
    place(f.project, f.sw1.id, null, null);
    removePlacement(f.project, f.sw2.id);
    const findings = unplacedComponent.check(fresh(f.project));
    expect(findings.map((x) => x.key).sort()).toEqual([f.sw1.id, f.sw2.id].sort());
    delete f.project.routes[f.link.id];
    expect(unroutedLink.check(fresh(f.project))).toEqual([]);
  });
});

describe('reach-exceeded', () => {
  it('flags a 100G-SR4 link routed to ~120 m of raw path', () => {
    const f = twoRackFixture({ rack2X: 116000 });
    routeTwoRacks(f);
    const len = routedLengthM(f.project, f.link.id)!;
    expect(len.rawM).toBeGreaterThan(119);
    expect(len.rawM).toBeLessThan(122);
    expect(len.standardM).toBeGreaterThan(100);
    const findings = reachExceeded.check(f.project);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('100 m reach of 100G-SR4');
    expect(findings[0]!.targets).toEqual([{ kind: 'link', id: f.link.id }]);
  });

  it('is clean for a short route and uses the estimate when unrouted', () => {
    const f = twoRackFixture();
    routeTwoRacks(f);
    expect(reachExceeded.check(f.project)).toEqual([]);
    const far = twoRackFixture({ rack2X: 116000 });
    const findings = reachExceeded.check(far.project);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('(est.)');
  });

  it('uses the integrated reach of DAC cables and skips links without optics', () => {
    const f = twoRackFixture();
    const dac = addLink(f.project, [f.sw1, 'eth1/50'], [f.sw2, 'eth1/2'], 'cbl.dac-100g');
    const findings = reachExceeded.check(f.project);
    expect(findings.map((x) => x.key)).toEqual([dac.id]);
    const bare = addLink(f.project, [f.sw1, 'eth1/51'], [f.sw2, 'eth1/3'], null);
    expect(reachExceeded.check(fresh(f.project)).map((x) => x.key)).toEqual([dac.id]);
    expect(bare.cableDefId).toBeNull();
  });
});

describe('tray-overfill / manager-overfill', () => {
  it('flags trays and managers above their thresholds', () => {
    const f = twoRackFixture();
    const route = routeTwoRacks(f);
    expect(trayOverfill.check(f.project)).toEqual([]);
    expect(managerOverfill.check(f.project)).toEqual([]);
    f.project.settings.trayFillWarn = 0.0001;
    f.project.settings.managerFillWarn = 0.0001;
    expect(trayOverfill.check(f.project).map((x) => x.key)).toEqual([f.tray.id]);
    expect(managerOverfill.check(f.project).map((x) => x.key).sort()).toEqual(
      [`${f.r1.id}:${route.aRack.side}`, `${f.r2.id}:${route.bRack.side}`].sort(),
    );
  });
});

describe('bend-radius', () => {
  it('flags corners whose shorter leg is below the cable bend radius', () => {
    const f = twoRackFixture();
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 1160, y: 500 }, { x: 1160, y: 520 }, { x: 4150, y: 520 }] },
    ]);
    const findings = bendRadius.check(f.project);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('2 corners');
    expect(findings[0]!.message).toContain('40 mm');
  });

  it('ignores straight runs and long legs', () => {
    const f = twoRackFixture();
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 2000, y: 500 }, { x: 2000, y: 700 }, { x: 4150, y: 700 }] },
    ]);
    expect(bendRadius.check(f.project)).toEqual([]);
  });
});

describe('clearance', () => {
  it('flags racks outside the room and inside keep-outs', () => {
    const p = createProject();
    addRack(p, 'IN', { x: 1000, y: 1000 });
    const edge = addRack(p, 'EDGE', { x: 0, y: 0 });
    const out = addRack(p, 'OUT', { x: -300, y: 1000 });
    const ko = addRack(p, 'KO', { x: 5000, y: 3000 });
    p.keepouts.push({
      id: 'k1',
      name: 'hot aisle',
      kind: 'aisle',
      outline: [{ x: 5200, y: 2000 }, { x: 8000, y: 2000 }, { x: 8000, y: 3200 }, { x: 5200, y: 3200 }],
    });
    p.keepouts.push({ id: 'k2', name: 'far', kind: 'custom', outline: [{ x: 9000, y: 6000 }, { x: 9500, y: 6000 }, { x: 9500, y: 6500 }] });
    const findings = clearance.check(p);
    expect(findings.map((x) => x.key).sort()).toEqual([`keepout:${ko.id}:k1`, `room:${out.id}`].sort());
    expect(findings.some((x) => x.targets.some((t) => t.id === edge.id))).toBe(false);
  });
});

describe('wrong-face', () => {
  it('flags a rear top entry used by a front port', () => {
    const f = twoRackFixture({ topEntries: false });
    const rear = addAccessory(f.project, f.r1.id, 'top-entry', { side: 'left', face: 'rear' });
    const route = routeTwoRacks(f);
    expect(route.aRack.entry).toBe(rear.id);
    const findings = wrongFace.check(f.project);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.key).toBe(`${f.link.id}:A`);
    expect(findings[0]!.message).toContain('rear top entry');
    place(f.project, f.sw1.id, f.r1.id, 40, 'rear');
    expect(wrongFace.check(f.project)).toEqual([]);
  });
});

describe('out-of-sync', () => {
  it('reports one error when the sync diff is non-empty', () => {
    const p = createProject();
    expect(outOfSync.check(p)).toEqual([]);
    vi.mocked(isOutOfSync).mockReturnValueOnce(true);
    const findings = outOfSync.check(p);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('F8');
  });
});

describe('tray-media', () => {
  it('flags fiber on a ladder and copper on a fiber runway, allows baskets', () => {
    const f = twoRackFixture();
    const ladder = addTray(f.project, 'tray.ladder-12', [{ x: 0, y: 600 }, { x: 5000, y: 600 }], 2600);
    const basket = addTray(f.project, 'tray.basket-200', [{ x: 0, y: 700 }, { x: 5000, y: 700 }], 2600);
    addRoute(f.project, f.link.id, [{ layer: 'overhead', trayId: ladder.id, points: [{ x: 1150, y: 600 }] }]);
    const dac = addLink(f.project, [f.sw1, 'eth1/50'], [f.sw2, 'eth1/2'], 'cbl.dac-100g');
    addRoute(f.project, dac.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }] },
      { layer: 'overhead', trayId: basket.id, points: [{ x: 2000, y: 700 }] },
    ]);
    const findings = trayMedia.check(f.project);
    expect(findings.map((x) => x.key).sort()).toEqual([`${dac.id}:${f.tray.id}`, `${f.link.id}:${ladder.id}`].sort());
    expect(findings.find((x) => x.key === `${f.link.id}:${ladder.id}`)!.message).toContain('fiber cable');
  });
});

describe('missing-manager', () => {
  it('groups routes per rack side lacking a manager', () => {
    const f = twoRackFixture({ managers: false });
    routeTwoRacks(f);
    const l2 = addLink(f.project, [f.sw1, 'eth1/50'], [f.sw2, 'eth1/2'], 'cbl.om4-duplex');
    addRoute(f.project, l2.id, [{ layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }] }]);
    const findings = missingManager.check(f.project);
    expect(findings).toHaveLength(2);
    const r1 = findings.find((x) => x.key === `${f.r1.id}:left`)!;
    expect(r1.message).toContain('2 cables use');
    expect(r1.targets).toHaveLength(3);
    addAccessory(f.project, f.r1.id, 'vcm', { side: 'left' });
    expect(missingManager.check(f.project).map((x) => x.key)).toEqual([`${f.r2.id}:left`]);
  });
});

describe('missing-waterfall', () => {
  it('flags overhead drops on trays without a waterfall over the rack', () => {
    const f = twoRackFixture();
    routeTwoRacks(f);
    expect(missingWaterfall.check(f.project)).toEqual([]);
    f.tray.fittings = f.tray.fittings.filter((x) => x.rackId !== f.r2.id);
    const findings = missingWaterfall.check(f.project);
    expect(findings.map((x) => x.key)).toEqual([`${f.link.id}:B`]);
    expect(findings[0]!.message).toContain('no waterfall');
  });

  it('ignores underfloor segments and segments without a tray', () => {
    const f = twoRackFixture();
    addRoute(f.project, f.link.id, [
      { layer: 'underfloor', points: [{ x: 1150, y: 500 }] },
      { layer: 'overhead', points: [{ x: 4150, y: 500 }] },
    ]);
    expect(missingWaterfall.check(f.project)).toEqual([]);
  });
});

describe('tray-clearance', () => {
  it('flags an overhead tray crossing a rack with less than 150 mm above the rack top', () => {
    const f = twoRackFixture();
    const low = addTray(f.project, 'tray.ladder-12', [{ x: 0, y: 1500 }, { x: 6000, y: 1500 }], 2000);
    const findings = trayClearance.check(f.project);
    expect(findings.map((x) => x.key).sort()).toEqual([`${low.id}:${f.r1.id}`, `${low.id}:${f.r2.id}`].sort());
    expect(findings[0]!.message).toContain('needs ≥ 2117 mm');
    low.elevationMm = 2117;
    expect(trayClearance.check(f.project)).toEqual([]);
    low.elevationMm = 2000;
    low.points = [{ x: 0, y: 500 }, { x: 6000, y: 500 }];
    expect(trayClearance.check(f.project)).toEqual([]);
  });
});

describe('runDrc', () => {
  it('stamps ids, applies severity overrides, and skips ignored rules', () => {
    const f = twoRackFixture();
    const issues = runDrc(f.project);
    const unrouted = issues.filter((i) => i.rule === 'unrouted-link');
    expect(unrouted).toHaveLength(1);
    expect(unrouted[0]).toMatchObject({ id: `unrouted-link:${f.link.id}`, severity: 'warning', domain: 'drc' });
    f.project.settings.drcSeverities['unrouted-link'] = 'error';
    expect(runDrc(f.project).find((i) => i.rule === 'unrouted-link')!.severity).toBe('error');
    f.project.settings.drcSeverities['unrouted-link'] = 'ignore';
    expect(runDrc(f.project).some((i) => i.rule === 'unrouted-link')).toBe(false);
  });

  it('registers every rule with a unique id and the drc domain', () => {
    const ids = drcRules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(drcRules.every((r) => r.domain === 'drc')).toBe(true);
    expect(ids).toEqual([
      'u-collision',
      'unplaced-component',
      'unrouted-link',
      'reach-exceeded',
      'tray-overfill',
      'bend-radius',
      'clearance',
      'wrong-face',
      'out-of-sync',
      'tray-media',
      'missing-manager',
      'manager-overfill',
      'missing-waterfall',
      'tray-clearance',
      'cable-length-short',
    ]);
    expect(drcRuleById('u-collision')?.defaultSeverity).toBe('error');
    expect(drcRuleById('nope')).toBeUndefined();
  });
});
