/**
 * Layout commands: racks, room, keepouts, placement, accessories, trays,
 * routes and waypoints, Update Layout (F8) and back-annotation. Every
 * factory returns a `Command` for the 'layout' history (accepting / rejecting
 * a back-annotation edits the schematic and lands in its history instead).
 *
 * Geometry is floor-plan millimetres. Drag verbs take a `dragId` so a whole
 * drag collapses into one undo entry.
 */
import { catalogIndex } from '@/catalog';
import { createRack, createTray, newId } from '@/model/factories';
import { rackRect, rotate90 } from '@/model/geometry';
import { indexProject } from '@/model/query';
import * as routing from '@/model/routing';
import * as sync from '@/model/sync';
import type { AcceptResult, ApplySummary } from '@/model/sync';
import type {
  AccessoryDef,
  EditorId,
  Face,
  Id,
  InRackPath,
  Keepout,
  Project,
  ProjectSettings,
  Rack,
  RackAccessory,
  RackDef,
  Room,
  Rotation,
  Route,
  Side,
  SyncChange,
  TrayDef,
  TrayFitting,
  Vec2,
} from '@/model/types';
import { command, type Command } from '@/store/commands';
import { asArray, dragKey, plural, resultCommand, snapshot, type ResultCommand } from './base';
import { planPlaceByRule, type PlaceByRulePlan, type PlaceRule, type PlannedPlacement } from './placeByRule';
import { defaultFrameDefId, frameNameFor, nextFreeFloorPos, nextRackName, placeDevice, redressRoutesOf, unplaceDevice, type PlacementTarget } from './placement';

const EDITOR = 'layout';

// ---------------------------------------------------------------------------
// Racks
// ---------------------------------------------------------------------------

export interface AddRackOptions {
  /** Defaults to the next free 'R01'-style name. */
  name?: string;
  row?: string;
  rotationDeg?: Rotation;
}

function requireRack(draft: Project, id: Id): Rack {
  const r = draft.racks.find((x) => x.id === id);
  if (!r) throw new Error(`Rack not found: ${id}`);
  return r;
}

function checkRackName(draft: Project, name: string, ignoreId?: Id): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Rack name cannot be empty');
  if (draft.racks.some((r) => r.id !== ignoreId && r.name === trimmed)) throw new Error(`Rack ${trimmed} already exists`);
  return trimmed;
}

function pushRack(draft: Project, def: RackDef, pos: Vec2, opts: AddRackOptions): Rack {
  const name = checkRackName(draft, opts.name ?? nextRackName(draft));
  const rack = createRack(def, { name, pos, ...(opts.row !== undefined ? { row: opts.row } : {}) });
  if (opts.rotationDeg !== undefined) rack.rotationDeg = opts.rotationDeg;
  draft.racks.push(rack);
  return rack;
}

/** Place a rack from a catalog def; `result` is the rack id. */
export function addRack(def: RackDef, pos: Vec2, opts: AddRackOptions = {}): ResultCommand<Id> {
  return resultCommand(`Add rack ${opts.name?.trim() || def.name}`, EDITOR, (d) => pushRack(d, def, pos, opts).id);
}

export interface NewFrameOptions {
  /** Frame def; default: the smallest patch frame that fits the device. */
  defId?: string;
  name?: string;
  rotationDeg?: Rotation;
  face?: Face;
}

/**
 * Make a device its own rack: create a free-standing patch frame at `pos`
 * (or the next free floor spot) and place the device at U1. This is how a
 * patch panel is placed directly on the floor plan without choosing a rack.
 * `result` is the new frame's rack id.
 */
export function placeInNewFrame(componentId: Id, pos?: Vec2, opts: NewFrameOptions = {}): ResultCommand<Id> {
  return resultCommand('Place as own frame', EDITOR, (d) => {
    const c = d.components.find((x) => x.id === componentId);
    if (!c) throw new Error(`Component ${componentId} does not exist`);
    const defId = opts.defId ?? defaultFrameDefId(d, c);
    const def = catalogIndex(d).catalog.racks.find((r) => r.id === defId);
    if (!def) throw new Error(`Unknown rack def ${defId}`);
    const at = pos ?? nextFreeFloorPos(d, def);
    const rack = pushRack(d, def, at, {
      name: opts.name ?? frameNameFor(d, c.ref),
      ...(opts.rotationDeg !== undefined ? { rotationDeg: opts.rotationDeg } : {}),
    });
    placeDevice(d, { componentId, rackId: rack.id, uPosition: 1, ...(opts.face !== undefined ? { face: opts.face } : {}) });
    redressRoutesOf(d, componentId);
    return rack.id;
  });
}

export interface RackArrayOptions {
  /** Position of the first rack. */
  origin: Vec2;
  count: number;
  /** Gap between adjacent rack footprints along the direction; 0 = butted together. */
  spacingMm?: number;
  /** Axis the row runs along; default 'x'. */
  direction?: 'x' | 'y';
  row?: string;
  rotationDeg?: Rotation;
}

/** Array `count` racks in a row; names continue the 'R01' sequence. `result` is the rack ids in order. */
export function addRackArray(def: RackDef, opts: RackArrayOptions): ResultCommand<Id[]> {
  return resultCommand(`Add ${plural(opts.count, 'rack')}`, EDITOR, (d) => {
    if (!Number.isInteger(opts.count) || opts.count < 1) throw new Error('Rack count must be 1 or more');
    const spacing = opts.spacingMm ?? 0;
    if (!(spacing >= 0)) throw new Error('Rack spacing cannot be negative');
    const rotationDeg = opts.rotationDeg ?? 0;
    const rect = rackRect({ pos: opts.origin, rotationDeg, widthMm: def.widthMm, depthMm: def.depthMm });
    const direction = opts.direction ?? 'x';
    const pitch = (direction === 'x' ? rect.width : rect.height) + spacing;
    const ids: Id[] = [];
    for (let i = 0; i < opts.count; i++) {
      const pos = direction === 'x' ? { x: opts.origin.x + i * pitch, y: opts.origin.y } : { x: opts.origin.x, y: opts.origin.y + i * pitch };
      ids.push(pushRack(d, def, pos, { rotationDeg, ...(opts.row !== undefined ? { row: opts.row } : {}) }).id);
    }
    return ids;
  });
}

/** Translate racks; waypoints anchored inside them follow. Steps of one drag coalesce. */
export function moveRacks(ids: readonly Id[], delta: Vec2, dragId?: string): Command {
  return command(
    `Move ${plural(ids.length, 'rack')}`,
    EDITOR,
    (d) => {
      for (const id of ids) {
        const rack = requireRack(d, id);
        rack.pos = { x: rack.pos.x + delta.x, y: rack.pos.y + delta.y };
        routing.onRackMoved(d, id, delta);
      }
    },
    dragKey('layout.move-racks', ids, dragId),
  );
}

/** Rotate a rack about its footprint centre by `steps` quarter turns; anchored waypoints turn with it. */
export function rotateRack(id: Id, steps = 1): Command {
  return command('Rotate rack', EDITOR, (d) => {
    const rack = requireRack(d, id);
    const before = rackRect(rack);
    const centre = { x: before.x + before.width / 2, y: before.y + before.height / 2 };
    const turns = (((steps % 4) + 4) % 4) as 0 | 1 | 2 | 3;
    const deg = (turns * 90) as Rotation;
    rack.rotationDeg = (((rack.rotationDeg / 90 + turns) % 4) * 90) as Rotation;
    const after = rackRect(rack);
    rack.pos = { x: centre.x - after.width / 2, y: centre.y - after.height / 2 };
    for (const route of Object.values(d.routes)) {
      let touched = false;
      for (const seg of route.segments) {
        for (const wp of seg.points) {
          if (wp.anchor?.rackId !== id) continue;
          const r = rotate90({ x: wp.pos.x - centre.x, y: wp.pos.y - centre.y }, deg);
          wp.pos = { x: centre.x + r.x, y: centre.y + r.y };
          touched = true;
        }
      }
      if (touched) routing.anchorWaypointsInRacks(d, route);
    }
  });
}

export interface DeleteRacksResult {
  rackIds: Id[];
  /** Components that lost their rack slot. */
  unplaced: Id[];
  accessoryIds: Id[];
}

/**
 * Remove racks. Devices in them become unplaced, their accessories go, routes
 * are kept but lose their anchors / entry references to the deleted racks.
 */
export function deleteRacks(ids: Id | readonly Id[]): ResultCommand<DeleteRacksResult> {
  const list = asArray(ids);
  return resultCommand(`Delete ${plural(list.length, 'rack')}`, EDITOR, (d) => {
    const set = new Set(list.filter((id) => d.racks.some((r) => r.id === id)));
    const unplaced: Id[] = [];
    for (const p of d.placements) {
      if (p.rackId === null || !set.has(p.rackId)) continue;
      p.rackId = null;
      p.uPosition = null;
      unplaced.push(p.componentId);
    }
    const accessoryIds = d.accessories.filter((a) => set.has(a.rackId)).map((a) => a.id);
    const removedAcc = new Set(accessoryIds);
    if (accessoryIds.length) d.accessories = d.accessories.filter((a) => !set.has(a.rackId));
    for (const route of Object.values(d.routes)) {
      for (const end of [route.aRack, route.bRack]) if (end.entry !== null && removedAcc.has(end.entry)) end.entry = null;
      for (const seg of route.segments) for (const wp of seg.points) if (wp.anchor && set.has(wp.anchor.rackId)) delete wp.anchor;
    }
    for (const tray of d.trays) for (const f of tray.fittings) if (f.rackId !== undefined && set.has(f.rackId)) delete f.rackId;
    d.racks = d.racks.filter((r) => !set.has(r.id));
    return { rackIds: [...set], unplaced, accessoryIds };
  });
}

export function renameRack(id: Id, name: string): Command {
  return command(`Rename rack to ${name.trim()}`, EDITOR, (d) => {
    requireRack(d, id).name = checkRackName(d, name, id);
  });
}

export function setRackRow(ids: Id | readonly Id[], row: string | undefined): Command {
  const list = asArray(ids);
  return command('Set rack row', EDITOR, (d) => {
    for (const id of list) {
      const rack = requireRack(d, id);
      const trimmed = row?.trim();
      if (trimmed) rack.row = trimmed;
      else delete rack.row;
    }
  });
}

// ---------------------------------------------------------------------------
// Room and keepouts
// ---------------------------------------------------------------------------

/** Replace the room polygon (at least three points). Steps of one drag coalesce when `dragId` is given. */
export function setRoomOutline(points: readonly Vec2[], dragId?: string): Command {
  return command(
    'Edit room outline',
    EDITOR,
    (d) => {
      if (points.length < 3) throw new Error('A room outline needs at least three points');
      d.room.outline = points.map((p) => ({ x: p.x, y: p.y }));
    },
    dragId !== undefined ? `layout.room:${dragId}` : undefined,
  );
}

export type RoomParam = Exclude<keyof Room, 'outline'>;

export function setRoomParam(key: RoomParam, value: number): Command {
  const labels: Record<RoomParam, string> = { gridMm: 'Set floor grid', ceilingMm: 'Set ceiling height', raisedFloorMm: 'Set raised floor' };
  return command(labels[key], EDITOR, (d) => {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${key} must be a non-negative number`);
    if (key === 'ceilingMm' && value <= 0) throw new Error('Ceiling height must be positive');
    d.room[key] = value;
  });
}

export interface AddKeepoutOptions {
  outline: readonly Vec2[];
  kind?: Keepout['kind'];
  name?: string;
}

/** `result` is the keepout id. */
export function addKeepout(opts: AddKeepoutOptions): ResultCommand<Id> {
  return resultCommand('Add keepout', EDITOR, (d) => {
    if (opts.outline.length < 3) throw new Error('A keepout needs at least three points');
    const keepout: Keepout = {
      id: newId(),
      name: opts.name?.trim() || `Keepout ${d.keepouts.length + 1}`,
      outline: opts.outline.map((p) => ({ x: p.x, y: p.y })),
      kind: opts.kind ?? 'custom',
    };
    d.keepouts.push(keepout);
    return keepout.id;
  });
}

function requireKeepout(draft: Project, id: Id): Keepout {
  const k = draft.keepouts.find((x) => x.id === id);
  if (!k) throw new Error(`Keepout not found: ${id}`);
  return k;
}

export function moveKeepout(id: Id, delta: Vec2, dragId?: string): Command {
  return command(
    'Move keepout',
    EDITOR,
    (d) => {
      const k = requireKeepout(d, id);
      k.outline = k.outline.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y }));
    },
    dragKey('layout.keepout', [id], dragId),
  );
}

export function setKeepoutOutline(id: Id, outline: readonly Vec2[], dragId?: string): Command {
  return command(
    'Edit keepout',
    EDITOR,
    (d) => {
      if (outline.length < 3) throw new Error('A keepout needs at least three points');
      requireKeepout(d, id).outline = outline.map((p) => ({ x: p.x, y: p.y }));
    },
    dragKey('layout.keepout-shape', [id], dragId),
  );
}

export function setKeepoutParams(id: Id, params: { name?: string; kind?: Keepout['kind'] }): Command {
  return command('Edit keepout', EDITOR, (d) => {
    const k = requireKeepout(d, id);
    if (params.name !== undefined && params.name.trim()) k.name = params.name.trim();
    if (params.kind !== undefined) k.kind = params.kind;
  });
}

export function deleteKeepout(ids: Id | readonly Id[]): Command {
  const list = asArray(ids);
  return command(`Delete ${plural(list.length, 'keepout')}`, EDITOR, (d) => {
    const set = new Set(list);
    d.keepouts = d.keepouts.filter((k) => !set.has(k.id));
  });
}

// ---------------------------------------------------------------------------
// Device placement
// ---------------------------------------------------------------------------

/**
 * Put a device in a rack slot. Throws (via the DRC u-collision rules) when
 * the U range is below U1, above the rack top or overlaps another device.
 * Routes on the device's links are re-dressed at that end.
 */
export function placeComponent(componentId: Id, rackId: Id, uPosition: number, face: Face = 'front'): Command {
  return command('Place device', EDITOR, (d) => {
    placeDevice(d, { componentId, rackId, uPosition, face });
    redressRoutesOf(d, componentId);
  });
}

/** Send devices back to the Unplaced bin. Their routes are kept. */
export function unplaceComponent(ids: Id | readonly Id[]): Command {
  const list = asArray(ids);
  return command(`Unplace ${plural(list.length, 'device')}`, EDITOR, (d) => {
    for (const id of list) unplaceDevice(d, id);
  });
}

/**
 * Move a placed device to another rack / U / face (same validation as
 * `placeComponent`), then re-square the unpinned end of every route on its
 * links so end segments stay orthogonal to the new rack entry. Pinned
 * waypoints and pinned in-rack paths are left alone. `result` lists the
 * routes that were re-dressed.
 */
export function moveDevice(componentId: Id, rackId: Id, uPosition: number, face?: Face): ResultCommand<Id[]> {
  return resultCommand('Move device', EDITOR, (d) => {
    const target: PlacementTarget = { componentId, rackId, uPosition, ...(face !== undefined ? { face } : {}) };
    placeDevice(d, target);
    return redressRoutesOf(d, componentId);
  });
}

export function setPlacementFace(componentId: Id, face: Face): ResultCommand<Id[]> {
  return resultCommand('Flip device', EDITOR, (d) => {
    const p = d.placements.find((x) => x.componentId === componentId);
    if (!p) throw new Error(`Component ${componentId} has no placement`);
    p.face = face;
    return redressRoutesOf(d, componentId);
  });
}

/** Plan and apply a placement rule; `result` is the plan (placements made + skipped). */
export function placeByRule(rule: PlaceRule): ResultCommand<PlaceByRulePlan> {
  return resultCommand(`Place by rule ${rule.refGlob}`, EDITOR, (d) => {
    const plan = planPlaceByRule(d, rule);
    applyPlanned(d, plan.placements);
    return plan;
  });
}

/** Apply placements previewed with `planPlaceByRule` (each validated again against the live layout). */
export function applyPlacementPlan(placements: readonly PlannedPlacement[]): Command {
  return command(`Place ${plural(placements.length, 'device')}`, EDITOR, (d) => applyPlanned(d, placements));
}

function applyPlanned(draft: Project, placements: readonly PlannedPlacement[]): void {
  // Devices being re-packed vacate their slots first so the fit checks see the planned layout only.
  for (const p of placements) unplaceDevice(draft, p.componentId);
  for (const p of placements) placeDevice(draft, { componentId: p.componentId, rackId: p.rackId, uPosition: p.uPosition, face: p.face });
  for (const p of placements) redressRoutesOf(draft, p.componentId);
}

// ---------------------------------------------------------------------------
// Rack accessories
// ---------------------------------------------------------------------------

export interface AccessoryOptions {
  side?: Side | 'center';
  face?: Face;
  uPosition?: number;
  heightU?: number;
  widthMm?: number;
}

/** Fit an accessory (vertical/horizontal manager, fiber enclosure, top entry) to a rack; `result` is its id. */
export function addAccessory(rackId: Id, def: AccessoryDef, opts: AccessoryOptions = {}): ResultCommand<Id> {
  return resultCommand(`Add ${def.name}`, EDITOR, (d) => {
    const rack = requireRack(d, rackId);
    const sided = def.type === 'vcm' || def.type === 'top-entry';
    const side = opts.side ?? (sided ? 'left' : undefined);
    if (def.type === 'vcm' && side === 'center') throw new Error('A vertical manager sits on the left or right');
    if (sided && d.accessories.some((a) => a.rackId === rackId && a.type === def.type && a.side === side)) {
      throw new Error(`Rack ${rack.name} already has a ${def.type === 'vcm' ? 'vertical manager' : 'top entry'} on the ${side}`);
    }
    const heightU = opts.heightU ?? def.heightU;
    const widthMm = opts.widthMm ?? def.widthMm;
    if (opts.uPosition !== undefined && (!Number.isInteger(opts.uPosition) || opts.uPosition < 1 || opts.uPosition + (heightU ?? 1) - 1 > rack.heightU)) {
      throw new Error(`U${opts.uPosition} does not fit in rack ${rack.name}`);
    }
    const acc: RackAccessory = {
      id: newId(),
      rackId,
      type: def.type,
      ...(side !== undefined ? { side } : {}),
      ...(opts.face !== undefined ? { face: opts.face } : {}),
      ...(opts.uPosition !== undefined ? { uPosition: opts.uPosition } : {}),
      ...(heightU !== undefined ? { heightU } : {}),
      ...(widthMm !== undefined ? { widthMm } : {}),
    };
    d.accessories.push(acc);
    return acc.id;
  });
}

/** Remove accessories; in-rack paths that used a removed top entry fall back to none. */
export function removeAccessory(ids: Id | readonly Id[]): Command {
  const list = asArray(ids);
  return command(`Remove ${plural(list.length, 'accessory', 'accessories')}`, EDITOR, (d) => {
    const set = new Set(list);
    d.accessories = d.accessories.filter((a) => !set.has(a.id));
    for (const route of Object.values(d.routes)) {
      for (const end of [route.aRack, route.bRack]) if (end.entry !== null && set.has(end.entry)) end.entry = null;
    }
  });
}

// ---------------------------------------------------------------------------
// Trays
// ---------------------------------------------------------------------------

function requireTray(draft: Project, id: Id) {
  const t = draft.trays.find((x) => x.id === id);
  if (!t) throw new Error(`Tray not found: ${id}`);
  return t;
}

const checkTrayPoints = (points: readonly Vec2[]): Vec2[] => {
  if (points.length < 2) throw new Error('A tray needs at least two points');
  return points.map((p) => ({ x: p.x, y: p.y }));
};

/** Lay a tray run from a catalog def along `points` (mm); negative elevation puts it underfloor. `result` is the tray id. */
export function addTray(def: TrayDef, points: readonly Vec2[], elevationMm: number, opts: { name?: string } = {}): ResultCommand<Id> {
  return resultCommand(`Add ${def.name}`, EDITOR, (d) => {
    if (!Number.isFinite(elevationMm)) throw new Error('Tray elevation must be a number');
    const tray = createTray(def, checkTrayPoints(points), elevationMm);
    if (opts.name?.trim()) tray.name = opts.name.trim();
    d.trays.push(tray);
    return tray.id;
  });
}

export function editTrayPoints(id: Id, points: readonly Vec2[], dragId?: string): Command {
  return command(
    'Edit tray',
    EDITOR,
    (d) => {
      requireTray(d, id).points = checkTrayPoints(points);
    },
    dragKey('layout.tray', [id], dragId),
  );
}

export function moveTray(ids: readonly Id[], delta: Vec2, dragId?: string): Command {
  return command(
    `Move ${plural(ids.length, 'tray')}`,
    EDITOR,
    (d) => {
      for (const id of ids) {
        const t = requireTray(d, id);
        t.points = t.points.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y }));
        t.fittings = t.fittings.map((f) => ({ ...f, at: { x: f.at.x + delta.x, y: f.at.y + delta.y } }));
      }
    },
    dragKey('layout.move-trays', ids, dragId),
  );
}

/** Change a tray's elevation (its layer follows the sign), name or cross-section. */
export function setTrayParams(id: Id, params: { elevationMm?: number; name?: string; widthMm?: number; depthMm?: number }): Command {
  return command('Edit tray', EDITOR, (d) => {
    const t = requireTray(d, id);
    if (params.elevationMm !== undefined) {
      if (!Number.isFinite(params.elevationMm)) throw new Error('Tray elevation must be a number');
      t.elevationMm = params.elevationMm;
      t.layer = params.elevationMm < 0 ? 'underfloor' : 'overhead';
    }
    if (params.name !== undefined) t.name = params.name.trim() || t.name;
    if (params.widthMm !== undefined && params.widthMm > 0) t.widthMm = params.widthMm;
    if (params.depthMm !== undefined && params.depthMm > 0) t.depthMm = params.depthMm;
  });
}

export function addTrayFitting(trayId: Id, fitting: TrayFitting): Command {
  return command(`Add ${fitting.type}`, EDITOR, (d) => {
    if (fitting.rackId !== undefined) requireRack(d, fitting.rackId);
    requireTray(d, trayId).fittings.push({ ...fitting, at: { x: fitting.at.x, y: fitting.at.y } });
  });
}

export function removeTrayFitting(trayId: Id, index: number): Command {
  return command('Remove fitting', EDITOR, (d) => {
    const t = requireTray(d, trayId);
    if (index < 0 || index >= t.fittings.length) throw new Error(`Tray has no fitting #${index}`);
    t.fittings.splice(index, 1);
  });
}

/** Remove trays; route segments that rode them keep their points but lose the tray reference. */
export function deleteTray(ids: Id | readonly Id[]): Command {
  const list = asArray(ids);
  return command(`Delete ${plural(list.length, 'tray')}`, EDITOR, (d) => {
    const set = new Set(list);
    d.trays = d.trays.filter((t) => !set.has(t.id));
    for (const route of Object.values(d.routes)) {
      for (const seg of route.segments) if (seg.trayId && set.has(seg.trayId)) seg.trayId = null;
    }
  });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** A route by its key: a link id, or a cable id for a cable's jacket route. */
function requireRoute(draft: Project, routeId: Id): Route {
  const r = draft.routes[routeId];
  if (!r) throw new Error(`${(draft.cables ?? []).some((c) => c.id === routeId) ? 'Cable' : 'Link'} ${routeId} has no route`);
  return r;
}

/** The two ends a route (or a would-be route) dresses: the link's ends, or the cable's first plugged leg per side. */
function requireRouteEnds(draft: Project, routeId: Id): routing.RouteEnds {
  const ends = routing.resolveEndsOf(indexProject(snapshot(draft)), routeId);
  if (!ends) throw new Error(`Link or cable not found (or a cable side is unplugged): ${routeId}`);
  return ends;
}

/** Common tail of every route edit: refresh rack anchors and clear the F8 review flag. */
function touchRoute(draft: Project, route: Route, reanchor = true): void {
  if (reanchor) routing.anchorWaypointsInRacks(draft, route);
  delete route.needsReview;
}

const cloneRoute = (route: Route): Route => ({
  linkId: route.linkId,
  ...(route.owner !== undefined ? { owner: route.owner } : {}),
  aRack: { ...route.aRack },
  bRack: { ...route.bRack },
  segments: route.segments.map((s) => ({
    layer: s.layer,
    trayId: s.trayId ?? null,
    points: s.points.map((wp) => ({
      id: wp.id,
      pos: { x: wp.pos.x, y: wp.pos.y },
      pinned: wp.pinned,
      ...(wp.anchor ? { anchor: { rackId: wp.anchor.rackId, offset: { ...wp.anchor.offset } } } : {}),
      ...(wp.serviceLoopM !== undefined ? { serviceLoopM: wp.serviceLoopM } : {}),
    })),
  })),
});

/**
 * Replace (or create) the whole route of a link, e.g. when the route tool
 * finishes. `routeId` may be a cable id: the route is then the cable's
 * jacket and is stored with `owner: 'cable'` whatever `route.owner` says.
 */
export function setRoute(routeId: Id, route: Route): Command {
  return command('Route cable', EDITOR, (d) => {
    const ends = requireRouteEnds(d, routeId);
    if (route.linkId !== routeId) throw new Error('Route belongs to another link or cable');
    const next = cloneRoute(route);
    if (ends.owner === 'cable') next.owner = 'cable';
    else delete next.owner;
    d.routes[routeId] = next;
    touchRoute(d, next);
  });
}

/**
 * Build a route from hand-routed floor points per layer (auto-dressing both
 * in-rack ends) and store it. A cable id routes the cable's jacket (from
 * side A's port to side B's furcation point); its legs are derived.
 */
export function finishRoute(routeId: Id, layerPoints: readonly routing.LayerPoints[], pinByDefault?: boolean): Command {
  return command('Route cable', EDITOR, (d) => {
    const route = routing.newRouteFromPoints(snapshot(d), routeId, layerPoints, pinByDefault ?? d.settings.pinWaypointsByDefault);
    if (!route) throw new Error(`Link or cable not found (or a cable side is unplugged): ${routeId}`);
    d.routes[routeId] = route;
  });
}

/** Delete routes by key (link ids, or cable ids for jacket routes). */
export function unroute(routeIds: Id | readonly Id[]): Command {
  const list = asArray(routeIds);
  return command(`Unroute ${plural(list.length, 'cable')}`, EDITOR, (d) => {
    for (const id of list) delete d.routes[id];
  });
}

// ---------------------------------------------------------------------------
// Waypoints
// ---------------------------------------------------------------------------

/** Insert a waypoint after `afterIdx` (-1 = at the start) of a segment; `result` is the waypoint id. */
export function insertWaypoint(linkId: Id, segIdx: number, afterIdx: number, pos: Vec2, pinned?: boolean): ResultCommand<Id> {
  return resultCommand('Add waypoint', EDITOR, (d) => {
    const route = requireRoute(d, linkId);
    const wp = routing.insertWaypoint(route, segIdx, afterIdx, pos, pinned ?? d.settings.pinWaypointsByDefault);
    if (!wp) throw new Error(`Route has no segment #${segIdx}`);
    touchRoute(d, route);
    return wp.id;
  });
}

export function deleteWaypoint(linkId: Id, segIdx: number, wpId: Id): Command {
  return command('Delete waypoint', EDITOR, (d) => {
    const route = requireRoute(d, linkId);
    if (!routing.deleteWaypoint(route, segIdx, wpId)) throw new Error('Waypoint not found');
    touchRoute(d, route);
  });
}

export interface MoveWaypointOptions {
  /** Slide unpinned neighbours so adjacent segments stay orthogonal. */
  keepOrthogonal?: boolean;
  dragId?: string;
}

/** Move a waypoint; steps of one drag coalesce. */
export function moveWaypoint(linkId: Id, segIdx: number, wpId: Id, pos: Vec2, opts: MoveWaypointOptions = {}): Command {
  return command(
    'Move waypoint',
    EDITOR,
    (d) => {
      const route = requireRoute(d, linkId);
      const ok = routing.moveWaypoint(route, segIdx, wpId, pos, opts.keepOrthogonal !== undefined ? { keepOrthogonal: opts.keepOrthogonal } : {});
      if (!ok) throw new Error('Waypoint not found');
      touchRoute(d, route);
    },
    dragKey('layout.wp', [linkId, wpId], opts.dragId),
  );
}

/**
 * Drag the segment between points i and i+1 perpendicular to itself; a
 * no-op when either end is pinned. Steps of one drag coalesce.
 */
export function dragSegment(linkId: Id, segIdx: number, i: number, delta: Vec2, dragId?: string): Command {
  return command(
    'Drag segment',
    EDITOR,
    (d) => {
      const route = requireRoute(d, linkId);
      if (routing.dragSegment(route, segIdx, i, delta)) touchRoute(d, route);
    },
    dragKey('layout.seg', [linkId, String(segIdx), String(i)], dragId),
  );
}

export function setPinned(linkId: Id, segIdx: number, wpId: Id | 'all', pinned: boolean): Command {
  return command(pinned ? 'Pin waypoint' : 'Unpin waypoint', EDITOR, (d) => {
    const route = requireRoute(d, linkId);
    if (routing.setPinned(route, segIdx, wpId, pinned) === 0 && wpId !== 'all') throw new Error('Waypoint not found');
    touchRoute(d, route, false);
  });
}

export function pinAll(linkId: Id): Command {
  return command('Pin all', EDITOR, (d) => {
    const route = requireRoute(d, linkId);
    routing.setAllPinned(route, true);
    touchRoute(d, route, false);
  });
}

export function unpinAll(linkId: Id): Command {
  return command('Unpin all', EDITOR, (d) => {
    const route = requireRoute(d, linkId);
    routing.setAllPinned(route, false);
    touchRoute(d, route, false);
  });
}

/** Drop redundant unpinned waypoints; `result` is how many went. */
export function straighten(linkId: Id): ResultCommand<number> {
  return resultCommand('Straighten', EDITOR, (d) => {
    const route = requireRoute(d, linkId);
    const n = routing.straighten(route);
    if (n > 0) touchRoute(d, route);
    return n;
  });
}

/** Coil of slack (metres) at a waypoint; null removes it. */
export function setServiceLoop(linkId: Id, segIdx: number, wpId: Id, metres: number | null): Command {
  return command(metres === null ? 'Remove service loop' : 'Set service loop', EDITOR, (d) => {
    const route = requireRoute(d, linkId);
    const hit = routing.findWaypoint(route, wpId);
    if (!hit || hit.segIdx !== segIdx) throw new Error('Waypoint not found');
    if (metres === null || metres <= 0) delete hit.wp.serviceLoopM;
    else if (!Number.isFinite(metres)) throw new Error('Service loop must be a length in metres');
    else hit.wp.serviceLoopM = metres;
    touchRoute(d, route, false);
  });
}

// ---------------------------------------------------------------------------
// In-rack dressing
// ---------------------------------------------------------------------------

/** Override the manager side and/or top entry at one end of a route (pins that end). `routeId` is a link id or a cable id. */
export function setInRackPath(routeId: Id, end: 'a' | 'b', path: { side?: Side; entry?: Id | null }): Command {
  return command('Set in-rack path', EDITOR, (d) => {
    const route = requireRoute(d, routeId);
    const endRef = requireRouteEnds(d, routeId)[end];
    const key = end === 'a' ? 'aRack' : 'bRack';
    const next: InRackPath = { ...route[key], pinned: true };
    if (path.side !== undefined) next.side = path.side;
    if (path.entry !== undefined) {
      if (path.entry !== null) {
        const acc = d.accessories.find((a) => a.id === path.entry);
        if (!acc || acc.type !== 'top-entry') throw new Error('Entry must be a top-entry accessory');
        const placement = d.placements.find((p) => p.componentId === endRef.componentId);
        if (placement?.rackId && placement.rackId !== acc.rackId) throw new Error('Top entry is on another rack');
      }
      next.entry = path.entry;
    }
    route[key] = next;
    touchRoute(d, route, false);
  });
}

/** Return one end of a route to automatic dressing. `routeId` is a link id or a cable id. */
export function resetInRackPath(routeId: Id, end: 'a' | 'b'): Command {
  return command('Auto in-rack path', EDITOR, (d) => {
    const route = requireRoute(d, routeId);
    const endRef = requireRouteEnds(d, routeId)[end];
    const key = end === 'a' ? 'aRack' : 'bRack';
    route[key] = routing.autoInRackPath(snapshot(d), endRef.componentId, endRef.portId);
    touchRoute(d, route, false);
  });
}

// ---------------------------------------------------------------------------
// Sync and back-annotation
// ---------------------------------------------------------------------------

/** Apply the checked changes of an Update Layout (F8) plan; `result` is the summary. */
export function applySyncPlan(changes: readonly SyncChange[]): ResultCommand<ApplySummary> {
  return resultCommand(`Update layout (${plural(changes.length, 'change')})`, EDITOR, (d) => sync.applySyncPlan(d, changes));
}

/** Propose moving a link end to another port of the same device; `result` is the proposal id. */
export function proposePortSwap(linkId: Id, end: 'a' | 'b', toPortId: string): ResultCommand<Id> {
  return resultCommand(`Propose port swap to ${toPortId}`, EDITOR, (d) => sync.proposePortSwap(d, linkId, end, toPortId).id);
}

export function proposeRefRename(componentId: Id, to: string): ResultCommand<Id> {
  return resultCommand(`Propose rename to ${to.trim()}`, EDITOR, (d) => sync.proposeRefRename(d, componentId, to).id);
}

export function proposeFootprintChange(componentId: Id, to: string | null): ResultCommand<Id> {
  return resultCommand('Propose model change', EDITOR, (d) => {
    if (to !== null && !catalogIndex(d).footprint(to)) throw new Error(`Unknown footprint: ${to}`);
    return sync.proposeFootprintChange(d, componentId, to).id;
  });
}

/**
 * Accept a pending proposal: applies it to the schematic and syncState, so it
 * is a schematic-history command. Throws (proposal stays pending) when it no
 * longer validates.
 */
export function acceptBackAnnotation(id: Id): ResultCommand<AcceptResult> {
  return resultCommand('Accept back-annotation', 'schematic', (d) => {
    const r = sync.acceptBackAnnotation(d, id);
    if (!r.ok) throw new Error(r.error);
    return r;
  });
}

export function rejectBackAnnotation(id: Id): Command {
  return command('Reject back-annotation', 'schematic', (d) => {
    sync.rejectBackAnnotation(d, id);
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Patch project settings (severity overrides, slack, pin-by-default, ...). Undoable in `editor` (default layout). */
export function setProjectSettings(partial: Partial<ProjectSettings>, editor: Exclude<EditorId, 'viewer3d'> = EDITOR): Command {
  return command('Change settings', editor, (d) => {
    for (const [k, v] of Object.entries(partial)) {
      if (v === undefined) continue;
      (d.settings as unknown as Record<string, unknown>)[k] = typeof v === 'object' && v !== null ? { ...(v as object) } : v;
    }
  });
}
