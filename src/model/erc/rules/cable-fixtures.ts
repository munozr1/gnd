/**
 * Fixtures for the cable ERC / DRC rules. Not a test file.
 *
 * Projects are built through the command layer (`executeCommand`), so they
 * are exactly what the app produces: Immer-frozen, cable links synced by the
 * cable mutators, refs annotated. States the commands refuse (an LC leg on
 * an MPO port, a plug on a deleted device, an unsound definition) are set
 * with `produce` through the helpers at the bottom.
 */
import { produce } from 'immer';
import { builtinCatalog } from '@/catalog';
import * as cables from '@/commands/cables';
import * as layout from '@/commands/layout';
import * as sch from '@/commands/schematic';
import type { CableSide, PortRef } from '@/model/cables';
import { ROOT_SHEET_ID, createProject } from '@/model/factories';
import type { Cable, CableDef, Id, Project } from '@/model/types';
import { emptyHistory, executeCommand, type Command } from '@/store/commands';

export const LEAF = 'sym.leaf-switch-48x25-8x100';
export const SPINE = 'sym.spine-switch-32x400';
export const LC_PANEL = 'sym.fiber-patch-panel-24lc';
export const TRUNK_8F = 'cbl.om4-8f-mpo8-4lc';
export const MPO_TRUNK_12F = 'cbl.om4-mpo-trunk';
export const SR4 = 'xcvr.100g-sr4';
export const LR4 = 'xcvr.100g-lr4';

/** Run commands in order; throws when a mutator does (as `execute` would report through `ui.lastError`). */
export function run(project: Project, ...cmds: Command[]): Project {
  let p = project;
  let h = emptyHistory();
  for (const cmd of cmds) {
    const r = executeCommand(p, h, cmd);
    p = r.project;
    h = r.history;
  }
  return p;
}

export function builtinCableDef(id: string): CableDef {
  const def = builtinCatalog.cables.find((c) => c.id === id);
  if (!def) throw new Error(`fixture: unknown cable def '${id}'`);
  return def;
}

export interface TrunkFixture {
  project: Project;
  leaf: Id;
  panel: Id;
  cable: Id;
}

/**
 * Leaf SW1 (100G-SR4 in eth1/49) and 24-LC panel PP1 joined by an 8F MPO-8 →
 * 4×LC-duplex trunk 'T-1': side A in eth1/49 and side B auto-filled onto
 * f1..f4, unless `plugA` / `plugB` is false.
 */
export function trunkFixture(opts: { plugA?: boolean; plugB?: boolean } = {}): TrunkFixture {
  const leaf = sch.addComponent(LEAF, ROOT_SHEET_ID, { x: 0, y: 0 });
  const panel = sch.addComponent(LC_PANEL, ROOT_SHEET_ID, { x: 600, y: 0 });
  let project = run(createProject('cables', '2026-01-01T00:00:00.000Z'), leaf, panel);
  const leafId = leaf.result!;
  const panelId = panel.result!;
  const create = cables.createCable(TRUNK_8F, {
    label: 'T-1',
    plugsA: opts.plugA === false ? [] : [{ componentId: leafId, portId: 'eth1/49' }],
  });
  project = run(project, sch.setOptic(leafId, 'eth1/49', SR4), create);
  const cableId = create.result!;
  if (opts.plugB !== false) project = run(project, cables.autoFillSide(cableId, 'B', { componentId: panelId, portId: 'f1' }));
  return { project, leaf: leafId, panel: panelId, cable: cableId };
}

export interface PlacedTrunkFixture extends TrunkFixture {
  r1: Id;
  r2: Id;
}

/**
 * The trunk fixture placed on the floor: SW1 at U40 of R01 (1000, 1000) and
 * PP1 at U`panelU` of R02 (`rack2X`, 1000), both 42U racks in one row.
 */
export function placedTrunkFixture(opts: { rack2X?: number; panelU?: number } = {}): PlacedTrunkFixture {
  const f = trunkFixture();
  const rackDef = builtinCatalog.racks.find((r) => r.id === 'rack.standard-42u')!;
  const r1 = layout.addRack(rackDef, { x: 1000, y: 1000 }, { name: 'R01' });
  const r2 = layout.addRack(rackDef, { x: opts.rack2X ?? 4000, y: 1000 }, { name: 'R02' });
  let project = run(f.project, r1, r2);
  project = run(project, layout.placeComponent(f.leaf, r1.result!, 40), layout.placeComponent(f.panel, r2.result!, opts.panelU ?? 10));
  return { ...f, project, r1: r1.result!, r2: r2.result! };
}

/** Add a cable definition to the project's custom catalog as is (no validation, unlike `addCableDef`). */
export const withCustomDef = (project: Project, def: CableDef): Project =>
  produce(project, (d) => {
    d.customCatalog.cables.push(def);
  });

/** Add a cable instance as is (no resolution, unlike `createCable`). */
export const withCable = (project: Project, cable: Cable): Project =>
  produce(project, (d) => {
    d.cables.push(cable);
  });

/** Set a plug directly, bypassing the compatibility checks `plugLeg` applies; links are NOT resynced. */
export const withPlug = (project: Project, cableId: Id, side: CableSide, leg: number, ref: PortRef | null): Project =>
  produce(project, (d) => {
    const cable = d.cables.find((c) => c.id === cableId);
    const plug = cable?.plugs.find((p) => p.side === side && p.leg === leg);
    if (!plug) throw new Error(`fixture: no leg ${side}${leg + 1} on ${cableId}`);
    plug.componentId = ref?.componentId ?? null;
    plug.portId = ref?.portId ?? null;
  });
