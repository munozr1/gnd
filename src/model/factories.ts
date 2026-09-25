import { nanoid } from 'nanoid';
import { resolveCable } from './cables/resolve';
import type {
  Cable,
  CableDef,
  CablePlug,
  Component,
  Id,
  Link,
  LinkEnd,
  Placement,
  Project,
  ProjectSettings,
  Rack,
  RackDef,
  Room,
  Sheet,
  SymbolDef,
  Tray,
  TrayDef,
  Vec2,
  Waypoint,
} from './types';

export const newId = (): Id => nanoid(10);

export const ROOT_SHEET_ID = 'root';

export const defaultSettings = (): ProjectSettings => ({
  ercSeverities: {},
  drcSeverities: {},
  pinWaypointsByDefault: true,
  trayFillWarn: 0.5,
  managerFillWarn: 0.6,
  separateCopperFiber: true,
  slackFraction: 0.1,
  slackPerEndM: 0.5,
});

export const defaultRoom = (): Room => ({
  outline: [
    { x: 0, y: 0 },
    { x: 12000, y: 0 },
    { x: 12000, y: 8000 },
    { x: 0, y: 8000 },
  ],
  gridMm: 600,
  ceilingMm: 3000,
  raisedFloorMm: 300,
});

export function createProject(name = 'Untitled datacenter', now = new Date().toISOString()): Project {
  return {
    id: newId(),
    name,
    version: 1,
    rev: 'A',
    createdAt: now,
    updatedAt: now,
    sheets: [{ id: ROOT_SHEET_ID, name: 'Root', parentId: null }],
    components: [],
    links: [],
    cables: [],
    room: defaultRoom(),
    racks: [],
    placements: [],
    accessories: [],
    trays: [],
    routes: {},
    keepouts: [],
    syncState: { components: {}, links: {} },
    backAnnotations: [],
    customCatalog: { symbols: [], footprints: [], transceivers: [], cables: [] },
    settings: defaultSettings(),
  };
}

export function createComponent(
  symbol: SymbolDef,
  opts: { sheetId: Id; pos: Vec2; ref?: string; footprintDefId?: string | null; value?: string },
): Component {
  return {
    id: newId(),
    ref: opts.ref ?? `${symbol.refPrefix}?`,
    symbolDefId: symbol.id,
    footprintDefId: opts.footprintDefId ?? symbol.defaultFootprintIds[0] ?? null,
    ...(opts.value !== undefined ? { value: opts.value } : {}),
    optics: {},
    sch: { pos: { ...opts.pos }, rotation: 0, sheetId: opts.sheetId },
  };
}

export function createLink(a: LinkEnd, b: LinkEnd, cableDefId: string | null = null, label?: string): Link {
  return {
    id: newId(),
    a: { ...a },
    b: { ...b },
    cableDefId,
    ...(label !== undefined ? { label } : {}),
    sch: { wirePoints: [] },
  };
}

/**
 * An installed cable of `def` with every leg unassigned: one plug per leg per
 * side, derived from the definition's fiber count and connectors. Throws when
 * the definition does not resolve (not a fiber cable, uneven split, …).
 */
export function createCable(def: CableDef, label: string): Cable {
  const resolved = resolveCable(def);
  if ('error' in resolved) throw new Error(`Cannot connect ${def.name || def.id}: ${resolved.error}`);
  const plugs: CablePlug[] = [];
  for (const side of ['A', 'B'] as const) {
    const legs = side === 'A' ? resolved.sideA.legs : resolved.sideB.legs;
    for (const leg of legs) plugs.push({ side, leg: leg.index, componentId: null, portId: null });
  }
  return { id: newId(), label, cableDefId: def.id, plugs };
}

export function createSheet(name: string, parentId: Id | null, pos?: Vec2): Sheet {
  return {
    id: newId(),
    name,
    parentId,
    ...(pos ? { sch: { pos: { ...pos }, width: 160, height: 100 } } : {}),
  };
}

export function createRack(def: RackDef, opts: { name: string; pos: Vec2; row?: string }): Rack {
  return {
    id: newId(),
    name: opts.name,
    pos: { ...opts.pos },
    rotationDeg: 0,
    heightU: def.heightU,
    widthMm: def.widthMm,
    depthMm: def.depthMm,
    ...(opts.row !== undefined ? { row: opts.row } : {}),
    ...(def.kind && def.kind !== 'rack' ? { kind: def.kind } : {}),
  };
}

export function createPlacement(componentId: Id): Placement {
  return { componentId, rackId: null, uPosition: null, face: 'front' };
}

export function createTray(def: TrayDef, points: Vec2[], elevationMm: number): Tray {
  return {
    id: newId(),
    kind: def.kind,
    layer: elevationMm < 0 ? 'underfloor' : 'overhead',
    points: points.map((p) => ({ ...p })),
    widthMm: def.widthMm,
    depthMm: def.depthMm,
    elevationMm,
    fittings: [],
    name: def.name,
  };
}

export function createWaypoint(pos: Vec2, pinned = false): Waypoint {
  return { id: newId(), pos: { ...pos }, pinned };
}
