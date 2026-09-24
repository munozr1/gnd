/**
 * Physical positions of racks, ports and rack entry points.
 *
 * Floor plan: x to the right, y down (canvas), millimetres. A rack at
 * rotation 0 has its FRONT facing +y ('south'); `rack.pos` is the top-left of
 * its axis-aligned footprint (see geometry.rackRect). Rotation is applied about
 * the footprint centre.
 *
 * 3D: x = floor x, z = floor y, y = elevation above finished floor (y up).
 */
import { indexProject } from '../query';
import { add, rectCenter, rotate90, scale, type Rect, rackRect } from '../geometry';
import type { Face, Id, Project, Rack, RackAccessory, Side, Vec2, Vec3 } from '../types';

/** Height of one rack unit. */
export const U_MM = 44.45;
/** Plinth/roof allowance added above the U stack to get the rack top. */
export const RACK_BASE_MM = 100;
/** 19" device width when the footprint omits one. */
export const DEFAULT_DEVICE_WIDTH_MM = 482.6;
/** Vertical cable manager cross-section defaults. */
export const DEFAULT_MANAGER_WIDTH_MM = 152;
export const DEFAULT_MANAGER_DEPTH_MM = 100;
/** Inset of the manager column from the rack side when no vcm accessory exists. */
const RAIL_INSET_MM = 40;

type RackLike = Pick<Rack, 'pos' | 'rotationDeg' | 'widthMm' | 'depthMm'>;

export const rackFloorRect = (rack: RackLike): Rect => rackRect(rack);

/** Unit vector of the rack's front face in the floor plan (rotation 0 → +y). */
export const rackFrontDir = (rack: Pick<Rack, 'rotationDeg'>): Vec2 => rotate90({ x: 0, y: 1 }, rack.rotationDeg);

/** Unit vector across the rack width, pointing to the viewer's RIGHT when facing the front. */
export const rackAcrossDir = (rack: Pick<Rack, 'rotationDeg'>): Vec2 => rotate90({ x: 1, y: 0 }, rack.rotationDeg);

export const rackCenter = (rack: RackLike): Vec2 => rectCenter(rackRect(rack));

/** Top of the rack frame above the floor. */
export const rackTopMm = (rack: Pick<Rack, 'heightU'>): number => rack.heightU * U_MM + RACK_BASE_MM;

/** Elevation of the bottom of U `u` (1-based) above the floor; rack base is 0. */
export const uElevationMm = (u: number): number => (u - 1) * U_MM;

/**
 * Convert rack-local coordinates to the floor plan. `across` runs from the
 * viewer's-left edge (facing the front) to the right edge, 0..widthMm;
 * `depth` runs from the rear face to the front face, 0..depthMm.
 */
export function rackLocalToFloor(rack: RackLike, local: { across: number; depth: number }): Vec2 {
  const c = rackCenter(rack);
  const u = rackAcrossDir(rack);
  const f = rackFrontDir(rack);
  return add(c, add(scale(u, local.across - rack.widthMm / 2), scale(f, local.depth - rack.depthMm / 2)));
}

export const floorToWorld = (p: Vec2, elevationMm: number): Vec3 => ({ x: p.x, y: elevationMm, z: p.y });
export const worldToFloor = (p: Vec3): Vec2 => ({ x: p.x, y: p.z });

export const oppositeFace = (face: Face): Face => (face === 'front' ? 'rear' : 'front');
export const oppositeSide = (side: Side): Side => (side === 'left' ? 'right' : 'left');

/** Rack face a port ends up on, given the device's own port face and how the device was placed. */
export const effectiveFace = (portFace: Face, placementFace: Face): Face =>
  placementFace === 'front' ? portFace : oppositeFace(portFace);

export interface PortPlacementInfo {
  rack: Rack;
  uPosition: number;
  /** Rack face the port is on. */
  face: Face;
  /** Distance from the viewer's left edge of the RACK when facing that face, mm. */
  acrossFromViewerLeft: number;
  /** Faceplate x of the port, mm. */
  faceplateX: number;
  /** Width of the device faceplate, mm. */
  faceplateWidth: number;
  elevationMm: number;
}

/** Everything needed to place a port physically, or null when the component is unplaced or unknown. */
export function portPlacement(project: Project, componentId: Id, portId: string): PortPlacementInfo | null {
  const idx = indexProject(project);
  const c = idx.component(componentId);
  const p = idx.placement(componentId);
  if (!c || !p || p.rackId === null || p.uPosition === null) return null;
  const rack = idx.rack(p.rackId);
  const fp = idx.footprintOf(c);
  const port = idx.portOf(c, portId);
  if (!rack || !fp || !port) return null;
  const faceplateWidth = fp.widthMm ?? DEFAULT_DEVICE_WIDTH_MM;
  const inset = (rack.widthMm - faceplateWidth) / 2;
  return {
    rack,
    uPosition: p.uPosition,
    face: effectiveFace(port.face, p.face),
    acrossFromViewerLeft: inset + port.pos.x,
    faceplateX: port.pos.x,
    faceplateWidth,
    elevationMm: uElevationMm(p.uPosition) + port.pos.y,
  };
}

/**
 * Floor-plan position of a port: on the rack rect edge of the port's face,
 * offset across the rack width by the port's faceplate x.
 */
export function portFloorPos(project: Project, componentId: Id, portId: string): Vec2 | null {
  const info = portPlacement(project, componentId, portId);
  if (!info) return null;
  return facePointToFloor(info.rack, info.face, info.acrossFromViewerLeft);
}

/** A point on a rack face, `acrossFromViewerLeft` mm from the left edge as seen by someone facing that face. */
export function facePointToFloor(rack: RackLike, face: Face, acrossFromViewerLeft: number): Vec2 {
  const across = face === 'front' ? acrossFromViewerLeft : rack.widthMm - acrossFromViewerLeft;
  return rackLocalToFloor(rack, { across, depth: face === 'front' ? rack.depthMm : 0 });
}

/** Height of a port above the floor: U elevation plus faceplate y. */
export function portElevationMm(project: Project, componentId: Id, portId: string): number | null {
  return portPlacement(project, componentId, portId)?.elevationMm ?? null;
}

/** 3D world position of a port (mm, y up). */
export function portWorldPos(project: Project, componentId: Id, portId: string): Vec3 | null {
  const info = portPlacement(project, componentId, portId);
  if (!info) return null;
  return floorToWorld(facePointToFloor(info.rack, info.face, info.acrossFromViewerLeft), info.elevationMm);
}

export interface RackEntryPoints {
  topLeft: Vec2;
  topRight: Vec2;
  /** Bottom brush panel (underfloor entry). */
  bottom: Vec2;
}

const topEntryOn = (project: Project, rackId: Id, side: Side): RackAccessory | undefined =>
  project.accessories.find((a) => a.rackId === rackId && a.type === 'top-entry' && a.side === side);

/**
 * Floor positions of the rack's cable entry points. Top entries sit at the
 * quarter points across the roof (left/right as seen from the front); when a
 * top-entry accessory with a face exists on that side the point shifts toward
 * that face. The bottom entry is the footprint centre.
 */
export function rackEntryPoints(project: Project, rack: Rack): RackEntryPoints {
  const at = (side: Side): Vec2 => {
    const acc = topEntryOn(project, rack.id, side);
    const across = side === 'left' ? rack.widthMm / 4 : (rack.widthMm * 3) / 4;
    let depth = rack.depthMm / 2;
    if (acc?.face === 'front') depth = (rack.depthMm * 3) / 4;
    else if (acc?.face === 'rear') depth = rack.depthMm / 4;
    return rackLocalToFloor(rack, { across, depth });
  };
  return { topLeft: at('left'), topRight: at('right'), bottom: rackCenter(rack) };
}

/** The vertical cable manager on a side of a rack, if fitted. */
export function managerFor(project: Project, rackId: Id, side: Side): RackAccessory | undefined {
  return project.accessories.find((a) => a.rackId === rackId && a.type === 'vcm' && a.side === side);
}

/** Cross-section of a manager (or the default when the accessory omits width). */
export function managerCrossSection(manager: RackAccessory | undefined): { widthMm: number; depthMm: number } {
  return { widthMm: manager?.widthMm ?? DEFAULT_MANAGER_WIDTH_MM, depthMm: DEFAULT_MANAGER_DEPTH_MM };
}

/**
 * Floor-plan centre of the vertical manager column on a side. A fitted vcm
 * stands beside the rack; without one the column falls back to the rack's
 * own side rail, just inside the frame.
 */
export function managerFloorCenter(project: Project, rackId: Id, side: Side): Vec2 | null {
  const rack = indexProject(project).rack(rackId);
  if (!rack) return null;
  const manager = managerFor(project, rackId, side);
  const halfW = rack.widthMm / 2;
  const offset = manager ? halfW + managerCrossSection(manager).widthMm / 2 : halfW - RAIL_INSET_MM;
  const across = side === 'left' ? halfW - offset : halfW + offset;
  return rackLocalToFloor(rack, { across, depth: rack.depthMm / 2 });
}

/** Floor rect occupied by a fitted vertical manager beside the rack, or null when none. */
export function managerFloorRect(project: Project, rackId: Id, side: Side): Rect | null {
  const rack = indexProject(project).rack(rackId);
  const manager = managerFor(project, rackId, side);
  if (!rack || !manager) return null;
  const { widthMm } = managerCrossSection(manager);
  const across = side === 'left' ? -widthMm / 2 : rack.widthMm + widthMm / 2;
  const centre = rackLocalToFloor(rack, { across, depth: rack.depthMm / 2 });
  const rotated = rack.rotationDeg === 90 || rack.rotationDeg === 270;
  const w = rotated ? rack.depthMm : widthMm;
  const h = rotated ? widthMm : rack.depthMm;
  return { x: centre.x - w / 2, y: centre.y - h / 2, width: w, height: h };
}

/** 3D polyline length in mm. */
export function polyline3dLength(points: readonly Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist3(points[i - 1]!, points[i]!);
  return total;
}

export const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
