/**
 * Turns a stored fiber `CableDef` into everything the app shows or checks:
 * legs, kind, channels, strand map, display name, summary and the legacy
 * fields (`media`, `endA`, …) the ERC rules and BOM still read. Pure and
 * memoised by definition identity; no React / Konva / Three.
 */
import type { CableDef, CablePolarity, FiberType, StrandLink } from '@/model/types';
import { connectorById, legacyConnectorOf } from './connectors';
import { deriveSides, type CableKind, type ResolvedSide } from './deriveSides';
import { deriveStrandMap, isBijection } from './strandMap';

/** The legacy vocabulary of a fiber cable, as the ERC / BOM / export code reads it. */
export interface LegacyCableFields {
  /** The fiber type, e.g. 'OM4'. */
  media: string;
  mediaClass: 'fiber';
  /** 'LC' | 'MPO-12' | 'MPO-16' | … (an MPO-8 leg is an 'MPO-12' body). */
  endA: string;
  endB: string;
  color: string;
  diameterMm: number;
  /** Legs on the fanned-out side of a trunk. */
  breakout?: { fanout: number };
}

/** The part of a resolved cable the naming and legacy helpers need. */
export interface CableSpec {
  fiberCount: number;
  fiberType: FiberType;
  sideA: ResolvedSide;
  sideB: ResolvedSide;
  kind: CableKind;
}

export interface ResolvedCable extends CableSpec {
  def: CableDef;
  channels: number;
  polarity: CablePolarity;
  strandMap: StrandLink[];
  /** True when `def.strandMap` was set by the user and is used instead of the derived map. */
  strandMapCustom: boolean;
  /** Jacket-to-legs length of a trunk (0 for a straight cable). */
  breakoutLengthM: number;
  diameterMm: number;
  color: string;
  /** '8F OM4 MPO-8 → 4×LC-duplex'. */
  displayName: string;
  /** '8F OM4 · Trunk (breakout) · MPO-8 → 4×LC-duplex · 4 channels'. */
  summary: string;
  legacy: LegacyCableFields;
}

export const DEFAULT_BREAKOUT_LENGTH_M = 0.5;

/** A definition that carries the fiber fields (as opposed to a legacy-only, copper, DAC or AOC one). */
export function isFiberCableDef(def: CableDef): boolean {
  return (
    typeof def.fiberCount === 'number' &&
    typeof def.sideA?.connector === 'string' &&
    typeof def.sideB?.connector === 'string'
  );
}

/** 'OM4' → 'OM4'; 'SMF' / 'OS1' → 'OS2'; anything else that is not a fiber type → undefined. */
export function fiberTypeFromMedia(media: string | undefined): FiberType | undefined {
  const m = (media ?? '').trim().toUpperCase();
  if (m === 'OS2' || m === 'OM3' || m === 'OM4' || m === 'OM5') return m;
  if (m.startsWith('OS') || m === 'SMF') return 'OS2';
  if (m.startsWith('OM') || m === 'MMF') return 'OM4';
  return undefined;
}

/** Default polarity: 'B' when either side is a multi-fiber connector, else 'A' (a duplex cord). */
export function defaultPolarity(connA: string, connB: string): CablePolarity {
  const multi = (id: string): boolean => connectorById(id)?.family === 'multi';
  return multi(connA) || multi(connB) ? 'B' : 'A';
}

/** Jacket colour by fiber type: OS2 yellow, OM3 / OM4 aqua, OM5 lime. */
export function defaultJacketColor(fiberType: FiberType): string {
  switch (fiberType) {
    case 'OS2':
      return '#facc15';
    case 'OM5':
      return '#a3e635';
    case 'OM3':
    case 'OM4':
      return '#2dd4bf';
  }
}

/** Outer diameter (mm) by fiber count; the table is the stock sizes, anything else is interpolated and rounded up to 0.5 mm. */
const DIAMETER_TABLE: readonly (readonly [fibers: number, mm: number])[] = [
  [2, 2.0],
  [8, 3.0],
  [12, 3.5],
  [16, 4.0],
  [24, 5.0],
  [32, 6.0],
  [48, 7.5],
  [72, 9.0],
  [96, 10.5],
  [144, 12.0],
];

export function diameterForFiberCount(fiberCount: number): number {
  const first = DIAMETER_TABLE[0]!;
  const last = DIAMETER_TABLE[DIAMETER_TABLE.length - 1]!;
  if (!Number.isFinite(fiberCount) || fiberCount <= first[0]) return first[1];
  const exact = DIAMETER_TABLE.find(([n]) => n === fiberCount);
  if (exact) return exact[1];
  const roundUpHalf = (mm: number): number => Math.ceil(mm * 2) / 2;
  if (fiberCount > last[0]) {
    // Extrapolate along the last segment's slope.
    const prev = DIAMETER_TABLE[DIAMETER_TABLE.length - 2]!;
    const slope = (last[1] - prev[1]) / (last[0] - prev[0]);
    return roundUpHalf(last[1] + slope * (fiberCount - last[0]));
  }
  const hiIndex = DIAMETER_TABLE.findIndex(([n]) => n > fiberCount);
  const lo = DIAMETER_TABLE[hiIndex - 1]!;
  const hi = DIAMETER_TABLE[hiIndex]!;
  const t = (fiberCount - lo[0]) / (hi[0] - lo[0]);
  return roundUpHalf(lo[1] + t * (hi[1] - lo[1]));
}

/** 'MPO-8' for one leg, '4×LC-duplex' for several. */
const sideLabel = (side: ResolvedSide): string =>
  side.legs.length === 1 ? side.connector : `${side.legs.length}×${side.connector}`;

const arrow = (kind: CableKind): string => (kind === 'trunk' ? '→' : '↔');

/** '8F OM4 MPO-8 → 4×LC-duplex'; '12F OM4 MPO-12 ↔ MPO-12'; '144F OS2 12×MPO-12 ↔ 12×MPO-12'. */
export function cableDisplayName(spec: CableSpec): string {
  return `${spec.fiberCount}F ${spec.fiberType} ${sideLabel(spec.sideA)} ${arrow(spec.kind)} ${sideLabel(spec.sideB)}`;
}

/** '8F OM4 · Trunk (breakout) · MPO-8 → 4×LC-duplex · 4 channels'. */
export function cableSummary(spec: CableSpec): string {
  const channels = spec.fiberCount / 2;
  const kind = spec.kind === 'trunk' ? 'Trunk (breakout)' : 'Straight';
  const ends = `${sideLabel(spec.sideA)} ${arrow(spec.kind)} ${sideLabel(spec.sideB)}`;
  return `${spec.fiberCount}F ${spec.fiberType} · ${kind} · ${ends} · ${channels} ${channels === 1 ? 'channel' : 'channels'}`;
}

/**
 * The legacy fields a fiber cable must carry for the existing ERC connector /
 * media rules, BOM and exports. `endA` / `endB` are the connectors' legacy
 * names and `breakout.fanout` the leg count of a trunk's fanned-out side.
 */
export function legacyFieldsFor(spec: CableSpec & { color: string; diameterMm: number }): LegacyCableFields {
  const legs = Math.max(spec.sideA.legs.length, spec.sideB.legs.length);
  return {
    media: spec.fiberType,
    mediaClass: 'fiber',
    endA: legacyConnectorOf(spec.sideA.connector) ?? spec.sideA.connector,
    endB: legacyConnectorOf(spec.sideB.connector) ?? spec.sideB.connector,
    color: spec.color,
    diameterMm: spec.diameterMm,
    breakout: spec.kind === 'trunk' ? { fanout: legs } : undefined,
  };
}

/**
 * Everything wrong with a fiber definition, as user-facing messages: missing
 * fields, an unknown connector or a fiber count that does not split into
 * legs, a custom strand map that is not a bijection, a negative breakout
 * length or an invalid polarity. Empty when the definition is sound.
 */
export function validateCableDef(def: CableDef): string[] {
  const problems: string[] = [];
  if (typeof def.fiberCount !== 'number') problems.push('Fiber count is required.');
  if (typeof def.sideA?.connector !== 'string' || def.sideA.connector === '') problems.push('Side A connector is required.');
  if (typeof def.sideB?.connector !== 'string' || def.sideB.connector === '') problems.push('Side B connector is required.');
  if (problems.length > 0) return problems;

  const sides = deriveSides(def.fiberCount!, def.sideA!.connector, def.sideB!.connector);
  if (!sides.ok) problems.push(sides.error);
  else if (def.strandMap !== undefined) {
    const check = isBijection(def.strandMap, sides.sideA, sides.sideB);
    if (!check.ok) problems.push(...check.problems.map((p) => `Custom strand map: ${p}.`));
  }
  if (def.breakoutLengthM !== undefined && !(Number.isFinite(def.breakoutLengthM) && def.breakoutLengthM >= 0)) {
    problems.push('Breakout length must be 0 m or more.');
  }
  if (def.polarity !== undefined && def.polarity !== 'A' && def.polarity !== 'B' && def.polarity !== 'C') {
    problems.push(`Polarity must be A, B or C, got "${String(def.polarity)}".`);
  }
  return problems;
}

const cache = new WeakMap<CableDef, ResolvedCable | { error: string }>();

/**
 * Resolve a fiber definition. Memoised by `def` identity (definitions are
 * immutable Immer objects, so a change is a new object). A definition without
 * the fiber fields, an unknown connector or a fiber count that does not split
 * evenly resolves to `{ error }`; a custom strand map is passed through as is
 * (`validateCableDef` reports when it is not a bijection).
 */
export function resolveCable(def: CableDef): ResolvedCable | { error: string } {
  const hit = cache.get(def);
  if (hit) return hit;
  const result = resolve(def);
  cache.set(def, result);
  return result;
}

function resolve(def: CableDef): ResolvedCable | { error: string } {
  if (!isFiberCableDef(def)) {
    return { error: `"${def.name || def.id}" has no fiber definition (fiberCount, sideA and sideB are required).` };
  }
  const fiberCount = def.fiberCount!;
  const sideA = def.sideA!;
  const sideB = def.sideB!;
  const sides = deriveSides(fiberCount, sideA.connector, sideB.connector, {
    legLabelsA: sideA.legLabels,
    legLabelsB: sideB.legLabels,
    legColorsA: sideA.legColors,
    legColorsB: sideB.legColors,
  });
  if (!sides.ok) return { error: sides.error };

  const fiberType = def.fiberType ?? fiberTypeFromMedia(def.media) ?? 'OM4';
  const polarity = def.polarity ?? defaultPolarity(sideA.connector, sideB.connector);
  const strandMapCustom = def.strandMap !== undefined;
  const strandMap = strandMapCustom ? def.strandMap! : deriveStrandMap(fiberCount, sides.sideA, sides.sideB, polarity);
  const color = def.color || defaultJacketColor(fiberType);
  const diameterMm = def.diameterMm > 0 ? def.diameterMm : diameterForFiberCount(fiberCount);
  const spec: CableSpec = { fiberCount, fiberType, sideA: sides.sideA, sideB: sides.sideB, kind: sides.kind };
  return {
    ...spec,
    def,
    channels: sides.channels,
    polarity,
    strandMap,
    strandMapCustom,
    breakoutLengthM: def.breakoutLengthM ?? (sides.kind === 'trunk' ? DEFAULT_BREAKOUT_LENGTH_M : 0),
    diameterMm,
    color,
    displayName: cableDisplayName(spec),
    summary: cableSummary(spec),
    legacy: legacyFieldsFor({ ...spec, color, diameterMm }),
  };
}
