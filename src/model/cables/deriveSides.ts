/**
 * Splits a cable's fibers into legs on each end from its fiber count and the
 * connector on each side. Pure; legs, kind and channel count are derived on
 * demand from (fiberCount, connA, connB) and never stored as source of truth.
 */
import { connectorById, connectorCatalog, fibersPerLeg, type ConnectorDef, type ConnectorFamily } from './connectors';

/** One connector on one end of a cable. `index` is 0-based; `positions` are 1-based. */
export interface Leg {
  index: number;
  /** '1', '2', … for small legs; 'A', 'B', … for multi-fiber legs, unless overridden. */
  label: string;
  /** Fiber positions this leg carries, in fiber order (the connector's positionsUsed). */
  positions: number[];
  color?: string;
}

export interface ResolvedSide {
  connector: string;
  legs: Leg[];
}

/** Straight when both ends have the same number of legs, else a trunk (breakout). */
export type CableKind = 'straight' | 'trunk';

export type DeriveSidesResult =
  | { ok: true; sideA: ResolvedSide; sideB: ResolvedSide; kind: CableKind; channels: number }
  | { ok: false; error: string };

export interface DeriveSidesOptions {
  /** Per-leg overrides by leg index; a missing or empty entry keeps the default. */
  legLabelsA?: string[];
  legLabelsB?: string[];
  legColorsA?: string[];
  legColorsB?: string[];
}

export function deriveSides(
  fiberCount: number,
  connA: string,
  connB: string,
  opts: DeriveSidesOptions = {},
): DeriveSidesResult {
  if (!Number.isInteger(fiberCount) || fiberCount <= 0 || fiberCount % 2 !== 0) {
    return { ok: false, error: `Fiber count must be a positive even number, got ${fiberCount}.` };
  }
  const defA = connectorById(connA);
  if (!defA) return { ok: false, error: `Unknown connector "${connA}".` };
  const defB = connectorById(connB);
  if (!defB) return { ok: false, error: `Unknown connector "${connB}".` };

  const sideA = resolveSide(fiberCount, defA, opts.legLabelsA, opts.legColorsA);
  if (typeof sideA === 'string') return { ok: false, error: sideA };
  const sideB = resolveSide(fiberCount, defB, opts.legLabelsB, opts.legColorsB);
  if (typeof sideB === 'string') return { ok: false, error: sideB };

  return {
    ok: true,
    sideA,
    sideB,
    kind: sideA.legs.length === sideB.legs.length ? 'straight' : 'trunk',
    channels: fiberCount / 2,
  };
}

/** Default leg label: '1', '2', … for small connectors, 'A', 'B', …, 'Z', 'AA', … for multi-fiber ones. */
export function defaultLegLabel(family: ConnectorFamily, index: number): string {
  if (family === 'small') return String(index + 1);
  let n = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return label;
}

/**
 * Connectors that do split `fiberCount` evenly, for the "use X or Y" hint:
 * same family and form factor as `failed` first, then same family, then any;
 * within a tier the connector giving the fewest legs first.
 */
export function connectorAlternatives(fiberCount: number, failed: ConnectorDef): ConnectorDef[] {
  const fits = connectorCatalog.filter((c) => c.id !== failed.id && fiberCount % c.fibersUsed === 0);
  const tiers = [
    fits.filter((c) => c.family === failed.family && c.vsff === failed.vsff),
    fits.filter((c) => c.family === failed.family),
    fits,
  ];
  return [...(tiers.find((t) => t.length > 0) ?? [])].sort((a, b) => b.fibersUsed - a.fibersUsed);
}

/** The side, or the validation message when the fibers do not divide into whole legs. */
function resolveSide(
  fiberCount: number,
  def: ConnectorDef,
  labels: string[] | undefined,
  colors: string[] | undefined,
): ResolvedSide | string {
  const per = fibersPerLeg(def);
  if (fiberCount % per !== 0) return splitError(fiberCount, def);
  const count = fiberCount / per;
  const legs: Leg[] = [];
  for (let i = 0; i < count; i++) {
    const leg: Leg = {
      index: i,
      label: override(labels, i) ?? defaultLegLabel(def.family, i),
      positions: [...def.positionsUsed],
    };
    const color = override(colors, i);
    if (color !== undefined) leg.color = color;
    legs.push(leg);
  }
  return { connector: def.id, legs };
}

/** A non-empty per-leg override, else undefined. */
function override(list: string[] | undefined, i: number): string | undefined {
  const v = list?.[i];
  return v === undefined || v === '' ? undefined : v;
}

function splitError(fiberCount: number, def: ConnectorDef): string {
  const head = `${fiberCount} fibers can't be split evenly into ${def.id} legs (${def.fibersUsed} each).`;
  const alternatives = connectorAlternatives(fiberCount, def).map((c) => c.id);
  return alternatives.length === 0 ? head : `${head} Use ${joinOr(alternatives)}.`;
}

const joinOr = (items: string[]): string =>
  items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
