/**
 * Lookups shared by the ERC rules. Pure; no React / Konva / Three.
 */
import type { ProjectIndex } from '@/model/query';
import type { CableDef, Component, Link, LinkEnd, PortGroup, PortType, SymbolDef, SymbolPin, TransceiverDef } from '@/model/types';

/**
 * Port type as ERC sees it: the footprint port when a physical model is
 * assigned and defines the port, else the schematic pin.
 */
export function portTypeOf(idx: ProjectIndex, c: Component, portId: string): PortType | undefined {
  return idx.portOf(c, portId)?.type ?? idx.pinOf(c, portId)?.type;
}

/** The optic the user assigned to a port (never the virtual DAC/AOC transceiver). */
export function assignedOptic(idx: ProjectIndex, c: Component, portId: string): TransceiverDef | undefined {
  return idx.catalog.transceiver(c.optics[portId]);
}

/** DAC / AOC: a cable whose ends are integrated transceivers. */
export function isIntegratedCable(cable: CableDef | undefined): boolean {
  if (!cable) return false;
  return cable.integrated !== undefined || cable.media === 'DAC' || cable.media === 'AOC';
}

/** Optic media class a cable's fibre / copper type requires at its ends, if it implies one. */
export function cableEndMedia(cable: CableDef): 'MMF' | 'SMF' | 'Copper' | undefined {
  const m = cable.media.trim().toUpperCase();
  if (m.startsWith('OM')) return 'MMF';
  if (m.startsWith('OS')) return 'SMF';
  if (m.startsWith('CAT')) return 'Copper';
  if (isIntegratedCable(cable)) return undefined;
  return cable.mediaClass === 'copper' ? 'Copper' : undefined;
}

export const normalizeConnector = (s: string): string => s.trim().toUpperCase();

/** Both ends of a link, in order. */
export const endsOf = (link: Link): readonly LinkEnd[] => [link.a, link.b];

/** The port a link end sits on, without any lane suffix. */
export const portOfEnd = (end: LinkEnd): LinkEnd => ({ componentId: end.componentId, portId: end.portId });

export function groupsWithRole(symbol: SymbolDef, role: NonNullable<PortGroup['role']>): PortGroup[] {
  return (symbol.groups ?? []).filter((g) => g.role === role);
}

export function pinsInGroup(symbol: SymbolDef, groupId: string): SymbolPin[] {
  return symbol.pins.filter((p) => p.group === groupId);
}

export function pinsWithRole(symbol: SymbolDef, role: NonNullable<PortGroup['role']>): SymbolPin[] {
  const ids = new Set(groupsWithRole(symbol, role).map((g) => g.id));
  return symbol.pins.filter((p) => p.group !== undefined && ids.has(p.group));
}

/** Distinct links touching `componentId` (a self-loop link is listed once). */
export function distinctLinksOf(idx: ProjectIndex, componentId: string): Link[] {
  const seen = new Set<string>();
  const out: Link[] = [];
  for (const l of idx.linksOf(componentId)) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    out.push(l);
  }
  return out;
}

export const formatGbps = (gbps: number): string => `${Number.isInteger(gbps) ? gbps : gbps.toFixed(1)}G`;
