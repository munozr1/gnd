/**
 * Upgrades a legacy fiber `CableDef` (only `media` / `endA` / `endB` /
 * `breakout`) to one that also carries the fiber fields, so saved projects
 * whose custom catalog predates configurable cables keep working. Pure and
 * idempotent; no React / Konva / Three.
 *
 * Mapping:
 * - Same legacy connector on both ends → one full-body leg each: LC ↔ LC is
 *   2F LC-duplex, MPO-12 ↔ MPO-12 is 12F MPO-12, MPO-16 ↔ MPO-16 is 16F, ….
 * - Different connectors → a trunk. The fanned-out side is the one whose
 *   full-body connector carries fewer fibers; with `breakout.fanout` f the
 *   cable has f × (fibers per small leg) fibers, else one full trunk leg.
 *   MPO-12 → LC with fanout 4 is 8F MPO-8 → 4×LC-duplex (the 8-fiber variant
 *   of the MPO-12 body), fanout 6 is 12F MPO-12 → 6×LC-duplex, MPO-24 →
 *   MPO-12 with fanout 2 is 24F MPO-24 → 2×MPO-12.
 * - `fiberType` from `media`: OS2 / OM3 / OM4 / OM5 as written, SMF → OS2,
 *   any other fiber media → OM4.
 * - `polarity` 'B' when either side is multi-fiber, 'A' for a duplex-only
 *   cord (the A-to-B cord; see strandMap.ts).
 * - Copper, DAC, AOC and 'integrated' ends, ends that are not fiber
 *   connectors, and definitions that already carry the fiber fields are
 *   returned unchanged (same reference).
 *
 * The legacy fields are left exactly as they were: they remain the vocabulary
 * the ERC rules and BOM read.
 */
import type { CableDef } from '@/model/types';
import { connectorsForLegacy, type ConnectorDef } from './connectors';
import { deriveSides } from './deriveSides';
import { defaultPolarity, fiberTypeFromMedia, isFiberCableDef } from './resolve';

const normalize = (s: string): string => s.trim().toUpperCase();

/** Whether a legacy definition is a fiber cable with connectorised ends (not DAC / AOC / copper). */
function isLegacyFiberCable(def: CableDef): boolean {
  if (def.mediaClass !== 'fiber' || def.integrated !== undefined) return false;
  const media = normalize(def.media);
  if (media === 'DAC' || media === 'AOC') return false;
  return normalize(def.endA) !== 'INTEGRATED' && normalize(def.endB) !== 'INTEGRATED';
}

/** The full-body connector a legacy name stands for, e.g. 'MPO-12' → MPO-12 (not MPO-8). */
const fullBody = (legacy: string): ConnectorDef | undefined => connectorsForLegacy(legacy)[0];

/** Among the catalog connectors of a legacy name, the one whose leg count fits `fiberCount` with the fewest legs. */
function fittingConnector(legacy: string, fiberCount: number): ConnectorDef | undefined {
  return connectorsForLegacy(legacy).find((c) => fiberCount % c.fibersUsed === 0);
}

interface FiberFields {
  fiberCount: number;
  connA: string;
  connB: string;
}

function fiberFieldsFor(def: CableDef): FiberFields | undefined {
  const bodyA = fullBody(def.endA);
  const bodyB = fullBody(def.endB);
  if (!bodyA || !bodyB) return undefined;

  if (bodyA.id === bodyB.id) {
    return { fiberCount: bodyA.fibersUsed, connA: bodyA.id, connB: bodyB.id };
  }

  // A trunk: the side with the smaller full-body connector fans out.
  const [trunk, small] = bodyA.fibersUsed >= bodyB.fibersUsed ? [bodyA, bodyB] : [bodyB, bodyA];
  const fanout = def.breakout?.fanout;
  const fiberCount = fanout !== undefined && fanout > 0 ? fanout * small.fibersUsed : trunk.fibersUsed;
  const trunkConn = fittingConnector(trunk.legacyConnector, fiberCount);
  const smallConn = fittingConnector(small.legacyConnector, fiberCount);
  if (!trunkConn || !smallConn) return undefined;
  const trunkIsA = trunk === bodyA;
  return {
    fiberCount,
    connA: trunkIsA ? trunkConn.id : smallConn.id,
    connB: trunkIsA ? smallConn.id : trunkConn.id,
  };
}

/**
 * The definition with fiber fields added, or the same object when it already
 * has them, is not a connectorised fiber cable, or cannot be mapped onto the
 * connector catalog.
 */
export function migrateLegacyCableDef(def: CableDef): CableDef {
  if (isFiberCableDef(def) || !isLegacyFiberCable(def)) return def;
  const fields = fiberFieldsFor(def);
  if (!fields) return def;
  if (!deriveSides(fields.fiberCount, fields.connA, fields.connB).ok) return def;
  return {
    ...def,
    fiberCount: fields.fiberCount,
    fiberType: fiberTypeFromMedia(def.media) ?? 'OM4',
    sideA: { connector: fields.connA },
    sideB: { connector: fields.connB },
    polarity: defaultPolarity(fields.connA, fields.connB),
  };
}

/** `migrateLegacyCableDef` over a list; the same array comes back when nothing changed. */
export function migrateLegacyCableDefs(defs: readonly CableDef[]): CableDef[] {
  let changed = false;
  const out = defs.map((d) => {
    const m = migrateLegacyCableDef(d);
    if (m !== d) changed = true;
    return m;
  });
  return changed ? out : (defs as CableDef[]);
}
