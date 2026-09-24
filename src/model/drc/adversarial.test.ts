/**
 * Adversarial DRC tests: boundary conditions and spec corners the happy-path
 * suite in index.test.ts does not cover. Unlike that file, nothing here is
 * mocked; out-of-sync goes through the real sync module.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { createProject, createRack } from '../factories';
import { trayFill } from '../routing/fill';
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
  routeTwoRacks,
  twoRackFixture,
  type TwoRackFixture,
} from '../routing/test-fixtures';
import { applySyncPlan } from '../sync/apply';
import { computeSyncPlan } from '../sync/diff';
import type { Project, TransceiverDef, TrayFitting, Vec2 } from '../types';
import { runDrc } from './index';
import { bendRadius } from './rules/bend-radius';
import { clearance } from './rules/clearance';
import { missingWaterfall } from './rules/missing-waterfall';
import { outOfSync } from './rules/out-of-sync';
import { reachExceeded } from './rules/reach-exceeded';
import { TRAY_CLEARANCE_MM, trayClearance } from './rules/tray-clearance';
import { trayMedia } from './rules/tray-media';
import { trayOverfill } from './rules/tray-overfill';
import { uCollision } from './rules/u-collision';
import { unplacedComponent } from './rules/unplaced-component';
import { unroutedLink } from './rules/unrouted-link';

const U_MM = 44.45;
const RACK_BASE_MM = 100;
const tall48 = builtinCatalog.racks.find((r) => r.id === 'rack.tall-48u')!;

const keys = (findings: { key?: string }[]): string[] => findings.map((f) => f.key ?? '').sort();

// ---------------------------------------------------------------------------
// u-collision
// ---------------------------------------------------------------------------

describe('u-collision boundaries', () => {
  it('does not flag devices that sit directly on top of each other', () => {
    const p = createProject();
    const r = addRack(p, 'R01', { x: 0, y: 0 });
    addDevice(p, 'sym.server-1u', 'SRV0', { rackId: r.id, u: 9 });
    addDevice(p, 'sym.spine-switch-32x400', 'SW1', { rackId: r.id, u: 10 }); // 10–11
    addDevice(p, 'sym.server-1u', 'SRV1', { rackId: r.id, u: 12 });
    addDevice(p, 'sym.gpu-server-4u', 'SRV2', { rackId: r.id, u: 13 }); // 13–16
    addDevice(p, 'sym.server-1u', 'SRV3', { rackId: r.id, u: 17 });
    expect(uCollision.check(p)).toEqual([]);
  });

  it('accepts a rack packed solid from U1 to U42', () => {
    const p = createProject();
    const r = addRack(p, 'R01', { x: 0, y: 0 });
    for (let u = 1; u <= 42; u++) addDevice(p, 'sym.server-1u', `SRV${u}`, { rackId: r.id, u });
    expect(uCollision.check(p)).toEqual([]);
  });

  it('flags overflow only when the top U passes the rack height', () => {
    const p = createProject();
    const r = addRack(p, 'R01', { x: 0, y: 0 });
    addDevice(p, 'sym.server-1u', 'A', { rackId: r.id, u: 42 }); // 42
    const b = addDevice(p, 'sym.spine-switch-32x400', 'B', { rackId: r.id, u: 41 }); // 41–42
    expect(uCollision.check(p).map((f) => f.key)).toEqual([`overlap:${b.id}:${p.components[0]!.id}`]);

    const q = createProject();
    const r2 = addRack(q, 'R02', { x: 0, y: 0 });
    addDevice(q, 'sym.gpu-server-4u', 'G1', { rackId: r2.id, u: 39 }); // 39–42
    expect(uCollision.check(q)).toEqual([]);
    const over = addDevice(q, 'sym.spine-switch-32x400', 'S1', { rackId: r2.id, u: 42 }); // 42–43
    const findings = uCollision.check(fresh(q));
    expect(keys(findings)).toEqual([`overflow:${over.id}`, `overlap:${q.components[0]!.id}:${over.id}`].sort());
    expect(findings.find((f) => f.key === `overflow:${over.id}`)!.message).toContain('42U');
  });

  it('uses each rack’s own height, not a fixed 42U', () => {
    const p = createProject();
    const tall = createRack(tall48, { name: 'T01', pos: { x: 0, y: 0 } });
    p.racks.push(tall);
    const short = addRack(p, 'S01', { x: 2000, y: 0 });
    short.heightU = 20;
    addDevice(p, 'sym.spine-switch-32x400', 'A', { rackId: tall.id, u: 47 }); // 47–48 fits 48U
    addDevice(p, 'sym.server-1u', 'B', { rackId: short.id, u: 20 });
    expect(uCollision.check(p)).toEqual([]);
    const c = addDevice(p, 'sym.spine-switch-32x400', 'C', { rackId: tall.id, u: 48 });
    const d = addDevice(p, 'sym.server-1u', 'D', { rackId: short.id, u: 21 });
    const findings = uCollision.check(fresh(p));
    expect(keys(findings)).toEqual([`overflow:${c.id}`, `overflow:${d.id}`, `overlap:${p.components[0]!.id}:${c.id}`].sort());
    expect(findings.find((f) => f.key === `overflow:${d.id}`)!.message).toContain('20U');
  });

  it('reports every overlapping pair once and no non-overlapping pair', () => {
    const p = createProject();
    const r = addRack(p, 'R01', { x: 0, y: 0 });
    const g = addDevice(p, 'sym.gpu-server-4u', 'G', { rackId: r.id, u: 10 }); // 10–13
    const a = addDevice(p, 'sym.server-1u', 'A', { rackId: r.id, u: 11 });
    const b = addDevice(p, 'sym.server-1u', 'B', { rackId: r.id, u: 13 });
    addDevice(p, 'sym.server-1u', 'C', { rackId: r.id, u: 14 });
    expect(keys(uCollision.check(p))).toEqual([`overlap:${g.id}:${a.id}`, `overlap:${g.id}:${b.id}`].sort());
  });

  it('flags two devices at the same U exactly once with both as targets', () => {
    const p = createProject();
    const r = addRack(p, 'R01', { x: 0, y: 0 });
    const a = addDevice(p, 'sym.server-1u', 'A', { rackId: r.id, u: 5 });
    const b = addDevice(p, 'sym.server-1u', 'B', { rackId: r.id, u: 5 });
    const findings = uCollision.check(p);
    expect(findings).toHaveLength(1);
    const ids = findings[0]!.targets.filter((t) => t.kind === 'component').map((t) => t.id);
    expect(ids.sort()).toEqual([a.id, b.id].sort());
  });

  it('never collides devices in different racks or unplaced devices', () => {
    const p = createProject();
    const r1 = addRack(p, 'R01', { x: 0, y: 0 });
    const r2 = addRack(p, 'R02', { x: 2000, y: 0 });
    addDevice(p, 'sym.gpu-server-4u', 'A', { rackId: r1.id, u: 10 });
    addDevice(p, 'sym.gpu-server-4u', 'B', { rackId: r2.id, u: 10 });
    addDevice(p, 'sym.gpu-server-4u', 'C');
    const half = addDevice(p, 'sym.gpu-server-4u', 'D', { rackId: r1.id, u: 12 });
    place(p, half.id, r1.id, null);
    expect(uCollision.check(p)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// reach-exceeded
// ---------------------------------------------------------------------------

function withCustomTransceivers(project: Project, xcvrs: TransceiverDef[]): Project {
  return { ...project, customCatalog: { ...project.customCatalog, transceivers: xcvrs } };
}

describe('reach-exceeded boundaries', () => {
  it('limits by the shorter reach whichever end carries it', () => {
    const f = twoRackFixture({ rack2X: 116000 });
    routeTwoRacks(f);
    f.sw1.optics['eth1/49'] = 'xcvr.100g-lr4';
    f.sw2.optics['eth1/1'] = 'xcvr.100g-sr4';
    let findings = reachExceeded.check(fresh(f.project));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('100 m reach of 100G-SR4');

    f.sw1.optics['eth1/49'] = 'xcvr.100g-sr4';
    f.sw2.optics['eth1/1'] = 'xcvr.100g-lr4';
    findings = reachExceeded.check(fresh(f.project));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain('100 m reach of 100G-SR4');

    f.sw1.optics['eth1/49'] = 'xcvr.100g-lr4';
    expect(reachExceeded.check(fresh(f.project))).toEqual([]);
  });

  it('uses the one optic present when the other end has none', () => {
    const f = twoRackFixture({ rack2X: 116000 });
    routeTwoRacks(f);
    delete f.sw1.optics['eth1/49'];
    expect(reachExceeded.check(fresh(f.project)).map((x) => x.key)).toEqual([f.link.id]);
    delete f.sw2.optics['eth1/1'];
    expect(reachExceeded.check(fresh(f.project))).toEqual([]);
  });

  it('compares the standard (rounded) length, not the raw or slack length', () => {
    const f = twoRackFixture();
    routeTwoRacks(f);
    const len = routedLengthM(f.project, f.link.id)!;
    expect(len.withSlackM).toBeLessThan(len.standardM);
    const mid = (len.withSlackM + len.standardM) / 2;
    const custom = (reachM: number): TransceiverDef => ({
      id: 'xcvr.test',
      name: 'TEST',
      formFactor: 'QSFP28',
      speedGbps: 100,
      media: 'MMF',
      connector: 'MPO-12',
      reachM,
      lanes: 4,
    });
    f.sw1.optics['eth1/49'] = 'xcvr.test';
    f.sw2.optics['eth1/1'] = 'xcvr.test';

    // raw < withSlack < reach < standard: only a standard-length comparison flags this.
    const flagged = reachExceeded.check(withCustomTransceivers(f.project, [custom(mid)]));
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.message).toContain(`${len.standardM} m exceeds the ${mid} m reach of TEST`);
    // reach == standard is allowed.
    expect(reachExceeded.check(withCustomTransceivers(f.project, [custom(len.standardM)]))).toEqual([]);
    // just below the standard length trips again.
    expect(reachExceeded.check(withCustomTransceivers(f.project, [custom(len.standardM - 0.01)]))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// tray-media
// ---------------------------------------------------------------------------

describe('tray-media accepts', () => {
  function routeOn(f: TwoRackFixture, trayId: string, cableDefId: string, port: [string, string]) {
    const link = addLink(f.project, [f.sw1, port[0]], [f.sw2, port[1]], cableDefId);
    addRoute(f.project, link.id, [{ layer: 'overhead', trayId, points: [{ x: 1150, y: 600 }] }]);
    return link;
  }

  it('lets both fiber and copper ride a basket', () => {
    const f = twoRackFixture();
    const basket = addTray(f.project, 'tray.basket-300', [{ x: 0, y: 600 }, { x: 5000, y: 600 }], 2600);
    routeOn(f, basket.id, 'cbl.om4-duplex', ['eth1/1', 'eth1/2']);
    routeOn(f, basket.id, 'cbl.cat6a', ['eth1/2', 'eth1/3']);
    routeOn(f, basket.id, 'cbl.dac-100g', ['eth1/50', 'eth1/4']);
    routeOn(f, basket.id, 'cbl.aoc-100g', ['eth1/51', 'eth1/5']);
    expect(trayMedia.check(fresh(f.project))).toEqual([]);
  });

  it('flags only the wrong class on runways and ladders', () => {
    const f = twoRackFixture();
    const ladder = addTray(f.project, 'tray.ladder-24', [{ x: 0, y: 600 }, { x: 5000, y: 600 }], 2600);
    const copperOnLadder = routeOn(f, ladder.id, 'cbl.cat6a', ['eth1/1', 'eth1/2']);
    const fiberOnLadder = routeOn(f, ladder.id, 'cbl.om4-duplex', ['eth1/2', 'eth1/3']);
    const aocOnLadder = routeOn(f, ladder.id, 'cbl.aoc-100g', ['eth1/50', 'eth1/4']);
    const fiberOnRunway = routeOn(f, f.tray.id, 'cbl.os2-duplex', ['eth1/3', 'eth1/5']);
    const copperOnRunway = routeOn(f, f.tray.id, 'cbl.dac-25g', ['eth1/4', 'eth1/6']);
    const noCable = routeOn(f, ladder.id, 'cbl.none', ['eth1/5', 'eth1/7']);
    noCable.cableDefId = null;
    const findings = trayMedia.check(fresh(f.project));
    expect(keys(findings)).toEqual(
      [`${fiberOnLadder.id}:${ladder.id}`, `${aocOnLadder.id}:${ladder.id}`, `${copperOnRunway.id}:${f.tray.id}`].sort(),
    );
    for (const ok of [copperOnLadder, fiberOnRunway, noCable]) {
      expect(findings.some((x) => x.key?.startsWith(ok.id))).toBe(false);
    }
  });

  it('reports a tray once per route even when several segments ride it', () => {
    const f = twoRackFixture();
    const ladder = addTray(f.project, 'tray.ladder-12', [{ x: 0, y: 600 }, { x: 5000, y: 600 }], 2600);
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: ladder.id, points: [{ x: 1150, y: 600 }] },
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 2000, y: 500 }] },
      { layer: 'overhead', trayId: ladder.id, points: [{ x: 4150, y: 600 }] },
    ]);
    expect(trayMedia.check(f.project).map((x) => x.key)).toEqual([`${f.link.id}:${ladder.id}`]);
  });
});

// ---------------------------------------------------------------------------
// missing-waterfall
// ---------------------------------------------------------------------------

describe('missing-waterfall uses the tray the route actually rides', () => {
  /** Second runway that passes straight over both rack footprints (y = 1500). */
  const secondTray = (f: TwoRackFixture, fittings: TrayFitting[] = []) =>
    addTray(f.project, 'tray.fiber-runway-6', [{ x: 500, y: 1500 }, { x: f.r2.pos.x + 1000, y: 1500 }], 2600, fittings);

  it('ignores waterfalls on a tray the route does not use', () => {
    const f = twoRackFixture();
    const t2 = secondTray(f);
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: t2.id, points: [{ x: 1300, y: 1500 }, { x: f.r2.pos.x + 300, y: 1500 }] },
    ]);
    const findings = missingWaterfall.check(f.project);
    expect(keys(findings)).toEqual([`${f.link.id}:A`, `${f.link.id}:B`]);
    expect(findings.every((x) => x.targets.some((t) => t.kind === 'tray' && t.id === t2.id))).toBe(true);
    expect(findings.some((x) => x.targets.some((t) => t.kind === 'tray' && t.id === f.tray.id))).toBe(false);
  });

  it('does not let another tray’s waterfall satisfy the drop', () => {
    const f = twoRackFixture();
    f.tray.fittings = f.tray.fittings.filter((x) => x.rackId !== f.r2.id);
    secondTray(f, [{ at: { x: f.r2.pos.x + 300, y: 1500 }, type: 'waterfall', rackId: f.r2.id }]);
    routeTwoRacks(f);
    expect(missingWaterfall.check(f.project).map((x) => x.key)).toEqual([`${f.link.id}:B`]);
  });

  it('checks each end against the tray at that end of a multi-tray route', () => {
    const f = twoRackFixture();
    f.tray.fittings = [{ at: { x: 1150, y: 500 }, type: 'waterfall', rackId: f.r1.id }];
    const t2 = secondTray(f, [{ at: { x: f.r2.pos.x + 300, y: 1500 }, type: 'waterfall', rackId: f.r2.id }]);
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 2500, y: 500 }] },
      { layer: 'overhead', trayId: t2.id, points: [{ x: 2500, y: 1500 }, { x: f.r2.pos.x + 300, y: 1500 }] },
    ]);
    expect(missingWaterfall.check(f.project)).toEqual([]);

    // Swap the waterfalls between the trays: now neither end drops from a tray with its waterfall.
    f.tray.fittings = [{ at: { x: 1150, y: 500 }, type: 'waterfall', rackId: f.r2.id }];
    t2.fittings = [{ at: { x: f.r2.pos.x + 300, y: 1500 }, type: 'waterfall', rackId: f.r1.id }];
    expect(keys(missingWaterfall.check(fresh(f.project)))).toEqual([`${f.link.id}:A`, `${f.link.id}:B`]);
  });

  it('skips empty leading/trailing segments when finding the end trays', () => {
    const f = twoRackFixture();
    const t2 = secondTray(f);
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: t2.id, points: [] },
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: f.r2.pos.x + 150, y: 500 }] },
      { layer: 'overhead', trayId: t2.id, points: [] },
    ]);
    expect(missingWaterfall.check(f.project)).toEqual([]);
  });

  it('only counts fittings of type waterfall', () => {
    const f = twoRackFixture();
    f.tray.fittings = f.tray.fittings.map((x) => (x.rackId === f.r1.id ? { ...x, type: 'tee' } : x));
    routeTwoRacks(f);
    expect(missingWaterfall.check(f.project).map((x) => x.key)).toEqual([`${f.link.id}:A`]);
  });

  it('accepts a waterfall positioned over the rack even without an explicit rackId', () => {
    const f = twoRackFixture();
    f.tray.fittings = [];
    const t2 = secondTray(f, [
      { at: { x: 1300, y: 1500 }, type: 'waterfall' }, // over R01 (x 1000–1600, y 1000–2070)
      { at: { x: f.r2.pos.x - 200, y: 1500 }, type: 'waterfall' }, // beside R02, not over it
    ]);
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: t2.id, points: [{ x: 1300, y: 1500 }, { x: f.r2.pos.x + 300, y: 1500 }] },
    ]);
    expect(missingWaterfall.check(f.project).map((x) => x.key)).toEqual([`${f.link.id}:B`]);
  });

  it('does not count a waterfall explicitly bound to another rack, wherever it sits', () => {
    const f = twoRackFixture();
    f.tray.fittings = [];
    const t2 = secondTray(f, [{ at: { x: 1300, y: 1500 }, type: 'waterfall', rackId: f.r2.id }]);
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: t2.id, points: [{ x: 1300, y: 1500 }, { x: f.r2.pos.x + 300, y: 1500 }] },
    ]);
    expect(missingWaterfall.check(f.project).map((x) => x.key)).toEqual([`${f.link.id}:A`]);
  });
});

// ---------------------------------------------------------------------------
// tray-clearance
// ---------------------------------------------------------------------------

describe('tray-clearance threshold', () => {
  const required42 = 42 * U_MM + RACK_BASE_MM + TRAY_CLEARANCE_MM; // 2116.9

  it('flags strictly below rack top + 150 mm and accepts exactly at it', () => {
    const f = twoRackFixture();
    const tray = addTray(f.project, 'tray.ladder-12', [{ x: 0, y: 1500 }, { x: 6000, y: 1500 }], required42);
    expect(trayClearance.check(f.project)).toEqual([]);
    tray.elevationMm = required42 - 0.1;
    const findings = trayClearance.check(fresh(f.project));
    expect(keys(findings)).toEqual([`${tray.id}:${f.r1.id}`, `${tray.id}:${f.r2.id}`].sort());
    expect(findings[0]!.message).toContain('needs ≥ 2117 mm');
  });

  it('measures against each rack’s own top', () => {
    const p = createProject();
    const tall = createRack(tall48, { name: 'T01', pos: { x: 1000, y: 1000 } });
    p.racks.push(tall);
    const std = addRack(p, 'R01', { x: 4000, y: 1000 });
    const required48 = 48 * U_MM + RACK_BASE_MM + TRAY_CLEARANCE_MM; // 2383.6
    const tray = addTray(p, 'tray.fiber-runway-6', [{ x: 0, y: 1500 }, { x: 6000, y: 1500 }], required48 - 1);
    const findings = trayClearance.check(p);
    expect(findings.map((x) => x.key)).toEqual([`${tray.id}:${tall.id}`]);
    expect(findings[0]!.message).toContain(`needs ≥ ${Math.round(required48)} mm`);
    expect(findings.some((x) => x.key === `${tray.id}:${std.id}`)).toBe(false);
  });

  it('uses the rotated footprint when deciding whether the tray passes over a rack', () => {
    const p = createProject();
    const rack = addRack(p, 'R90', { x: 3000, y: 3000 }, 90); // footprint x 3000–4070, y 3000–3600
    const across = addTray(p, 'tray.ladder-12', [{ x: 0, y: 3300 }, { x: 3500, y: 3300 }], 1500);
    const short = addTray(p, 'tray.ladder-12', [{ x: 0, y: 3300 }, { x: 2000, y: 3300 }], 1500);
    const unrotatedOnly = addTray(p, 'tray.ladder-12', [{ x: 0, y: 3800 }, { x: 6000, y: 3800 }], 1500);
    const inside = addTray(p, 'tray.ladder-12', [{ x: 3200, y: 3100 }, { x: 3400, y: 3100 }], 1500);
    expect(keys(trayClearance.check(p))).toEqual([`${across.id}:${rack.id}`, `${inside.id}:${rack.id}`].sort());
    expect(short.id).not.toBe(unrotatedOnly.id);
  });

  it('ignores underfloor trays and single-point trays', () => {
    const f = twoRackFixture();
    addTray(f.project, 'tray.basket-200', [{ x: 0, y: 1500 }, { x: 6000, y: 1500 }], -150);
    addTray(f.project, 'tray.ladder-12', [{ x: 1300, y: 1500 }], 1000);
    expect(trayClearance.check(f.project)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// clearance
// ---------------------------------------------------------------------------

describe('clearance: room outline vs keep-outs', () => {
  const box = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];

  it('reports only the room for a rack outside it, only the keep-out for a rack inside one, and both when both apply', () => {
    const p = createProject();
    const outside = addRack(p, 'OUT', { x: 13000, y: 1000 });
    const inKo = addRack(p, 'KO', { x: 3000, y: 3000 });
    const both = addRack(p, 'BOTH', { x: -2000, y: 1000 });
    p.keepouts.push({ id: 'k1', name: 'aisle', kind: 'aisle', outline: box(2800, 2800, 4000, 4500) });
    p.keepouts.push({ id: 'k2', name: 'dock', kind: 'custom', outline: box(-3000, 0, 0, 3000) });
    const findings = clearance.check(p);
    expect(keys(findings)).toEqual(
      [`room:${outside.id}`, `keepout:${inKo.id}:k1`, `room:${both.id}`, `keepout:${both.id}:k2`].sort(),
    );
  });

  it('treats touching a wall or keep-out edge as clear, and a 1 mm overlap as a hit', () => {
    const p = createProject();
    addRack(p, 'E', { x: 11400, y: 1000 }); // right edge exactly on x = 12000
    addRack(p, 'S', { x: 1000, y: 6930 }); // bottom edge exactly on y = 8000
    addRack(p, 'T', { x: 5000, y: 1000 }); // x 5000–5600 touches the keep-out at 5600
    p.keepouts.push({ id: 'k', name: 'k', kind: 'custom', outline: box(5600, 0, 6000, 3000) });
    expect(clearance.check(p)).toEqual([]);
    const e = addRack(p, 'E2', { x: 11401, y: 3000 });
    const s = addRack(p, 'S2', { x: 3000, y: 6931 });
    const t = addRack(p, 'T2', { x: 5001, y: 4000 });
    p.keepouts.push({ id: 'k2', name: 'k2', kind: 'custom', outline: box(5600, 3500, 6000, 6000) });
    expect(keys(clearance.check(fresh(p)))).toEqual([`room:${e.id}`, `room:${s.id}`, `keepout:${t.id}:k2`].sort());
  });

  it('uses the rotated footprint against the wall', () => {
    const p = createProject();
    addRack(p, 'R0', { x: 11000, y: 1000 }, 0); // x 11000–11600, inside
    const r90 = addRack(p, 'R90', { x: 11000, y: 3000 }, 90); // x 11000–12070, through the wall
    expect(clearance.check(p).map((x) => x.key)).toEqual([`room:${r90.id}`]);
  });

  it('flags a rack in the notch of an L-shaped room', () => {
    const p = createProject();
    p.room.outline = [
      { x: 0, y: 0 },
      { x: 12000, y: 0 },
      { x: 12000, y: 4000 },
      { x: 6000, y: 4000 },
      { x: 6000, y: 8000 },
      { x: 0, y: 8000 },
    ];
    addRack(p, 'IN', { x: 2000, y: 5000 });
    const notch = addRack(p, 'NOTCH', { x: 8000, y: 5000 });
    const straddle = addRack(p, 'STRADDLE', { x: 5700, y: 5000 }); // x 5700–6300 crosses x = 6000
    expect(keys(clearance.check(p))).toEqual([`room:${notch.id}`, `room:${straddle.id}`].sort());
  });

  it('flags a rack that bridges a gap in a U-shaped room even though every corner is inside', () => {
    const p = createProject();
    // Two arms 1000 wide joined by a bar at the top; the slot between them is x 1000–2000, y 1000–3000.
    p.room.outline = [
      { x: 0, y: 0 },
      { x: 3000, y: 0 },
      { x: 3000, y: 3000 },
      { x: 2000, y: 3000 },
      { x: 2000, y: 1000 },
      { x: 1000, y: 1000 },
      { x: 1000, y: 3000 },
      { x: 0, y: 3000 },
    ];
    const bridge = addRack(p, 'BRIDGE', { x: 965, y: 1500 }, 90); // x 965–2035, y 1500–2100
    const findings = clearance.check(p);
    expect(findings.map((x) => x.key)).toEqual([`room:${bridge.id}`]);
  });

  it('flags a keep-out fully inside the rack and clears a rack in a concave keep-out’s notch', () => {
    const p = createProject();
    const r = addRack(p, 'R', { x: 1000, y: 1000 });
    p.keepouts.push({ id: 'tiny', name: 'tiny', kind: 'custom', outline: box(1200, 1200, 1300, 1300) });
    const notchRack = addRack(p, 'N', { x: 6000, y: 2000 }); // x 6000–6600, y 2000–3070
    p.keepouts.push({
      id: 'L',
      name: 'L',
      kind: 'custom',
      outline: [
        { x: 5000, y: 1000 },
        { x: 8000, y: 1000 },
        { x: 8000, y: 1500 },
        { x: 5500, y: 1500 },
        { x: 5500, y: 5000 },
        { x: 5000, y: 5000 },
      ],
    });
    expect(clearance.check(p).map((x) => x.key)).toEqual([`keepout:${r.id}:tiny`]);
    expect(notchRack.name).toBe('N');
  });
});

// ---------------------------------------------------------------------------
// out-of-sync (real sync module)
// ---------------------------------------------------------------------------

describe('out-of-sync through the sync module', () => {
  const resync = (project: Project): Project =>
    produce(project, (draft) => {
      applySyncPlan(draft, computeSyncPlan(project).changes);
    });

  it('is an error until Update Layout is applied, then clean', () => {
    const f = twoRackFixture();
    routeTwoRacks(f);
    expect(outOfSync.check(f.project)).toHaveLength(1);
    const issues = runDrc(f.project).filter((i) => i.rule === 'out-of-sync');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ id: 'out-of-sync:out-of-sync', severity: 'error', domain: 'drc' });

    const synced = resync(f.project);
    expect(outOfSync.check(synced)).toEqual([]);
    expect(runDrc(synced).some((i) => i.rule === 'out-of-sync')).toBe(false);
  });

  it('flags every schematic edit and nothing for layout-only edits', () => {
    const f = twoRackFixture();
    const synced = resync(f.project);
    const sw1 = synced.components.find((c) => c.ref === 'SW1')!;
    const sw2 = synced.components.find((c) => c.ref === 'SW2')!;

    const schematicEdits: ((d: Project) => void)[] = [
      (d) => {
        d.components.find((c) => c.id === sw1.id)!.ref = 'SW9';
      },
      (d) => {
        d.components.find((c) => c.id === sw1.id)!.footprintDefId = null;
      },
      (d) => {
        // Deleting a device in the schematic takes its links with it.
        d.components = d.components.filter((c) => c.id !== sw2.id);
        d.links = d.links.filter((l) => l.a.componentId !== sw2.id && l.b.componentId !== sw2.id);
      },
      (d) => {
        addDevice(d, 'sym.server-1u', 'SRV1');
      },
      (d) => {
        addLink(d, [d.components[0]!, 'eth1/50'], [d.components[1]!, 'eth1/2']);
      },
      (d) => {
        d.links[0]!.b.portId = 'eth1/3';
      },
      (d) => {
        d.links = [];
      },
    ];
    for (const edit of schematicEdits) {
      const edited = produce(synced, edit);
      expect(outOfSync.check(edited), 'schematic edit should be out of sync').toHaveLength(1);
      expect(outOfSync.check(resync(edited))).toEqual([]);
    }

    const layoutEdits: ((d: Project) => void)[] = [
      (d) => {
        place(d, sw1.id, null, null);
      },
      (d) => {
        addRack(d, 'R03', { x: 8000, y: 1000 });
      },
      (d) => {
        routeTwoRacks({ ...f, project: d });
      },
      (d) => {
        addAccessory(d, d.racks[0]!.id, 'vcm', { side: 'center' });
      },
      (d) => {
        d.links[0]!.cableDefId = 'cbl.om4-duplex';
      },
      (d) => {
        d.links[0]!.label = 'uplink';
      },
    ];
    for (const edit of layoutEdits) {
      expect(outOfSync.check(produce(synced, edit)), 'layout-only edit should stay in sync').toEqual([]);
    }
  });

  it('respects the severity override', () => {
    const f = twoRackFixture();
    f.project.settings.drcSeverities['out-of-sync'] = 'warning';
    expect(runDrc(f.project).find((i) => i.rule === 'out-of-sync')!.severity).toBe('warning');
    f.project.settings.drcSeverities['out-of-sync'] = 'ignore';
    expect(runDrc(fresh(f.project)).some((i) => i.rule === 'out-of-sync')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// unrouted-link
// ---------------------------------------------------------------------------

describe('unrouted-link airwire semantics', () => {
  it('is silent when either end is unplaced and once any route object exists', () => {
    const f = twoRackFixture();
    expect(unroutedLink.check(f.project)).toHaveLength(1);
    place(f.project, f.sw2.id, f.r2.id, null);
    expect(unroutedLink.check(fresh(f.project))).toEqual([]);
    place(f.project, f.sw2.id, f.r2.id, 40);
    addRoute(f.project, f.link.id, []);
    expect(unroutedLink.check(fresh(f.project))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// bend-radius
// ---------------------------------------------------------------------------

describe('bend-radius across segment joins', () => {
  it('finds the same corners whether the polyline is one segment or split at the corner', () => {
    const one = twoRackFixture();
    addRoute(one.project, one.link.id, [
      { layer: 'overhead', trayId: one.tray.id, points: [{ x: 1150, y: 500 }, { x: 1160, y: 500 }, { x: 1160, y: 520 }, { x: 4150, y: 520 }] },
    ]);
    const split = twoRackFixture();
    addRoute(split.project, split.link.id, [
      { layer: 'overhead', trayId: split.tray.id, points: [{ x: 1150, y: 500 }, { x: 1160, y: 500 }] },
      { layer: 'overhead', trayId: split.tray.id, points: [{ x: 1160, y: 520 }, { x: 4150, y: 520 }] },
    ]);
    const joined = twoRackFixture();
    addRoute(joined.project, joined.link.id, [
      { layer: 'overhead', trayId: joined.tray.id, points: [{ x: 1150, y: 500 }, { x: 1160, y: 500 }] },
      { layer: 'overhead', trayId: joined.tray.id, points: [{ x: 1160, y: 500 }, { x: 1160, y: 520 }, { x: 4150, y: 520 }] },
    ]);
    const expected = bendRadius.check(one.project);
    expect(expected).toHaveLength(1);
    expect(expected[0]!.message).toContain('2 corners');
    expect(bendRadius.check(split.project).map((x) => x.message)).toEqual(expected.map((x) => x.message));
    expect(bendRadius.check(joined.project).map((x) => x.message)).toEqual(expected.map((x) => x.message));
  });

  it('does not fold a layer change (a vertical drop) into a floor-plan corner', () => {
    const f = twoRackFixture();
    // Overhead run ends at (2000,500); the cable drops to the floor and continues underfloor at right angles.
    // The turn happens across the vertical, not in the tray, so no tray corner is tight.
    addRoute(f.project, f.link.id, [
      { layer: 'overhead', trayId: f.tray.id, points: [{ x: 1150, y: 500 }, { x: 2000, y: 500 }] },
      { layer: 'underfloor', points: [{ x: 2000, y: 500 }, { x: 2000, y: 510 }, { x: 2000, y: 2000 }] },
    ]);
    expect(bendRadius.check(f.project)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// tray-overfill
// ---------------------------------------------------------------------------

describe('tray-overfill threshold', () => {
  it('warns only strictly above the configured fraction', () => {
    const f = twoRackFixture();
    routeTwoRacks(f);
    const fill = trayFill(f.project, f.tray.id)!;
    expect(fill.fraction).toBeGreaterThan(0);
    f.project.settings.trayFillWarn = fill.fraction;
    expect(trayOverfill.check(fresh(f.project))).toEqual([]);
    f.project.settings.trayFillWarn = fill.fraction - 1e-9;
    expect(trayOverfill.check(fresh(f.project)).map((x) => x.key)).toEqual([f.tray.id]);
  });
});

// ---------------------------------------------------------------------------
// misc placement edge cases
// ---------------------------------------------------------------------------

describe('placement edge cases', () => {
  it('u-collision uses heights from custom-catalog footprints', () => {
    const p = createProject();
    const base = builtinCatalog.footprints.find((x) => x.id === 'fp.server-1u')!;
    p.customCatalog.footprints.push({ ...base, id: 'fp.custom-3u', model: 'Custom 3U', heightU: 3 });
    const r = addRack(p, 'R01', { x: 0, y: 0 });
    const c = addDevice(p, 'sym.server-1u', 'SRV1', { rackId: r.id, u: 40 });
    c.footprintDefId = 'fp.custom-3u'; // 40–42
    expect(uCollision.check(fresh(p))).toEqual([]);
    place(p, c.id, r.id, 41); // 41–43
    expect(uCollision.check(fresh(p)).map((x) => x.key)).toEqual([`overflow:${c.id}`]);
  });

  it('unplaced-component flags a rack with no U as unplaced', () => {
    const f = twoRackFixture();
    place(f.project, f.sw1.id, f.r1.id, null);
    expect(unplacedComponent.check(fresh(f.project)).map((x) => x.key)).toEqual([f.sw1.id]);
  });

  it('reach-exceeded is silent when a routed link has an unplaced end', () => {
    const f = twoRackFixture({ rack2X: 116000 });
    routeTwoRacks(f);
    place(f.project, f.sw2.id, null, null);
    expect(reachExceeded.check(fresh(f.project))).toEqual([]);
  });
});
