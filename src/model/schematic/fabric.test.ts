import { describe, expect, it } from 'vitest';
import { createLink } from '../factories';
import { portKey } from '../query';
import type { Component, Project } from '../types';
import { applyFabric, planFabric, suggestFabricPorts } from './fabric';
import { LEAF, SPINE, fixtureProject, place, symbol } from './testUtils';

function leafSpine(nLeafs: number, nSpines: number): { p: Project; leafs: Component[]; spines: Component[] } {
  const p = fixtureProject();
  const spines = Array.from({ length: nSpines }, (_, j) => place(p, SPINE, { x: 400 * j, y: 0 }, { ref: `SW${j + 1}` }));
  const leafs = Array.from({ length: nLeafs }, (_, i) =>
    place(p, LEAF, { x: 300 * i, y: 600 }, { ref: `SW${nSpines + i + 1}` }),
  );
  return { p, leafs, spines };
}

describe('suggestFabricPorts', () => {
  it('offers uplink-group pins for a leaf and downlink-group pins for a spine', () => {
    const leaf = suggestFabricPorts(symbol(LEAF));
    expect(leaf.uplinks).toEqual(Array.from({ length: 8 }, (_, i) => `eth1/${49 + i}`));
    expect(leaf.downlinks).toHaveLength(48);
    const spine = suggestFabricPorts(symbol(SPINE));
    expect(spine.uplinks).toEqual([]);
    expect(spine.downlinks).toEqual(Array.from({ length: 32 }, (_, i) => `eth1/${i + 1}`));
  });
});

describe('planFabric', () => {
  it('builds a 2 spine x 8 leaf full mesh with distinct ports and optics on every end', () => {
    const { p, leafs, spines } = leafSpine(8, 2);
    const plan = planFabric(p, {
      leafIds: leafs.map((l) => l.id),
      spineIds: spines.map((s) => s.id),
      leafPortIds: suggestFabricPorts(symbol(LEAF)).uplinks.slice(0, 2),
      spinePortIds: suggestFabricPorts(symbol(SPINE)).downlinks.slice(0, 8),
      cableDefId: null,
      opticId: 'xcvr.100g-sr4',
      labelPrefix: 'FAB',
    });
    expect(plan.skipped).toEqual([]);
    expect(plan.links).toHaveLength(16);
    const keys = plan.links.flatMap((l) => [portKey(l.a), portKey(l.b)]);
    expect(new Set(keys).size).toBe(32);
    // Deterministic assignment: leaf i <-> spine j uses leaf port [j] and spine port [i].
    const l3s1 = plan.links.find((l) => l.a.componentId === leafs[3]!.id && l.b.componentId === spines[1]!.id)!;
    expect(l3s1.a.portId).toBe('eth1/50');
    expect(l3s1.b.portId).toBe('eth1/4');
    expect(plan.links.map((l) => l.label)).toEqual(Array.from({ length: 16 }, (_, i) => `FAB${i + 1}`));
    // Cable defaults from the optic (MMF + MPO -> OM4 trunk).
    expect(plan.links.every((l) => l.cableDefId === 'cbl.om4-mpo-trunk')).toBe(true);
    expect(plan.optics).toHaveLength(32);

    const ids = applyFabric(p, plan);
    expect(ids).toHaveLength(16);
    expect(p.links).toHaveLength(16);
    const linksOf = (id: string) => p.links.filter((l) => l.a.componentId === id || l.b.componentId === id);
    for (const leaf of leafs) {
      expect(linksOf(leaf.id)).toHaveLength(2);
      expect(leaf.optics).toEqual({ 'eth1/49': 'xcvr.100g-sr4', 'eth1/50': 'xcvr.100g-sr4' });
    }
    for (const spine of spines) {
      expect(linksOf(spine.id)).toHaveLength(8);
      expect(Object.keys(spine.optics)).toHaveLength(8);
    }
    // Re-planning over the applied mesh finds every port occupied.
    const again = planFabric(p, {
      leafIds: leafs.map((l) => l.id),
      spineIds: spines.map((s) => s.id),
      leafPortIds: ['eth1/49', 'eth1/50'],
      spinePortIds: Array.from({ length: 8 }, (_, i) => `eth1/${i + 1}`),
      cableDefId: null,
    });
    expect(again.links).toEqual([]);
    expect(again.skipped.every((s) => s.reason === 'port-occupied')).toBe(true);
  });

  it('skips occupied ports and reports them', () => {
    const { p, leafs, spines } = leafSpine(2, 2);
    p.links.push(createLink({ componentId: leafs[0]!.id, portId: 'eth1/49' }, { componentId: spines[1]!.id, portId: 'eth1/30' }));
    const plan = planFabric(p, {
      leafIds: leafs.map((l) => l.id),
      spineIds: spines.map((s) => s.id),
      leafPortIds: ['eth1/49', 'eth1/50'],
      spinePortIds: ['eth1/1', 'eth1/2'],
      cableDefId: 'cbl.om4-mpo-trunk',
    });
    expect(plan.links).toHaveLength(3);
    expect(plan.skipped).toEqual([
      expect.objectContaining({ reason: 'port-occupied', leafId: leafs[0]!.id, spineId: spines[0]!.id, portId: 'eth1/49' }),
    ]);
  });

  it('reports insufficient port lists and missing ports', () => {
    const { p, leafs, spines } = leafSpine(3, 2);
    const plan = planFabric(p, {
      leafIds: leafs.map((l) => l.id),
      spineIds: spines.map((s) => s.id),
      leafPortIds: ['eth1/49'],
      spinePortIds: ['eth1/1', 'nope'],
      cableDefId: null,
    });
    // leaf i, spine 0: ok for i=0; i=1 -> spine port 'nope' missing; i=2 -> no spine port.
    // spine 1 -> no leaf port for every leaf.
    expect(plan.links).toHaveLength(1);
    const reasons = plan.skipped.map((s) => s.reason).sort();
    expect(reasons).toEqual(
      ['insufficient-leaf-ports', 'insufficient-leaf-ports', 'insufficient-leaf-ports', 'insufficient-spine-ports', 'missing-port'].sort(),
    );
  });

  it('creates the link but withholds an optic that does not fit the cage', () => {
    const { p, leafs, spines } = leafSpine(1, 1);
    const plan = planFabric(p, {
      leafIds: [leafs[0]!.id],
      spineIds: [spines[0]!.id],
      leafPortIds: ['eth1/49'],
      spinePortIds: ['eth1/1'],
      cableDefId: null,
      opticId: 'xcvr.400g-dr4',
    });
    expect(plan.links).toHaveLength(1);
    expect(plan.optics).toEqual([{ componentId: spines[0]!.id, portId: 'eth1/1', opticId: 'xcvr.400g-dr4' }]);
    expect(plan.skipped).toEqual([expect.objectContaining({ reason: 'optic-incompatible', leafId: leafs[0]!.id })]);
  });

  it('reports unknown components', () => {
    const { p, leafs } = leafSpine(1, 0);
    const plan = planFabric(p, {
      leafIds: [leafs[0]!.id, 'ghost'],
      spineIds: ['phantom'],
      leafPortIds: ['eth1/49'],
      spinePortIds: ['eth1/1', 'eth1/2'],
      cableDefId: null,
    });
    expect(plan.links).toEqual([]);
    expect(plan.skipped.map((s) => s.reason).sort()).toEqual(['missing-leaf', 'missing-spine']);
  });
});
