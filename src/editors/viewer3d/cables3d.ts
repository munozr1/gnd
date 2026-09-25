/**
 * 3D geometry of an installed cable (a `Cable` instance): the jacket tube,
 * a furcation boot on every side that fans out into several legs, one thin
 * leg per connector on such a side (a dim stub when the leg has no port), and
 * a connector shape at every port end. Pure: the model's mm go in, scene
 * metres (y up) come out; no React / Three. The jacket follows the cable's
 * route when it has one, so the 3D view shows the same pathway as the layout.
 */
import { isPatchFrame } from '@/commands/placement';
import { connectorById, furcationFloorPos, isPlugged, plugOf, resolveCableOf, type CableSide, type ConnectorDef, type Leg, type ResolvedSide } from '@/model/cables';
import { indexProject } from '@/model/query';
import { portPlacement, portWorldPos, rackFrontDir, routePath3d, type RoutePath3d } from '@/model/routing';
import type { Cable, Id, Project, Route, RoutingLayer, Vec2, Vec3 } from '@/model/types';
import type { BoxPart, V3 } from './geometry';

/** Thickness of a patch-panel faceplate standing proud of each face of a patch-frame wall, mm (shared with the rack builder). */
export const PLATE_MM = 10;
/** The furcation boot: a short cylinder where the jacket splits. */
export const BOOT_LENGTH_MM = 60;
export const BOOT_COLOR = '#2e353d';
/** A breakout leg is a thin 2 mm tube. */
export const LEG_DIAMETER_MM = 2;
/** A leg without a port is a stub of this length pointing away from the jacket. */
export const LEG_STUB_MM = 150;
export const STUB_COLOR = '#5b6670';
/** Angle between neighbouring stubs so they do not draw on top of each other. */
export const STUB_SPREAD_DEG = 6;
/** A jacket whose far side has no position at all stands this far out of the known end. */
export const JACKET_STUB_MM = 300;
/** A leg / an unrouted jacket leaves a port perpendicular to its face for this far before heading off. */
export const PORT_STANDOFF_MM = 40;
/** Connector shapes at a port end: [width, height, length along the port normal], mm. */
export const MPO_CONNECTOR_MM: V3 = [12, 6, 20];
export const LC_CONNECTOR_MM: V3 = [4, 4, 12];
/** Gap between the two ferrules of a duplex connector, mm. */
export const LC_GAP_MM = 1;

/** The selection item every part of an installed cable resolves to: clicking any of them selects the whole cable. */
export type CableTarget = { kind: 'cable'; id: Id };

export interface TubePart {
  target: CableTarget;
  /** Metres, y up. */
  points: V3[];
  radius: number;
  bendRadius: number;
  color: string;
}
export interface LegPart extends TubePart {
  side: CableSide;
  leg: number;
  label: string;
  /** false → a stub for a leg with no (placed) port. */
  plugged: boolean;
}
export interface BootPart {
  target: CableTarget;
  side: CableSide;
  /** Centre of the boot (= the furcation point), metres. */
  position: V3;
  /** Unit axis, pointing away from the jacket towards the legs. */
  direction: V3;
  length: number;
  radius: number;
  color: string;
}
export interface InstalledCable3d {
  id: Id;
  label: string;
  target: CableTarget;
  jacket: TubePart;
  layers: RoutingLayer[];
  /** true when the jacket follows a route rather than a straight airwire. */
  routed: boolean;
  boots: BootPart[];
  legs: LegPart[];
  connectors: BoxPart[];
}

const metres = (p: Vec3): V3 => [p.x / 1000, p.y / 1000, p.z / 1000];
const unit = (v: Vec3): Vec3 | null => {
  const n = Math.hypot(v.x, v.y, v.z);
  return n < 1e-9 ? null : { x: v.x / n, y: v.y / n, z: v.z / n };
};
const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const along = (p: Vec3, d: Vec3, mm: number): Vec3 => ({ x: p.x + d.x * mm, y: p.y + d.y * mm, z: p.z + d.z * mm });
const rotateY = (v: Vec3, rad: number): Vec3 => {
  const c = Math.cos(rad), s = Math.sin(rad);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
};

/** A plugged leg's port in the scene. */
interface PortEnd {
  leg: number;
  pos: Vec3;
  /** Outward unit normal of the rack face the port is on (floor plane). */
  normal: Vec2;
  /** Yaw of boxes on that face (the rack's rotation, as the rack builder uses it). */
  rotation: number;
  /** How far the port stud stands proud of the rack face (a patch wall's faceplate). */
  proudMm: number;
}
const out = (end: PortEnd, mm: number): Vec3 => ({ x: end.pos.x + end.normal.x * mm, y: end.pos.y, z: end.pos.z + end.normal.y * mm });

interface SideGeom {
  side: CableSide;
  def: ResolvedSide;
  connector: ConnectorDef | undefined;
  /** Several legs → the jacket ends in a furcation boot on this side. */
  multi: boolean;
  /** Per leg index; null when the leg has no port or its component is not in a rack. */
  ends: (PortEnd | null)[];
  /** Where the jacket meets this side, mm world: the single port (proud of its face) or the furcation point. */
  anchor: Vec3 | null;
  /** Unit direction away from this side's rack face(s). */
  outward: Vec3 | null;
}

function portEnd(project: Project, leg: number, componentId: Id, portId: string): PortEnd | null {
  const info = portPlacement(project, componentId, portId), pos = portWorldPos(project, componentId, portId);
  if (!info || !pos) return null;
  const front = rackFrontDir(info.rack);
  return { leg, pos, normal: info.face === 'front' ? front : { x: -front.x, y: -front.y }, rotation: -info.rack.rotationDeg * Math.PI / 180, proudMm: isPatchFrame(info.rack) ? PLATE_MM : 0 };
}

function sideGeom(project: Project, cable: Cable, side: CableSide, def: ResolvedSide): SideGeom {
  const ends = def.legs.map((leg) => {
    const plug = plugOf(cable, side, leg.index);
    return isPlugged(plug) ? portEnd(project, leg.index, plug.componentId, plug.portId) : null;
  });
  const placed = ends.filter((e): e is PortEnd => e !== null);
  const mean = placed.length ? placed.reduce((acc, e) => ({ x: acc.x + e.normal.x, y: acc.y + e.normal.y }), { x: 0, y: 0 }) : null;
  const outward = mean ? unit({ x: mean.x, y: 0, z: mean.y }) : null;
  const multi = def.legs.length > 1;
  const single = !multi ? placed[0] : undefined;
  return { side, def, connector: connectorById(def.connector), multi, ends, anchor: single ? out(single, single.proudMm) : null, outward };
}

/**
 * The furcation point of a multi-leg side in mm world space: the layout's
 * furcation node (pinned by the user, else the derived default that follows
 * the ports; an unpinned stored position is ignored, exactly as
 * `furcationFloorPos` does, so 3D and layout always agree) at the mean
 * elevation of the side's plugged ports. `aimAt` says whether the other side
 * has a placed port for the default to point towards.
 */
function furcationOf(project: Project, cable: Cable, geom: SideGeom, aimAt: boolean, breakoutMm: number): Vec3 | null {
  const placed = geom.ends.filter((e): e is PortEnd => e !== null);
  const elevation = placed.length ? placed.reduce((s, e) => s + e.pos.y, 0) / placed.length : null;
  const floor = furcationFloorPos(project, cable, geom.side);
  if (floor?.pinned) return { x: floor.pos.x, y: elevation ?? 0, z: floor.pos.y };
  if (!placed.length || elevation === null) return null;
  if (aimAt) return floor ? { x: floor.pos.x, y: elevation, z: floor.pos.y } : null;
  // Nothing on the other side to aim at: the breakout length straight out of the face, far enough for the boot to clear it.
  const centroid = placed.reduce((acc, e) => ({ x: acc.x + e.pos.x, y: acc.y + e.pos.z }), { x: 0, y: 0 });
  const c = { x: centroid.x / placed.length, y: elevation, z: centroid.y / placed.length };
  return along(c, geom.outward ?? { x: 0, y: 0, z: 1 }, Math.max(breakoutMm, BOOT_LENGTH_MM * 2));
}

/** The pathway the jacket follows: the cable's own route, else the route of the first link it owns. */
function jacketRoute(project: Project, cable: Cable): { path: RoutePath3d; route: Route } | null {
  const idx = indexProject(project);
  const own = project.routes[cable.id];
  const ownPath = own && routePath3d(project, cable.id);
  if (own && ownPath) return { path: ownPath, route: own };
  for (const link of idx.linksOfCable(cable.id)) {
    const route = project.routes[link.id];
    const path = route && routePath3d(project, link.id);
    if (route && path) return { path, route };
  }
  return null;
}

function connectorShapes(end: PortEnd, connector: ConnectorDef | undefined, target: InstalledCable3d['target']): BoxPart[] {
  if (!connector) return [];
  const size = connector.family === 'multi' ? MPO_CONNECTOR_MM : LC_CONNECTOR_MM;
  const centre = out(end, end.proudMm + size[2] / 2);
  // A duplex plug is two ferrules side by side across the face; simplex is one.
  const ferrules = connector.family === 'multi' || connector.positions < 2 ? [0] : [-(size[0] + LC_GAP_MM) / 2, (size[0] + LC_GAP_MM) / 2];
  const across = { x: -end.normal.y, y: end.normal.x };
  return ferrules.map((shift) => ({
    target,
    position: metres({ x: centre.x + across.x * shift, y: centre.y, z: centre.z + across.y * shift }),
    size: [size[0] / 1000, size[1] / 1000, size[2] / 1000],
    rotation: end.rotation,
    color: connector.color,
  }));
}

/**
 * Scene parts of one installed cable, or null when neither end has a place
 * in the room (no plugged leg on a racked device and no furcation point).
 * A side with no position at all is sketched as a stub out of the known end.
 */
export function buildInstalledCable3d(project: Project, cable: Cable): InstalledCable3d | null {
  const resolved = resolveCableOf(project, cable);
  if (!resolved) return null;
  const target = { kind: 'cable', id: cable.id } as const;
  const A = sideGeom(project, cable, 'A', resolved.sideA), B = sideGeom(project, cable, 'B', resolved.sideB);
  const breakoutMm = resolved.breakoutLengthM * 1000;
  const hasPort = (g: SideGeom) => g.ends.some((e) => e !== null);
  for (const [g, other] of [[A, B], [B, A]] as const) if (g.multi) g.anchor = furcationOf(project, cable, g, hasPort(other), breakoutMm);
  if (!A.anchor && !B.anchor) return null;
  // A side without any position: the jacket stands JACKET_STUB_MM out of the other end, and that is where its boot / stub ends.
  const stubbed = { A: false, B: false };
  for (const [g, other] of [[A, B], [B, A]] as const) {
    if (g.anchor || !other.anchor) continue;
    g.outward = other.outward ?? { x: 0, y: 0, z: 1 };
    g.anchor = along(other.anchor, g.outward, JACKET_STUB_MM);
    stubbed[g.side] = true;
  }
  const aAnchor = A.anchor!, bAnchor = B.anchor!;

  const routing = stubbed.A || stubbed.B ? null : jacketRoute(project, cable);
  let points: Vec3[];
  if (routing) {
    points = routing.path.points.map((p) => ({ ...p }));
    // The route runs port to port; a fanned-out side ends at its boot instead.
    if (A.multi) points[0] = aAnchor;
    if (B.multi) points[points.length - 1] = bAnchor;
  } else {
    // Straight airwire, leaving a single port perpendicular to its face.
    const standoff = (g: SideGeom, anchor: Vec3): Vec3[] => (!g.multi && !stubbed[g.side] && g.outward ? [anchor, along(anchor, g.outward, PORT_STANDOFF_MM)] : [anchor]);
    points = [...standoff(A, aAnchor), ...standoff(B, bAnchor).reverse()];
  }
  const radius = Math.max(0.001, resolved.diameterMm / 2000);
  const jacket: TubePart = { target, points: points.map(metres), radius, bendRadius: (resolved.def.bendRadiusMm || 20) / 1000, color: resolved.color };

  const boots: BootPart[] = [], legs: LegPart[] = [], connectors: BoxPart[] = [];
  for (const g of [A, B]) {
    const anchor = g.side === 'A' ? aAnchor : bAnchor;
    if (g.multi) {
      // The boot is the last BOOT_LENGTH_MM of the jacket: its axis continues the jacket's final segment and its far end
      // is the furcation point itself, where the legs start (the same point the layout's furcation node marks). Centring
      // the boot on the furcation instead would push the legs' origin past it, into the floor under a vertical drop.
      const neighbour = g.side === 'A' ? points[1] : points[points.length - 2];
      const direction = (neighbour && unit(sub3(anchor, neighbour))) ?? g.outward ?? { x: 0, y: 0, z: 1 };
      boots.push({ target, side: g.side, position: metres(along(anchor, direction, -BOOT_LENGTH_MM / 2)), direction: [direction.x, direction.y, direction.z], length: BOOT_LENGTH_MM / 1000, radius: radius * 2, color: BOOT_COLOR });
      const start = anchor;
      const stubs = g.def.legs.filter((leg) => !g.ends[leg.index]);
      g.def.legs.forEach((leg: Leg) => {
        const end = g.ends[leg.index];
        if (end) {
          legs.push({ target, side: g.side, leg: leg.index, label: leg.label, plugged: true, color: resolved.color, radius: LEG_DIAMETER_MM / 2000, bendRadius: 0.03, points: [start, out(end, end.proudMm + PORT_STANDOFF_MM), out(end, end.proudMm)].map(metres) });
        } else {
          const k = stubs.indexOf(leg), theta = (k - (stubs.length - 1) / 2) * STUB_SPREAD_DEG * Math.PI / 180;
          const dir = unit(rotateY(direction, theta)) ?? direction;
          legs.push({ target, side: g.side, leg: leg.index, label: leg.label, plugged: false, color: STUB_COLOR, radius: LEG_DIAMETER_MM / 2000, bendRadius: 0.03, points: [start, along(start, dir, LEG_STUB_MM)].map(metres) });
        }
      });
    }
    for (const end of g.ends) if (end) connectors.push(...connectorShapes(end, g.connector, target));
  }
  return { id: cable.id, label: cable.label, target, jacket, layers: routing ? [...new Set(routing.route.segments.map((s) => s.layer))] : [], routed: !!routing, boots, legs, connectors };
}
