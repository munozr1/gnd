import { describe, expect, it } from 'vitest';
import { buildPodProject } from '@/model/demo';
import { BOM_HEADER, bomCsv, bomSections } from './bom';
import { parseCsv } from './csv';
import { addTrunk, routeJacket, trunkFixture } from './test-fixtures';

const cables = (rows: ReturnType<typeof bomSections>) => rows.find((s) => s.id === 'cables')!.rows;

describe('bomSections — cables', () => {
  it('counts every demo-pod link under its cable type × standard length', () => {
    const p = buildPodProject();
    const rows = cables(bomSections(p));
    expect(rows.reduce((n, r) => n + r.quantity, 0)).toBe(p.links.length);
    expect(rows.every((r) => r.lengthLabel === undefined)).toBe(true);
  });

  it('groups installed cables by full definition × length and drops their links from the plain section', () => {
    const f = trunkFixture();
    // CBL1 routed, CBL2 declared 5 m, CBL4 declared 5 m, CBL3 unplugged on side B (no length).
    let project = routeJacket(f.project, f.cable.id);
    project = addTrunk(project, 'CBL2', { sw: f.sw1, portA: 'eth1/51', panel: f.panel, firstB: 'f5', lengthM: 5 }).project;
    project = addTrunk(project, 'CBL3', { sw: f.sw1, portA: 'eth1/52', panel: f.panel }).project;
    project = addTrunk(project, 'CBL4', { sw: f.sw1, portA: 'eth1/53', panel: f.panel, firstB: 'f9', lengthM: 5 }).project;
    expect(project.links.length).toBe(1 + 4 + 4 + 4);

    const rows = cables(bomSections(project));
    const plain = rows.filter((r) => r.item === 'OM4 MPO trunk');
    expect(plain).toEqual([{ item: 'OM4 MPO trunk', quantity: 1, lengthM: expect.any(Number), notes: 'OM4; 1 estimated' }]);

    const trunks = rows.filter((r) => r.item === '8F OM4 MPO-8 → 4×LC-duplex');
    expect(trunks.map((r) => [r.quantity, r.lengthM, r.lengthLabel, r.notes])).toEqual([
      [2, 5, undefined, 'OM4, trunk (breakout); 2 declared; CBL2, CBL4'],
      [1, expect.any(Number), undefined, 'OM4, trunk (breakout); 1 routed; CBL1'],
      [1, null, 'unspecified', 'OM4, trunk (breakout); 1 with no declared or routed length; CBL3'],
    ]);
    // Declared 5 m sorts before the routed standard length (> 5 m for two racks 3 m apart with slack) and 'unspecified' last.
    expect(trunks[1]!.lengthM!).toBeGreaterThan(5);
    expect(rows.reduce((n, r) => n + r.quantity, 0)).toBe(1 + 4);
  });

  it('an unrouted, undeclared cable is "unspecified", never an estimate', () => {
    const { project } = trunkFixture();
    const row = cables(bomSections(project)).find((r) => r.item === '8F OM4 MPO-8 → 4×LC-duplex')!;
    expect(row).toMatchObject({ quantity: 1, lengthM: null, lengthLabel: 'unspecified' });
  });

  it('a cable whose definition is gone is still counted, by its definition id', () => {
    const { project, cable } = trunkFixture();
    const orphan = { ...project, cables: project.cables.map((c) => (c.id === cable.id ? { ...c, cableDefId: 'cbl.gone', lengthM: 3 } : c)) };
    const row = cables(bomSections(orphan)).find((r) => r.item === 'cbl.gone')!;
    expect(row).toEqual({ item: 'cbl.gone', quantity: 1, lengthM: 3, notes: 'unknown cable definition; 1 declared; CBL1' });
  });
});

describe('bomCsv', () => {
  it('prints the length label for unspecified lengths and numbers otherwise', () => {
    const f = trunkFixture();
    const project = addTrunk(f.project, 'CBL2', { sw: f.sw1, portA: 'eth1/51', panel: f.panel, firstB: 'f5', lengthM: 5 }).project;
    const [header, ...rows] = parseCsv(bomCsv(project));
    expect(header).toEqual([...BOM_HEADER]);
    const trunkRows = rows.filter((r) => r[0] === 'Cables' && r[1] === '8F OM4 MPO-8 → 4×LC-duplex');
    expect(trunkRows.map((r) => [r[2], r[3]])).toEqual([
      ['1', '5'],
      ['1', 'unspecified'],
    ]);
  });
});
