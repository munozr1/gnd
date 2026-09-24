/**
 * Read model for the library panel: catalog symbols with the facts a row
 * shows (height, port summary, custom-or-builtin), grouped by category and
 * filtered by a tokenised query. Pure.
 */
import { catalogIndex } from '@/catalog';
import type { FootprintDef, Project, SymbolDef } from '@/model/types';

export interface LibraryEntry {
  symbol: SymbolDef;
  /** Height of the symbol's default footprint, when it has one. */
  heightU: number | null;
  footprint: FootprintDef | null;
  /** '48×SFP28 + 8×QSFP28 + 1×RJ45'. */
  portSummary: string;
  /** From the project's custom catalog. */
  custom: boolean;
  category: string;
  /** Lower-cased haystack for `matchesLibraryQuery`. */
  searchText: string;
}

export interface LibraryGroup {
  category: string;
  entries: LibraryEntry[];
}

export const CUSTOM_CATEGORY = 'Custom';
const CATEGORY_ORDER = ['Switches', 'Servers', 'Patch panels', 'Panels'];

/** Count port types in order of first appearance: '48×SFP28 + 8×QSFP28'. */
export function summariseTypes(types: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  if (counts.size === 0) return 'no ports';
  return [...counts.entries()].map(([type, n]) => `${n}×${type}`).join(' + ');
}

/** Port summary of a symbol's pins. */
export const portSummary = (symbol: SymbolDef): string => summariseTypes(symbol.pins.map((p) => p.type));

export function libraryEntries(project: Project): LibraryEntry[] {
  const idx = catalogIndex(project);
  const customIds = new Set(project.customCatalog.symbols.map((s) => s.id));
  return idx.catalog.symbols.map((symbol) => {
    const custom = customIds.has(symbol.id);
    const footprint = idx.footprint(symbol.defaultFootprintIds[0]) ?? null;
    const category = custom ? CUSTOM_CATEGORY : (symbol.category ?? 'Other');
    const summary = portSummary(symbol);
    const searchText = [
      symbol.name,
      symbol.kind,
      symbol.refPrefix,
      category,
      summary,
      ...new Set(symbol.pins.map((p) => p.type)),
      ...(symbol.groups ?? []).map((g) => g.name),
      footprint?.model ?? '',
      footprint?.vendor ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return {
      symbol,
      heightU: footprint?.heightU ?? null,
      footprint,
      portSummary: summary,
      custom,
      category,
      searchText,
    };
  });
}

/** Every whitespace-separated token must occur somewhere in the entry's text. */
export function matchesLibraryQuery(entry: LibraryEntry, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  return tokens.every((t) => entry.searchText.includes(t));
}

const categoryRank = (c: string): number => {
  if (c === CUSTOM_CATEGORY) return Number.MAX_SAFE_INTEGER;
  const i = CATEGORY_ORDER.indexOf(c);
  return i < 0 ? CATEGORY_ORDER.length : i;
};

/** Filter by query and group by category (known categories first, Custom last, empty groups dropped). */
export function groupLibrary(entries: readonly LibraryEntry[], query = ''): LibraryGroup[] {
  const groups = new Map<string, LibraryEntry[]>();
  for (const e of entries) {
    if (!matchesLibraryQuery(e, query)) continue;
    const arr = groups.get(e.category);
    if (arr) arr.push(e);
    else groups.set(e.category, [e]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => categoryRank(a) - categoryRank(b) || a.localeCompare(b))
    .map(([category, list]) => ({ category, entries: list }));
}

/** Flat list in display order, for keyboard navigation. */
export function flattenGroups(groups: readonly LibraryGroup[]): LibraryEntry[] {
  return groups.flatMap((g) => g.entries);
}
