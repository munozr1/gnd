/**
 * Read-only lookups over a Project. Pure; safe for memoised selectors.
 * Anything hot in an editor should go through `ProjectIndex` rather than
 * scanning arrays.
 */
import { catalogIndex, type CatalogIndex } from '@/catalog';
import type {
  CableDef,
  Component,
  FootprintPort,
  Id,
  Link,
  LinkEnd,
  Placement,
  Project,
  Rack,
  Route,
  SymbolDef,
  SymbolPin,
  TransceiverDef,
} from './types';

export class ProjectIndex {
  readonly catalog: CatalogIndex;
  readonly componentById = new Map<Id, Component>();
  readonly linkById = new Map<Id, Link>();
  readonly rackById = new Map<Id, Rack>();
  readonly placementByComponent = new Map<Id, Placement>();
  readonly linksByComponent = new Map<Id, Link[]>();
  readonly componentsByRack = new Map<Id, Component[]>();
  readonly componentsBySheet = new Map<Id, Component[]>();

  constructor(readonly project: Project) {
    this.catalog = catalogIndex(project);
    for (const c of project.components) {
      this.componentById.set(c.id, c);
      const s = this.componentsBySheet.get(c.sch.sheetId);
      if (s) s.push(c);
      else this.componentsBySheet.set(c.sch.sheetId, [c]);
    }
    for (const l of project.links) {
      this.linkById.set(l.id, l);
      for (const end of [l.a, l.b]) {
        const arr = this.linksByComponent.get(end.componentId);
        if (arr) arr.push(l);
        else this.linksByComponent.set(end.componentId, [l]);
      }
    }
    for (const r of project.racks) this.rackById.set(r.id, r);
    for (const p of project.placements) {
      this.placementByComponent.set(p.componentId, p);
      if (p.rackId) {
        const c = this.componentById.get(p.componentId);
        if (c) {
          const arr = this.componentsByRack.get(p.rackId);
          if (arr) arr.push(c);
          else this.componentsByRack.set(p.rackId, [c]);
        }
      }
    }
  }

  component(id: Id): Component | undefined {
    return this.componentById.get(id);
  }
  link(id: Id): Link | undefined {
    return this.linkById.get(id);
  }
  rack(id: Id): Rack | undefined {
    return this.rackById.get(id);
  }
  placement(componentId: Id): Placement | undefined {
    return this.placementByComponent.get(componentId);
  }
  route(linkId: Id): Route | undefined {
    return this.project.routes[linkId];
  }
  symbolOf(c: Component): SymbolDef | undefined {
    return this.catalog.symbol(c.symbolDefId);
  }
  footprintOf(c: Component) {
    return this.catalog.footprint(c.footprintDefId);
  }
  pinOf(c: Component, portId: string): SymbolPin | undefined {
    return this.symbolOf(c)?.pins.find((p) => p.portId === portId);
  }
  portOf(c: Component, portId: string): FootprintPort | undefined {
    return this.footprintOf(c)?.ports.find((p) => p.id === portId);
  }
  linksOf(componentId: Id): Link[] {
    return this.linksByComponent.get(componentId) ?? [];
  }
  componentsInRack(rackId: Id): Component[] {
    return this.componentsByRack.get(rackId) ?? [];
  }
  /** Rack a component is placed in, if any. */
  rackOfComponent(componentId: Id): Rack | undefined {
    const p = this.placementByComponent.get(componentId);
    return p?.rackId ? this.rackById.get(p.rackId) : undefined;
  }
  /** Height in U of a component (1 if no footprint). */
  heightUOf(c: Component): number {
    return this.footprintOf(c)?.heightU ?? 1;
  }
  cableOf(link: Link): CableDef | undefined {
    return this.catalog.cable(link.cableDefId);
  }

  /**
   * Effective transceiver at a link end: the assigned optic, or the virtual
   * integrated transceiver of a DAC/AOC cable.
   */
  transceiverAt(link: Link, end: LinkEnd): TransceiverDef | undefined {
    const c = this.componentById.get(end.componentId);
    if (!c) return undefined;
    const assigned = this.catalog.transceiver(c.optics[end.portId]);
    if (assigned) return assigned;
    const cable = this.cableOf(link);
    if (cable?.integrated) {
      return {
        id: `virtual.${cable.id}`,
        name: cable.name,
        formFactor: cable.integrated.formFactor,
        speedGbps: cable.integrated.speedGbps,
        media: cable.media === 'AOC' ? 'AOC' : 'DAC',
        connector: 'integrated',
        reachM: cable.integrated.reachM,
        lanes: 1,
      };
    }
    return undefined;
  }

  /** Human label for a link end: 'SW1:eth1/49' (with lane suffix). */
  endLabel(end: LinkEnd): string {
    const c = this.componentById.get(end.componentId);
    const ref = c?.ref ?? end.componentId;
    return `${ref}:${end.portId}${end.lane !== undefined ? `.${end.lane}` : ''}`;
  }

  linkLabel(link: Link): string {
    return link.label ?? `${this.endLabel(link.a)} — ${this.endLabel(link.b)}`;
  }

  /** Set of 'componentId/portId[/lane]' keys currently occupied by links. */
  occupiedPortKeys(): Map<string, Link[]> {
    const m = new Map<string, Link[]>();
    for (const l of this.project.links) {
      for (const end of [l.a, l.b]) {
        const k = portKey(end);
        const arr = m.get(k);
        if (arr) arr.push(l);
        else m.set(k, [l]);
      }
    }
    return m;
  }

  /** Whether a port is free (no link on it or any of its lanes). */
  isPortFree(componentId: Id, portId: string): boolean {
    return !this.linksOf(componentId).some(
      (l) =>
        (l.a.componentId === componentId && l.a.portId === portId) ||
        (l.b.componentId === componentId && l.b.portId === portId),
    );
  }
}

export const portKey = (end: LinkEnd): string =>
  `${end.componentId}/${end.portId}${end.lane !== undefined ? `/${end.lane}` : ''}`;

const indexCache = new WeakMap<Project, ProjectIndex>();

/** Memoised per project object identity (Immer gives a new object on every change). */
export function indexProject(project: Project): ProjectIndex {
  let idx = indexCache.get(project);
  if (!idx) {
    idx = new ProjectIndex(project);
    indexCache.set(project, idx);
  }
  return idx;
}

/** Whether the physical port `a` can accept an optic of form factor `ff`. */
export function formFactorFits(port: FootprintPort['type'], ff: FootprintPort['type']): boolean {
  if (port === ff) return true;
  // Backward-compatible cages: an SFP in an SFP28 cage, a QSFP28 in a QSFP-DD cage, etc.
  const compat: Record<string, string[]> = {
    'SFP+': ['SFP'],
    SFP28: ['SFP', 'SFP+'],
    'QSFP+': [],
    QSFP28: ['QSFP+'],
    QSFP56: ['QSFP+', 'QSFP28'],
    'QSFP-DD': ['QSFP+', 'QSFP28', 'QSFP56'],
    OSFP: [],
  };
  return compat[port]?.includes(ff) ?? false;
}

/** Whether a port type is an optical/pluggable cage (vs a fixed RJ45 / LC adapter). */
export function isPluggableCage(type: FootprintPort['type']): boolean {
  return type !== 'RJ45' && type !== 'LC' && type !== 'MPO-12';
}

/** U range [bottom, top] occupied by a placed component, inclusive. */
export function uRange(idx: ProjectIndex, componentId: Id): { bottom: number; top: number } | null {
  const p = idx.placement(componentId);
  const c = idx.component(componentId);
  if (!p || !c || p.rackId === null || p.uPosition === null) return null;
  const h = idx.heightUOf(c);
  return { bottom: p.uPosition, top: p.uPosition + h - 1 };
}
