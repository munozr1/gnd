/**
 * Update Layout from Schematic (F8): diff the live logical model against
 * `project.syncState`, the layout's copy of it as of the last apply.
 *
 * Pure readers. `computeSyncPlan` yields changes in a stable, grouped order:
 * components (add, remove, footprint-changed, ref-renamed) then links (add,
 * remove, endpoint-changed). Within a group, schematic array order is used
 * for live items and (ref | label, id) order for items that only exist in
 * syncState.
 */
import { indexProject, ProjectIndex, uRange } from '@/model/query';
import type { Id, LinkEnd, Project, SyncChange, SyncPlan, SyncState } from '@/model/types';

export function computeSyncPlan(project: Project): SyncPlan {
  return { changes: [...iterateChanges(project)] };
}

/** True when the schematic has changes the layout has not applied yet. Stops at the first change. */
export function isOutOfSync(project: Project): boolean {
  return !iterateChanges(project).next().done;
}

/** Stable identity for a change, e.g. for dialog checkboxes. */
export function changeKey(change: SyncChange): string {
  switch (change.kind) {
    case 'add-component':
    case 'remove-component':
    case 'footprint-changed':
    case 'ref-renamed':
      return `${change.kind}:${change.componentId}`;
    case 'add-link':
    case 'remove-link':
    case 'link-endpoint-changed':
      return `${change.kind}:${change.linkId}`;
  }
}

export const linkEndsEqual = (x: LinkEnd, y: LinkEnd): boolean =>
  x.componentId === y.componentId && x.portId === y.portId && x.lane === y.lane;

/**
 * Whether a component could take `footprintDefId` without moving: unplaced
 * components always fit; a placed one must stay within its rack's height and
 * must not overlap any other placed component in that rack.
 */
export function footprintFits(idx: ProjectIndex, componentId: Id, footprintDefId: string | null): boolean {
  const placement = idx.placement(componentId);
  if (!placement || placement.rackId === null || placement.uPosition === null) return true;
  const rack = idx.rack(placement.rackId);
  if (!rack) return true;
  const heightU = idx.catalog.footprint(footprintDefId)?.heightU ?? 1;
  const bottom = placement.uPosition;
  const top = bottom + heightU - 1;
  if (bottom < 1 || top > rack.heightU) return false;
  for (const other of idx.componentsInRack(rack.id)) {
    if (other.id === componentId) continue;
    const r = uRange(idx, other.id);
    if (r && r.bottom <= top && r.top >= bottom) return false;
  }
  return true;
}

/**
 * Ids of the links that still touch a component: a live link by its live ends,
 * a link the schematic has deleted by its last-synced ends. A live link that
 * was re-attached to another device no longer touches the component, so its
 * route is not orphaned when the device is removed (it is flagged for review
 * by the accompanying link-endpoint-changed instead).
 */
export function linksTouchingComponent(project: Project, componentId: Id): Id[] {
  const touches = (ends: { a: LinkEnd; b: LinkEnd }) =>
    ends.a.componentId === componentId || ends.b.componentId === componentId;
  const out: Id[] = [];
  const live = new Set<Id>();
  for (const l of project.links) {
    live.add(l.id);
    if (touches(l)) out.push(l.id);
  }
  for (const [id, ends] of Object.entries(project.syncState.links)) {
    if (!live.has(id) && touches(ends)) out.push(id);
  }
  return out;
}

/** Ids of the routes a component removal would orphan: those of the links that still touch it. */
export function routesTouchingComponent(project: Project, componentId: Id): Id[] {
  return linksTouchingComponent(project, componentId).filter((id) => project.routes[id] !== undefined);
}

// ---------------------------------------------------------------------------

function* iterateChanges(project: Project): Generator<SyncChange, void, undefined> {
  const idx = indexProject(project);
  const sync = project.syncState;

  // Components ---------------------------------------------------------------
  for (const c of project.components) {
    if (!sync.components[c.id]) yield { kind: 'add-component', componentId: c.id, ref: c.ref };
  }
  for (const [id, synced] of sortedByLabel(Object.entries(sync.components), (s) => s.ref)) {
    if (idx.component(id)) continue;
    yield {
      kind: 'remove-component',
      componentId: id,
      ref: synced.ref,
      orphanedRouteIds: routesTouchingComponent(project, id),
    };
  }
  for (const c of project.components) {
    const synced = sync.components[c.id];
    if (!synced || synced.footprintDefId === c.footprintDefId) continue;
    yield {
      kind: 'footprint-changed',
      componentId: c.id,
      ref: c.ref,
      from: synced.footprintDefId,
      to: c.footprintDefId,
      fits: footprintFits(idx, c.id, c.footprintDefId),
    };
  }
  for (const c of project.components) {
    const synced = sync.components[c.id];
    if (!synced || synced.ref === c.ref) continue;
    yield { kind: 'ref-renamed', componentId: c.id, from: synced.ref, to: c.ref };
  }

  // Links ----------------------------------------------------------------------
  for (const l of project.links) {
    if (!sync.links[l.id]) yield { kind: 'add-link', linkId: l.id, label: idx.linkLabel(l) };
  }
  const removedLinks = Object.entries(sync.links)
    .filter(([id]) => !idx.link(id))
    .map(([id, ends]) => [id, syncedLinkLabel(idx, sync, ends)] as const);
  for (const [id, label] of sortedByLabel(removedLinks, (l) => l)) {
    yield { kind: 'remove-link', linkId: id, label, hadRoute: project.routes[id] !== undefined };
  }
  for (const l of project.links) {
    const synced = sync.links[l.id];
    if (!synced || (linkEndsEqual(synced.a, l.a) && linkEndsEqual(synced.b, l.b))) continue;
    yield { kind: 'link-endpoint-changed', linkId: l.id, label: idx.linkLabel(l) };
  }
}

function sortedByLabel<T>(entries: (readonly [Id, T])[], label: (t: T) => string): (readonly [Id, T])[] {
  return [...entries].sort(([idA, a], [idB, b]) => {
    const la = label(a);
    const lb = label(b);
    return la < lb ? -1 : la > lb ? 1 : idA < idB ? -1 : idA > idB ? 1 : 0;
  });
}

/** Label for a link that no longer exists, using live refs when the components survive. */
function syncedLinkLabel(idx: ProjectIndex, sync: SyncState, ends: { a: LinkEnd; b: LinkEnd }): string {
  const endLabel = (end: LinkEnd) => {
    const ref = idx.component(end.componentId)?.ref ?? sync.components[end.componentId]?.ref ?? end.componentId;
    return `${ref}:${end.portId}${end.lane !== undefined ? `.${end.lane}` : ''}`;
  };
  return `${endLabel(ends.a)} — ${endLabel(ends.b)}`;
}
