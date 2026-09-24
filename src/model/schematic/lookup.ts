/**
 * Small draft-safe lookups. Mutators receive an Immer draft, so they cannot use
 * the memoised `indexProject` (its cache keys on object identity, which a draft
 * changes under our feet). These scans are O(n) and fine for mutations.
 */
import type { Component, Id, Link, LinkEnd, Project, Sheet } from '../types';

export function findComponent(project: Project, id: Id): Component | undefined {
  return project.components.find((c) => c.id === id);
}

export function requireComponent(project: Project, id: Id): Component {
  const c = findComponent(project, id);
  if (!c) throw new Error(`Component not found: ${id}`);
  return c;
}

export function findLink(project: Project, id: Id): Link | undefined {
  return project.links.find((l) => l.id === id);
}

export function requireLink(project: Project, id: Id): Link {
  const l = findLink(project, id);
  if (!l) throw new Error(`Link not found: ${id}`);
  return l;
}

export function findSheet(project: Project, id: Id): Sheet | undefined {
  return project.sheets.find((s) => s.id === id);
}

export function requireSheet(project: Project, id: Id): Sheet {
  const s = findSheet(project, id);
  if (!s) throw new Error(`Sheet not found: ${id}`);
  return s;
}

/** Links touching a given port (any lane). */
export function linksOnPort(links: readonly Link[], componentId: Id, portId: string): Link[] {
  return links.filter(
    (l) =>
      (l.a.componentId === componentId && l.a.portId === portId) ||
      (l.b.componentId === componentId && l.b.portId === portId),
  );
}

/**
 * Whether a link end can be attached. A whole-port end needs the port to be
 * completely free; a lane end needs no whole-port link and a free lane.
 */
export function isEndFree(links: readonly Link[], end: LinkEnd): boolean {
  for (const l of linksOnPort(links, end.componentId, end.portId)) {
    const other = l.a.componentId === end.componentId && l.a.portId === end.portId ? l.a : l.b;
    if (end.lane === undefined || other.lane === undefined) return false;
    if (other.lane === end.lane) return false;
  }
  return true;
}

export const sameEnd = (a: LinkEnd, b: LinkEnd): boolean =>
  a.componentId === b.componentId && a.portId === b.portId && a.lane === b.lane;
