/**
 * Auto-dressing of the in-rack part of a cable path: which vertical manager
 * the cable uses, which top entry it exits through, and the resulting 3D
 * polyline from the port up to (or down to) the tray elevation.
 */
import { indexProject } from '../query';
import type { Face, Id, InRackPath, Link, Project, RackAccessory, Side, Vec3 } from '../types';
import {
  floorToWorld,
  managerFloorCenter,
  managerFor,
  oppositeSide,
  portPlacement,
  portWorldPos,
  rackEntryPoints,
  rackTopMm,
  worldToFloor,
} from './positions';

export { managerFor };

export interface AutoDressOptions {
  /** User-pinned side; skips the nearer-side rule. */
  forceSide?: Side;
  /** Media class of the cable; derived from the link on the port when omitted. */
  mediaClass?: 'fiber' | 'copper';
}

/** Which side of the rack (as seen from the front) is nearer to a port. */
export function nearerSide(faceplateX: number, faceplateWidth: number, face: Face): Side {
  const viewerSide: Side = faceplateX < faceplateWidth / 2 ? 'left' : 'right';
  // A viewer facing the rear sees the rack's left side on their right.
  return face === 'front' ? viewerSide : oppositeSide(viewerSide);
}

function mediaClassOnPort(project: Project, componentId: Id, portId: string): 'fiber' | 'copper' | undefined {
  const idx = indexProject(project);
  const link: Link | undefined = idx
    .linksOf(componentId)
    .find(
      (l) =>
        (l.a.componentId === componentId && l.a.portId === portId) ||
        (l.b.componentId === componentId && l.b.portId === portId),
    );
  return link ? idx.cableOf(link)?.mediaClass : undefined;
}

/** Top-entry accessory on a side, preferring one whose face matches the port. */
export function topEntryFor(project: Project, rackId: Id, side: Side, face?: Face): RackAccessory | undefined {
  const candidates = project.accessories.filter((a) => a.rackId === rackId && a.type === 'top-entry');
  const onSide = candidates.filter((a) => a.side === side);
  const pool = onSide.length ? onSide : candidates.filter((a) => a.side === 'center');
  return pool.find((a) => face !== undefined && a.face === face) ?? pool.find((a) => !a.face) ?? pool[0];
}

/**
 * Rule-based in-rack path for a port:
 * - the nearer manager (left half of the faceplate → left, else right),
 * - when `settings.separateCopperFiber` is on and both managers exist, fiber
 *   takes the left manager and copper the right,
 * - when only one manager is fitted, that one,
 * - the top-entry accessory on the chosen side (or a centre one), else null.
 *
 * Unplaced components still get a path so the route stays well-formed.
 */
export function autoInRackPath(project: Project, componentId: Id, portId: string, opts: AutoDressOptions = {}): InRackPath {
  const info = portPlacement(project, componentId, portId);
  if (!info) return { side: opts.forceSide ?? 'left', entry: null, pinned: false };
  const rackId = info.rack.id;
  let side: Side;
  if (opts.forceSide) {
    side = opts.forceSide;
  } else {
    const hasLeft = managerFor(project, rackId, 'left') !== undefined;
    const hasRight = managerFor(project, rackId, 'right') !== undefined;
    const media = opts.mediaClass ?? mediaClassOnPort(project, componentId, portId);
    if (project.settings.separateCopperFiber && hasLeft && hasRight && media) {
      side = media === 'fiber' ? 'left' : 'right';
    } else if (hasLeft !== hasRight) {
      side = hasLeft ? 'left' : 'right';
    } else {
      side = nearerSide(info.faceplateX, info.faceplateWidth, info.face);
    }
  }
  return { side, entry: topEntryFor(project, rackId, side, info.face)?.id ?? null, pinned: false };
}

/**
 * 3D polyline (mm, y up) from a port to the tray elevation:
 * port → horizontal to the manager column → vertical to the rack top (or the
 * floor for an underfloor tray) → across to the entry point → the rise/drop
 * to the tray elevation. A tray elevation between floor and rack top (an
 * in-rack run) ends inside the manager at that elevation.
 */
export function inRackPolyline3d(
  project: Project,
  componentId: Id,
  portId: string,
  path: InRackPath,
  trayElevationMm: number,
): Vec3[] | null {
  return inRackPolyline3dDetailed(project, componentId, portId, path, trayElevationMm)?.points ?? null;
}

export interface InRackPolyline {
  points: Vec3[];
  /** Index of the point where the final rise/drop to the tray elevation starts (last index when there is none). */
  riseStart: number;
}

/** Same as `inRackPolyline3d`, also reporting where the rise to the tray begins. */
export function inRackPolyline3dDetailed(
  project: Project,
  componentId: Id,
  portId: string,
  path: InRackPath,
  trayElevationMm: number,
): InRackPolyline | null {
  const port = portWorldPos(project, componentId, portId);
  const info = portPlacement(project, componentId, portId);
  if (!port || !info) return null;
  const rack = info.rack;
  const managerFloor = managerFloorCenter(project, rack.id, path.side) ?? worldToFloor(port);
  const points: Vec3[] = [];
  const push = (p: Vec3): number => {
    const last = points[points.length - 1];
    if (!last || !same3(last, p)) points.push({ ...p });
    return points.length - 1;
  };
  push(port);
  push(floorToWorld(managerFloor, port.y));
  const top = rackTopMm(rack);
  let riseStart: number;
  if (trayElevationMm >= top) {
    const entries = rackEntryPoints(project, rack);
    const entry = path.side === 'left' ? entries.topLeft : entries.topRight;
    push(floorToWorld(managerFloor, top));
    riseStart = push(floorToWorld(entry, top));
    push(floorToWorld(entry, trayElevationMm));
  } else if (trayElevationMm < 0) {
    const entry = rackEntryPoints(project, rack).bottom;
    push(floorToWorld(managerFloor, 0));
    riseStart = push(floorToWorld(entry, 0));
    push(floorToWorld(entry, trayElevationMm));
  } else {
    riseStart = push(floorToWorld(managerFloor, trayElevationMm));
  }
  return { points, riseStart };
}

export const same3 = (a: Vec3, b: Vec3, eps = 1e-6): boolean =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;
