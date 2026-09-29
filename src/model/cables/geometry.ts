/**
 * Where an installed cable sits on the schematic and the floor plan: the
 * ports its legs end on, the default furcation (breakout) point on the floor,
 * and the schematic fan (pins per side plus a furcation point for a side with
 * several legs). Pure readers for the renderers; no React / Konva / Three.
 */
import { add, dist, scale, sub } from '../geometry';
import { indexProject, type ProjectIndex } from '../query';
import { portFloorPos } from '../routing/positions';
import { componentLayout, pinEndpoint } from '../schematic/symbolGeometry';
import { autoWirePoints, WIRE_STUB, wireMidpoint } from '../schematic/wires';
import type { Cable, Id, Project, Vec2 } from '../types';
import type { ResolvedSide } from './deriveSides';
import { isPlugged, plainProject, resolveCableOf, type CableSide, type PortRef } from './instances';
import type { ResolvedCable } from './resolve';

/** Ports of the plugged legs of each side, in leg order. (`project` is accepted for symmetry with the other readers.) */
export function cableEnds(_project: Project, cable: Cable): { A: PortRef[]; B: PortRef[] } {
  const ends = { A: [] as PortRef[], B: [] as PortRef[] };
  const sorted = [...cable.plugs].sort((x, y) => x.leg - y.leg);
  for (const plug of sorted) {
    if (isPlugged(plug)) ends[plug.side].push({ componentId: plug.componentId, portId: plug.portId });
  }
  return ends;
}

const centroid = (points: readonly Vec2[]): Vec2 | null => {
  if (points.length === 0) return null;
  const sum = points.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
  return scale(sum, 1 / points.length);
};

/** Floor positions of a side's plugged ports (placed components only). */
function sideFloorPoints(project: Project, cable: Cable, side: CableSide): Vec2[] {
  const out: Vec2[] = [];
  for (const ref of cableEnds(project, cable)[side]) {
    const p = portFloorPos(project, ref.componentId, ref.portId);
    if (p) out.push(p);
  }
  return out;
}

/**
 * Default furcation point of a side on the floor plan: the definition's
 * breakout length (metres → mm) back from the centroid of that side's plugged
 * port positions towards the other side's centroid, clamped to the midpoint
 * when the ends are closer than that. Null when the side has no placed port.
 */
export function furcationDefaultFloorPos(project: Project, cable: Cable, side: CableSide): Vec2 | null {
  const plain = plainProject(project);
  const own = centroid(sideFloorPoints(plain, cable, side));
  if (!own) return null;
  const other = centroid(sideFloorPoints(plain, cable, side === 'A' ? 'B' : 'A'));
  const resolved = resolveCableOf(plain, cable);
  const breakoutMm = (resolved?.breakoutLengthM ?? 0) * 1000;
  if (!other || breakoutMm <= 0) return own;
  const d = dist(own, other);
  if (d === 0) return own;
  const back = Math.min(breakoutMm, d / 2);
  return add(own, scale(sub(other, own), back / d));
}

/** Whether a side of the cable's definition fans out into several legs (and so has a furcation point). */
export function sideIsFanned(project: Project, cable: Cable, side: CableSide): boolean {
  const resolved = resolveCableOf(plainProject(project), cable);
  const legs = side === 'A' ? resolved?.sideA.legs.length : resolved?.sideB.legs.length;
  return (legs ?? 0) > 1;
}

export interface FurcationPos {
  pos: Vec2;
  /** true when the user placed it (`Cable.furcation`); false when it is the derived default that follows the ports. */
  pinned: boolean;
}

/**
 * Effective furcation point of a side on the floor plan: the user-pinned
 * position when there is one, else `furcationDefaultFloorPos`. Null for a
 * side with a single leg (no fan-out) or, unpinned, without a placed port.
 * An unpinned stored position is ignored so that unpinning returns the node
 * to the derived default.
 */
export function furcationFloorPos(project: Project, cable: Cable, side: CableSide): FurcationPos | null {
  if (!sideIsFanned(project, cable, side)) return null;
  const stored = cable.furcation?.[side];
  if (stored?.pinned) return { pos: { x: stored.pos.x, y: stored.pos.y }, pinned: true };
  const pos = furcationDefaultFloorPos(project, cable, side);
  return pos ? { pos, pinned: false } : null;
}

export interface CableLegFloor {
  leg: number;
  ref: PortRef;
  /** Floor position of the leg's port. */
  pos: Vec2;
}

/** The plugged legs of a side whose port is placed, with their floor positions, in leg order. */
export function cableLegsFloor(project: Project, cable: Cable, side: CableSide): CableLegFloor[] {
  const plain = plainProject(project);
  const out: CableLegFloor[] = [];
  for (const plug of [...cable.plugs].sort((x, y) => x.leg - y.leg)) {
    if (plug.side !== side || !isPlugged(plug)) continue;
    const ref = { componentId: plug.componentId, portId: plug.portId };
    const pos = portFloorPos(plain, ref.componentId, ref.portId);
    if (pos) out.push({ leg: plug.leg, ref, pos });
  }
  return out;
}

export interface FanPin {
  leg: number;
  pos: Vec2;
  /** Unit direction the pin points away from its body. */
  dir: Vec2;
}

export interface CableSchematicFan {
  aPins: FanPin[];
  bPins: FanPin[];
  /** Present when side A has several legs and at least one plugged pin on the sheet. */
  furcationA?: Vec2;
  furcationB?: Vec2;
}

/** Distance from a multi-leg side's pins to its furcation glyph, schematic units. */
export const FAN_OFFSET = 40;

function sidePins(project: Project, cable: Cable, side: CableSide, sheetId: Id | undefined): FanPin[] {
  const idx = indexProject(project);
  const out: FanPin[] = [];
  for (const plug of [...cable.plugs].sort((x, y) => x.leg - y.leg)) {
    if (plug.side !== side || !isPlugged(plug)) continue;
    const c = idx.component(plug.componentId);
    if (!c || (sheetId !== undefined && c.sch.sheetId !== sheetId)) continue;
    const layout = componentLayout(project, c.id);
    const pin = layout && pinEndpoint(layout, plug.portId);
    if (pin) out.push({ leg: plug.leg, pos: pin.pos, dir: pin.dir });
  }
  return out;
}

/**
 * Furcation point for a side with several legs: FAN_OFFSET units from the
 * side's pins towards the other side (along the pins' axis; horizontal pins
 * fan sideways at their mean y, vertical pins fan up / down at their mean x).
 * Without pins on the other side the pins' own outward direction is used.
 */
function furcationFor(pins: readonly FanPin[], others: readonly FanPin[]): Vec2 | undefined {
  const mean = centroid(pins.map((p) => p.pos));
  if (!mean) return undefined;
  const meanDir = centroid(pins.map((p) => p.dir)) ?? { x: 1, y: 0 };
  const horizontal = Math.abs(meanDir.x) >= Math.abs(meanDir.y);
  const target = centroid(others.map((p) => p.pos));
  const sign = (v: number, fallback: number): number => (v > 0 ? 1 : v < 0 ? -1 : fallback >= 0 ? 1 : -1);
  if (horizontal) {
    const s = target ? sign(target.x - mean.x, meanDir.x) : sign(meanDir.x, 1);
    return { x: mean.x + FAN_OFFSET * s, y: mean.y };
  }
  const s = target ? sign(target.y - mean.y, meanDir.y) : sign(meanDir.y, 1);
  return { x: mean.x, y: mean.y + FAN_OFFSET * s };
}

/**
 * Schematic geometry of a cable: the pin position of every plugged leg per
 * side (optionally only those on `sheetId`) and a furcation point for each
 * side whose definition has more than one leg.
 */
export function cableSchematicFan(project: Project, cable: Cable, sheetId?: Id): CableSchematicFan {
  const plain = plainProject(project);
  const aPins = sidePins(plain, cable, 'A', sheetId);
  const bPins = sidePins(plain, cable, 'B', sheetId);
  const resolved = resolveCableOf(plain, cable);
  const fan: CableSchematicFan = { aPins, bPins };
  if (resolved && resolved.sideA.legs.length > 1) {
    const f = furcationFor(aPins, bPins);
    if (f) fan.furcationA = f;
  }
  if (resolved && resolved.sideB.legs.length > 1) {
    const f = furcationFor(bPins, aPins);
    if (f) fan.furcationB = f;
  }
  return fan;
}

// ---------------------------------------------------------------------------
// Schematic drawing: jacket + fans (consumed by src/editors/schematic/scene.ts)
// ---------------------------------------------------------------------------

/** Length of a dangling stub: an unassigned leg, or the jacket end of an unassigned single-leg side. */
export const DANGLE_LENGTH = 25;
/** A plugged leg runs straight out of its pin for this long before fanning to the furcation. */
export const LEG_STUB = 10;
/** Perpendicular pitch between the dangling stubs of one fan. */
const DANGLE_PITCH = 8;
/** Jacket stub towards a side plugged on another sheet (the plain wires' off-sheet stubs are 60 too). */
const OFF_SHEET_STUB = 60;
/** Default jacket length to the fan of a multi-leg side with nothing plugged yet. */
const PENDING_FAN_OFFSET = WIRE_STUB + FAN_OFFSET;

export type CableLegState = 'pin' | 'dangling' | 'offSheet';
export type CableEndKind = 'pin' | 'fan' | 'dangling' | 'offSheet';

export interface CableSchematicLeg {
  side: CableSide;
  leg: number;
  /** From the furcation to the pin, or to the free end of a dangling / off-sheet stub. */
  points: Vec2[];
  state: CableLegState;
  /** The plugged port ('pin' and 'offSheet'). */
  ref?: PortRef;
  /** 'PP1:f1 ▸ Pod A' when the leg is plugged on another sheet. */
  offSheetLabel?: string;
}

export interface CableSchematicEnd {
  side: CableSide;
  /**
   * 'pin': a single-leg side plugged on this sheet (the jacket ends on the pin);
   * 'fan': a multi-leg side, jacket ends at the furcation and `legs` fan out;
   * 'dangling': an unplugged single-leg side (short stub, hollow circle);
   * 'offSheet': plugged only on other sheets (stub with an off-sheet label).
   */
  kind: CableEndKind;
  /** Where the jacket ends: the pin, the furcation, or the free end of a stub. */
  anchor: Vec2;
  /** Axis-aligned unit direction in which the jacket leaves the anchor. */
  dir: Vec2;
  /** Legs of a 'fan' end in leg order; empty otherwise. */
  legs: CableSchematicLeg[];
  /** The plugged port ('pin' and 'offSheet'). */
  ref?: PortRef;
  offSheetLabel?: string;
}

export interface CableSchematicDrawing {
  cable: Cable;
  resolved: ResolvedCable;
  /** Jacket polyline from end A's anchor to end B's anchor (orthogonal elbows between two plugged ends). */
  jacket: Vec2[];
  ends: Record<CableSide, CableSchematicEnd>;
  /** '8F · 4ch' at the jacket's midpoint. */
  badge: { pos: Vec2; text: string };
}

const axisOf = (v: Vec2): Vec2 => (Math.abs(v.x) >= Math.abs(v.y) ? { x: v.x < 0 ? -1 : 1, y: 0 } : { x: 0, y: v.y < 0 ? -1 : 1 });
const perpOf = (d: Vec2): Vec2 => ({ x: -d.y, y: d.x });
const neg = (d: Vec2): Vec2 => ({ x: -d.x + 0, y: -d.y + 0 });

interface SidePin extends FanPin { ref: PortRef }
interface SideInfo {
  /** Plugged legs whose pin is on this sheet. */
  pins: Map<number, SidePin>;
  /** Plugged legs whose component is on another sheet. */
  elsewhere: Map<number, { ref: PortRef; label: string }>;
}

function sideInfo(project: Project, idx: ProjectIndex, cable: Cable, side: CableSide, sheetId: Id): SideInfo {
  const info: SideInfo = { pins: new Map(), elsewhere: new Map() };
  for (const plug of cable.plugs) {
    if (plug.side !== side || !isPlugged(plug)) continue;
    const c = idx.component(plug.componentId);
    if (!c) continue;
    const ref = { componentId: plug.componentId, portId: plug.portId };
    const layout = c.sch.sheetId === sheetId ? componentLayout(project, c.id) : undefined;
    const pin = layout && pinEndpoint(layout, plug.portId);
    if (pin) info.pins.set(plug.leg, { leg: plug.leg, pos: pin.pos, dir: pin.dir, ref });
    else info.elsewhere.set(plug.leg, { ref, label: `${idx.endLabel(ref)} ▸ ${project.sheets.find((s) => s.id === c.sch.sheetId)?.name ?? 'Sheet'}` });
  }
  return info;
}

/** Legs of a fan: plugged ones run pin → LEG_STUB out → furcation; the rest dangle DANGLE_LENGTH past the furcation, spread by leg order. */
function fanLegs(side: CableSide, sideDef: ResolvedSide, info: SideInfo, furcation: Vec2, jacketDir: Vec2): CableSchematicLeg[] {
  const fanDir = neg(jacketDir);
  const perp = perpOf(fanDir);
  const n = sideDef.legs.length;
  const legs: CableSchematicLeg[] = [];
  for (let i = 0; i < n; i++) {
    const pin = info.pins.get(i);
    if (pin) {
      legs.push({ side, leg: i, points: [furcation, add(pin.pos, scale(pin.dir, LEG_STUB)), pin.pos], state: 'pin', ref: pin.ref });
      continue;
    }
    const tip = add(add(furcation, scale(fanDir, DANGLE_LENGTH)), scale(perp, (i - (n - 1) / 2) * DANGLE_PITCH));
    const away = info.elsewhere.get(i);
    legs.push(away
      ? { side, leg: i, points: [furcation, tip], state: 'offSheet', ref: away.ref, offSheetLabel: away.label }
      : { side, leg: i, points: [furcation, tip], state: 'dangling' });
  }
  return legs;
}

/**
 * The end of a side with at least one pin on the sheet. A single-leg side
 * ends on its pin; a multi-leg side ends at a furcation FAN_OFFSET in front
 * of its pins (along their mean outward direction, so the legs never cross
 * the symbol body; the jacket's elbow route takes care of reaching the other
 * side) with one leg per definition leg.
 */
function plumbedEnd(side: CableSide, sideDef: ResolvedSide, info: SideInfo): CableSchematicEnd | null {
  const pins = [...info.pins.values()].sort((x, y) => x.leg - y.leg);
  if (pins.length === 0) return null;
  if (sideDef.legs.length === 1) {
    const pin = pins[0]!;
    return { side, kind: 'pin', anchor: pin.pos, dir: axisOf(pin.dir), legs: [], ref: pin.ref };
  }
  const mean = centroid(pins.map((p) => p.pos))!;
  const dir = axisOf(centroid(pins.map((p) => p.dir))!);
  const furcation = add(mean, scale(dir, FAN_OFFSET));
  return { side, kind: 'fan', anchor: furcation, dir, legs: fanLegs(side, sideDef, info, furcation, dir) };
}

/** The end of a side with no pin on the sheet, laid out from the other (plumbed) end. */
function pendingEnd(side: CableSide, sideDef: ResolvedSide, info: SideInfo, from: CableSchematicEnd): CableSchematicEnd {
  const dir = neg(from.dir);
  const away = [...info.elsewhere.entries()].sort((x, y) => x[0] - y[0])[0]?.[1];
  if (away) {
    return { side, kind: 'offSheet', anchor: add(from.anchor, scale(from.dir, OFF_SHEET_STUB)), dir, legs: [], ref: away.ref, offSheetLabel: away.label };
  }
  if (sideDef.legs.length === 1) return { side, kind: 'dangling', anchor: add(from.anchor, scale(from.dir, DANGLE_LENGTH)), dir, legs: [] };
  const furcation = add(from.anchor, scale(from.dir, PENDING_FAN_OFFSET));
  return { side, kind: 'fan', anchor: furcation, dir, legs: fanLegs(side, sideDef, info, furcation, dir) };
}

/**
 * Everything the schematic draws for one cable on `sheetId`: the jacket
 * polyline (A → B), both ends and the badge. Null when the cable has no pin
 * on the sheet (or its definition does not resolve). Legs plugged on other
 * sheets show as off-sheet stubs; unassigned legs dangle.
 */
export function cableSchematicDrawing(project: Project, cable: Cable, sheetId: Id): CableSchematicDrawing | null {
  const plain = plainProject(project);
  const resolved = resolveCableOf(plain, cable);
  if (!resolved) return null;
  const idx = indexProject(plain);
  const info = { A: sideInfo(plain, idx, cable, 'A', sheetId), B: sideInfo(plain, idx, cable, 'B', sheetId) };
  if (info.A.pins.size === 0 && info.B.pins.size === 0) return null;
  let a = plumbedEnd('A', resolved.sideA, info.A);
  let b = plumbedEnd('B', resolved.sideB, info.B);
  let jacket: Vec2[];
  if (a && b) {
    jacket = [a.anchor, ...autoWirePoints(a.anchor, a.dir, b.anchor, b.dir), b.anchor];
  } else if (a) {
    b = pendingEnd('B', resolved.sideB, info.B, a);
    jacket = [a.anchor, b.anchor];
  } else {
    a = pendingEnd('A', resolved.sideA, info.A, b!);
    jacket = [a.anchor, b!.anchor];
  }
  return { cable, resolved, jacket, ends: { A: a, B: b! }, badge: { pos: wireMidpoint(jacket), text: `${resolved.fiberCount}F · ${resolved.channels}ch` } };
}

/** Legs on the other side that share fibers with (`side`, `leg`) through the strand map, ascending. */
export function legsLinkedTo(resolved: ResolvedCable, side: CableSide, leg: number): number[] {
  const out = new Set<number>();
  for (const l of resolved.strandMap) {
    const own = side === 'A' ? l.a : l.b;
    if (own.leg === leg) out.add(side === 'A' ? l.b.leg : l.a.leg);
  }
  return [...out].sort((x, y) => x - y);
}
