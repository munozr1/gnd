/**
 * Placement helpers shared by the layout commands and the place-by-rule
 * planner. `checkUFit` applies the same rules as the DRC 'u-collision' rule
 * (below U1, above the rack top, overlapping another device) to a
 * *prospective* placement, so a command can refuse it up front.
 */
import { catalogIndex } from '@/catalog';
import { createPlacement } from '@/model/factories';
import * as routing from '@/model/routing';
import type { Component, Face, Id, Placement, Project, Rack } from '@/model/types';
import { compareNatural, snapshot } from './base';

export interface PlacementTarget {
  componentId: Id;
  rackId: Id;
  /** Bottom U, 1-based. */
  uPosition: number;
  face?: Face;
}

export interface URange {
  bottom: number;
  top: number;
}

export const uLabel = (r: URange): string => (r.bottom === r.top ? `U${r.bottom}` : `U${r.bottom}–U${r.top}`);

/** Height in U of a component: its footprint's, or 1 without one. Works on drafts. */
export function heightUOf(project: Project, c: Component): number {
  return catalogIndex(project).footprint(c.footprintDefId)?.heightU ?? 1;
}

/** Devices placed in a rack with their U ranges (excluding `ignoreComponentId`), sorted bottom-up. */
export function occupiedRanges(project: Project, rackId: Id, ignoreComponentId?: Id): { component: Component; range: URange }[] {
  const byId = new Map(project.components.map((c) => [c.id, c] as const));
  const out: { component: Component; range: URange }[] = [];
  for (const p of project.placements) {
    if (p.rackId !== rackId || p.uPosition === null || p.componentId === ignoreComponentId) continue;
    const c = byId.get(p.componentId);
    if (!c) continue;
    const h = heightUOf(project, c);
    out.push({ component: c, range: { bottom: p.uPosition, top: p.uPosition + h - 1 } });
  }
  return out.sort((a, b) => a.range.bottom - b.range.bottom);
}

/** Whether a U range is free of other devices in a rack (ignoring one component, e.g. the one being moved). */
export function isURangeFree(project: Project, rackId: Id, range: URange, ignoreComponentId?: Id): boolean {
  return !occupiedRanges(project, rackId, ignoreComponentId).some(
    ({ range: r }) => r.bottom <= range.top && r.top >= range.bottom,
  );
}

/**
 * Error message when a device cannot sit at the target (unknown rack /
 * component, below U1, over the rack top, overlapping another device), or
 * null when it fits. The component's own current placement is ignored.
 */
export function checkUFit(project: Project, target: PlacementTarget): string | null {
  const c = project.components.find((x) => x.id === target.componentId);
  if (!c) return `Component not found: ${target.componentId}`;
  const rack = project.racks.find((r) => r.id === target.rackId);
  if (!rack) return `Rack not found: ${target.rackId}`;
  if (!Number.isInteger(target.uPosition)) return `U position must be a whole number (got ${target.uPosition})`;
  const h = heightUOf(project, c);
  const range: URange = { bottom: target.uPosition, top: target.uPosition + h - 1 };
  if (range.bottom < 1) return `${c.ref} (${uLabel(range)}) is below U1 of rack ${rack.name}`;
  if (range.top > rack.heightU) return `${c.ref} (${uLabel(range)}) exceeds the ${rack.heightU}U height of rack ${rack.name}`;
  for (const other of occupiedRanges(project, rack.id, c.id)) {
    if (other.range.bottom <= range.top && other.range.top >= range.bottom) {
      return `${c.ref} (${uLabel(range)}) overlaps ${other.component.ref} (${uLabel(other.range)}) in rack ${rack.name}`;
    }
  }
  return null;
}

/**
 * Put a device in a rack slot on an Immer draft, creating its placement row
 * when the layout has none yet. Throws when it does not fit. Returns the
 * placement.
 */
export function placeDevice(draft: Project, target: PlacementTarget): Placement {
  const error = checkUFit(draft, target);
  if (error) throw new Error(error);
  let placement = draft.placements.find((p) => p.componentId === target.componentId);
  if (!placement) {
    placement = createPlacement(target.componentId);
    draft.placements.push(placement);
  }
  placement.rackId = target.rackId;
  placement.uPosition = target.uPosition;
  placement.face = target.face ?? placement.face;
  return placement;
}

/** Clear a device's rack slot (it returns to the Unplaced bin). Returns false when it was already unplaced. */
export function unplaceDevice(draft: Project, componentId: Id): boolean {
  const p = draft.placements.find((x) => x.componentId === componentId);
  if (!p || (p.rackId === null && p.uPosition === null)) return false;
  p.rackId = null;
  p.uPosition = null;
  return true;
}

/**
 * After a device moved: re-dress the in-rack path and re-square the unpinned
 * end waypoint of every route on its links (pinned waypoints stay put).
 * Returns the ids of the routes touched.
 */
export function redressRoutesOf(draft: Project, componentId: Id): Id[] {
  const touched: Id[] = [];
  for (const link of draft.links) {
    if (!draft.routes[link.id]) continue;
    let hit = false;
    if (link.a.componentId === componentId) hit = routing.onEndpointMoved(draft, link.id, 'a') || hit;
    if (link.b.componentId === componentId) hit = routing.onEndpointMoved(draft, link.id, 'b') || hit;
    if (hit) touched.push(link.id);
  }
  return touched;
}

const RACK_NAME_RE = /^R(\d+)$/i;

/** Lowest free 'R01'-style name ('R01'..'R99', then 'R100'). */
export function nextRackName(project: Project): string {
  const used = new Set<number>();
  for (const r of project.racks) {
    const m = RACK_NAME_RE.exec(r.name.trim());
    if (m) used.add(Number(m[1]));
  }
  let n = 1;
  while (used.has(n)) n++;
  return `R${String(n).padStart(2, '0')}`;
}

/** Racks sorted by name, naturally ('R2' before 'R10'). */
export function racksInOrder(project: Project): Rack[] {
  return [...snapshot(project).racks].sort((a, b) => compareNatural(a.name, b.name));
}

export const isPatchFrame = (rack: Pick<Rack, 'kind'>): boolean => (rack.kind ?? 'rack') === 'patch-frame';

/** Default frame for a component that becomes its own rack: the patch frame, grown to fit tall devices. */
export function defaultFrameDefId(project: Project, c: Component): string {
  const cat = catalogIndex(project);
  const height = heightUOf(project, c);
  const frames = cat.catalog.racks.filter((r) => r.kind === 'patch-frame').sort((a, b) => a.heightU - b.heightU);
  return (frames.find((r) => r.heightU >= height) ?? frames.at(-1) ?? cat.catalog.racks[0])!.id;
}

/** 'PF-<ref>' when free, else 'PF-<ref>-2', … */
export function frameNameFor(project: Project, ref: string): string {
  const taken = new Set(project.racks.map((r) => r.name));
  const base = `PF-${ref}`;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Next free spot for a new free-standing frame: to the right of the
 * right-most rack on the bottom row, on the floor grid; the room origin
 * when the floor is empty.
 */
export function nextFreeFloorPos(project: Project, size: { widthMm: number; depthMm: number }): { x: number; y: number } {
  const grid = project.room.gridMm || 600;
  const racks = snapshot(project).racks;
  if (racks.length === 0) return { x: grid, y: grid };
  const rects = racks.map((r) => routing.rackFloorRect(r));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  const rowTop = Math.max(...rects.map((r) => r.y));
  const row = rects.filter((r) => r.y >= rowTop - 1);
  const right = Math.max(...row.map((r) => r.x + r.width));
  const x = Math.ceil((right + grid) / grid) * grid;
  const y = Math.floor(rowTop / grid) * grid;
  // Wrap to a new row when the frame would leave the room outline's bounds.
  const roomRight = Math.max(...project.room.outline.map((p) => p.x));
  if (x + size.widthMm > roomRight) return { x: grid, y: Math.ceil((bottom + grid) / grid) * grid };
  return { x, y };
}
