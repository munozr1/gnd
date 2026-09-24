/**
 * Pure logic behind the fabric connector dialog: which components look like
 * leafs or spines, the default port ranges, and the optics that fit every
 * port on both sides. The dialog only adds state and rendering.
 */
import { compareNatural } from '@/commands/base';
import { indexProject, formFactorFits } from '@/model/query';
import { compatibleOptics, defaultCableFor, suggestFabricPorts } from '@/model/schematic';
import type { Component, Id, PortType, Project, SelectionItem, SymbolDef, TransceiverDef } from '@/model/types';

export type FabricRole = 'leaf' | 'spine';

/**
 * Leaf: a symbol with both uplink and downlink groups (or named leaf/ToR).
 * Spine: downlink-only switch (or named spine). Servers, panels: null.
 */
export function fabricRoleOf(symbol: SymbolDef): FabricRole | null {
  const name = symbol.name.toLowerCase();
  if (/\bspine\b|\bsuper[- ]?spine\b/.test(name)) return 'spine';
  if (/\bleaf\b|\btor\b/.test(name)) return 'leaf';
  const roles = new Set((symbol.groups ?? []).map((g) => g.role));
  if (roles.has('uplink') && roles.has('downlink')) return 'leaf';
  if (roles.has('downlink')) return 'spine';
  return symbol.kind === 'switch' ? 'leaf' : null;
}

export interface FabricCandidate {
  component: Component;
  symbol: SymbolDef;
  role: FabricRole;
}

/** Every component that can take part in a fabric, sorted by ref. */
export function fabricCandidates(project: Project): FabricCandidate[] {
  const idx = indexProject(project);
  const out: FabricCandidate[] = [];
  for (const c of project.components) {
    const symbol = idx.symbolOf(c);
    if (!symbol) continue;
    const role = fabricRoleOf(symbol);
    if (role) out.push({ component: c, symbol, role });
  }
  return out.sort((a, b) => compareNatural(a.component.ref, b.component.ref));
}

/**
 * Pre-check lists: the selected components split by role; with no components
 * selected, every candidate in the project.
 */
export function initialFabricSelection(project: Project, selection: readonly SelectionItem[]): { leafIds: Id[]; spineIds: Id[] } {
  const candidates = fabricCandidates(project);
  const selected = new Set(selection.filter((i) => i.kind === 'component').map((i) => i.id));
  const pool = selected.size > 0 ? candidates.filter((c) => selected.has(c.component.id)) : candidates;
  return {
    leafIds: pool.filter((c) => c.role === 'leaf').map((c) => c.component.id),
    spineIds: pool.filter((c) => c.role === 'spine').map((c) => c.component.id),
  };
}

const firstSymbol = (project: Project, ids: readonly Id[]): SymbolDef | undefined => {
  const idx = indexProject(project);
  for (const id of ids) {
    const c = idx.component(id);
    const s = c && idx.symbolOf(c);
    if (s) return s;
  }
  return undefined;
};

/** Uplink ports of the first leaf, one per spine. */
export function defaultLeafPortIds(project: Project, leafIds: readonly Id[], spineCount: number): string[] {
  const symbol = firstSymbol(project, leafIds);
  if (!symbol) return [];
  const { uplinks, downlinks } = suggestFabricPorts(symbol);
  return (uplinks.length ? uplinks : downlinks).slice(0, Math.max(0, spineCount));
}

/** Fabric (downlink) ports of the first spine, one per leaf. */
export function defaultSpinePortIds(project: Project, spineIds: readonly Id[], leafCount: number): string[] {
  const symbol = firstSymbol(project, spineIds);
  if (!symbol) return [];
  const { downlinks, uplinks } = suggestFabricPorts(symbol);
  return (downlinks.length ? downlinks : uplinks).slice(0, Math.max(0, leafCount));
}

/** Distinct cage types across the given ports of the given components (unknown ports ignored). */
export function portTypesAt(project: Project, componentIds: readonly Id[], portIds: readonly string[]): Set<PortType> {
  const idx = indexProject(project);
  const out = new Set<PortType>();
  for (const id of componentIds) {
    const c = idx.component(id);
    if (!c) continue;
    for (const portId of portIds) {
      const pin = idx.pinOf(c, portId);
      if (pin) out.add(pin.type);
    }
  }
  return out;
}

/** Transceivers that fit every leaf uplink and every spine port in the plan. */
export function fabricOptics(project: Project, leafIds: readonly Id[], leafPortIds: readonly string[], spineIds: readonly Id[], spinePortIds: readonly string[]): TransceiverDef[] {
  const types = new Set([...portTypesAt(project, leafIds, leafPortIds), ...portTypesAt(project, spineIds, spinePortIds)]);
  if (types.size === 0) return [];
  const catalog = indexProject(project).catalog.catalog;
  const [first, ...rest] = [...types];
  return compatibleOptics(catalog, first!).filter((t) => rest.every((pt) => formFactorFits(pt, t.formFactor)));
}

/** Cable the optic pair calls for, or null. */
export function fabricDefaultCable(project: Project, opticId: string | null): string | null {
  if (!opticId) return null;
  return defaultCableFor(indexProject(project).catalog.catalog, opticId, opticId);
}
