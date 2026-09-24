/**
 * Fabric connector: generate the full leaf-spine mesh with deterministic port
 * assignment. Leaf i <-> spine j uses leaf port `leafPortIds[j]` and spine port
 * `spinePortIds[i]`, so every leaf lands on the same spine port index and every
 * spine sees the leafs in order.
 */
import { createLink } from '../factories';
import { formFactorFits, indexProject, portKey } from '../query';
import type { Id, Link, LinkEnd, PortType, Project, SymbolDef } from '../types';
import { defaultCableFor } from './assignment';
import { isEndFree, requireComponent } from './lookup';

export interface FabricOptions {
  leafIds: Id[];
  spineIds: Id[];
  /** Uplink ports on each leaf, in spine order (index j -> spine j). */
  leafPortIds: string[];
  /** Fabric ports on each spine, in leaf order (index i -> leaf i). */
  spinePortIds: string[];
  cableDefId: string | null;
  /** Assigned to both ends of every generated link (when it fits the cage). */
  opticId?: string;
  /** Links get labels '<labelPrefix><n>' numbered from 1. */
  labelPrefix?: string;
}

export type FabricSkipReason =
  | 'missing-leaf'
  | 'missing-spine'
  | 'same-component'
  | 'insufficient-leaf-ports'
  | 'insufficient-spine-ports'
  | 'missing-port'
  | 'port-occupied'
  | 'optic-incompatible';

export interface FabricSkip {
  reason: FabricSkipReason;
  leafId?: Id;
  spineId?: Id;
  portId?: string;
  message: string;
}

export interface OpticAssignment {
  componentId: Id;
  portId: string;
  opticId: string;
}

export interface FabricPlan {
  links: Link[];
  optics: OpticAssignment[];
  skipped: FabricSkip[];
}

/** Compute the mesh without touching the project. */
export function planFabric(project: Project, opts: FabricOptions): FabricPlan {
  const idx = indexProject(project);
  const catalog = idx.catalog;
  const optic = catalog.transceiver(opts.opticId);
  const cableDefId =
    opts.cableDefId ?? (optic ? defaultCableFor(catalog.catalog, optic, optic) : null);

  const links: Link[] = [];
  const optics: OpticAssignment[] = [];
  const skipped: FabricSkip[] = [];
  const claimed = new Set<string>();
  const opticsPlanned = new Set<string>();
  const pending = [...project.links];
  let labelN = 0;

  const refOf = (id: Id): string => idx.component(id)?.ref ?? id;

  const claimEnd = (end: LinkEnd): boolean => {
    const key = portKey(end);
    if (claimed.has(key)) return false;
    if (!isEndFree(pending, end)) return false;
    claimed.add(key);
    return true;
  };

  const planOptic = (role: 'leaf' | 'spine', componentId: Id, portId: string, portType: PortType) => {
    if (!optic) return;
    const key = `${componentId}/${portId}`;
    if (opticsPlanned.has(key)) return;
    if (!formFactorFits(portType, optic.formFactor)) {
      skipped.push({
        reason: 'optic-incompatible',
        ...(role === 'leaf' ? { leafId: componentId } : { spineId: componentId }),
        portId,
        message: `${optic.name} (${optic.formFactor}) does not fit ${refOf(componentId)}:${portId} (${portType})`,
      });
      return;
    }
    opticsPlanned.add(key);
    optics.push({ componentId, portId, opticId: optic.id });
  };

  opts.leafIds.forEach((leafId, i) => {
    const leaf = idx.component(leafId);
    const leafSymbol = leaf ? idx.symbolOf(leaf) : undefined;
    if (!leaf || !leafSymbol) {
      skipped.push({ reason: 'missing-leaf', leafId, message: `Leaf ${leafId} not found` });
      return;
    }
    opts.spineIds.forEach((spineId, j) => {
      const spine = idx.component(spineId);
      const spineSymbol = spine ? idx.symbolOf(spine) : undefined;
      if (!spine || !spineSymbol) {
        if (i === 0) skipped.push({ reason: 'missing-spine', spineId, message: `Spine ${spineId} not found` });
        return;
      }
      if (leafId === spineId) {
        skipped.push({ reason: 'same-component', leafId, spineId, message: `${leaf.ref} is both leaf and spine` });
        return;
      }
      const leafPortId = opts.leafPortIds[j];
      const spinePortId = opts.spinePortIds[i];
      if (leafPortId === undefined) {
        skipped.push({
          reason: 'insufficient-leaf-ports',
          leafId,
          spineId,
          message: `${leaf.ref}: no uplink port for spine ${j + 1} (${opts.leafPortIds.length} given)`,
        });
        return;
      }
      if (spinePortId === undefined) {
        skipped.push({
          reason: 'insufficient-spine-ports',
          leafId,
          spineId,
          message: `${spine.ref}: no fabric port for leaf ${i + 1} (${opts.spinePortIds.length} given)`,
        });
        return;
      }
      const leafPin = leafSymbol.pins.find((p) => p.portId === leafPortId);
      const spinePin = spineSymbol.pins.find((p) => p.portId === spinePortId);
      if (!leafPin) {
        skipped.push({ reason: 'missing-port', leafId, spineId, portId: leafPortId, message: `${leaf.ref} has no port ${leafPortId}` });
        return;
      }
      if (!spinePin) {
        skipped.push({ reason: 'missing-port', leafId, spineId, portId: spinePortId, message: `${spine.ref} has no port ${spinePortId}` });
        return;
      }
      const a: LinkEnd = { componentId: leafId, portId: leafPortId };
      const b: LinkEnd = { componentId: spineId, portId: spinePortId };
      if (!claimEnd(a)) {
        skipped.push({ reason: 'port-occupied', leafId, spineId, portId: leafPortId, message: `${leaf.ref}:${leafPortId} is already connected` });
        return;
      }
      if (!claimEnd(b)) {
        claimed.delete(portKey(a));
        skipped.push({ reason: 'port-occupied', leafId, spineId, portId: spinePortId, message: `${spine.ref}:${spinePortId} is already connected` });
        return;
      }
      labelN++;
      const label = opts.labelPrefix !== undefined ? `${opts.labelPrefix}${labelN}` : undefined;
      links.push(createLink(a, b, cableDefId, label));
      planOptic('leaf', leafId, leafPortId, leafPin.type);
      planOptic('spine', spineId, spinePortId, spinePin.type);
    });
  });

  return { links, optics, skipped };
}

/** Push the planned links and optics into the draft. Returns the new link ids. */
export function applyFabric(draft: Project, plan: FabricPlan): Id[] {
  for (const o of plan.optics) {
    requireComponent(draft, o.componentId).optics[o.portId] = o.opticId;
  }
  for (const l of plan.links) {
    draft.links.push({
      ...l,
      a: { ...l.a },
      b: { ...l.b },
      sch: { wirePoints: l.sch.wirePoints.map((p) => ({ ...p })) },
    });
  }
  return plan.links.map((l) => l.id);
}

/**
 * Port ids a symbol offers to a fabric, in pin order: `uplinks` from groups
 * with role 'uplink' (a leaf's spine-facing ports) and `downlinks` from groups
 * with role 'downlink' (a spine's fabric ports, a leaf's server ports). When
 * a symbol declares no such groups, all non-management pluggable pins are
 * offered in both.
 */
export function suggestFabricPorts(symbol: SymbolDef): { uplinks: string[]; downlinks: string[] } {
  const groupsByRole = (role: 'uplink' | 'downlink'): Set<string> =>
    new Set((symbol.groups ?? []).filter((g) => g.role === role).map((g) => g.id));
  const pinsIn = (groups: Set<string>): string[] =>
    symbol.pins.filter((p) => p.group !== undefined && groups.has(p.group)).map((p) => p.portId);
  const uplinks = pinsIn(groupsByRole('uplink'));
  const downlinks = pinsIn(groupsByRole('downlink'));
  if (uplinks.length || downlinks.length) return { uplinks, downlinks };
  const mgmt = new Set((symbol.groups ?? []).filter((g) => g.role === 'mgmt').map((g) => g.id));
  const all = symbol.pins
    .filter((p) => p.type !== 'RJ45' && (p.group === undefined || !mgmt.has(p.group)))
    .map((p) => p.portId);
  return { uplinks: all, downlinks: all };
}
