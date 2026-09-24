/**
 * Project JSON migrations and validation. `migrate` accepts anything parsed
 * from JSON (or read back from IndexedDB) and returns a well-formed Project,
 * upgrading older versions step by step and filling defaults for optional
 * fields that older files may lack.
 */
import { defaultRoom, defaultSettings, ROOT_SHEET_ID } from '@/model/factories';
import type { Project, Sheet } from '@/model/types';

export const CURRENT_PROJECT_VERSION = 1 as const;

export class ProjectParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectParseError';
  }
}

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Version-to-version upgrade steps, keyed by the version they upgrade FROM. */
const steps: Record<number, (raw: Raw) => Raw> = {};

export function migrate(raw: unknown, now: string = new Date().toISOString()): Project {
  if (!isObject(raw)) throw new ProjectParseError('Project must be a JSON object');
  let r: Raw = { ...raw };
  const version = r.version === undefined ? 1 : r.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ProjectParseError(`Invalid project version: ${String(version)}`);
  }
  if (version > CURRENT_PROJECT_VERSION) {
    throw new ProjectParseError(
      `Project version ${version} is newer than this app supports (${CURRENT_PROJECT_VERSION})`,
    );
  }
  for (let v = version; v < CURRENT_PROJECT_VERSION; v++) {
    const step = steps[v];
    if (!step) throw new ProjectParseError(`No migration from project version ${v}`);
    r = step(r);
  }
  return normalizeV1(r, now);
}

function requireString(r: Raw, key: string): string {
  const v = r[key];
  if (typeof v !== 'string' || v.length === 0) throw new ProjectParseError(`Project is missing '${key}'`);
  return v;
}

function optionalString(r: Raw, key: string, fallback: string): string {
  const v = r[key];
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function requireArray<T>(r: Raw, key: string, check: (item: unknown) => item is T): T[] {
  const v = r[key];
  if (!Array.isArray(v)) throw new ProjectParseError(`Project is missing '${key}'`);
  v.forEach((item, i) => {
    if (!check(item)) throw new ProjectParseError(`Project '${key}[${i}]' is malformed`);
  });
  return v as T[];
}

function optionalArray<T>(r: Raw, key: string): T[] {
  const v = r[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new ProjectParseError(`Project '${key}' must be an array`);
  return v as T[];
}

function optionalObject(r: Raw, key: string): Raw {
  const v = r[key];
  if (v === undefined || v === null) return {};
  if (!isObject(v)) throw new ProjectParseError(`Project '${key}' must be an object`);
  return v;
}

const hasId = (item: unknown): item is { id: string } => isObject(item) && typeof item.id === 'string';

const isSheetLike = (item: unknown): item is Sheet =>
  hasId(item) && typeof (item as Raw).name === 'string' && 'parentId' in item;

const isComponentLike = (item: unknown): item is Project['components'][number] =>
  hasId(item) && typeof (item as Raw).symbolDefId === 'string' && isObject((item as Raw).sch);

const isLinkEnd = (v: unknown): boolean =>
  isObject(v) && typeof v.componentId === 'string' && typeof v.portId === 'string';

const isLinkLike = (item: unknown): item is Project['links'][number] =>
  hasId(item) && isLinkEnd((item as Raw).a) && isLinkEnd((item as Raw).b);

function normalizeV1(r: Raw, now: string): Project {
  const id = requireString(r, 'id');
  const name = requireString(r, 'name');
  const sheets = requireArray(r, 'sheets', isSheetLike);
  const components = requireArray(r, 'components', isComponentLike).map((c) => ({
    ...c,
    footprintDefId: c.footprintDefId ?? null,
    optics: isObject(c.optics) ? c.optics : {},
  }));
  const links = requireArray(r, 'links', isLinkLike).map((l) => ({
    ...l,
    cableDefId: l.cableDefId ?? null,
    sch: isObject(l.sch) && Array.isArray(l.sch.wirePoints) ? l.sch : { wirePoints: [] },
  }));

  const createdAt = optionalString(r, 'createdAt', now);
  const customCatalog = optionalObject(r, 'customCatalog');
  const syncState = optionalObject(r, 'syncState');

  return {
    id,
    name,
    version: CURRENT_PROJECT_VERSION,
    rev: optionalString(r, 'rev', 'A'),
    createdAt,
    updatedAt: optionalString(r, 'updatedAt', createdAt),
    sheets: sheets.length > 0 ? sheets : [{ id: ROOT_SHEET_ID, name: 'Root', parentId: null }],
    components,
    links,
    room: { ...defaultRoom(), ...optionalObject(r, 'room') } as Project['room'],
    racks: optionalArray(r, 'racks'),
    placements: optionalArray(r, 'placements'),
    accessories: optionalArray(r, 'accessories'),
    trays: optionalArray(r, 'trays'),
    routes: optionalObject(r, 'routes') as Project['routes'],
    keepouts: optionalArray(r, 'keepouts'),
    syncState: {
      components: (optionalObject(syncState, 'components') as Project['syncState']['components']) ?? {},
      links: (optionalObject(syncState, 'links') as Project['syncState']['links']) ?? {},
    },
    backAnnotations: optionalArray(r, 'backAnnotations'),
    customCatalog: {
      symbols: optionalArray(customCatalog, 'symbols'),
      footprints: optionalArray(customCatalog, 'footprints'),
      transceivers: optionalArray(customCatalog, 'transceivers'),
      cables: optionalArray(customCatalog, 'cables'),
    },
    settings: { ...defaultSettings(), ...optionalObject(r, 'settings') } as Project['settings'],
  };
}
