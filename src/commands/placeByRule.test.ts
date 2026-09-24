import { describe, expect, it } from 'vitest';
import { drcRuleById } from '@/model/drc';
import { createProject } from '@/model/factories';
import { addDevice, addRack } from '@/model/routing/test-fixtures';
import type { Project } from '@/model/types';
import { emptyHistory, executeCommand, undoCommand } from '@/store/commands';
import { placeByRule } from './layout';
import { matchCandidates, matchRacks, planPlaceByRule } from './placeByRule';

const uCollision = drcRuleById('u-collision')!;

function project(): Project {
  return createProject('t', '2026-01-01T00:00:00.000Z');
}

describe('matchRacks / matchCandidates', () => {
  it('filters by row and name globs, sorted naturally', () => {
    const p = project();
    const r10 = addRack(p, 'R10', { x: 0, y: 0 });
    const r2 = addRack(p, 'R2', { x: 0, y: 0 });
    const r1 = addRack(p, 'R1', { x: 0, y: 0 });
    r1.row = 'A';
    r2.row = 'a';
    r10.row = 'B';
    expect(matchRacks(p).map((r) => r.name)).toEqual(['R1', 'R2', 'R10']);
    expect(matchRacks(p, { row: 'A' }).map((r) => r.name)).toEqual(['R1', 'R2']);
    expect(matchRacks(p, { names: ['R1?'] }).map((r) => r.name)).toEqual(['R10']);
    expect(matchRacks(p, { names: ['R1', 'R10'], row: 'B' }).map((r) => r.name)).toEqual(['R10']);

    const rack = addRack(p, 'R99', { x: 0, y: 0 });
    addDevice(p, 'sym.server-1u', 'SRV10');
    addDevice(p, 'sym.server-1u', 'SRV2');
    addDevice(p, 'sym.leaf-switch-48x25-8x100', 'SW1').value = 'leaf-a';
    addDevice(p, 'sym.leaf-switch-48x25-8x100', 'SW2', { rackId: rack.id, u: 42 }).value = 'spine';
    expect(matchCandidates(p, { refGlob: 'SRV*' }).map((c) => c.ref)).toEqual(['SRV2', 'SRV10']);
    expect(matchCandidates(p, { refGlob: 'SW*', role: 'leaf*' }).map((c) => c.ref)).toEqual(['SW1']);
    expect(matchCandidates(p, { refGlob: 'SW*' }).map((c) => c.ref)).toEqual(['SW1']); // SW2 is placed
    expect(matchCandidates(p, { refGlob: 'SW*', includePlaced: true }).map((c) => c.ref)).toEqual(['SW1', 'SW2']);
  });
});

describe('planPlaceByRule', () => {
  it('fill-bottom-up packs devices around what is already there, without collisions', () => {
    const p = project();
    const r1 = addRack(p, 'R01', { x: 0, y: 0 });
    const r2 = addRack(p, 'R02', { x: 1000, y: 0 });
    for (const r of [r1, r2]) r.row = 'A';
    addDevice(p, 'sym.leaf-switch-48x25-8x100', 'SW1', { rackId: r1.id, u: 1 }); // U1 taken
    addDevice(p, 'sym.spine-switch-32x400', 'SW2', { rackId: r1.id, u: 3 }); // U3–U4 taken
    const servers = Array.from({ length: 6 }, (_, i) => addDevice(p, 'sym.server-1u', `SRV${i + 1}`));
    const big = addDevice(p, 'sym.gpu-server-4u', 'SRV7'); // 4U

    const plan = planPlaceByRule(p, { refGlob: 'SRV*', rackFilter: { row: 'A' }, mode: 'fill-bottom-up' });
    expect(plan.skipped).toEqual([]);
    expect(plan.rackIds).toEqual([r1.id, r2.id]);
    // Gaps first: U2, then U5.. (U3–U4 is the spine), all in R01.
    const byRef = Object.fromEntries(plan.placements.map((x) => [x.ref, x]));
    expect(byRef['SRV1']).toMatchObject({ rackId: r1.id, uPosition: 2, heightU: 1 });
    expect(byRef['SRV2']).toMatchObject({ rackId: r1.id, uPosition: 5 });
    expect(byRef['SRV6']).toMatchObject({ rackId: r1.id, uPosition: 9 });
    expect(byRef['SRV7']).toMatchObject({ rackId: r1.id, uPosition: 10, heightU: 4, face: 'front' });
    expect(plan.candidateIds).toEqual([...servers, big].map((c) => c.id));

    const cmd = placeByRule({ refGlob: 'SRV*', rackFilter: { row: 'A' }, mode: 'fill-bottom-up' });
    const r = executeCommand(p, emptyHistory(), cmd);
    expect(cmd.result?.placements).toHaveLength(7);
    expect(uCollision.check(r.project)).toEqual([]);
    for (const x of cmd.result!.placements) {
      expect(r.project.placements.find((pl) => pl.componentId === x.componentId)).toMatchObject({ rackId: x.rackId, uPosition: x.uPosition });
    }
    const u = undoCommand(r.project, r.history, 'layout');
    expect(u.project.placements.filter((pl) => pl.rackId !== null)).toHaveLength(2);
  });

  it('spills into the next rack and reports what does not fit', () => {
    const p = project();
    const r1 = addRack(p, 'R01', { x: 0, y: 0 });
    const r2 = addRack(p, 'R02', { x: 1000, y: 0 });
    // 42U racks: 41 free in R01 (U42 taken), 42 in R02 → room for 83 1U servers.
    addDevice(p, 'sym.leaf-switch-48x25-8x100', 'SW1', { rackId: r1.id, u: 42 });
    for (let i = 1; i <= 85; i++) addDevice(p, 'sym.server-1u', `SRV${i}`);
    const plan = planPlaceByRule(p, { refGlob: 'SRV*', mode: 'fill-bottom-up' });
    expect(plan.placements).toHaveLength(83);
    expect(plan.placements.filter((x) => x.rackId === r1.id)).toHaveLength(41);
    expect(plan.placements.filter((x) => x.rackId === r2.id)).toHaveLength(42);
    expect(plan.skipped.map((s) => [s.ref, s.reason])).toEqual([
      ['SRV84', 'no-space'],
      ['SRV85', 'no-space'],
    ]);
    const r = executeCommand(p, emptyHistory(), placeByRule({ refGlob: 'SRV*', mode: 'fill-bottom-up' }));
    expect(uCollision.check(r.project)).toEqual([]);
  });

  it('fill-top-down packs from the top; fixed-u takes one device per rack', () => {
    const p = project();
    const r1 = addRack(p, 'R01', { x: 0, y: 0 });
    const r2 = addRack(p, 'R02', { x: 1000, y: 0 });
    const r3 = addRack(p, 'R03', { x: 2000, y: 0 });
    addDevice(p, 'sym.server-2u', 'SRV1');
    addDevice(p, 'sym.server-1u', 'SRV2');
    const top = planPlaceByRule(p, { refGlob: 'SRV*', mode: 'fill-top-down', rackFilter: { names: ['R01'] } });
    expect(top.placements.map((x) => [x.ref, x.uPosition])).toEqual([
      ['SRV1', 41], // 2U at U41–U42
      ['SRV2', 40],
    ]);

    for (let i = 1; i <= 4; i++) addDevice(p, 'sym.leaf-switch-48x25-8x100', `SW${i}`).value = 'leaf';
    addDevice(p, 'sym.leaf-switch-48x25-8x100', 'SW9', { rackId: r2.id, u: 42 }).value = 'other';
    const fixed = planPlaceByRule(p, { refGlob: 'SW*', role: 'leaf', mode: 'fixed-u', u: 42, face: 'rear' });
    // R02's U42 is taken, so the leafs land in R01 and R03; two are left over.
    expect(fixed.placements.map((x) => [x.ref, x.rackId, x.uPosition, x.face])).toEqual([
      ['SW1', r1.id, 42, 'rear'],
      ['SW2', r3.id, 42, 'rear'],
    ]);
    expect(fixed.skipped.map((s) => [s.ref, s.reason])).toEqual([
      ['SW3', 'no-space'],
      ['SW4', 'no-space'],
    ]);
    expect(() => planPlaceByRule(p, { refGlob: 'SW*', mode: 'fixed-u' })).toThrow(/U position/);
    expect(() => planPlaceByRule(p, { refGlob: ' ', mode: 'fill-bottom-up' })).toThrow(/ref pattern/);
    const none = planPlaceByRule(p, { refGlob: 'SRV*', mode: 'fill-bottom-up', rackFilter: { row: 'Z' } });
    expect(none.placements).toEqual([]);
    expect(none.skipped.every((s) => s.reason === 'no-rack')).toBe(true);
  });

  it('includePlaced re-packs placed devices from the bottom', () => {
    const p = project();
    const r1 = addRack(p, 'R01', { x: 0, y: 0 });
    addDevice(p, 'sym.server-1u', 'SRV1', { rackId: r1.id, u: 30 });
    addDevice(p, 'sym.server-1u', 'SRV2', { rackId: r1.id, u: 10 });
    addDevice(p, 'sym.server-1u', 'SRV3');
    const plan = planPlaceByRule(p, { refGlob: 'SRV*', mode: 'fill-bottom-up', includePlaced: true });
    expect(plan.placements.map((x) => [x.ref, x.uPosition])).toEqual([
      ['SRV1', 1],
      ['SRV2', 2],
      ['SRV3', 3],
    ]);
    const r = executeCommand(p, emptyHistory(), placeByRule({ refGlob: 'SRV*', mode: 'fill-bottom-up', includePlaced: true }));
    expect(r.project.placements.map((pl) => pl.uPosition)).toEqual([1, 2, 3]);
    expect(uCollision.check(r.project)).toEqual([]);
  });
});
