/**
 * Hierarchical sheets: create, duplicate (stamp out a pod), delete, and find
 * the links that cross a sheet boundary (its hierarchical pins).
 */
import { createSheet, newId } from '../factories';
import { indexProject } from '../query';
import type { Component, Id, Link, LinkEnd, Project, Sheet, Vec2 } from '../types';
import { annotate, refPrefixOf } from './annotate';
import { childSheets, isRootSheet, sheetSubtreeIds } from './hierarchy';
import { requireSheet } from './lookup';
import { deleteComponents } from './mutations';
import { GRID } from './symbolGeometry';

export { childSheets, isRootSheet, sheetAncestry, sheetOrder, sheetPath, sheetSubtreeIds } from './hierarchy';

/** Gap between a sheet symbol and its duplicate on the parent sheet. */
export const SHEET_DUPLICATE_GAP = 2 * GRID;

export function createChildSheet(draft: Project, parentId: Id, name: string, pos: Vec2): Sheet {
  requireSheet(draft, parentId);
  const sheet = createSheet(name, parentId, pos);
  draft.sheets.push(sheet);
  return sheet;
}

export interface DuplicateSheetResult {
  sheetId: Id;
  /** old sheet id -> new sheet id, for the whole cloned subtree. */
  sheetIdMap: Map<Id, Id>;
  componentIdMap: Map<Id, Id>;
  linkIdMap: Map<Id, Id>;
  /** Original links with exactly one end inside the subtree; not cloned. */
  droppedCrossSheetLinks: Id[];
}

/**
 * Deep-clone a sheet with its descendant sheets, components and internal
 * links. Clones get fresh ids and freshly annotated refs; nothing physical
 * (placements, routes, optics stay per-component so they are copied) is
 * created. Links crossing out of the subtree are dropped and reported.
 */
export function duplicateSheet(draft: Project, sheetId: Id, newName: string): DuplicateSheetResult {
  const source = requireSheet(draft, sheetId);
  if (isRootSheet(source)) throw new Error('The root sheet cannot be duplicated');

  const subtree = sheetSubtreeIds(draft, sheetId);
  const sheetIdMap = new Map<Id, Id>(subtree.map((id) => [id, newId()] as const));
  const newRootId = sheetIdMap.get(sheetId)!;

  for (const oldId of subtree) {
    const old = requireSheet(draft, oldId);
    const isRoot = oldId === sheetId;
    const parentId = isRoot ? old.parentId : (sheetIdMap.get(old.parentId ?? '') ?? old.parentId);
    const clone: Sheet = { id: sheetIdMap.get(oldId)!, name: isRoot ? newName : old.name, parentId };
    if (old.sch) {
      clone.sch = {
        pos: isRoot
          ? { x: old.sch.pos.x + old.sch.width + SHEET_DUPLICATE_GAP, y: old.sch.pos.y }
          : { ...old.sch.pos },
        width: old.sch.width,
        height: old.sch.height,
      };
      if (isRoot) clone.sch.pos = nextFreeSheetSlot(draft, old.parentId, clone.sch);
    }
    draft.sheets.push(clone);
  }

  const subtreeSet = new Set(subtree);
  const componentIdMap = new Map<Id, Id>();
  const newComponents: Component[] = [];
  for (const c of draft.components) {
    if (!subtreeSet.has(c.sch.sheetId)) continue;
    const id = newId();
    componentIdMap.set(c.id, id);
    const clone: Component = {
      id,
      ref: `${refPrefixOf(draft, c)}?`,
      symbolDefId: c.symbolDefId,
      footprintDefId: c.footprintDefId,
      ...(c.value !== undefined ? { value: c.value } : {}),
      optics: { ...c.optics },
      sch: {
        pos: { ...c.sch.pos },
        rotation: c.sch.rotation,
        ...(c.sch.mirrored ? { mirrored: true } : {}),
        sheetId: sheetIdMap.get(c.sch.sheetId)!,
      },
      ...(c.expandedPins ? { expandedPins: true } : {}),
    };
    newComponents.push(clone);
  }
  draft.components.push(...newComponents);

  const linkIdMap = new Map<Id, Id>();
  const droppedCrossSheetLinks: Id[] = [];
  const newLinks: Link[] = [];
  const mapEnd = (e: LinkEnd): LinkEnd => ({
    componentId: componentIdMap.get(e.componentId)!,
    portId: e.portId,
    ...(e.lane !== undefined ? { lane: e.lane } : {}),
  });
  for (const l of draft.links) {
    const aIn = componentIdMap.has(l.a.componentId);
    const bIn = componentIdMap.has(l.b.componentId);
    if (!aIn && !bIn) continue;
    if (aIn !== bIn) {
      droppedCrossSheetLinks.push(l.id);
      continue;
    }
    const id = newId();
    linkIdMap.set(l.id, id);
    newLinks.push({
      id,
      a: mapEnd(l.a),
      b: mapEnd(l.b),
      cableDefId: l.cableDefId,
      ...(l.label !== undefined ? { label: l.label } : {}),
      sch: { wirePoints: l.sch.wirePoints.map((p) => ({ ...p })) },
    });
  }
  draft.links.push(...newLinks);

  annotate(draft, { scope: 'unannotated', sheetId: newRootId });

  return { sheetId: newRootId, sheetIdMap, componentIdMap, linkIdMap, droppedCrossSheetLinks };
}

/** First slot to the right of `wanted` on the parent sheet that overlaps no sibling sheet symbol. */
function nextFreeSheetSlot(
  project: Project,
  parentId: Id | null,
  wanted: { pos: Vec2; width: number; height: number },
): Vec2 {
  const siblings = childSheets(project, parentId).filter((s) => s.sch);
  const overlaps = (pos: Vec2): boolean =>
    siblings.some((s) => {
      const r = s.sch!;
      return (
        pos.x < r.pos.x + r.width &&
        pos.x + wanted.width > r.pos.x &&
        pos.y < r.pos.y + r.height &&
        pos.y + wanted.height > r.pos.y
      );
    });
  const pos = { ...wanted.pos };
  let guard = 0;
  while (overlaps(pos) && guard++ < 1000) pos.x += wanted.width + SHEET_DUPLICATE_GAP;
  return pos;
}

export interface DeleteSheetResult {
  sheetIds: Id[];
  componentIds: Id[];
  linkIds: Id[];
}

/** Remove a sheet subtree with every component on it and their links. */
export function deleteSheet(draft: Project, sheetId: Id): DeleteSheetResult {
  const sheet = requireSheet(draft, sheetId);
  if (isRootSheet(sheet)) throw new Error('The root sheet cannot be deleted');
  const subtree = sheetSubtreeIds(draft, sheetId);
  const subtreeSet = new Set(subtree);
  const componentIds = draft.components.filter((c) => subtreeSet.has(c.sch.sheetId)).map((c) => c.id);
  const { linkIds } = deleteComponents(draft, componentIds);
  draft.sheets = draft.sheets.filter((s) => !subtreeSet.has(s.id));
  return { sheetIds: subtree, componentIds, linkIds };
}

export function renameSheet(draft: Project, sheetId: Id, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Sheet name cannot be empty');
  requireSheet(draft, sheetId).name = trimmed;
}

export function moveSheetSymbol(draft: Project, sheetId: Id, pos: Vec2): void {
  const s = requireSheet(draft, sheetId);
  if (!s.sch) s.sch = { pos: { ...pos }, width: 160, height: 100 };
  else s.sch.pos = { ...pos };
}

export interface CrossSheetLink {
  link: Link;
  insideEnd: LinkEnd;
  outsideEnd: LinkEnd;
}

/**
 * Links with exactly one end inside the sheet subtree. These are the sheet
 * symbol's hierarchical pins on its parent sheet.
 */
export function crossSheetLinks(project: Project, sheetId: Id): CrossSheetLink[] {
  const idx = indexProject(project);
  const subtree = new Set(sheetSubtreeIds(project, sheetId));
  const inside = (end: LinkEnd): boolean => {
    const c = idx.component(end.componentId);
    return c !== undefined && subtree.has(c.sch.sheetId);
  };
  const out: CrossSheetLink[] = [];
  for (const link of project.links) {
    const aIn = inside(link.a);
    const bIn = inside(link.b);
    if (aIn === bIn) continue;
    out.push(aIn ? { link, insideEnd: link.a, outsideEnd: link.b } : { link, insideEnd: link.b, outsideEnd: link.a });
  }
  return out;
}
