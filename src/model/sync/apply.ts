/**
 * Apply a (user-selected subset of a) sync plan to the layout. Mutates an
 * Immer draft in place; the caller wraps it in one undoable command.
 *
 * Each change is idempotent and tolerant of a stale plan: it is applied only
 * when the live project still calls for it, and skipped (not counted)
 * otherwise. Concretely, a removal is skipped when its target exists in the
 * schematic again, and an add / model change / rename / endpoint change is
 * skipped when its subject is gone or when syncState already records the live
 * value (so a route reviewed after an earlier apply is not flagged again).
 * Whether a new model fits is re-checked against the live layout at apply
 * time; the plan's `fits` is only advisory for the dialog.
 *
 * Unchecked changes leave the layout untouched: a device deleted from the
 * schematic keeps its rack slot until its remove-component is applied, so
 * undoing the deletion restores it in place.
 */
import { unplugComponents } from '@/model/cables/instances';
import { createPlacement } from '@/model/factories';
import { ProjectIndex } from '@/model/query';
import type { Id, LinkEnd, Project, SyncChange } from '@/model/types';
import { footprintFits, linkEndsEqual, linksTouchingComponent } from './diff';

export interface ApplySummary {
  /** Number of changes that were actually applied. */
  applied: number;
  /** Link ids whose routes were deleted (orphaned or removed links). */
  removedRoutes: Id[];
  /** Component ids that were unplaced because their new footprint did not fit. */
  unplaced: Id[];
}

export function applySyncPlan(draft: Project, changes: readonly SyncChange[]): ApplySummary {
  const removedRoutes = new Set<Id>();
  const unplaced: Id[] = [];
  let applied = 0;

  const deleteRoute = (linkId: Id) => {
    if (draft.routes[linkId] === undefined) return;
    delete draft.routes[linkId];
    removedRoutes.add(linkId);
  };
  const liveComponent = (id: Id) => draft.components.find((x) => x.id === id);
  const liveLink = (id: Id) => draft.links.find((x) => x.id === id);

  for (const change of changes) {
    switch (change.kind) {
      case 'add-component': {
        const c = liveComponent(change.componentId);
        if (!c || draft.syncState.components[c.id]) continue;
        if (!draft.placements.some((p) => p.componentId === c.id)) {
          draft.placements.push(createPlacement(c.id));
        }
        draft.syncState.components[c.id] = { ref: c.ref, footprintDefId: c.footprintDefId };
        applied++;
        break;
      }
      case 'remove-component': {
        const id = change.componentId;
        if (liveComponent(id)) continue;
        // A link cannot exist in the layout without its device: drop its route and its sync entry too.
        // A link the schematic re-attached elsewhere does not touch the device any more and is kept.
        for (const linkId of linksTouchingComponent(draft, id)) {
          deleteRoute(linkId);
          delete draft.syncState.links[linkId];
        }
        if (draft.placements.some((p) => p.componentId === id)) {
          draft.placements = draft.placements.filter((p) => p.componentId !== id);
        }
        // A cable leg still pointing at the vanished device (older files) becomes unassigned.
        unplugComponents(draft, [id]);
        delete draft.syncState.components[id];
        applied++;
        break;
      }
      case 'footprint-changed': {
        const c = liveComponent(change.componentId);
        const synced = c && draft.syncState.components[c.id];
        if (!c || !synced || synced.footprintDefId === c.footprintDefId) continue;
        // The plan's `fits` describes the layout at plan time; the device or its neighbours may have
        // moved since (or been unplaced earlier in this apply), so decide against the live layout.
        const fits = footprintFits(new ProjectIndex(draft), c.id, c.footprintDefId);
        const placement = draft.placements.find((p) => p.componentId === c.id);
        if (!placement) {
          draft.placements.push(createPlacement(c.id));
        } else if (!fits && placement.rackId !== null) {
          placement.rackId = null;
          placement.uPosition = null;
          unplaced.push(c.id);
        }
        synced.footprintDefId = c.footprintDefId;
        applied++;
        break;
      }
      case 'ref-renamed': {
        const c = liveComponent(change.componentId);
        const synced = c && draft.syncState.components[c.id];
        if (!c || !synced || synced.ref === c.ref) continue;
        synced.ref = c.ref;
        applied++;
        break;
      }
      case 'add-link': {
        const l = liveLink(change.linkId);
        if (!l || draft.syncState.links[l.id]) continue;
        draft.syncState.links[l.id] = { a: copyEnd(l.a), b: copyEnd(l.b) };
        applied++;
        break;
      }
      case 'remove-link': {
        if (liveLink(change.linkId)) continue;
        deleteRoute(change.linkId);
        delete draft.syncState.links[change.linkId];
        applied++;
        break;
      }
      case 'link-endpoint-changed': {
        const l = liveLink(change.linkId);
        const synced = l && draft.syncState.links[l.id];
        if (!l || !synced || (linkEndsEqual(synced.a, l.a) && linkEndsEqual(synced.b, l.b))) continue;
        const route = draft.routes[l.id];
        if (route) route.needsReview = true;
        draft.syncState.links[l.id] = { a: copyEnd(l.a), b: copyEnd(l.b) };
        applied++;
        break;
      }
    }
  }

  // A placement belongs to a live component or to one the layout still holds in syncState (its
  // removal is pending or unchecked). Anything else is a ghost and is dropped.
  const live = new Set(draft.components.map((c) => c.id));
  const known = (id: Id) => live.has(id) || draft.syncState.components[id] !== undefined;
  if (draft.placements.some((p) => !known(p.componentId))) {
    draft.placements = draft.placements.filter((p) => known(p.componentId));
  }

  return { applied, removedRoutes: [...removedRoutes], unplaced };
}

/** Copy a link end without carrying an explicit `lane: undefined` key. */
export function copyEnd(end: LinkEnd): LinkEnd {
  return end.lane === undefined
    ? { componentId: end.componentId, portId: end.portId }
    : { componentId: end.componentId, portId: end.portId, lane: end.lane };
}
