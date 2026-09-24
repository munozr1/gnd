/**
 * Test fixtures for the ERC rules. Not a test file itself.
 *
 * Tests mutate plain project objects, so `check` always builds a fresh
 * ProjectIndex rather than going through the identity-memoised
 * `indexProject`.
 */
import { builtinCatalog } from '@/catalog';
import { ROOT_SHEET_ID, createComponent, createLink, createProject } from '@/model/factories';
import { ProjectIndex } from '@/model/query';
import type { Component, Issue, Link, LinkEnd, Project, SymbolDef } from '@/model/types';
import type { Rule } from './rule';

export const LEAF = 'sym.leaf-switch-48x25-8x100';
export const SPINE = 'sym.spine-switch-32x400';
export const MGMT_SWITCH = 'sym.mgmt-switch-48x1g-4x10';
export const SERVER_1U = 'sym.server-1u';
export const SERVER_2U = 'sym.server-2u';
export const GPU_SERVER = 'sym.gpu-server-4u';
export const LC_PANEL = 'sym.fiber-patch-panel-24lc';
export const MPO_PANEL = 'sym.mpo-patch-panel-12';

export function symbol(id: string): SymbolDef {
  const s = builtinCatalog.symbols.find((x) => x.id === id);
  if (!s) throw new Error(`fixture: unknown symbol '${id}'`);
  return s;
}

export function addComponent(
  project: Project,
  symbolId: string,
  ref: string,
  opts: { footprintDefId?: string | null; optics?: Record<string, string> } = {},
): Component {
  const c = createComponent(symbol(symbolId), { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref });
  // createComponent falls back to the default footprint on null, so set it afterwards.
  if (opts.footprintDefId !== undefined) c.footprintDefId = opts.footprintDefId;
  if (opts.optics) c.optics = { ...opts.optics };
  project.components.push(c);
  return c;
}

export const end = (c: Component, portId: string, lane?: number): LinkEnd =>
  lane === undefined ? { componentId: c.id, portId } : { componentId: c.id, portId, lane };

export function connect(project: Project, a: LinkEnd, b: LinkEnd, cableDefId: string | null = null): Link {
  const l = createLink(a, b, cableDefId);
  project.links.push(l);
  return l;
}

export function check(rule: Rule, project: Project): Issue[] {
  return rule.check(project, new ProjectIndex(project));
}

export const errors = (issues: Issue[]): Issue[] => issues.filter((i) => i.severity === 'error');

export const hasTarget = (issue: Issue, kind: 'component' | 'link', id: string, portId?: string): boolean =>
  issue.targets.some(
    (t) => t.kind === kind && t.id === id && (portId === undefined || (t.kind === 'component' && t.portId === portId)),
  );

/**
 * A clean 2-spine x 8-leaf mesh: every leaf uplink (eth1/49..56, QSFP28)
 * carries a 100G-SR4 into a spine QSFP-DD port with a 100G-SR4 on the far
 * end, over an OM4 MPO-12 trunk. Four uplinks per leaf per spine fills all
 * 32 spine ports.
 */
export function buildSpineLeafMesh(): Project {
  const project = createProject('mesh', '2026-01-01T00:00:00.000Z');
  const spines = [0, 1].map((s) => addComponent(project, SPINE, `SW${s + 1}`));
  const leaves = Array.from({ length: 8 }, (_, i) => addComponent(project, LEAF, `SW${i + 11}`));
  leaves.forEach((leaf, i) => {
    spines.forEach((spine, s) => {
      for (let j = 0; j < 4; j++) {
        const leafPort = `eth1/${49 + s * 4 + j}`;
        const spinePort = `eth1/${i * 4 + j + 1}`;
        leaf.optics[leafPort] = 'xcvr.100g-sr4';
        spine.optics[spinePort] = 'xcvr.100g-sr4';
        connect(project, end(leaf, leafPort), end(spine, spinePort), 'cbl.om4-mpo-trunk');
      }
    });
  });
  return project;
}
