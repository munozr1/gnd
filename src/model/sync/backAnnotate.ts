/**
 * Back-annotation (layout -> schematic). The layout never edits the logical
 * model directly; it records a proposal in `project.backAnnotations` that the
 * user accepts or rejects in the schematic. Accepting applies the change to
 * the schematic AND to `syncState`, so the layout stays in sync without an F8.
 *
 * `validate*` return an error message or null; `propose*` throw on invalid
 * input (validate first in the UI). `acceptBackAnnotation` re-validates,
 * because the schematic may have changed since the proposal was made.
 */
import { catalogIndex } from '@/catalog';
import { newId } from '@/model/factories';
import { ProjectIndex } from '@/model/query';
import type { BackAnnotation, Component, Id, LinkEnd, PortType, Project } from '@/model/types';
import { copyEnd } from './apply';
import { footprintFits } from './diff';

export type AcceptResult =
  | { ok: true; annotation: BackAnnotation; /** The device lost its rack slot because the new model did not fit. */ unplaced: boolean }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validatePortSwap(project: Project, linkId: Id, end: 'a' | 'b', toPortId: string): string | null {
  const idx = freshIndex(project);
  const link = idx.link(linkId);
  if (!link) return `Link ${linkId} does not exist`;
  const from = link[end];
  const c = idx.component(from.componentId);
  if (!c) return `Component ${from.componentId} does not exist`;
  if (from.portId === toPortId) return `Link is already on ${c.ref}:${toPortId}`;
  const fromType = portTypeOf(idx, c, from.portId);
  const toType = portTypeOf(idx, c, toPortId);
  if (!toType) return `${c.ref} has no port ${toPortId}`;
  if (fromType && fromType !== toType) return `${c.ref}:${toPortId} is ${toType}, not ${fromType}`;
  const target: LinkEnd = from.lane === undefined
    ? { componentId: c.id, portId: toPortId }
    : { componentId: c.id, portId: toPortId, lane: from.lane };
  if (!isEndFree(idx, target)) return `${c.ref}:${toPortId} is already in use`;
  return null;
}

export function validateRefRename(project: Project, componentId: Id, to: string): string | null {
  const c = project.components.find((x) => x.id === componentId);
  if (!c) return `Component ${componentId} does not exist`;
  const ref = to.trim();
  if (ref.length === 0) return 'Reference designator cannot be empty';
  if (ref === c.ref) return `${c.ref} already has that reference`;
  const clash = project.components.find((x) => x.id !== componentId && x.ref === ref);
  if (clash) return `Reference ${ref} is already used by another component`;
  return null;
}

export function validateFootprintChange(project: Project, componentId: Id, to: string | null): string | null {
  const c = project.components.find((x) => x.id === componentId);
  if (!c) return `Component ${componentId} does not exist`;
  if (c.footprintDefId === to) return `${c.ref} already uses that model`;
  if (to !== null && !catalogIndex(project).footprint(to)) return `Unknown footprint ${to}`;
  return null;
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

/** Propose moving one end of a link to another port of the same component. Supersedes a pending proposal for that end. */
export function proposePortSwap(draft: Project, linkId: Id, end: 'a' | 'b', toPortId: string): BackAnnotation {
  const error = validatePortSwap(draft, linkId, end, toPortId);
  if (error) throw new Error(error);
  const link = draft.links.find((l) => l.id === linkId)!;
  const annotation: BackAnnotation = {
    id: newId(),
    kind: 'port-swap',
    linkId,
    end,
    fromPortId: link[end].portId,
    toPortId,
  };
  dropProposals(draft, (b) => b.kind === 'port-swap' && b.linkId === linkId && b.end === end);
  draft.backAnnotations.push(annotation);
  return annotation;
}

/** Propose a new reference designator. Supersedes a pending rename for the component. */
export function proposeRefRename(draft: Project, componentId: Id, to: string): BackAnnotation {
  const ref = to.trim();
  const error = validateRefRename(draft, componentId, ref);
  if (error) throw new Error(error);
  const c = draft.components.find((x) => x.id === componentId)!;
  const annotation: BackAnnotation = { id: newId(), kind: 'ref-rename', componentId, from: c.ref, to: ref };
  dropProposals(draft, (b) => b.kind === 'ref-rename' && b.componentId === componentId);
  draft.backAnnotations.push(annotation);
  return annotation;
}

/** Propose a different physical model. Supersedes a pending model change for the component. */
export function proposeFootprintChange(draft: Project, componentId: Id, to: string | null): BackAnnotation {
  const error = validateFootprintChange(draft, componentId, to);
  if (error) throw new Error(error);
  const c = draft.components.find((x) => x.id === componentId)!;
  const annotation: BackAnnotation = {
    id: newId(),
    kind: 'footprint-change',
    componentId,
    from: c.footprintDefId,
    to,
  };
  dropProposals(draft, (b) => b.kind === 'footprint-change' && b.componentId === componentId);
  draft.backAnnotations.push(annotation);
  return annotation;
}

// ---------------------------------------------------------------------------
// Accept / reject
// ---------------------------------------------------------------------------

/**
 * Apply a proposal to the schematic and to syncState. On failure the proposal
 * stays pending so the user can inspect or reject it.
 */
export function acceptBackAnnotation(draft: Project, id: Id): AcceptResult {
  const annotation = draft.backAnnotations.find((b) => b.id === id);
  if (!annotation) return { ok: false, error: `No pending back-annotation ${id}` };

  let unplaced = false;
  switch (annotation.kind) {
    case 'port-swap': {
      const link = draft.links.find((l) => l.id === annotation.linkId);
      if (link && link[annotation.end].portId !== annotation.fromPortId) {
        return { ok: false, error: 'Link end has changed since the proposal was made' };
      }
      const error = validatePortSwap(draft, annotation.linkId, annotation.end, annotation.toPortId);
      if (error || !link) return { ok: false, error: error ?? `Link ${annotation.linkId} does not exist` };
      const end = link[annotation.end];
      end.portId = annotation.toPortId;
      // The transceiver is plugged into the cable, so it moves with it unless the target already has one.
      const c = draft.components.find((x) => x.id === end.componentId);
      const optic = c?.optics[annotation.fromPortId];
      if (c && optic !== undefined && c.optics[annotation.toPortId] === undefined) {
        c.optics[annotation.toPortId] = optic;
        delete c.optics[annotation.fromPortId];
      }
      const synced = draft.syncState.links[link.id];
      if (synced) synced[annotation.end] = copyEnd(end);
      break;
    }
    case 'ref-rename': {
      const error = validateRefRename(draft, annotation.componentId, annotation.to);
      if (error) return { ok: false, error };
      const c = draft.components.find((x) => x.id === annotation.componentId)!;
      c.ref = annotation.to;
      const synced = draft.syncState.components[c.id];
      if (synced) synced.ref = c.ref;
      break;
    }
    case 'footprint-change': {
      const error = validateFootprintChange(draft, annotation.componentId, annotation.to);
      if (error) return { ok: false, error };
      const fits = footprintFits(freshIndex(draft), annotation.componentId, annotation.to);
      const c = draft.components.find((x) => x.id === annotation.componentId)!;
      c.footprintDefId = annotation.to;
      if (!fits) {
        const placement = draft.placements.find((p) => p.componentId === c.id);
        if (placement && placement.rackId !== null) {
          placement.rackId = null;
          placement.uPosition = null;
          unplaced = true;
        }
      }
      const synced = draft.syncState.components[c.id];
      if (synced) synced.footprintDefId = c.footprintDefId;
      break;
    }
  }

  // Snapshot before removal: `annotation` is a draft proxy that dies with the recipe.
  const accepted: BackAnnotation = { ...annotation };
  dropProposals(draft, (b) => b.id === id);
  return { ok: true, annotation: accepted, unplaced };
}

/** Discard a proposal. Returns false when no such proposal was pending. */
export function rejectBackAnnotation(draft: Project, id: Id): boolean {
  const before = draft.backAnnotations.length;
  dropProposals(draft, (b) => b.id === id);
  return draft.backAnnotations.length !== before;
}

// ---------------------------------------------------------------------------

/**
 * A non-memoised index. `indexProject` caches by object identity, which is
 * wrong for an Immer draft that is being mutated in the same recipe.
 */
const freshIndex = (project: Project): ProjectIndex => new ProjectIndex(project);

/** Port type as the schematic sees it (symbol pin), falling back to the footprint. */
function portTypeOf(idx: ProjectIndex, c: Component, portId: string): PortType | undefined {
  return idx.pinOf(c, portId)?.type ?? idx.portOf(c, portId)?.type;
}

/** Whether a port (or one lane of a breakout port) has no link on it. */
function isEndFree(idx: ProjectIndex, end: LinkEnd): boolean {
  for (const l of idx.linksOf(end.componentId)) {
    for (const e of [l.a, l.b]) {
      if (e.componentId !== end.componentId || e.portId !== end.portId) continue;
      if (e.lane === undefined || end.lane === undefined || e.lane === end.lane) return false;
    }
  }
  return true;
}

function dropProposals(draft: Project, match: (b: BackAnnotation) => boolean): void {
  if (draft.backAnnotations.some(match)) {
    draft.backAnnotations = draft.backAnnotations.filter((b) => !match(b));
  }
}
