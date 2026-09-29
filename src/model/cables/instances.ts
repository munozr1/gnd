/**
 * Installed cables (`Cable` instances) and how they connect to ports.
 *
 * A cable OWNS its links: for every channel (a Tx/Rx fiber pair) whose two
 * fibers are, through the definition's strand map, on plugged legs at both
 * ends, exactly one plan `Link` carrying `link.cableId` exists between the two
 * ports. `syncCableLinks` reconciles `project.links` with that derivation
 * after any plug change, so ERC / DRC / F8 / exports keep working on links.
 *
 * Lanes: a multi-fiber leg (MPO / MMC) on a multi-lane port makes one lane
 * link per channel (`lane` = channel index within the leg, 0-based, like a
 * breakout); a duplex leg carries one channel and takes the whole port (no
 * lane, even when its optic advertises WDM lanes). Channels beyond the port's
 * lane count (an MPO-12 cord between two 4-lane optics uses channels 1–4 of 6)
 * produce no link.
 *
 * Pure; no React / Konva / Three. Mutators take an Immer draft.
 */
import { current, isDraft } from 'immer';
import { createLink } from '../factories';
import { indexProject, isPluggableCage, ProjectIndex } from '../query';
import { isEndFree, linksOnPort } from '../schematic/lookup';
import type { Cable, CablePlug, Id, Link, LinkEnd, Project } from '../types';
import { connectorById, portAcceptsConnector } from './connectors';
import type { ResolvedSide } from './deriveSides';
import { resolveCable, type ResolvedCable } from './resolve';

export type CableSide = 'A' | 'B';

/** A port on a component (no lane). */
export interface PortRef {
  componentId: Id;
  portId: string;
}

export type PlugCheck = { ok: true } | { ok: false; reason: string };

/** Index over a plain project (memoised) or a fresh one over an Immer draft, whose identity is stable while it mutates. */
const indexFor = (project: Project): ProjectIndex => (isDraft(project) ? new ProjectIndex(project) : indexProject(project));

/** The plain (non-draft) view of a project, for memoised readers. */
export const plainProject = (project: Project): Project => (isDraft(project) ? (current(project) as Project) : project);

export const isPlugged = (plug: CablePlug | undefined): plug is CablePlug & { componentId: Id; portId: string } =>
  plug !== undefined && plug.componentId !== null && plug.portId !== null;

export function plugOf(cable: Cable, side: CableSide, leg: number): CablePlug | undefined {
  return cable.plugs.find((p) => p.side === side && p.leg === leg);
}

/** The resolved definition of an installed cable, or undefined when its def is missing or does not resolve. */
export function resolveCableOf(project: Project, cable: Cable): ResolvedCable | undefined {
  const def = indexFor(project).catalog.cable(cable.cableDefId);
  if (!def) return undefined;
  const r = resolveCable(def);
  return 'error' in r ? undefined : r;
}

export function requireCable(project: Project, cableId: Id): Cable {
  const c = project.cables.find((x) => x.id === cableId);
  if (!c) throw new Error(`Cable not found: ${cableId}`);
  return c;
}

/** Legs of a side that have no port yet, in leg order. */
export function unassignedLegs(cable: Cable, side: CableSide): number[] {
  return cable.plugs.filter((p) => p.side === side && !isPlugged(p)).map((p) => p.leg).sort((a, b) => a - b);
}

/** The next unassigned leg, side A first then side B, or null when every leg is plugged. */
export function nextUnassignedLeg(cable: Cable): { side: CableSide; leg: number } | null {
  for (const side of ['A', 'B'] as const) {
    const legs = unassignedLegs(cable, side);
    if (legs.length > 0) return { side, leg: legs[0]! };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

type Slot = { leg: number; pos: number };
const slotKey = (s: Slot): string => `${s.leg}:${s.pos}`;

/** One Tx/Rx pair on one side: which leg carries it and its index within that leg. */
export interface SideChannel {
  leg: number;
  /** 0-based channel index within the leg (the lane on a multi-lane port). */
  index: number;
  slots: [Slot, Slot];
}

/**
 * Channels of a side, mirroring the strand-map rule: outer-in position pairs
 * within each multi-fiber leg ((1,12), (2,11), …), the two positions of a
 * duplex leg, or consecutive simplex legs paired (the channel is attributed
 * to its Tx leg).
 */
export function sideChannels(side: ResolvedSide): SideChannel[] {
  const family = connectorById(side.connector)?.family ?? 'small';
  const out: SideChannel[] = [];
  if (family === 'multi') {
    for (const leg of side.legs) {
      const p = [...leg.positions].sort((x, y) => x - y);
      for (let k = 0; k < Math.floor(p.length / 2); k++) {
        out.push({ leg: leg.index, index: k, slots: [{ leg: leg.index, pos: p[k]! }, { leg: leg.index, pos: p[p.length - 1 - k]! }] });
      }
    }
    return out;
  }
  const seq: Slot[] = [];
  for (const leg of side.legs) for (const pos of leg.positions) seq.push({ leg: leg.index, pos });
  const perLeg = new Map<number, number>();
  for (let i = 0; i + 1 < seq.length; i += 2) {
    const tx = seq[i]!;
    const rx = seq[i + 1]!;
    // Duplex: one channel per leg (index 0). Simplex: legs 2c-1 / 2c, attributed to the Tx leg.
    const index = perLeg.get(tx.leg) ?? 0;
    perLeg.set(tx.leg, index + 1);
    out.push({ leg: tx.leg, index, slots: [tx, rx] });
  }
  return out;
}

/**
 * How many channels a port takes from a leg ending in `connectorId`: a duplex
 * or simplex leg always fills the whole port (1); a multi-fiber leg gets one
 * lane per channel up to the optic's lane count, or 6 on a fixed MPO-12 port.
 */
export function portLaneCapacity(idx: ProjectIndex, ref: PortRef, connectorId: string): number {
  if (connectorById(connectorId)?.family !== 'multi') return 1;
  const c = idx.component(ref.componentId);
  const pin = c && idx.pinOf(c, ref.portId);
  if (!c || !pin) return 0;
  const optic = idx.catalog.transceiver(c.optics[ref.portId]);
  if (optic) return Math.max(1, optic.lanes);
  if (pin.type === 'MPO-12') return 6;
  return 1;
}

function laneEnd(idx: ProjectIndex, plug: CablePlug & { componentId: Id; portId: string }, connector: string, channel: number): LinkEnd | null {
  const capacity = portLaneCapacity(idx, plug, connector);
  if (channel >= capacity) return null;
  return capacity > 1 ? { componentId: plug.componentId, portId: plug.portId, lane: channel } : { componentId: plug.componentId, portId: plug.portId };
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export interface DerivedLink {
  a: LinkEnd;
  b: LinkEnd;
}

/** The links a cable should have, one per channel plugged at both ends (see the module doc). */
export function deriveCableLinks(project: Project, cable: Cable): DerivedLink[] {
  return deriveWith(indexFor(project), cable);
}

function deriveWith(idx: ProjectIndex, cable: Cable): DerivedLink[] {
  const def = idx.catalog.cable(cable.cableDefId);
  const resolved = def ? resolveCable(def) : undefined;
  if (!resolved || 'error' in resolved) return [];
  const bChannelBySlot = new Map<string, SideChannel>();
  for (const ch of sideChannels(resolved.sideB)) for (const s of ch.slots) bChannelBySlot.set(slotKey(s), ch);
  const aToB = new Map<string, Slot>();
  for (const link of resolved.strandMap) aToB.set(slotKey(link.a), link.b);

  const out: DerivedLink[] = [];
  for (const ch of sideChannels(resolved.sideA)) {
    const bSlots = ch.slots.map((s) => aToB.get(slotKey(s)));
    const bChannels = bSlots.map((s) => (s ? bChannelBySlot.get(slotKey(s)) : undefined));
    const [b0, b1] = bChannels;
    // A channel is end-to-end only when both fibers land in one channel on side B (a custom map may split them).
    if (!b0 || !b1 || b0 !== b1) continue;
    const plugA = plugOf(cable, 'A', ch.leg);
    const plugB = plugOf(cable, 'B', b0.leg);
    if (!isPlugged(plugA) || !isPlugged(plugB)) continue;
    const a = laneEnd(idx, plugA, resolved.sideA.connector, ch.index);
    const b = laneEnd(idx, plugB, resolved.sideB.connector, b0.index);
    if (!a || !b) continue;
    out.push({ a, b });
  }
  return out;
}

const sameEnd = (x: LinkEnd, y: LinkEnd): boolean => x.componentId === y.componentId && x.portId === y.portId && x.lane === y.lane;
const sameLink = (l: Link, d: DerivedLink): boolean => (sameEnd(l.a, d.a) && sameEnd(l.b, d.b)) || (sameEnd(l.a, d.b) && sameEnd(l.b, d.a));

export interface SyncCableLinksResult {
  added: Id[];
  removed: Id[];
}

/**
 * Reconcile `draft.links` with `deriveCableLinks`: create the links that are
 * missing (with the cable's def and `cableId`), drop this cable's links that
 * no longer derive (and their routes), leave every other link untouched.
 * Throws 'Port X is already used by …' when a derived end collides with a
 * link that is not part of this cable.
 */
export function syncCableLinks(draft: Project, cableId: Id): SyncCableLinksResult {
  const cable = requireCable(draft, cableId);
  const idx = new ProjectIndex(draft);
  const desired = deriveWith(idx, cable);
  const mine = draft.links.filter((l) => l.cableId === cableId);
  const others = draft.links.filter((l) => l.cableId !== cableId);
  const keep = new Set<Id>();
  const added: Id[] = [];
  for (const d of desired) {
    const existing = mine.find((l) => !keep.has(l.id) && sameLink(l, d));
    if (existing) {
      keep.add(existing.id);
      continue;
    }
    for (const end of [d.a, d.b]) {
      if (isEndFree(others, end)) continue;
      const clash = linksOnPort(others, end.componentId, end.portId)[0];
      throw new Error(`Port ${idx.endLabel(end)} is already used by ${clash ? idx.linkLabel(clash) : 'another link'}`);
    }
    const link = createLink(d.a, d.b, cable.cableDefId);
    link.cableId = cableId;
    draft.links.push(link);
    added.push(link.id);
    keep.add(link.id);
  }
  const removed = mine.filter((l) => !keep.has(l.id)).map((l) => l.id);
  if (removed.length > 0) {
    const gone = new Set(removed);
    draft.links = draft.links.filter((l) => !gone.has(l.id));
    for (const id of removed) delete draft.routes[id];
  }
  return { added, removed };
}

// ---------------------------------------------------------------------------
// Plugging
// ---------------------------------------------------------------------------

/** 'MPO-12 port' / 'LC port' / 'empty QSFP28 cage' — what a port offers a leg, for messages. */
function describePort(idx: ProjectIndex, ref: PortRef): string {
  const c = idx.component(ref.componentId);
  const pin = c && idx.pinOf(c, ref.portId);
  if (!c || !pin) return 'unknown port';
  const optic = idx.catalog.transceiver(c.optics[ref.portId]);
  if (optic) return optic.connector.toLowerCase() === 'integrated' ? `${optic.name} DAC/AOC port` : `${optic.connector} port`;
  return isPluggableCage(pin.type) ? `empty ${pin.type} cage` : `${pin.type} port`;
}

/**
 * Whether leg `leg` of side `side` can plug into `ref`: the connector must
 * suit the port (its fixed type, or its optic's connector for a cage), and
 * the port must be free of other cable plugs and of links that no cable owns.
 */
export function plugCompatible(project: Project, cable: Cable, side: CableSide, leg: number, ref: PortRef): PlugCheck {
  return checkPlug(indexFor(project), cable, side, leg, ref);
}

function checkPlug(idx: ProjectIndex, cable: Cable, side: CableSide, leg: number, ref: PortRef): PlugCheck {
  const def = idx.catalog.cable(cable.cableDefId);
  const resolved = def ? resolveCable(def) : undefined;
  if (!def) return { ok: false, reason: `Unknown cable definition ${cable.cableDefId}` };
  if (!resolved || 'error' in resolved) return { ok: false, reason: resolved?.error ?? `Cable ${def.name} does not resolve` };
  const sideDef = side === 'A' ? resolved.sideA : resolved.sideB;
  const legDef = sideDef.legs[leg];
  if (!legDef) return { ok: false, reason: `Side ${side} of ${cable.label} has no leg ${leg + 1}` };
  const c = idx.component(ref.componentId);
  if (!c) return { ok: false, reason: `Component not found: ${ref.componentId}` };
  const pin = idx.pinOf(c, ref.portId);
  if (!pin) return { ok: false, reason: `${c.ref} has no port ${ref.portId}` };
  const optic = idx.catalog.transceiver(c.optics[ref.portId]);
  const port = { type: pin.type, ...(optic ? { opticConnector: optic.connector, opticLanes: optic.lanes } : {}) };
  if (!portAcceptsConnector(port, sideDef.connector)) {
    return { ok: false, reason: `${sideDef.connector} leg ${legDef.label} cannot plug into ${ref.portId} (${describePort(idx, ref)})` };
  }
  const other = idx.plugAt(ref);
  if (other && !(other.cableId === cable.id && other.side === side && other.leg === leg)) {
    const ownerLabel = idx.cable(other.cableId)?.label ?? other.cableId;
    return { ok: false, reason: `${c.ref}:${ref.portId} is already used by cable ${ownerLabel} (side ${other.side} leg ${other.leg + 1})` };
  }
  if (idx.linksOf(c.id).some((l) => l.cableId !== cable.id && ((l.a.componentId === c.id && l.a.portId === ref.portId) || (l.b.componentId === c.id && l.b.portId === ref.portId)))) {
    return { ok: false, reason: `${c.ref}:${ref.portId} is already connected` };
  }
  return { ok: true };
}

/**
 * Ports for the remaining unassigned legs of `side`, walking the component's
 * ports in their natural (symbol) order from `first`: one compatible free
 * port per leg, skipping occupied or incompatible ones, stopping early when
 * the ports run out. Empty when `first` itself does not take the first leg.
 */
export function autoFillPorts(project: Project, cable: Cable, side: CableSide, first: PortRef): PortRef[] {
  // One index for the whole walk: over a draft each would be a fresh O(n) build.
  const idx = indexFor(project);
  const c = idx.component(first.componentId);
  const symbol = c && idx.symbolOf(c);
  if (!c || !symbol) return [];
  const start = symbol.pins.findIndex((p) => p.portId === first.portId);
  if (start < 0) return [];
  const legs = unassignedLegs(cable, side);
  const out: PortRef[] = [];
  const taken = new Set<string>();
  for (let i = start; i < symbol.pins.length && out.length < legs.length; i++) {
    const ref: PortRef = { componentId: c.id, portId: symbol.pins[i]!.portId };
    if (taken.has(ref.portId)) continue;
    const check = checkPlug(idx, cable, side, legs[out.length]!, ref);
    if (check.ok) {
      out.push(ref);
      taken.add(ref.portId);
    } else if (i === start) {
      return [];
    }
  }
  return out;
}

/** The port after `ref` on the same component in symbol order, or null at the end. */
export function nextPortAfter(project: Project, ref: PortRef): PortRef | null {
  const idx = indexFor(project);
  const c = idx.component(ref.componentId);
  const symbol = c && idx.symbolOf(c);
  if (!c || !symbol) return null;
  const i = symbol.pins.findIndex((p) => p.portId === ref.portId);
  const next = i >= 0 ? symbol.pins[i + 1] : undefined;
  return next ? { componentId: c.id, portId: next.portId } : null;
}

// ---------------------------------------------------------------------------
// Draft mutators
// ---------------------------------------------------------------------------

/** Plug a leg (validated with `plugCompatible`, throwing its reason) and resync the cable's links. */
export function plugCableLeg(draft: Project, cableId: Id, side: CableSide, leg: number, ref: PortRef): void {
  const cable = requireCable(draft, cableId);
  const check = plugCompatible(draft, cable, side, leg, ref);
  if (!check.ok) throw new Error(check.reason);
  const plug = plugOf(cable, side, leg);
  if (!plug) throw new Error(`Side ${side} of ${cable.label} has no leg ${leg + 1}`);
  plug.componentId = ref.componentId;
  plug.portId = ref.portId;
  syncCableLinks(draft, cableId);
}

export function unplugCableLeg(draft: Project, cableId: Id, side: CableSide, leg: number): void {
  const cable = requireCable(draft, cableId);
  const plug = plugOf(cable, side, leg);
  if (!plug) throw new Error(`Side ${side} of ${cable.label} has no leg ${leg + 1}`);
  plug.componentId = null;
  plug.portId = null;
  syncCableLinks(draft, cableId);
}

/** Auto-fill a side from `first` (see `autoFillPorts`); returns the number of legs plugged. Throws when `first` is not compatible. */
export function autoFillCableSide(draft: Project, cableId: Id, side: CableSide, first: PortRef): number {
  const cable = requireCable(draft, cableId);
  const legs = unassignedLegs(cable, side);
  if (legs.length === 0) return 0;
  const check = plugCompatible(draft, cable, side, legs[0]!, first);
  if (!check.ok) throw new Error(check.reason);
  const ports = autoFillPorts(draft, cable, side, first);
  ports.forEach((ref, i) => {
    const plug = plugOf(cable, side, legs[i]!)!;
    plug.componentId = ref.componentId;
    plug.portId = ref.portId;
  });
  syncCableLinks(draft, cableId);
  return ports.length;
}

/** Remove a cable with the links it owns (and their routes). */
export function removeCable(draft: Project, cableId: Id): void {
  requireCable(draft, cableId);
  const gone = new Set(draft.links.filter((l) => l.cableId === cableId).map((l) => l.id));
  if (gone.size > 0) {
    draft.links = draft.links.filter((l) => !gone.has(l.id));
    for (const id of gone) delete draft.routes[id];
  }
  draft.cables = draft.cables.filter((c) => c.id !== cableId);
}

/**
 * Null every plug on the given components (they are being deleted) and
 * resync the affected cables. Returns the ids of the cables that changed.
 */
export function unplugComponents(draft: Project, componentIds: readonly Id[]): Id[] {
  const set = new Set(componentIds);
  const changed: Id[] = [];
  for (const cable of draft.cables ?? []) {
    let touched = false;
    for (const plug of cable.plugs) {
      if (plug.componentId !== null && set.has(plug.componentId)) {
        plug.componentId = null;
        plug.portId = null;
        touched = true;
      }
    }
    if (touched) changed.push(cable.id);
  }
  for (const id of changed) syncCableLinks(draft, id);
  return changed;
}
