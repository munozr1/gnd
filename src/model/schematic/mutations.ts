/**
 * Primitive schematic mutators. Each takes an Immer draft and mutates in
 * place; editors wrap them in undoable commands. They validate and throw on
 * bad input rather than silently no-op, so command code can surface errors.
 *
 * Layout state (placements, routes) is trimmed when its component / link
 * disappears; `syncState` is deliberately untouched so F8 can diff against it.
 */
import { catalogIndex } from '@/catalog';
import { unplugComponents } from '../cables/instances';
import { createComponent, createLink } from '../factories';
import { snapVec } from '../geometry';
import type { Component, Id, LinkEnd, Project, Vec2 } from '../types';
import { nextRef, refPrefixOf } from './annotate';
import { defaultCableForLink } from './assignment';
import { isEndFree, requireComponent, requireLink, requireSheet, sameEnd } from './lookup';
import { GRID } from './symbolGeometry';

export interface AddComponentOptions {
  value?: string;
  footprintDefId?: string | null;
  /** Skip auto-annotation and leave the ref as '<prefix>?'. */
  annotate?: boolean;
}

/**
 * Place a symbol on a sheet (snapped to GRID) and give it the next free ref.
 * No placement is created; Update Layout (F8) is what admits it to the layout.
 */
export function addComponent(
  draft: Project,
  symbolId: string,
  sheetId: Id,
  pos: Vec2,
  opts: AddComponentOptions = {},
): Component {
  const symbol = catalogIndex(draft).symbol(symbolId);
  if (!symbol) throw new Error(`Unknown symbol: ${symbolId}`);
  requireSheet(draft, sheetId);
  const c = createComponent(symbol, {
    sheetId,
    pos: snapVec(pos, GRID),
    ...(opts.value !== undefined ? { value: opts.value } : {}),
  });
  // createComponent treats null as "use the default"; here null means "unassigned".
  if (opts.footprintDefId !== undefined) c.footprintDefId = opts.footprintDefId;
  if (opts.annotate !== false) c.ref = nextRef(draft, symbol.refPrefix);
  draft.components.push(c);
  return c;
}

/** Links whose ends touch any of the given components, split by whether both ends are inside the set. */
function linksTouching(draft: Project, ids: ReadonlySet<Id>) {
  const inside: Project['links'] = [];
  const partial: Project['links'] = [];
  for (const l of draft.links) {
    const a = ids.has(l.a.componentId);
    const b = ids.has(l.b.componentId);
    if (a && b) inside.push(l);
    else if (a || b) partial.push(l);
  }
  return { inside, partial };
}

/**
 * Translate components. Wires between moved components move with them;
 * wires to unmoved components drop their elbows and re-route automatically.
 */
export function moveComponents(draft: Project, ids: readonly Id[], delta: Vec2): void {
  const set = new Set(ids);
  for (const c of draft.components) {
    if (!set.has(c.id)) continue;
    c.sch.pos = { x: c.sch.pos.x + delta.x, y: c.sch.pos.y + delta.y };
  }
  const { inside, partial } = linksTouching(draft, set);
  for (const l of inside) l.sch.wirePoints = l.sch.wirePoints.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y }));
  for (const l of partial) l.sch.wirePoints = [];
}

function clearWiresOf(draft: Project, id: Id): void {
  for (const l of draft.links) {
    if (l.a.componentId === id || l.b.componentId === id) l.sch.wirePoints = [];
  }
}

export function rotateComponent(draft: Project, id: Id, steps = 1): void {
  const c = requireComponent(draft, id);
  const n = ((((c.sch.rotation / 90 + steps) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  c.sch.rotation = (n * 90) as Component['sch']['rotation'];
  clearWiresOf(draft, id);
}

export function mirrorComponent(draft: Project, id: Id): void {
  const c = requireComponent(draft, id);
  c.sch.mirrored = !c.sch.mirrored;
  if (!c.sch.mirrored) delete c.sch.mirrored;
  clearWiresOf(draft, id);
}

export interface DeleteResult {
  componentIds: Id[];
  linkIds: Id[];
}

/** Remove components with their links, placements and routes. Optics go with the component. */
export function deleteComponents(draft: Project, ids: readonly Id[]): DeleteResult {
  const set = new Set(ids);
  const componentIds = draft.components.filter((c) => set.has(c.id)).map((c) => c.id);
  const linkIds = draft.links
    .filter((l) => set.has(l.a.componentId) || set.has(l.b.componentId))
    .map((l) => l.id);
  deleteLinks(draft, linkIds);
  draft.components = draft.components.filter((c) => !set.has(c.id));
  draft.placements = draft.placements.filter((p) => !set.has(p.componentId));
  // Cable legs plugged into a deleted device become unassigned; their links went with the device above.
  unplugComponents(draft, componentIds);
  return { componentIds, linkIds };
}

/**
 * Connect two ports. `cableDefId` undefined = derive from the optics at both
 * ends; null = no cable. Throws when either end is missing or occupied.
 */
export function addLink(draft: Project, a: LinkEnd, b: LinkEnd, cableDefId?: string | null): Id {
  if (sameEnd(a, b)) throw new Error('A link needs two different ports');
  const catalog = catalogIndex(draft);
  for (const end of [a, b]) {
    const c = requireComponent(draft, end.componentId);
    const pin = catalog.symbol(c.symbolDefId)?.pins.find((p) => p.portId === end.portId);
    if (!pin) throw new Error(`${c.ref} has no port ${end.portId}`);
    if (!isEndFree(draft.links, end)) {
      throw new Error(`${c.ref}:${end.portId}${end.lane !== undefined ? `.${end.lane}` : ''} is already connected`);
    }
  }
  const link = createLink(a, b, cableDefId === undefined ? defaultCableForLink(draft, { a, b }) : cableDefId);
  draft.links.push(link);
  return link.id;
}

/** Remove links and any routes on them. */
export function deleteLinks(draft: Project, ids: readonly Id[]): void {
  const set = new Set(ids);
  if (set.size === 0) return;
  draft.links = draft.links.filter((l) => !set.has(l.id));
  for (const id of set) delete draft.routes[id];
}

export function setLinkLabel(draft: Project, id: Id, label: string | undefined): void {
  const l = requireLink(draft, id);
  if (label === undefined || label === '') delete l.label;
  else l.label = label;
}

export function setLinkCable(draft: Project, id: Id, cableDefId: string | null): void {
  requireLink(draft, id).cableDefId = cableDefId;
}

/** Store intermediate elbow points (pin ends excluded). */
export function setLinkWirePoints(draft: Project, id: Id, points: readonly Vec2[]): void {
  requireLink(draft, id).sch.wirePoints = points.map((p) => ({ x: p.x, y: p.y }));
}

export function setComponentValue(draft: Project, id: Id, value: string | undefined): void {
  const c = requireComponent(draft, id);
  if (value === undefined || value === '') delete c.value;
  else c.value = value;
}

/** Rename a ref; throws when another component already uses it. */
export function setComponentRef(draft: Project, id: Id, ref: string): void {
  const c = requireComponent(draft, id);
  const trimmed = ref.trim();
  if (!trimmed) throw new Error('Ref cannot be empty');
  const clash = draft.components.find((o) => o.id !== id && o.ref === trimmed);
  if (clash) throw new Error(`Ref ${trimmed} is already used`);
  c.ref = trimmed;
}

export function toggleExpandedPins(draft: Project, id: Id): boolean {
  const c = requireComponent(draft, id);
  const expanded = c.expandedPins !== true;
  if (expanded) c.expandedPins = true;
  else delete c.expandedPins;
  clearWiresOf(draft, id);
  return expanded;
}

/** Reset a component's ref to '<prefix>?' so the next annotate renumbers it. */
export function clearRef(draft: Project, id: Id): void {
  const c = requireComponent(draft, id);
  c.ref = `${refPrefixOf(draft, c)}?`;
}
