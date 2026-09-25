/**
 * Where an installed cable sits on the schematic and the floor plan: the
 * ports its legs end on, the default furcation (breakout) point on the floor,
 * and the schematic fan (pins per side plus a furcation point for a side with
 * several legs). Pure readers for the renderers; no React / Konva / Three.
 */
import { add, dist, scale, sub } from '../geometry';
import { indexProject } from '../query';
import { portFloorPos } from '../routing/positions';
import { componentLayout, pinEndpoint } from '../schematic/symbolGeometry';
import type { Cable, Id, Project, Vec2 } from '../types';
import { isPlugged, plainProject, resolveCableOf, type CableSide, type PortRef } from './instances';

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
