import type {
  AccessoryDef,
  CableDef,
  Catalog,
  FootprintDef,
  Project,
  RackDef,
  SymbolDef,
  TransceiverDef,
  TrayDef,
} from '@/model/types';
import symbols from './symbols.json';
import footprints from './footprints.json';
import transceivers from './transceivers.json';
import cables from './cables.json';
import racks from './racks.json';
import trays from './trays.json';
import accessories from './accessories.json';

/** The built-in starter catalog (generic, vendor-neutral). */
export const builtinCatalog: Catalog = {
  symbols: symbols as SymbolDef[],
  footprints: footprints as FootprintDef[],
  transceivers: transceivers as TransceiverDef[],
  cables: cables as CableDef[],
  racks: racks as RackDef[],
  trays: trays as TrayDef[],
  accessories: accessories as AccessoryDef[],
};

/**
 * Merge the built-in catalog with a project's custom catalog. Custom entries
 * with the same id override built-ins.
 */
export function resolveCatalog(project?: Pick<Project, 'customCatalog'> | null): Catalog {
  if (!project) return builtinCatalog;
  const merge = <T extends { id: string }>(base: T[], extra: T[]): T[] => {
    if (extra.length === 0) return base;
    const map = new Map(base.map((x) => [x.id, x] as const));
    for (const x of extra) map.set(x.id, x);
    return [...map.values()];
  };
  return {
    symbols: merge(builtinCatalog.symbols, project.customCatalog.symbols),
    footprints: merge(builtinCatalog.footprints, project.customCatalog.footprints),
    transceivers: merge(builtinCatalog.transceivers, project.customCatalog.transceivers),
    cables: merge(builtinCatalog.cables, project.customCatalog.cables),
    racks: builtinCatalog.racks,
    trays: builtinCatalog.trays,
    accessories: builtinCatalog.accessories,
  };
}

export class CatalogIndex {
  readonly symbols: Map<string, SymbolDef>;
  readonly footprints: Map<string, FootprintDef>;
  readonly transceivers: Map<string, TransceiverDef>;
  readonly cables: Map<string, CableDef>;
  readonly racks: Map<string, RackDef>;
  readonly trays: Map<string, TrayDef>;
  readonly accessories: Map<string, AccessoryDef>;

  constructor(readonly catalog: Catalog) {
    this.symbols = new Map(catalog.symbols.map((s) => [s.id, s]));
    this.footprints = new Map(catalog.footprints.map((f) => [f.id, f]));
    this.transceivers = new Map(catalog.transceivers.map((t) => [t.id, t]));
    this.cables = new Map(catalog.cables.map((c) => [c.id, c]));
    this.racks = new Map(catalog.racks.map((r) => [r.id, r]));
    this.trays = new Map(catalog.trays.map((t) => [t.id, t]));
    this.accessories = new Map(catalog.accessories.map((a) => [a.id, a]));
  }

  symbol(id: string): SymbolDef | undefined {
    return this.symbols.get(id);
  }
  footprint(id: string | null | undefined): FootprintDef | undefined {
    return id ? this.footprints.get(id) : undefined;
  }
  transceiver(id: string | null | undefined): TransceiverDef | undefined {
    return id ? this.transceivers.get(id) : undefined;
  }
  cable(id: string | null | undefined): CableDef | undefined {
    return id ? this.cables.get(id) : undefined;
  }
}

const indexCache = new WeakMap<object, CatalogIndex>();
const builtinIndex = new CatalogIndex(builtinCatalog);

/** Cached index for a project's resolved catalog (keyed on the customCatalog object identity). */
export function catalogIndex(project?: Pick<Project, 'customCatalog'> | null): CatalogIndex {
  if (!project) return builtinIndex;
  const key = project.customCatalog;
  const c = project.customCatalog;
  if (
    c.symbols.length === 0 &&
    c.footprints.length === 0 &&
    c.transceivers.length === 0 &&
    c.cables.length === 0
  ) {
    return builtinIndex;
  }
  let idx = indexCache.get(key);
  if (!idx) {
    idx = new CatalogIndex(resolveCatalog(project));
    indexCache.set(key, idx);
  }
  return idx;
}
