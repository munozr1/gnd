import { describe, expect, it } from 'vitest';
import { buildPodProject } from '@/model/demo';
import { CABLE_SCHEDULE_HEADER, cableScheduleCableRows, cableScheduleCsv, cableScheduleRows } from './cableSchedule';
import { parseCsv } from './csv';
import { addTrunk, routeJacket, trunkFixture } from './test-fixtures';

const byRow = (csv: string) => {
  const [header, ...rows] = parseCsv(csv);
  const col = (name: string): number => header!.indexOf(name);
  return { header: header!, rows, cell: (row: string[], name: string) => row[col(name)] };
};

describe('cableScheduleRows (plain links)', () => {
  it('lists every link of the demo pod, unrouted ones estimated, and never a cable-owned link', () => {
    const p = buildPodProject();
    const rows = cableScheduleRows(p);
    expect(rows).toHaveLength(p.links.length);
    expect(rows.filter((r) => r.basis === 'routed')).toHaveLength(Object.keys(p.routes).length);
    expect(rows.every((r) => r.lengthM !== null && r.a.rack !== '' && r.b.rack !== '')).toBe(true);
  });

  it('skips the links an installed cable owns, so the trunk is reported once', () => {
    const { project, link } = trunkFixture();
    expect(project.links).toHaveLength(5);
    const rows = cableScheduleRows(project);
    expect(rows.map((r) => r.id)).toEqual([link.id]);
    expect(rows[0]).toMatchObject({ cable: 'OM4 MPO trunk', basis: 'estimated', a: { ref: 'SW1', portLabel: 'eth1/49' }, b: { ref: 'SW2', portLabel: 'eth1/1' } });
  });
});

describe('cableScheduleCableRows', () => {
  it('one row per cable with definition, fibers, channels, kind, both sides and length, plus one sub-row per leg', () => {
    const f = trunkFixture();
    const project = routeJacket(f.project, f.cable.id);
    const rows = cableScheduleCableRows(project);
    expect(rows).toHaveLength(1);
    const c = rows[0]!;
    expect(c).toMatchObject({
      id: f.cable.id,
      label: 'CBL1',
      cable: '8F OM4 MPO-8 → 4×LC-duplex',
      fiberCount: 8,
      channels: 4,
      kind: 'trunk',
      sideA: 'MPO-8 → SW1:eth1/50',
      sideB: '4×LC-duplex → PP1:f1–f4',
      aPorts: 'eth1/50',
      bPorts: 'f1–f4',
      basis: 'routed',
      layerPath: 'in-rack→overhead→in-rack',
      routed: true,
      needsReview: false,
    });
    expect(c.a).toMatchObject({ rack: 'R01', uLabel: 'U40', ref: 'SW1', optic: '100G-SR4' });
    expect(c.b).toMatchObject({ rack: 'R02', uLabel: 'U10', ref: 'PP1' });
    expect(c.lengthM).toBeGreaterThan(0);
    expect(c.legs.map((l) => [l.side, l.label, l.connector, l.port, l.positions, l.channels])).toEqual([
      ['A', 'A', 'MPO-8', 'SW1:eth1/50', '1-4, 9-12', '1-4'],
      ['B', '1', 'LC-duplex', 'PP1:f1', '1-2', '1'],
      ['B', '2', 'LC-duplex', 'PP1:f2', '1-2', '2'],
      ['B', '3', 'LC-duplex', 'PP1:f3', '1-2', '3'],
      ['B', '4', 'LC-duplex', 'PP1:f4', '1-2', '4'],
    ]);
    expect(c.legs[1]!.end).toMatchObject({ rack: 'R02', uLabel: 'U10', ref: 'PP1', portLabel: 'f1' });
  });

  it('uses the declared length when set and reports the estimate / nothing otherwise', () => {
    const f = trunkFixture();
    const declared = addTrunk(f.project, 'CBL2', { sw: f.sw1, portA: 'eth1/51', panel: f.panel, firstB: 'f5', lengthM: 5 });
    const partial = addTrunk(declared.project, 'CBL3', { sw: f.sw1, portA: 'eth1/52', panel: f.panel });
    const rows = cableScheduleCableRows(partial.project);
    expect(rows.map((r) => [r.label, r.basis, r.lengthM, r.layerPath, r.routed])).toEqual([
      ['CBL1', 'estimated', expect.any(Number), '', false],
      ['CBL2', 'declared', 5, '', false],
      ['CBL3', '', null, '', false],
    ]);
    expect(rows[2]).toMatchObject({ sideB: '4×LC-duplex → unassigned', b: null, bPorts: '' });
    expect(rows[2]!.legs.slice(1).every((l) => l.port === '' && l.end === null)).toBe(true);
  });
});

describe('cableScheduleCsv', () => {
  it('keeps the plain-link columns, then appends the cable rows and their leg sub-rows', () => {
    const f = trunkFixture();
    const project = routeJacket(f.project, f.cable.id);
    const { header, rows, cell } = byRow(cableScheduleCsv(project));
    expect(header).toEqual([...CABLE_SCHEDULE_HEADER]);
    expect(header.slice(0, 16)).toEqual([
      'Label', 'A rack', 'A U', 'A ref', 'A port', 'A optic', 'B rack', 'B U', 'B ref', 'B port', 'B optic',
      'Cable', 'Length (m)', 'Length basis', 'Layer path', 'Needs review',
    ]);
    expect(rows.map((r) => cell(r, 'Row'))).toEqual(['link', 'cable', 'leg', 'leg', 'leg', 'leg', 'leg']);
    expect(rows.every((r) => r.length === header.length)).toBe(true);

    const link = rows[0]!;
    expect([cell(link, 'Label'), cell(link, 'A ref'), cell(link, 'A port'), cell(link, 'B ref'), cell(link, 'B port'), cell(link, 'Cable'), cell(link, 'Length basis')]).toEqual([
      'SW1:eth1/49 — SW2:eth1/1', 'SW1', 'eth1/49', 'SW2', 'eth1/1', 'OM4 MPO trunk', 'estimated',
    ]);
    expect(link.slice(17).every((c) => c === '')).toBe(true);

    const cable = rows[1]!;
    expect([cell(cable, 'Label'), cell(cable, 'A rack'), cell(cable, 'A U'), cell(cable, 'A ref'), cell(cable, 'A port'), cell(cable, 'A optic')]).toEqual(['CBL1', 'R01', 'U40', 'SW1', 'eth1/50', '100G-SR4']);
    expect([cell(cable, 'B rack'), cell(cable, 'B U'), cell(cable, 'B ref'), cell(cable, 'B port'), cell(cable, 'B optic')]).toEqual(['R02', 'U10', 'PP1', 'f1–f4', '']);
    expect([cell(cable, 'Cable'), cell(cable, 'Fibers'), cell(cable, 'Channels'), cell(cable, 'Kind'), cell(cable, 'Side A'), cell(cable, 'Side B')]).toEqual([
      '8F OM4 MPO-8 → 4×LC-duplex', '8', '4', 'trunk', 'MPO-8 → SW1:eth1/50', '4×LC-duplex → PP1:f1–f4',
    ]);
    expect([cell(cable, 'Length basis'), cell(cable, 'Layer path'), cell(cable, 'Needs review')]).toEqual(['routed', 'in-rack→overhead→in-rack', 'no']);
    expect(Number(cell(cable, 'Length (m)'))).toBeGreaterThan(0);

    const legA = rows[2]!;
    expect([cell(legA, 'Label'), cell(legA, 'A ref'), cell(legA, 'A port'), cell(legA, 'B ref'), cell(legA, 'Cable'), cell(legA, 'Leg'), cell(legA, 'Leg side'), cell(legA, 'Leg port'), cell(legA, 'Fibers carried'), cell(legA, 'Leg channels')]).toEqual([
      'CBL1', 'SW1', 'eth1/50', '', 'MPO-8', 'A', 'A', 'SW1:eth1/50', '1-4, 9-12', '1-4',
    ]);
    const leg3 = rows[5]!;
    expect([cell(leg3, 'A ref'), cell(leg3, 'B rack'), cell(leg3, 'B U'), cell(leg3, 'B ref'), cell(leg3, 'B port'), cell(leg3, 'Cable'), cell(leg3, 'Leg'), cell(leg3, 'Leg side'), cell(leg3, 'Leg port'), cell(leg3, 'Fibers carried'), cell(leg3, 'Leg channels')]).toEqual([
      '', 'R02', 'U10', 'PP1', 'f3', 'LC-duplex', '3', 'B', 'PP1:f3', '1-2', '3',
    ]);
    expect(cell(leg3, 'Length (m)')).toBe('');
  });
});
