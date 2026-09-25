import { describe, expect, it } from 'vitest';
import { indexProject } from '@/model/query';
import { compactNumbers, compactPorts, installedCable, installedCables } from './cableInstances';
import { addTrunk, routeJacket, trunkFixture } from './test-fixtures';

describe('compactNumbers / compactPorts', () => {
  it('collapses runs into ASCII ranges and keeps singles', () => {
    expect(compactNumbers([1, 2, 3, 4, 9, 10, 11, 12])).toBe('1-4, 9-12');
    expect(compactNumbers([2])).toBe('2');
    expect(compactNumbers([3, 1, 2, 7, 7])).toBe('1-3, 7');
    expect(compactNumbers([])).toBe('');
  });

  it('collapses consecutive ports on one device, with or without the ref', () => {
    const ends = ['f1', 'f2', 'f3', 'f4', 'f7'].map((portLabel) => ({ ref: 'PP1', portLabel }));
    expect(compactPorts(ends)).toBe('PP1:f1–f4, PP1:f7');
    expect(compactPorts(ends, { withRef: false })).toBe('f1–f4, f7');
    expect(compactPorts([{ ref: 'SW1', portLabel: 'eth1/49' }, { ref: 'SW1', portLabel: 'eth1/50' }, { ref: 'SW2', portLabel: 'eth1/1' }])).toBe('SW1:eth1/49–eth1/50, SW2:eth1/1');
    expect(compactPorts([{ ref: 'SW1', portLabel: 'eth1/49.0' }, { ref: 'SW1', portLabel: 'eth1/49.2' }])).toBe('SW1:eth1/49.0, SW1:eth1/49.2');
    expect(compactPorts([])).toBe('');
  });
});

describe('installedCable', () => {
  it('describes the trunk: definition, legs with ports / positions / channels, side summaries', () => {
    const { project, cable, sw1 } = trunkFixture();
    const c = installedCable(project, cable);
    expect(c.name).toBe('8F OM4 MPO-8 → 4×LC-duplex');
    expect(c.fiberCount).toBe(8);
    expect(c.channels).toBe(4);
    expect(c.kind).toBe('trunk');
    expect(c.legs.map((l) => [l.side, l.label, l.connector, l.port, l.positions, l.channels])).toEqual([
      ['A', 'A', 'MPO-8', 'SW1:eth1/50', [1, 2, 3, 4, 9, 10, 11, 12], [1, 2, 3, 4]],
      ['B', '1', 'LC-duplex', 'PP1:f1', [1, 2], [1]],
      ['B', '2', 'LC-duplex', 'PP1:f2', [1, 2], [2]],
      ['B', '3', 'LC-duplex', 'PP1:f3', [1, 2], [3]],
      ['B', '4', 'LC-duplex', 'PP1:f4', [1, 2], [4]],
    ]);
    // The leg channels agree with the lane links the cable owns (lane k ↔ channel k + 1 ↔ f(k + 1)).
    const links = indexProject(project).linksOfCable(cable.id);
    expect(links.map((l) => [l.a.lane, l.b.portId]).sort()).toEqual([[0, 'f1'], [1, 'f2'], [2, 'f3'], [3, 'f4']]);
    expect(c.sideA.summary).toBe('MPO-8 → SW1:eth1/50');
    expect(c.sideB.summary).toBe('4×LC-duplex → PP1:f1–f4');
    expect(c.sideA.portLabels).toBe('eth1/50');
    expect(c.sideB.portLabels).toBe('f1–f4');
    expect(c.sideA.first?.componentId).toBe(sw1.id);
    expect(c.sideA.first).toMatchObject({ rack: 'R01', uLabel: 'U40', optic: '100G-SR4' });
    expect(c.sideB.first).toMatchObject({ rack: 'R02', uLabel: 'U10', ref: 'PP1' });
  });

  it('length: declared first, else routed standard length, else the estimate; unassigned sides say so', () => {
    const f = trunkFixture();
    expect(installedCable(f.project, f.cable).length.basis).toBe('estimated');
    const routed = routeJacket(f.project, f.cable.id);
    const r = installedCable(routed, routed.cables[0]!);
    expect(r.length.basis).toBe('routed');
    expect(r.length.lengthM).toBeGreaterThan(0);

    const declared = addTrunk(f.project, 'CBL2', { sw: f.sw1, portA: 'eth1/51', panel: f.panel, firstB: 'f5', lengthM: 5 });
    expect(installedCable(declared.project, declared.cable).length).toEqual({ lengthM: 5, basis: 'declared' });

    const partial = addTrunk(f.project, 'CBL3', { sw: f.sw1, portA: 'eth1/52', panel: f.panel });
    const p = installedCable(partial.project, partial.cable);
    expect(p.length).toEqual({ lengthM: null, basis: '' });
    expect(p.sideB.summary).toBe('4×LC-duplex → unassigned');
    expect(p.sideB.ports).toBe('unassigned');
    expect(p.sideB.portLabels).toBe('');
    expect(p.sideB.first).toBeNull();
    expect(p.legs.filter((l) => l.side === 'B').every((l) => l.port === '' && l.end === null)).toBe(true);
  });

  it('a partially plugged side counts its unassigned legs', () => {
    const f = trunkFixture();
    const { project, cable } = addTrunk(f.project, 'CBL2', { sw: f.sw1, portA: 'eth1/51', panel: f.panel });
    const plugged = {
      ...project,
      cables: project.cables.map((c) => (c.id === cable.id ? { ...c, plugs: c.plugs.map((p) => (p.side === 'B' && p.leg === 2 ? { ...p, componentId: f.panel.id, portId: 'f9' } : p)) } : c)),
    };
    expect(installedCable(plugged, plugged.cables.find((c) => c.id === cable.id)!).sideB.summary).toBe('4×LC-duplex → PP1:f9 (3 unassigned)');
  });

  it('lists cables in natural label order and survives a missing definition', () => {
    const f = trunkFixture();
    const p2 = addTrunk(f.project, 'CBL10', { sw: f.sw1, portA: 'eth1/51', panel: f.panel, firstB: 'f5' }).project;
    const p3 = addTrunk(p2, 'CBL2', { sw: f.sw1, portA: 'eth1/52', panel: f.panel, firstB: 'f9' }).project;
    expect(installedCables(p3).map((c) => c.cable.label)).toEqual(['CBL1', 'CBL2', 'CBL10']);

    const orphan = { ...p3, cables: p3.cables.map((c) => (c.label === 'CBL2' ? { ...c, cableDefId: 'cbl.gone' } : c)) };
    const o = installedCables(orphan).find((c) => c.cable.label === 'CBL2')!;
    expect(o.resolved).toBeUndefined();
    expect(o.name).toBe('cbl.gone');
    expect(o.kind).toBe('');
    expect(o.legs.map((l) => [l.label, l.connector, l.port])).toEqual([
      ['1', '', 'SW1:eth1/52'],
      ['1', '', 'PP1:f9'],
      ['2', '', 'PP1:f10'],
      ['3', '', 'PP1:f11'],
      ['4', '', 'PP1:f12'],
    ]);
  });
});
