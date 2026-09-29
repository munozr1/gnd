import { describe, expect, it } from 'vitest';
import * as cables from '@/commands/cables';
import { finishRoute } from '@/commands/layout';
import { placedTrunkFixture, run, trunkFixture, type PlacedTrunkFixture } from '@/model/erc/rules/cable-fixtures';
import { routedLengthM } from '@/model/routing/length';
import { dist3, portWorldPos } from '@/model/routing/positions';
import { runDrc } from '../index';
import { cableLengthShort } from './cable-length-short';

/** Straight-line run (m) from SW1 eth1/49 to a panel port. */
const runTo = (f: PlacedTrunkFixture, portId: string): number =>
  dist3(portWorldPos(f.project, f.leaf, 'eth1/49')!, portWorldPos(f.project, f.panel, portId)!) / 1000;

/** The jacket route of the placed fixture: over the row at y = 500 from above R01 to above R02. */
const jacketRoute = (f: PlacedTrunkFixture) =>
  finishRoute(f.cable, [{ layer: 'overhead', trayId: null, points: [{ x: 1150, y: 500 }, { x: f.project.racks[1]!.pos.x + 150, y: 500 }] }]);

describe('cable-length-short', () => {
  it('warns per leg when the declared length plus the breakout cannot span the racks', () => {
    const f = placedTrunkFixture();
    const project = run(f.project, cables.setCableLength(f.cable, 2));
    const straight = runTo(f, 'f1');
    expect(straight).toBeGreaterThan(2.5);
    const findings = cableLengthShort.check(project);
    expect(findings.map((x) => x.key)).toEqual(['B0', 'B1', 'B2', 'B3'].map((leg) => `${f.cable}:${leg}`));
    expect(findings[0]!.message).toBe(
      `T-1: 2 m declared jacket + 0.5 m breakout is shorter than the ${Math.round(straight * 100) / 100} m straight run from SW1:eth1/49 to PP1:f1 (side B leg 1)`,
    );
    expect(findings[3]!.message).toContain('to PP1:f4 (side B leg 4)');
    expect(findings[0]!.targets).toEqual([
      { kind: 'cable', id: f.cable },
      { kind: 'component', id: f.panel, portId: 'f1' },
    ]);
    const issues = runDrc(project).filter((i) => i.rule === 'cable-length-short');
    expect(issues).toHaveLength(4);
    expect(issues[0]).toMatchObject({ id: `cable-length-short:${f.cable}:B0`, severity: 'warning', domain: 'drc' });
  });

  it('is clean with a long enough declared length, without any length, or when an end is unplaced', () => {
    const f = placedTrunkFixture();
    expect(cableLengthShort.check(run(f.project, cables.setCableLength(f.cable, 10)))).toEqual([]);
    expect(cableLengthShort.check(f.project)).toEqual([]);
    const unplaced = trunkFixture();
    expect(cableLengthShort.check(run(unplaced.project, cables.setCableLength(unplaced.cable, 0.1)))).toEqual([]);
  });

  it('uses the routed jacket rather than the declared length', () => {
    const f = placedTrunkFixture();
    const project = run(f.project, cables.setCableLength(f.cable, 1), jacketRoute(f));
    const routed = routedLengthM(project, f.cable)!;
    expect(routed.rawM + 0.5).toBeGreaterThan(runTo(f, 'f4'));
    expect(cableLengthShort.check(project)).toEqual([]);
  });

  it('flags a routed jacket whose pinned furcation leaves the legs short of the panel', () => {
    const f = placedTrunkFixture({ rack2X: 9000 });
    // The furcation is pinned beside R01 and the jacket routed straight down to it, so the 0.5 m legs cannot reach R02, 8 m away.
    const project = run(
      f.project,
      cables.setFurcation(f.cable, 'B', { x: 1200, y: 900 }),
      finishRoute(f.cable, [{ layer: 'overhead', trayId: null, points: [{ x: 1150, y: 500 }, { x: 1200, y: 500 }] }]),
    );
    const routed = routedLengthM(project, f.cable)!;
    expect(routed.rawM + 0.5).toBeLessThan(runTo(f, 'f1'));
    const findings = cableLengthShort.check(project);
    expect(findings).toHaveLength(4);
    expect(findings[0]!.message).toMatch(/^T-1: [\d.]+ m routed jacket \+ 0\.5 m breakout is shorter than the [\d.]+ m straight run from SW1:eth1\/49 to PP1:f1 \(side B leg 1\)$/);
  });

  it('omits the breakout for a straight cord and names only the legs out of reach', () => {
    const f = placedTrunkFixture();
    // Unplug leg 4: three legs remain; a declared length just short of leg 1's run reaches none of them.
    const project = run(f.project, cables.unplugLeg(f.cable, 'B', 3), cables.setCableLength(f.cable, 1));
    expect(cableLengthShort.check(project).map((x) => x.key)).toEqual(['B0', 'B1', 'B2'].map((leg) => `${f.cable}:${leg}`));
  });
});
