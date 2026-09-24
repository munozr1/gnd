import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { createComponent, createProject, ROOT_SHEET_ID } from '@/model/factories';
import { planFabric } from '@/model/schematic';
import { defaultLeafPortIds, defaultSpinePortIds, fabricCandidates, fabricDefaultCable, fabricOptics, fabricRoleOf, initialFabricSelection } from './fabricForm';
import { parsePortRange, formatPortRange } from './portRange';

const sym = (id: string) => builtinCatalog.symbols.find((s) => s.id === id)!;
const leaf = sym('sym.leaf-switch-48x25-8x100');
const spine = sym('sym.spine-switch-32x400');
const mgmt = sym('sym.mgmt-switch-48x1g-4x10');
const server = sym('sym.server-1u');
const panel = sym('sym.fiber-patch-panel-24lc');

function podProject(spines = 2, leafs = 8) {
  const project = createProject('t', '2026-01-01T00:00:00.000Z');
  for (let i = 1; i <= spines; i++) project.components.push(createComponent(spine, { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: `SP${i}` }));
  for (let i = 1; i <= leafs; i++) project.components.push(createComponent(leaf, { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: `SW${i}` }));
  project.components.push(createComponent(server, { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: 'SRV1' }));
  return project;
}

describe('fabricRoleOf', () => {
  it('classifies the catalog symbols', () => {
    expect(fabricRoleOf(leaf)).toBe('leaf');
    expect(fabricRoleOf(spine)).toBe('spine');
    expect(fabricRoleOf(mgmt)).toBe('leaf');
    expect(fabricRoleOf(server)).toBeNull();
    expect(fabricRoleOf(panel)).toBeNull();
  });
});

describe('initialFabricSelection', () => {
  it('uses the selection when components are selected, else every candidate', () => {
    const project = podProject();
    const all = initialFabricSelection(project, []);
    expect(all.spineIds).toHaveLength(2);
    expect(all.leafIds).toHaveLength(8);
    expect(fabricCandidates(project).map((c) => c.component.ref).slice(0, 3)).toEqual(['SP1', 'SP2', 'SW1']);

    const [sp1, , sw1, sw2] = project.components;
    const some = initialFabricSelection(project, [
      { kind: 'component', id: sp1!.id },
      { kind: 'component', id: sw1!.id },
      { kind: 'component', id: sw2!.id },
      { kind: 'link', id: 'x' },
    ]);
    expect(some.spineIds).toEqual([sp1!.id]);
    expect(some.leafIds).toEqual([sw1!.id, sw2!.id]);
  });
});

describe('default ports, optics and cable', () => {
  it('suggests one leaf uplink per spine and one spine port per leaf', () => {
    const project = podProject();
    const { leafIds, spineIds } = initialFabricSelection(project, []);
    const leafPorts = defaultLeafPortIds(project, leafIds, spineIds.length);
    const spinePorts = defaultSpinePortIds(project, spineIds, leafIds.length);
    expect(leafPorts).toEqual(['eth1/49', 'eth1/50']);
    expect(formatPortRange(leafPorts)).toBe('eth1/49-eth1/50');
    expect(spinePorts).toHaveLength(8);
    expect(formatPortRange(spinePorts)).toBe('eth1/1-eth1/8');
    expect(parsePortRange(formatPortRange(spinePorts))).toEqual(spinePorts);
  });

  it('offers only optics that fit both the QSFP28 uplinks and the QSFP-DD spine ports', () => {
    const project = podProject();
    const { leafIds, spineIds } = initialFabricSelection(project, []);
    const optics = fabricOptics(project, leafIds, ['eth1/49', 'eth1/50'], spineIds, ['eth1/1', 'eth1/2']);
    expect(optics.map((o) => o.id)).toEqual(['xcvr.100g-sr4', 'xcvr.100g-lr4']);
    expect(fabricDefaultCable(project, 'xcvr.100g-sr4')).toBe('cbl.om4-mpo-trunk');
    expect(fabricDefaultCable(project, null)).toBeNull();
  });

  it('plans the full 2 × 8 mesh from the defaults', () => {
    const project = podProject();
    const { leafIds, spineIds } = initialFabricSelection(project, []);
    const plan = planFabric(project, {
      leafIds,
      spineIds,
      leafPortIds: parsePortRange('eth1/49-eth1/50'),
      spinePortIds: parsePortRange('eth1/1-eth1/8'),
      cableDefId: 'cbl.om4-mpo-trunk',
      opticId: 'xcvr.100g-sr4',
      labelPrefix: 'FAB',
    });
    expect(plan.links).toHaveLength(16);
    expect(plan.skipped).toEqual([]);
    expect(plan.optics).toHaveLength(8 * 2 + 2 * 8);
  });
});
