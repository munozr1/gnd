import { describe, expect, it } from 'vitest';
import { buildPodProject } from '@/model/demo';
import { CABLE_LABELS_HEADER, cableLabelRows, cableLabelsCsv } from './cableLabels';
import { parseCsv } from './csv';
import { addTrunk, routeJacket, trunkFixture } from './test-fixtures';

describe('cableLabelRows', () => {
  it('two rows per plain link, near → far', () => {
    const p = buildPodProject();
    const rows = cableLabelRows(p);
    expect(rows).toHaveLength(p.links.length * 2);
    expect(rows.every((r) => r.kind === 'link')).toBe(true);
    const [a, b] = rows;
    expect(a!.linkId).toBe(b!.linkId);
    expect(a!.text).toBe(`${a!.from} → ${a!.to}`);
    expect([b!.from, b!.to]).toEqual([a!.to, a!.from]);
  });

  it('an installed trunk: one label per jacket end and one per leg end; its links get no rows of their own', () => {
    const f = trunkFixture();
    const project = routeJacket(f.project, f.cable.id);
    const rows = cableLabelRows(project);
    expect(rows.filter((r) => r.kind === 'link')).toHaveLength(2);
    const cable = rows.filter((r) => r.linkId === f.cable.id);
    expect(cable.map((r) => [r.kind, r.end, r.text])).toEqual([
      ['jacket', 'A', 'CBL1 A SW1:eth1/50 → PP1:f1–f4'],
      ['jacket', 'B', 'CBL1 B PP1:f1–f4 → SW1:eth1/50'],
      ['leg', 'AA', 'CBL1 AA → SW1:eth1/50'],
      ['leg', 'B1', 'CBL1 B1 → PP1:f1'],
      ['leg', 'B2', 'CBL1 B2 → PP1:f2'],
      ['leg', 'B3', 'CBL1 B3 → PP1:f3'],
      ['leg', 'B4', 'CBL1 B4 → PP1:f4'],
    ]);
    expect(cable[0]).toMatchObject({ cable: 'CBL1', from: 'SW1:eth1/50', fromLocation: 'R01 U40', to: 'PP1:f1–f4', toLocation: 'R02 U10' });
    expect(cable[4]).toMatchObject({ from: 'PP1:f2', fromLocation: 'R02 U10', to: 'SW1:eth1/50', toLocation: 'R01 U40' });
    expect(cable.every((r) => r.lengthM === cable[0]!.lengthM && r.lengthM! > 0)).toBe(true);
  });

  it('unassigned legs are labelled as such and a declared length is used', () => {
    const f = trunkFixture();
    const { project, cable } = addTrunk(f.project, 'CBL3', { sw: f.sw1, portA: 'eth1/52', panel: f.panel, lengthM: 7 });
    const rows = cableLabelRows(project).filter((r) => r.linkId === cable.id);
    expect(rows.map((r) => r.text)).toEqual([
      'CBL3 A SW1:eth1/52 → unassigned',
      'CBL3 B unassigned → SW1:eth1/52',
      'CBL3 AA → SW1:eth1/52',
      'CBL3 B1 → unassigned',
      'CBL3 B2 → unassigned',
      'CBL3 B3 → unassigned',
      'CBL3 B4 → unassigned',
    ]);
    expect(rows[3]).toMatchObject({ from: '', fromLocation: '', to: 'SW1:eth1/52', toLocation: 'R01 U40', lengthM: 7 });
  });
});

describe('cableLabelsCsv', () => {
  it('keeps the original columns and appends the row kind', () => {
    const f = trunkFixture();
    const [header, ...rows] = parseCsv(cableLabelsCsv(f.project));
    expect(header).toEqual([...CABLE_LABELS_HEADER]);
    expect(header!.slice(0, 8)).toEqual(['Cable', 'End', 'Label', 'From', 'From location', 'To', 'To location', 'Length (m)']);
    expect(rows.map((r) => r[8])).toEqual(['link', 'link', 'jacket', 'jacket', 'leg', 'leg', 'leg', 'leg', 'leg']);
    expect(rows[5]).toEqual(['CBL1', 'B1', 'CBL1 B1 → PP1:f1', 'PP1:f1', 'R02 U10', 'SW1:eth1/50', 'R01 U40', expect.any(String), 'leg']);
  });
});
