/**
 * Pure geometry for the rack elevation: racks laid out side by side in world
 * millimetres (x to the right, y DOWN so the floor is y = 0 and elevation e
 * sits at y = -e), U slot arithmetic, faceplate/port positions and the
 * green/red ghost fit check used by placement drags.
 */
import { checkUFit, heightUOf, occupiedRanges, uLabel, type URange } from '@/commands/placement';
import type { Rect } from '@/model/geometry';
import { indexProject } from '@/model/query';
import { DEFAULT_DEVICE_WIDTH_MM, DEFAULT_MANAGER_WIDTH_MM, U_MM, effectiveFace, rackTopMm, uElevationMm } from '@/model/routing';
import type { Face, FootprintPort, Id, Project, Rack, RackAccessory, Side, Vec2 } from '@/model/types';
import { COLORS, RACK_GAP_MM, RAIL_INSET_MM } from './constants';

export { U_MM };

// ---------------------------------------------------------------------------
// Elevation <-> y
// ---------------------------------------------------------------------------

export const elevToY = (elevationMm: number): number => -elevationMm;
export const yToElev = (y: number): number => -y;
/** y of the bottom edge of U `u` (1-based). */
export const uBottomY = (u: number): number => -uElevationMm(u);
/** y of the top edge of U `u`. */
export const uTopY = (u: number): number => -uElevationMm(u + 1);
/** 1-based U containing world y; below U1 gives 0 or less, above the stack more than heightU. */
export const uAtY = (y: number): number => Math.floor(-y / U_MM) + 1;

// ---------------------------------------------------------------------------
// Rack columns
// ---------------------------------------------------------------------------

/** Side of the rack (as named on accessories, seen from the FRONT) that a viewer facing `face` sees on their left/right. */
export const viewerSide = (rackSide: Side, face: Face): Side =>
  face === 'front' ? rackSide : rackSide === 'left' ? 'right' : 'left';

export interface ManagerColumn {
  accessory: RackAccessory;
  /** Rack side (front-view naming). */
  side: Side;
  /** World x of the manager's left edge and its width. */
  x: number;
  width: number;
}

export interface TopEntryBox {
  accessory: RackAccessory;
  x: number;
  width: number;
}

export interface RackColumn {
  rack: Rack;
  index: number;
  face: Face;
  /** Left edge of the rack frame. */
  x: number;
  width: number;
  /** Height of the frame (U stack + roof allowance) and of the U stack alone. */
  top: number;
  stackTop: number;
  /** y of the roof (= -top). */
  y: number;
  /** Managers keyed by the VIEWER's side. */
  managers: { left: ManagerColumn | null; right: ManagerColumn | null };
  topEntries: TopEntryBox[];
  /** Horizontal extent of the slot including managers. */
  extent: { x0: number; x1: number };
}

const TOP_ENTRY_WIDTH_MM = 120;

function topEntryX(rack: Rack, face: Face, side: RackAccessory['side']): number {
  const s = side === 'center' || side === undefined ? 'center' : viewerSide(side, face);
  const across = s === 'left' ? rack.widthMm / 4 : s === 'right' ? (rack.widthMm * 3) / 4 : rack.widthMm / 2;
  return across - TOP_ENTRY_WIDTH_MM / 2;
}

/** Lay racks out left to right; each slot is [left manager][frame][right manager] with a gap between slots. */
export function layoutColumns(
  racks: readonly Rack[],
  accessories: readonly RackAccessory[],
  face: Face,
  gapMm = RACK_GAP_MM,
): RackColumn[] {
  const out: RackColumn[] = [];
  let cursor = 0;
  racks.forEach((rack, index) => {
    const own = accessories.filter((a) => a.rackId === rack.id);
    const vcm = (rackSide: Side) => own.find((a) => a.type === 'vcm' && a.side === rackSide);
    // Which rack side shows on the viewer's left/right for this face.
    const leftRackSide: Side = face === 'front' ? 'left' : 'right';
    const rightRackSide: Side = face === 'front' ? 'right' : 'left';
    const leftAcc = vcm(leftRackSide);
    const rightAcc = vcm(rightRackSide);
    const leftW = leftAcc ? (leftAcc.widthMm ?? DEFAULT_MANAGER_WIDTH_MM) : 0;
    const rightW = rightAcc ? (rightAcc.widthMm ?? DEFAULT_MANAGER_WIDTH_MM) : 0;
    const x = cursor + leftW;
    const top = rackTopMm(rack);
    const column: RackColumn = {
      rack,
      index,
      face,
      x,
      width: rack.widthMm,
      top,
      stackTop: rack.heightU * U_MM,
      y: -top,
      managers: {
        left: leftAcc ? { accessory: leftAcc, side: leftRackSide, x: cursor, width: leftW } : null,
        right: rightAcc ? { accessory: rightAcc, side: rightRackSide, x: x + rack.widthMm, width: rightW } : null,
      },
      topEntries: own
        .filter((a) => a.type === 'top-entry')
        .map((a) => ({ accessory: a, x: x + topEntryX(rack, face, a.side), width: TOP_ENTRY_WIDTH_MM })),
      extent: { x0: cursor, x1: x + rack.widthMm + rightW },
    };
    out.push(column);
    cursor = column.extent.x1 + gapMm;
  });
  return out;
}

/** Column whose slot (plus half the gap on either side) contains world x. */
export function columnAt(columns: readonly RackColumn[], x: number, gapMm = RACK_GAP_MM): RackColumn | null {
  for (const c of columns) {
    if (x >= c.extent.x0 - gapMm / 2 && x <= c.extent.x1 + gapMm / 2) return c;
  }
  return null;
}

/** Frame rect of a column (world). */
export const columnRect = (c: RackColumn): Rect => ({ x: c.x, y: c.y, width: c.width, height: c.top });

/** Bounding rect of the whole elevation (all slots, floor to the tallest roof, with exit headroom). */
export function columnsBounds(columns: readonly RackColumn[], headroomMm = 600): Rect {
  if (columns.length === 0) return { x: 0, y: -2000, width: 1200, height: 2000 };
  const x0 = columns[0]!.extent.x0;
  const x1 = columns[columns.length - 1]!.extent.x1;
  const top = Math.max(...columns.map((c) => c.top));
  return { x: x0, y: -top - headroomMm, width: x1 - x0, height: top + headroomMm };
}

/** Centre x of the manager column on a RACK side (fallback: just inside the frame, like routing/positions). */
export function managerCenterX(column: RackColumn, rackSide: Side): number {
  const v = viewerSide(rackSide, column.face);
  const m = column.managers[v];
  if (m) return m.x + m.width / 2;
  return v === 'left' ? column.x + RAIL_INSET_MM : column.x + column.width - RAIL_INSET_MM;
}

/** Inner edge x of the manager (where the horizontal run meets it) on a rack side. */
export function managerInnerX(column: RackColumn, rackSide: Side): number {
  const v = viewerSide(rackSide, column.face);
  const m = column.managers[v];
  if (m) return v === 'left' ? m.x + m.width : m.x;
  return managerCenterX(column, rackSide);
}

// ---------------------------------------------------------------------------
// Devices and ports
// ---------------------------------------------------------------------------

export const faceplateInset = (rack: Pick<Rack, 'widthMm'>, widthMm: number): number => (rack.widthMm - widthMm) / 2;

/** World rect of a device spanning `heightU` from bottom U `u`. */
export function deviceRect(column: RackColumn, u: number, heightU: number, widthMm = DEFAULT_DEVICE_WIDTH_MM): Rect {
  const w = Math.min(widthMm, column.width);
  return {
    x: column.x + faceplateInset(column.rack, w),
    y: uTopY(u + heightU - 1),
    width: w,
    height: heightU * U_MM,
  };
}

export interface PortPoint {
  x: number;
  y: number;
  /** The port faces the viewer (its effective face is the viewed face). */
  visible: boolean;
  face: Face;
}

/**
 * World position of a footprint port on a device placed at bottom U `u` with
 * `placementFace`, as seen from the column's face. Ports on the far face are
 * mirrored across the rack width (they sit behind the plate).
 */
export function portPoint(
  column: RackColumn,
  u: number,
  port: FootprintPort,
  placementFace: Face,
  widthMm = DEFAULT_DEVICE_WIDTH_MM,
): PortPoint {
  const face = effectiveFace(port.face, placementFace);
  const w = Math.min(widthMm, column.width);
  const fromViewerLeft = faceplateInset(column.rack, w) + port.pos.x;
  const visible = face === column.face;
  const x = column.x + (visible ? fromViewerLeft : column.rack.widthMm - fromViewerLeft);
  return { x, y: uBottomY(u) - port.pos.y, visible, face };
}

// ---------------------------------------------------------------------------
// Slots and fit
// ---------------------------------------------------------------------------

/**
 * Bottom U for a device of `heightU` whose grab point is at world y with the
 * pointer `grabOffsetU` U above the device bottom. Clamped so the device
 * stays inside the rack whenever it can fit at all.
 */
export function dropSlot(rackHeightU: number, y: number, heightU: number, grabOffsetU = 0): number {
  const raw = uAtY(y) - grabOffsetU;
  const maxBottom = Math.max(1, rackHeightU - heightU + 1);
  return Math.min(maxBottom, Math.max(1, raw));
}

/** Screen-space helper: convert a pointer's world y to a U inside a column, or null when outside the stack. */
export function uInColumn(column: RackColumn, y: number): number | null {
  const u = uAtY(y);
  return u >= 1 && u <= column.rack.heightU ? u : null;
}

export interface GhostFit {
  u: number;
  range: URange;
  ok: boolean;
  /** Why it does not fit (collision / overflow), or null. */
  reason: string | null;
}

/** Whether a component may sit at bottom U `u` of a rack; ignores the component's own current slot. */
export function ghostFit(project: Project, componentId: Id, rackId: Id, u: number): GhostFit {
  const c = indexProject(project).component(componentId);
  const h = c ? heightUOf(project, c) : 1;
  const range: URange = { bottom: u, top: u + h - 1 };
  const reason = checkUFit(project, { componentId, rackId, uPosition: u });
  return { u, range, ok: reason === null, reason };
}

export const ghostColor = (fit: Pick<GhostFit, 'ok'>): string => (fit.ok ? COLORS.ghostOk : COLORS.ghostBad);

export { uLabel };

/** Lowest free bottom U that fits `heightU` in a rack, bottom-up; null when full. */
export function firstFreeSlot(project: Project, rackId: Id, heightU: number, ignoreComponentId?: Id): number | null {
  const rack = indexProject(project).rack(rackId);
  if (!rack || heightU < 1 || heightU > rack.heightU) return null;
  const taken = occupiedRanges(project, rackId, ignoreComponentId);
  let u = 1;
  for (const { range } of taken) {
    if (range.bottom - u >= heightU) return u;
    u = Math.max(u, range.top + 1);
  }
  return u + heightU - 1 <= rack.heightU ? u : null;
}

/** Nearest point on/inside a rect distance, used for hover tolerance. */
export function rectDistance(r: Rect, p: Vec2): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height));
  return Math.hypot(dx, dy);
}
