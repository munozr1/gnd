/**
 * Place-by-rule planner: "put SW* with role leaf at U42 of each rack in row
 * A", "fill SRV* bottom-up in R01–R06". Pure: `planPlaceByRule` returns the
 * placements it would make plus what it had to skip; the `placeByRule`
 * command in ./layout.ts applies them.
 *
 * Candidates are matched by ref glob (and value glob when `role` is given),
 * ordered naturally by ref; racks by the filter, ordered naturally by name.
 * Only unplaced candidates are considered unless `includePlaced` is set, in
 * which case placed ones are lifted out first and re-packed.
 */
import { globToRegExp } from '@/model/schematic';
import type { Component, Face, Id, Project, Rack } from '@/model/types';
import { compareNatural, snapshot } from './base';
import { heightUOf, occupiedRanges, type URange } from './placement';

export type PlaceMode = 'fixed-u' | 'fill-bottom-up' | 'fill-top-down';

export interface RackFilter {
  /** Rack row label (exact, case-insensitive). */
  row?: string;
  /** Rack names or globs ('R0?', 'R1*'). */
  names?: string[];
}

export interface PlaceRule {
  /** Ref pattern, e.g. 'SW*' or 'SRV1?'. */
  refGlob: string;
  /** Component value (role) pattern, e.g. 'leaf*'. */
  role?: string;
  rackFilter?: RackFilter;
  mode: PlaceMode;
  /** Bottom U for 'fixed-u'. */
  u?: number;
  /** Default 'front'. */
  face?: Face;
  /** Re-pack already-placed matches too (default: unplaced only). */
  includePlaced?: boolean;
}

export interface PlannedPlacement {
  componentId: Id;
  ref: string;
  rackId: Id;
  rackName: string;
  uPosition: number;
  heightU: number;
  face: Face;
}

export type PlaceSkipReason = 'no-rack' | 'no-space' | 'too-tall';

export interface PlaceSkip {
  componentId: Id;
  ref: string;
  reason: PlaceSkipReason;
  message: string;
}

export interface PlaceByRulePlan {
  placements: PlannedPlacement[];
  skipped: PlaceSkip[];
  /** Racks the rule matched, in fill order. */
  rackIds: Id[];
  /** Components the rule matched, in placement order. */
  candidateIds: Id[];
}

/** Racks matching a filter, in natural name order. */
export function matchRacks(project: Project, filter: RackFilter = {}): Rack[] {
  const nameRes = (filter.names ?? []).map((n) => globToRegExp(n.trim())).filter((re) => re.source !== '^$');
  const row = filter.row?.trim().toLowerCase();
  return project.racks
    .filter((r) => (row === undefined || row === '' ? true : (r.row ?? '').toLowerCase() === row))
    .filter((r) => (nameRes.length === 0 ? true : nameRes.some((re) => re.test(r.name))))
    .sort((a, b) => compareNatural(a.name, b.name));
}

/** Components matching the rule's ref / role globs, in natural ref order. */
export function matchCandidates(project: Project, rule: Pick<PlaceRule, 'refGlob' | 'role' | 'includePlaced'>): Component[] {
  const refRe = globToRegExp(rule.refGlob.trim());
  const roleRe = rule.role !== undefined && rule.role.trim() !== '' ? globToRegExp(rule.role.trim()) : null;
  const placed = new Set(
    project.placements.filter((p) => p.rackId !== null && p.uPosition !== null).map((p) => p.componentId),
  );
  return project.components
    .filter((c) => refRe.test(c.ref))
    .filter((c) => (roleRe ? roleRe.test(c.value ?? '') : true))
    .filter((c) => rule.includePlaced === true || !placed.has(c.id))
    .sort((a, b) => compareNatural(a.ref, b.ref));
}

interface RackSlots {
  rack: Rack;
  taken: URange[];
}

const free = (slots: RackSlots, range: URange): boolean =>
  range.bottom >= 1 &&
  range.top <= slots.rack.heightU &&
  !slots.taken.some((t) => t.bottom <= range.top && t.top >= range.bottom);

/** Lowest free bottom U for a device of height `h`, scanning up from U1. */
function lowestFree(slots: RackSlots, h: number): number | null {
  for (let u = 1; u + h - 1 <= slots.rack.heightU; u++) {
    if (free(slots, { bottom: u, top: u + h - 1 })) return u;
  }
  return null;
}

/** Highest free bottom U for a device of height `h`, scanning down from the top. */
function highestFree(slots: RackSlots, h: number): number | null {
  for (let u = slots.rack.heightU - h + 1; u >= 1; u--) {
    if (free(slots, { bottom: u, top: u + h - 1 })) return u;
  }
  return null;
}

/** Compute the placements a rule would make without touching the project. Throws on a malformed rule. */
export function planPlaceByRule(project: Project, rule: PlaceRule): PlaceByRulePlan {
  const view = snapshot(project);
  if (!rule.refGlob.trim()) throw new Error('Place by rule needs a ref pattern');
  if (rule.mode === 'fixed-u' && (rule.u === undefined || !Number.isInteger(rule.u) || rule.u < 1)) {
    throw new Error('Fixed-U placement needs a U position of 1 or more');
  }
  const face = rule.face ?? 'front';
  const racks = matchRacks(view, rule.rackFilter);
  const candidates = matchCandidates(view, rule);
  const candidateIds = new Set(candidates.map((c) => c.id));
  const slots: RackSlots[] = racks.map((rack) => ({
    rack,
    // Candidates being re-packed vacate their slots first.
    taken: occupiedRanges(view, rack.id)
      .filter((o) => !candidateIds.has(o.component.id))
      .map((o) => o.range),
  }));

  const placements: PlannedPlacement[] = [];
  const skipped: PlaceSkip[] = [];
  const tallest = Math.max(0, ...racks.map((r) => r.heightU));

  const put = (c: Component, s: RackSlots, u: number, h: number): void => {
    s.taken.push({ bottom: u, top: u + h - 1 });
    placements.push({ componentId: c.id, ref: c.ref, rackId: s.rack.id, rackName: s.rack.name, uPosition: u, heightU: h, face });
  };
  const skip = (c: Component, reason: PlaceSkipReason, message: string): void => {
    skipped.push({ componentId: c.id, ref: c.ref, reason, message });
  };

  if (rule.mode === 'fixed-u') {
    const u = rule.u!;
    let next = 0;
    for (const s of slots) {
      const c = candidates[next];
      if (!c) break;
      const h = heightUOf(view, c);
      if (!free(s, { bottom: u, top: u + h - 1 })) continue; // this rack's slot is taken; try the next rack
      put(c, s, u, h);
      next++;
    }
    for (const c of candidates.slice(next)) {
      skip(
        c,
        racks.length === 0 ? 'no-rack' : 'no-space',
        racks.length === 0 ? `${c.ref}: no rack matches the filter` : `${c.ref}: no matching rack has U${u} free`,
      );
    }
  } else {
    const pick = rule.mode === 'fill-bottom-up' ? lowestFree : highestFree;
    for (const c of candidates) {
      const h = heightUOf(view, c);
      if (racks.length === 0) {
        skip(c, 'no-rack', `${c.ref}: no rack matches the filter`);
        continue;
      }
      if (h > tallest) {
        skip(c, 'too-tall', `${c.ref} (${h}U) is taller than any matching rack`);
        continue;
      }
      let done = false;
      for (const s of slots) {
        const u = pick(s, h);
        if (u === null) continue;
        put(c, s, u, h);
        done = true;
        break;
      }
      if (!done) skip(c, 'no-space', `${c.ref} (${h}U): no room left in the matching racks`);
    }
  }

  return { placements, skipped, rackIds: racks.map((r) => r.id), candidateIds: candidates.map((c) => c.id) };
}
