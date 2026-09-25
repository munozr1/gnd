/**
 * Cable-definition commands: add, edit and delete a fiber cable definition in
 * the project's custom catalog (`customCatalog.cables`; a custom entry with a
 * built-in id overrides the built-in). A definition is its fiber fields
 * (`fiberCount`, `fiberType`, `sideA`, `sideB`, polarity, custom strand map,
 * …); the legacy fields the ERC / BOM / exports still read (`media`, `endA`,
 * `endB`, `color`, `diameterMm`, `breakout`) are regenerated from them on
 * every write so nothing can leave them stale. All three commands live in
 * the 'schematic' history.
 */
import { current, isDraft } from 'immer';
import { builtinCatalog } from '@/catalog';
import { fiberTypeFromMedia, resolveCable, validateCableDef } from '@/model/cables';
import type { CableDef, CableSideDef, FiberType, Project } from '@/model/types';
import { command, type Command } from '@/store/commands';
import { resultCommand, type ResultCommand } from './base';
import { slugify } from './customDevice';

const EDITOR = 'schematic';

/** Ids of definitions made in the Cable Builder: 'cbl.custom.<slug of the name>'. */
export const CUSTOM_CABLE_ID_PREFIX = 'cbl.custom.';

/**
 * What the Cable Builder hands over: a name and the fiber fields. Everything
 * else is optional — the legacy fields are derived, `color` / `diameterMm` /
 * `bendRadiusMm` default from the fiber type and count, and `id` is picked
 * from the name when absent.
 */
export interface FiberCableDefInput extends Partial<Omit<CableDef, 'name' | 'fiberCount' | 'fiberType' | 'sideA' | 'sideB'>> {
  name: string;
  fiberCount: number;
  fiberType: FiberType;
  sideA: CableSideDef;
  sideB: CableSideDef;
}

export type CableDefPatch = Partial<Omit<CableDef, 'id'>>;

/** Minimum bend radius from the outer diameter: ten diameters, never under 30 mm (the catalog seeds' rule). */
export function defaultBendRadiusMm(diameterMm: number): number {
  return Math.max(30, Math.round(diameterMm * 10));
}

/** 'cbl.custom.8f-om4-mpo-8-4-lc-duplex', with a '-2', '-3', … suffix when that id is taken. */
export function cableDefIdFor(name: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  const base = `${CUSTOM_CABLE_ID_PREFIX}${slugify(name) || 'cable'}`;
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!used.has(id)) return id;
  }
}

/**
 * A complete definition from the builder's input: throws the first
 * validation problem (empty name, unknown connector, uneven split, custom map
 * that is not a bijection, …), derives the legacy fields, defaults colour,
 * diameter and bend radius, and picks an id unused among `takenIds` when the
 * input has none. Optional fields that are unset stay absent.
 */
export function buildCableDef(input: FiberCableDefInput, takenIds: Iterable<string> = []): CableDef {
  const name = input.name.trim();
  if (!name) throw new Error('Cable name cannot be empty');
  const candidate: CableDef = stripUndefined({
    ...input,
    id: input.id ?? '',
    name,
    media: input.fiberType,
    mediaClass: 'fiber',
    endA: input.endA ?? '',
    endB: input.endB ?? '',
    color: input.color ?? '',
    bendRadiusMm: input.bendRadiusMm ?? 0,
    diameterMm: input.diameterMm ?? 0,
  });
  const problems = validateCableDef(candidate);
  if (problems.length > 0) throw new Error(problems[0]);
  const resolved = resolveCable(candidate);
  if ('error' in resolved) throw new Error(resolved.error);
  const bendRadiusMm =
    input.bendRadiusMm !== undefined && input.bendRadiusMm > 0 ? input.bendRadiusMm : defaultBendRadiusMm(resolved.diameterMm);
  return stripUndefined({
    ...candidate,
    id: input.id ?? cableDefIdFor(name, takenIds),
    ...resolved.legacy,
    bendRadiusMm,
  });
}

/** Every cable id the project can see (built-ins plus custom). */
const cableIds = (p: Project): Set<string> => {
  const ids = new Set(builtinCatalog.cables.map((c) => c.id));
  for (const c of p.customCatalog.cables) ids.add(c.id);
  return ids;
};

/**
 * Add a fiber cable definition to the project's catalog; `result` is its id.
 * Throws the first validation problem, or when an explicit id is already a
 * custom definition.
 */
export function addCableDef(input: FiberCableDefInput): ResultCommand<string> {
  return resultCommand(`Add cable ${input.name.trim() || 'definition'}`, EDITOR, (d) => {
    if (input.id !== undefined && d.customCatalog.cables.some((c) => c.id === input.id)) {
      throw new Error(`Cable definition "${input.id}" already exists`);
    }
    const def = buildCableDef(input, cableIds(d));
    d.customCatalog.cables.push(def);
    return def.id;
  });
}

/**
 * Change a fiber definition. A built-in one is copied into the custom
 * catalog first (custom entries override built-ins by id). The patched
 * definition is validated again and its legacy fields regenerated; pass
 * `strandMap: undefined` to drop a custom strand map, or `color: ''` to go
 * back to the fiber type's jacket colour.
 */
export function updateCableDef(id: string, patch: CableDefPatch): Command {
  return command(`Edit cable ${id}`, EDITOR, (d) => {
    const list = d.customCatalog.cables;
    let i = list.findIndex((c) => c.id === id);
    if (i < 0) {
      const builtin = builtinCatalog.cables.find((c) => c.id === id);
      if (!builtin) throw new Error(`Unknown cable definition "${id}"`);
      i = list.push(structuredClone(builtin)) - 1;
    }
    const base = list[i]!;
    const plain = isDraft(base) ? (current(base) as CableDef) : base;
    const merged: CableDef = { ...plain, ...patch, id };
    if (typeof merged.fiberCount !== 'number' || !merged.sideA || !merged.sideB) {
      throw new Error(`"${id}" is not a fiber cable definition`);
    }
    const fiberType = merged.fiberType ?? fiberTypeFromMedia(merged.media) ?? 'OM4';
    list[i] = buildCableDef({ ...merged, fiberType } as FiberCableDefInput);
  });
}

/**
 * Remove a custom definition. Refused while a link still uses it, unless a
 * built-in with the same id takes over (the custom entry was an override).
 */
export function deleteCableDef(id: string): Command {
  return command(`Delete cable ${id}`, EDITOR, (d) => {
    const list = d.customCatalog.cables;
    const i = list.findIndex((c) => c.id === id);
    if (i < 0) throw new Error(`"${id}" is not a custom cable definition`);
    const overridesBuiltin = builtinCatalog.cables.some((c) => c.id === id);
    const users = overridesBuiltin ? 0 : d.links.filter((l) => l.cableDefId === id).length;
    if (users > 0) throw new Error(`Cable definition "${id}" is used by ${users} link${users === 1 ? '' : 's'}`);
    list.splice(i, 1);
  });
}

/** Copy without the keys set to undefined, so persisted JSON and deep-equal tests see absent fields. */
function stripUndefined<T extends object>(obj: T): T {
  const out = { ...obj } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out as T;
}
