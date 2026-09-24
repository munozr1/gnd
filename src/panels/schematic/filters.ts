/**
 * Pure filtering helpers shared by the inspector, the assignment table and
 * the link list: ref globs, kind filters, tokenised free-text search.
 */
import { compareNatural } from '@/commands/base';
import type { ProjectIndex } from '@/model/query';
import { globMatch } from '@/model/schematic';
import type { Component, DeviceKind, Link } from '@/model/types';

const hasWildcard = (glob: string): boolean => /[*?]/.test(glob);

/**
 * Ref filter as typed in a filter box: empty matches everything, a pattern
 * with '*' / '?' is an anchored glob ('SRV*'), plain text is a case-insensitive
 * substring ('sw' matches 'SW12').
 */
export function matchesRefFilter(filter: string, ref: string): boolean {
  const f = filter.trim();
  if (!f) return true;
  if (hasWildcard(f)) return globMatch(f, ref);
  return ref.toLowerCase().includes(f.toLowerCase());
}

/** Bulk-assign globs are strict: '' still means everything, but plain text is an exact ref. */
export function normaliseRefGlob(input: string): string {
  const f = input.trim();
  return f === '' ? '*' : f;
}

/** Split 'eth0, eth1/*' into individual port globs. */
export function splitGlobs(input: string): string[] {
  return input
    .split(/[,\s]+/)
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
}

export type KindFilter = DeviceKind | 'all';

export interface ComponentFilter {
  ref?: string;
  kind?: KindFilter;
  /** Only components without a physical model or with an optical port on a link but no optic. */
  unassignedOnly?: boolean;
}

/** Ports of a component that carry a link (any lane). */
export function linkedPortIds(idx: ProjectIndex, componentId: string): Set<string> {
  const out = new Set<string>();
  for (const l of idx.linksOf(componentId)) {
    if (l.a.componentId === componentId) out.add(l.a.portId);
    if (l.b.componentId === componentId) out.add(l.b.portId);
  }
  return out;
}

/** Ports the inspector / assignment table show by default: linked, or carrying an optic. */
export function usedPortIds(idx: ProjectIndex, c: Component): Set<string> {
  const used = linkedPortIds(idx, c.id);
  for (const portId of Object.keys(c.optics)) used.add(portId);
  return used;
}

const OPTICAL_CAGE = new Set(['SFP', 'SFP+', 'SFP28', 'QSFP+', 'QSFP28', 'QSFP56', 'QSFP-DD', 'OSFP']);

/** Linked pluggable ports with no optic assigned (DAC/AOC links excepted). */
export function portsMissingOptic(idx: ProjectIndex, c: Component): string[] {
  const symbol = idx.symbolOf(c);
  if (!symbol) return [];
  const out: string[] = [];
  for (const l of idx.linksOf(c.id)) {
    const end = l.a.componentId === c.id ? l.a : l.b;
    const pin = symbol.pins.find((p) => p.portId === end.portId);
    if (!pin || !OPTICAL_CAGE.has(pin.type)) continue;
    if (c.optics[end.portId]) continue;
    if (idx.cableOf(l)?.integrated) continue;
    if (!out.includes(end.portId)) out.push(end.portId);
  }
  return out;
}

export function isUnassigned(idx: ProjectIndex, c: Component): boolean {
  return c.footprintDefId === null || portsMissingOptic(idx, c).length > 0;
}

export function filterComponents(idx: ProjectIndex, components: readonly Component[], filter: ComponentFilter): Component[] {
  const ref = filter.ref ?? '';
  const kind = filter.kind ?? 'all';
  return components.filter((c) => {
    if (!matchesRefFilter(ref, c.ref)) return false;
    if (kind !== 'all' && idx.symbolOf(c)?.kind !== kind) return false;
    if (filter.unassignedOnly && !isUnassigned(idx, c)) return false;
    return true;
  });
}

export const byRef = (a: Component, b: Component): number => compareNatural(a.ref, b.ref);

/** Every whitespace-separated token of `query` must occur in `text` (case-insensitive). */
export function matchesSearch(query: string, text: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return true;
  const hay = text.toLowerCase();
  return tokens.every((t) => hay.includes(t));
}

/** Searchable text for a link row: label, both end labels, cable and optic names. */
export function linkSearchText(idx: ProjectIndex, link: Link): string {
  const parts = [link.label ?? '', idx.endLabel(link.a), idx.endLabel(link.b), idx.cableOf(link)?.name ?? ''];
  const oa = idx.transceiverAt(link, link.a);
  const ob = idx.transceiverAt(link, link.b);
  if (oa) parts.push(oa.name);
  if (ob) parts.push(ob.name);
  return parts.join(' ');
}

/** Links sorted by label (natural), unlabeled ones after, by end labels. */
export function sortLinks(idx: ProjectIndex, links: readonly Link[]): Link[] {
  const key = (l: Link): string => l.label ?? `${idx.endLabel(l.a)} ${idx.endLabel(l.b)}`;
  return [...links].sort((a, b) => {
    const tier = Number(a.label === undefined) - Number(b.label === undefined);
    return tier || compareNatural(key(a), key(b));
  });
}
