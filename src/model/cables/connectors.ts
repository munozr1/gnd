/**
 * Fiber connector catalog: the plug types a cable leg can end in, and the
 * compatibility rule between a connector and a port. Pure data + lookups; no
 * React / Konva / Three.
 *
 * `legacyConnector` bridges to the vocabulary the rest of the app already
 * speaks (`TransceiverDef.connector`, `CableDef.endA/endB`, the ERC
 * connector-mismatch rule): 'LC', 'MPO-12', 'MPO-16', … An MPO-8 plug is
 * 'MPO-12' there because it is an MPO-12 body with 8 of its positions used.
 */
import type { PortType } from '@/model/types';
import connectorsJson from '@/catalog/connectors.json';

export type ConnectorFamily = 'small' | 'multi';
export type ConnectorGender = 'pinned' | 'unpinned';

export interface ConnectorDef {
  /** Catalog id, e.g. 'LC-duplex', 'MPO-8'. */
  id: string;
  name: string;
  /** 'small' = one channel per plug (LC / SN / CS); 'multi' = many fibers per plug (MPO / MMC). */
  family: ConnectorFamily;
  /** Very-small-form-factor connector (SN, CS, MMC). */
  vsff: boolean;
  /** Fiber positions in the body. */
  positions: number;
  /** 1-based positions a leg of this connector carries, in fiber order (MPO-8 = 1-4, 9-12). */
  positionsUsed: number[];
  /** Fibers one leg carries (= positionsUsed.length). */
  fibersUsed: number;
  /** Pinned / unpinned choice; MPO and MMC only. */
  genderOptions?: ConnectorGender[];
  /** Display default for the boot (CSS colour). */
  color: string;
  /** The connector's name in the existing ERC / transceiver / CableDef vocabulary. */
  legacyConnector: string;
}

export const connectorCatalog: readonly ConnectorDef[] = connectorsJson as ConnectorDef[];

const byId = new Map(connectorCatalog.map((c) => [c.id, c] as const));

export function connectorById(id: string): ConnectorDef | undefined {
  return byId.get(id);
}

export function requireConnector(id: string): ConnectorDef {
  const def = byId.get(id);
  if (!def) throw new Error(`Unknown connector "${id}"`);
  return def;
}

/** Fibers one leg of this connector carries. */
export const fibersPerLeg = (def: ConnectorDef): number => def.fibersUsed;

/** The legacy name ('LC', 'MPO-12', …) of a catalog connector, if the id exists. */
export function legacyConnectorOf(id: string): string | undefined {
  return byId.get(id)?.legacyConnector;
}

// Same normalisation as the ERC helpers, so 'lc' / ' MPO-12 ' compare equal.
const normalize = (s: string): string => s.trim().toUpperCase();

/**
 * Catalog connectors a legacy name stands for, the one using every position of
 * its body first ('LC' → LC-duplex then LC-simplex, 'MPO-12' → MPO-12 then
 * MPO-8), so `[0]` is the sensible default when a legacy cable is upgraded.
 */
export function connectorsForLegacy(legacy: string): ConnectorDef[] {
  const key = normalize(legacy);
  return connectorCatalog.filter((c) => c.legacyConnector === key).sort((a, b) => b.fibersUsed - a.fibersUsed);
}

/** What a port offers a cable leg: its type and, for a pluggable cage, the assigned optic. */
export interface PortConnectorView {
  type: PortType;
  /** `TransceiverDef.connector` of the optic in a cage ('LC', 'MPO-12', 'MPO-16', 'integrated', …). */
  opticConnector?: string;
  /** `TransceiverDef.lanes` of that optic. */
  opticLanes?: number;
}

/**
 * Whether a leg ending in `connectorId` can plug into `port`.
 *
 * - Fixed LC port: LC-duplex or LC-simplex. Fixed MPO-12 port: MPO-12 or
 *   MPO-8 (same body). RJ45: never a fiber connector.
 * - A cage (SFP*, QSFP*, OSFP) accepts by its optic: 'LC' → LC-duplex only
 *   (transceivers are duplex); 'MPO-12' → MPO-12 always, MPO-8 when the optic
 *   uses at most 4 lanes (8 fibers; an unknown lane count is taken as this,
 *   the common case); anything else ('MPO-16', 'MMC-16', 'SN', …) by legacy
 *   name. An integrated (DAC / AOC) optic or an empty cage accepts nothing.
 */
export function portAcceptsConnector(port: PortConnectorView, connectorId: string): boolean {
  const def = byId.get(connectorId);
  if (!def) return false;
  switch (port.type) {
    case 'RJ45':
      return false;
    case 'LC':
      return def.legacyConnector === 'LC';
    case 'MPO-12':
      return def.legacyConnector === 'MPO-12';
    default:
      break;
  }
  const optic = port.opticConnector === undefined ? '' : normalize(port.opticConnector);
  if (optic === '' || optic === 'INTEGRATED') return false;
  if (optic === 'LC') return def.id === 'LC-duplex';
  if (optic === 'MPO-12') {
    if (def.id === 'MPO-12') return true;
    if (def.id === 'MPO-8') return port.opticLanes === undefined || port.opticLanes <= 4;
    return false;
  }
  return def.legacyConnector === optic;
}
