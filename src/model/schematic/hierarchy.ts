/**
 * Read-only helpers over the sheet hierarchy. Pure; used by annotation,
 * duplication and the sheet tree UI.
 */
import type { Id, Project, Sheet } from '../types';

export function childSheets(project: Project, parentId: Id | null): Sheet[] {
  return project.sheets.filter((s) => s.parentId === parentId);
}

/** Sheet ids of a subtree in depth-first preorder, starting with `sheetId` itself. */
export function sheetSubtreeIds(project: Project, sheetId: Id): Id[] {
  const out: Id[] = [];
  const seen = new Set<Id>();
  const visit = (id: Id) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    for (const child of childSheets(project, id)) visit(child.id);
  };
  visit(sheetId);
  return out;
}

/**
 * All sheet ids in hierarchy order: roots (parentId null) in array order, each
 * followed by its descendants depth-first. Orphans (parent missing) come last.
 */
export function sheetOrder(project: Project): Id[] {
  const out: Id[] = [];
  const seen = new Set<Id>();
  for (const root of childSheets(project, null)) {
    for (const id of sheetSubtreeIds(project, root.id)) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  for (const s of project.sheets) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      out.push(s.id);
    }
  }
  return out;
}

/** Ancestors from the root down to (and including) the sheet. */
export function sheetAncestry(project: Project, sheetId: Id): Sheet[] {
  const byId = new Map(project.sheets.map((s) => [s.id, s] as const));
  const chain: Sheet[] = [];
  const seen = new Set<Id>();
  let cur = byId.get(sheetId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId === null ? undefined : byId.get(cur.parentId);
  }
  return chain;
}

/** 'Root / Pod A / Rack 1'. Unknown sheet ids yield ''. */
export function sheetPath(project: Project, sheetId: Id, separator = ' / '): string {
  return sheetAncestry(project, sheetId)
    .map((s) => s.name)
    .join(separator);
}

export function isRootSheet(sheet: Sheet): boolean {
  return sheet.parentId === null;
}
