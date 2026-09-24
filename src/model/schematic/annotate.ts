/**
 * Reference designator annotation: 'SW1', 'SRV12', 'PP3'. Numbering is per
 * prefix across the whole project. A ref ending in '?' ('SW?') is unannotated.
 */
import { catalogIndex } from '@/catalog';
import type { Component, Id, Project } from '../types';
import { sheetOrder, sheetSubtreeIds } from './hierarchy';

export interface AnnotateOptions {
  /** 'unannotated' (default) numbers only '?' refs; 'all' renumbers every ref in scope. */
  scope?: 'all' | 'unannotated';
  /** Restrict to a sheet and its descendants. */
  sheetId?: Id;
}

export interface RefChange {
  componentId: Id;
  from: string;
  to: string;
}

const REF_RE = /^([A-Za-z]+)(\d+)$/;

export const isUnannotated = (ref: string): boolean => ref.endsWith('?') || ref.length === 0;

export function parseRef(ref: string): { prefix: string; n: number } | null {
  const m = REF_RE.exec(ref);
  if (!m) return null;
  return { prefix: m[1]!, n: Number(m[2]) };
}

/** Prefix a component numbers under: its symbol's refPrefix, else the alpha head of its ref, else 'U'. */
export function refPrefixOf(project: Project, component: Component): string {
  const symbol = catalogIndex(project).symbol(component.symbolDefId);
  if (symbol?.refPrefix) return symbol.refPrefix;
  const m = /^([A-Za-z]+)/.exec(component.ref);
  return m?.[1] ?? 'U';
}

function usedNumbers(components: readonly Component[]): Map<string, Set<number>> {
  const used = new Map<string, Set<number>>();
  for (const c of components) {
    const parsed = parseRef(c.ref);
    if (!parsed) continue;
    let set = used.get(parsed.prefix);
    if (!set) {
      set = new Set();
      used.set(parsed.prefix, set);
    }
    set.add(parsed.n);
  }
  return used;
}

function lowestFree(used: Map<string, Set<number>>, prefix: string, cursor: Map<string, number>): number {
  const set = used.get(prefix);
  let n = cursor.get(prefix) ?? 1;
  while (set?.has(n)) n++;
  cursor.set(prefix, n + 1);
  return n;
}

/** Smallest unused '<prefix><n>' in the project (fills gaps, like KiCad's "first free number"). */
export function nextRef(project: Project, prefix: string): string {
  const used = usedNumbers(project.components);
  return `${prefix}${lowestFree(used, prefix, new Map())}`;
}

/** Components sorted for numbering: sheet hierarchy order, then y, then x, then array order. */
export function annotationOrder(project: Project, components: readonly Component[]): Component[] {
  const rank = new Map(sheetOrder(project).map((id, i) => [id, i] as const));
  const index = new Map(project.components.map((c, i) => [c.id, i] as const));
  return [...components].sort((a, b) => {
    const ra = rank.get(a.sch.sheetId) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.sch.sheetId) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    if (a.sch.pos.y !== b.sch.pos.y) return a.sch.pos.y - b.sch.pos.y;
    if (a.sch.pos.x !== b.sch.pos.x) return a.sch.pos.x - b.sch.pos.x;
    return (index.get(a.id) ?? 0) - (index.get(b.id) ?? 0);
  });
}

/**
 * Assign reference designators in place. Returns the refs that changed so the
 * caller can record a command / feed F8's ref-renamed detection.
 */
export function annotate(draft: Project, opts: AnnotateOptions = {}): RefChange[] {
  const scope = opts.scope ?? 'unannotated';
  const sheetScope = opts.sheetId ? new Set(sheetSubtreeIds(draft, opts.sheetId)) : null;
  const inScope = (c: Component): boolean => sheetScope === null || sheetScope.has(c.sch.sheetId);

  const targets = annotationOrder(
    draft,
    draft.components.filter((c) => inScope(c) && (scope === 'all' || isUnannotated(c.ref))),
  );
  const targetIds = new Set(targets.map((c) => c.id));
  // Numbers held by everything that keeps its ref stay reserved.
  const used = usedNumbers(draft.components.filter((c) => !targetIds.has(c.id)));
  const cursor = new Map<string, number>();

  const changes: RefChange[] = [];
  for (const c of targets) {
    const prefix = refPrefixOf(draft, c);
    const n = lowestFree(used, prefix, cursor);
    let set = used.get(prefix);
    if (!set) {
      set = new Set();
      used.set(prefix, set);
    }
    set.add(n);
    const to = `${prefix}${n}`;
    if (c.ref !== to) {
      changes.push({ componentId: c.id, from: c.ref, to });
      c.ref = to;
    }
  }
  return changes;
}

/** Refs used by more than one component (bad state; ERC should flag). */
export function duplicateRefs(project: Project): Map<string, Component[]> {
  const byRef = new Map<string, Component[]>();
  for (const c of project.components) {
    if (isUnannotated(c.ref)) continue;
    const arr = byRef.get(c.ref);
    if (arr) arr.push(c);
    else byRef.set(c.ref, [c]);
  }
  for (const [ref, comps] of byRef) if (comps.length < 2) byRef.delete(ref);
  return byRef;
}
