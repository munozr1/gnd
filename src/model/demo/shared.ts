/**
 * Building blocks shared by the demo project generators: catalog ids, a port
 * ledger that guarantees no port is used twice, device / rack / tray helpers,
 * overhead + in-rack routing and the F8 sync that makes `syncState` match
 * the schematic.
 *
 * Projects are built by plain mutation for speed (Immer is an order of
 * magnitude slower over thousands of links). `indexProject` memoises per
 * object identity, so every reader is handed a fresh shallow copy (`view`)
 * taken after the last mutation it must see.
 */
import { builtinCatalog } from '@/catalog';
import { ROOT_SHEET_ID, createComponent, createLink, createProject, createRack, createTray, newId } from '../factories';
import { indexProject, portKey } from '../query';
import { autoInRackPath } from '../routing/dressing';
import { managerFloorCenter, rackCenter, rackEntryPoints } from '../routing/positions';
import { newRouteFromPoints, type LayerPoints } from '../routing/waypoints';
import { applyFabric, planFabric } from '../schematic/fabric';
import { createChildSheet } from '../schematic/sheets';
import { applySyncPlan } from '../sync/apply';
import { computeSyncPlan } from '../sync/diff';
import type {
  Component,
  Id,
  Link,
  LinkEnd,
  Project,
  Rack,
  RackDef,
  Sheet,
  SymbolDef,
  Tray,
  TrayDef,
  Vec2,
} from '../types';

// ---------------------------------------------------------------------------
// Catalog ids
// ---------------------------------------------------------------------------

export const SYM = {
  leaf: 'sym.leaf-switch-48x25-8x100',
  spine: 'sym.spine-switch-32x400',
  mgmt: 'sym.mgmt-switch-48x1g-4x10',
  server1u: 'sym.server-1u',
  server2u: 'sym.server-2u',
  lcPanel: 'sym.fiber-patch-panel-24lc',
} as const;

export const XCVR = {
  sr10: 'xcvr.10g-sr',
  sr25: 'xcvr.25g-sr',
  sr4_100: 'xcvr.100g-sr4',
} as const;

export const CABLE = {
  om4Duplex: 'cbl.om4-duplex',
  om4Trunk: 'cbl.om4-mpo-trunk',
  cat6a: 'cbl.cat6a',
  aoc100: 'cbl.aoc-100g',
} as const;

export const RACK_DEF = {
  standard: 'rack.standard-42u',
  network: 'rack.network-42u',
} as const;

export const TRAY_DEF = {
  runway6: 'tray.fiber-runway-6',
  runway12: 'tray.fiber-runway-12',
  ladder12: 'tray.ladder-12',
  ladder18: 'tray.ladder-18',
} as const;

/** Leaf downlink n (1..48). */
export const leafDownlink = (n: number): string => `eth1/${n}`;
/** Leaf uplink n (1..8). */
export const leafUplink = (n: number): string => `eth1/${48 + n}`;
/** Spine fabric port n (1..32). */
export const spinePort = (n: number): string => `eth1/${n}`;
export const mgmtAccess = (n: number): string => `ge${n}`;
export const mgmtUplink = (n: number): string => `xe${n}`;
export const panelFront = (n: number): string => `f${n}`;
export const panelRear = (n: number): string => `r${n}`;

export const LEAF_DOWNLINKS = 48;
export const LEAF_UPLINKS = 8;
export const SPINE_PORTS = 32;
export const MGMT_ACCESS_PORTS = 48;
export const MGMT_UPLINKS = 4;
export const PANEL_PORTS = 24;

export const VCM_WIDTH_MM = 152;
/** Bottom of the overhead fiber runway above the finished floor. */
export const RUNWAY_ELEVATION_MM = 2600;
/** Bottom of the overhead copper ladder rack. */
export const LADDER_ELEVATION_MM = 2400;
/** Gap between rack frames in a row (room for a manager on each side). */
export const RACK_GAP_MM = 600;

/** Schematic grid step used by the generators. */
export const SCH_GRID = 10;
/** Width of one schematic column (a rack's worth of symbols). */
export const SCH_COLUMN_W = 720;
export const SCH_MARGIN = 100;
export const SHEET_SYMBOL_W = 160;
export const SHEET_SYMBOL_H = 100;

export function symbolDef(id: string): SymbolDef {
  const s = builtinCatalog.symbols.find((x) => x.id === id);
  if (!s) throw new Error(`demo: unknown symbol ${id}`);
  return s;
}

export function rackDef(id: string): RackDef {
  const r = builtinCatalog.racks.find((x) => x.id === id);
  if (!r) throw new Error(`demo: unknown rack ${id}`);
  return r;
}

export function trayDef(id: string): TrayDef {
  const t = builtinCatalog.trays.find((x) => x.id === id);
  if (!t) throw new Error(`demo: unknown tray ${id}`);
  return t;
}

/** Fresh shallow copy so memoised readers re-index after in-place mutation. */
export const view = (project: Project): Project => ({ ...project });

// ---------------------------------------------------------------------------
// Build context
// ---------------------------------------------------------------------------

/** Tracks every link end so a generator can never reuse a port. */
export class PortLedger {
  private readonly used = new Set<string>();

  claim(end: LinkEnd): void {
    const key = portKey(end);
    if (this.used.has(key)) throw new Error(`demo: port ${key} is already connected`);
    this.used.add(key);
  }

  isFree(end: LinkEnd): boolean {
    return !this.used.has(portKey(end));
  }

  get size(): number {
    return this.used.size;
  }
}

/** Sequential reference designators per prefix ('SW1', 'SW2', 'SRV1', ...). */
export class RefCounter {
  private readonly counts = new Map<string, number>();

  next(prefix: string): string {
    const n = (this.counts.get(prefix) ?? 0) + 1;
    this.counts.set(prefix, n);
    return `${prefix}${n}`;
  }
}

export interface DemoContext {
  project: Project;
  ledger: PortLedger;
  refs: RefCounter;
}

export function startProject(name: string): DemoContext {
  return { project: createProject(name), ledger: new PortLedger(), refs: new RefCounter() };
}

// ---------------------------------------------------------------------------
// Schematic
// ---------------------------------------------------------------------------

export function addSheet(ctx: DemoContext, name: string, pos: Vec2): Sheet {
  return createChildSheet(ctx.project, ROOT_SHEET_ID, name, pos);
}

/** Position of the n-th sheet symbol on the root sheet (stacked vertically). */
export const sheetSlot = (n: number): Vec2 => ({
  x: SCH_MARGIN,
  y: SCH_MARGIN + n * (SHEET_SYMBOL_H + 60),
});

/** Add a device with its default footprint and the next sequential ref. */
export function addDevice(ctx: DemoContext, symbolId: string, sheetId: Id, pos: Vec2, value?: string): Component {
  const symbol = symbolDef(symbolId);
  const c = createComponent(symbol, {
    sheetId,
    pos,
    ref: ctx.refs.next(symbol.refPrefix),
    ...(value !== undefined ? { value } : {}),
  });
  ctx.project.components.push(c);
  return c;
}

export interface EndSpec {
  c: Component;
  port: string;
  /** Optic to assign on this end (pluggable cages only). */
  optic?: string;
}

/** Connect two ports; claims both ends in the ledger and assigns the optics. */
export function connect(ctx: DemoContext, a: EndSpec, b: EndSpec, cableDefId: string, label?: string): Link {
  const ea: LinkEnd = { componentId: a.c.id, portId: a.port };
  const eb: LinkEnd = { componentId: b.c.id, portId: b.port };
  ctx.ledger.claim(ea);
  ctx.ledger.claim(eb);
  if (a.optic !== undefined) a.c.optics[a.port] = a.optic;
  if (b.optic !== undefined) b.c.optics[b.port] = b.optic;
  const link = createLink(ea, eb, cableDefId, label);
  ctx.project.links.push(link);
  return link;
}

/**
 * Full leaf-spine mesh through the fabric connector: leaf i <-> spine j on
 * leaf uplink j and spine port i, 100G-SR4 at both ends over an OM4 MPO
 * trunk. Leafs beyond a spine's 32 ports and spines beyond a leaf's 8
 * uplinks are skipped by `planFabric`, so callers chunk large fabrics into
 * pods. Returns the new link ids.
 */
export function meshFabric(ctx: DemoContext, leafs: readonly Component[], spines: readonly Component[], labelPrefix: string): Id[] {
  if (leafs.length === 0 || spines.length === 0) return [];
  const plan = planFabric(view(ctx.project), {
    leafIds: leafs.map((l) => l.id),
    spineIds: spines.map((s) => s.id),
    leafPortIds: spines.slice(0, LEAF_UPLINKS).map((_, j) => leafUplink(j + 1)),
    spinePortIds: leafs.slice(0, SPINE_PORTS).map((_, i) => spinePort(i + 1)),
    cableDefId: CABLE.om4Trunk,
    opticId: XCVR.sr4_100,
    labelPrefix,
  });
  for (const l of plan.links) {
    ctx.ledger.claim(l.a);
    ctx.ledger.claim(l.b);
  }
  return applyFabric(ctx.project, plan);
}

// ---------------------------------------------------------------------------
// Physical
// ---------------------------------------------------------------------------

export interface RackRowSpec {
  /** One entry per rack: name and rack def id. */
  racks: { name: string; defId: string }[];
  /** Top-left of the first rack footprint. */
  origin: Vec2;
  gapMm?: number;
  row?: string;
}

/** A row of racks along +x, all facing +y, `gapMm` between frames. */
export function addRackRow(ctx: DemoContext, spec: RackRowSpec): Rack[] {
  const gap = spec.gapMm ?? RACK_GAP_MM;
  const out: Rack[] = [];
  let x = spec.origin.x;
  for (const r of spec.racks) {
    const def = rackDef(r.defId);
    const rack = createRack(def, {
      name: r.name,
      pos: { x, y: spec.origin.y },
      ...(spec.row !== undefined ? { row: spec.row } : {}),
    });
    ctx.project.racks.push(rack);
    out.push(rack);
    x += def.widthMm + gap;
  }
  return out;
}

/** Vertical cable managers on both sides plus a top entry on each side. */
export function fitRack(ctx: DemoContext, rack: Rack): void {
  for (const side of ['left', 'right'] as const) {
    ctx.project.accessories.push({ id: newId(), rackId: rack.id, type: 'vcm', side, widthMm: VCM_WIDTH_MM });
    ctx.project.accessories.push({ id: newId(), rackId: rack.id, type: 'top-entry', side });
  }
}

export function place(ctx: DemoContext, c: Component, rack: Rack, u: number): void {
  if (u < 1 || u > rack.heightU) throw new RangeError(`demo: U${u} is outside rack ${rack.name}`);
  ctx.project.placements.push({ componentId: c.id, rackId: rack.id, uPosition: u, face: 'front' });
}

/** A straight tray along +x at `y` with a waterfall fitting over each rack. */
export function addRowTray(
  ctx: DemoContext,
  opts: { defId: string; name: string; y: number; x0: number; x1: number; elevationMm: number; racks: readonly Rack[] },
): Tray {
  const tray = createTray(trayDef(opts.defId), [{ x: opts.x0, y: opts.y }, { x: opts.x1, y: opts.y }], opts.elevationMm);
  tray.name = opts.name;
  tray.fittings = opts.racks.map((r) => ({ at: { x: rackCenter(r).x, y: opts.y }, type: 'waterfall' as const, rackId: r.id }));
  ctx.project.trays.push(tray);
  return tray;
}

/** A straight tray along +y at `x` (joins row trays), with a tee at each junction. */
export function addBackboneTray(
  ctx: DemoContext,
  opts: { defId: string; name: string; x: number; y0: number; y1: number; elevationMm: number; junctionYs: readonly number[] },
): Tray {
  const tray = createTray(trayDef(opts.defId), [{ x: opts.x, y: opts.y0 }, { x: opts.x, y: opts.y1 }], opts.elevationMm);
  tray.name = opts.name;
  tray.fittings = opts.junctionYs.map((y) => ({ at: { x: opts.x, y }, type: 'tee' as const }));
  ctx.project.trays.push(tray);
  return tray;
}

// ---------------------------------------------------------------------------
// Sync + routing
// ---------------------------------------------------------------------------

/** F8 with everything checked: placements exist, syncState mirrors the schematic. */
export function syncLayout(ctx: DemoContext): void {
  const plan = computeSyncPlan(view(ctx.project));
  applySyncPlan(ctx.project, plan.changes);
}

/**
 * Overhead trays a media class can ride: the row tray serving each rack (a
 * point on it is reached at the rack's entry x and the tray's y) and an
 * optional backbone at `x` joining every row tray.
 */
export interface TrayNetwork {
  byRack: Map<Id, { trayId: Id; y: number }>;
  backbone: { trayId: Id; x: number } | null;
}

export interface TrayNetworks {
  fiber: TrayNetwork;
  copper?: TrayNetwork;
}

const entryPoint = (project: Project, rack: Rack, side: 'left' | 'right'): Vec2 => {
  const e = rackEntryPoints(project, rack);
  return side === 'left' ? e.topLeft : e.topRight;
};

/**
 * Hand-routed legs for a link: an in-rack segment at the manager column
 * when both ends share a rack; otherwise up onto the row tray, along it and,
 * for racks on different rows, across the backbone. Null when an end is
 * unplaced or no tray serves it.
 */
export function routeLegs(project: Project, link: Link, nets: TrayNetworks): LayerPoints[] | null {
  const idx = indexProject(project);
  const rackA = idx.rackOfComponent(link.a.componentId);
  const rackB = idx.rackOfComponent(link.b.componentId);
  if (!rackA || !rackB) return null;
  const sideA = autoInRackPath(project, link.a.componentId, link.a.portId).side;
  if (rackA.id === rackB.id) {
    const c = managerFloorCenter(project, rackA.id, sideA);
    return c ? [{ layer: 'in-rack', points: [c] }] : null;
  }
  const media = idx.cableOf(link)?.mediaClass ?? 'fiber';
  const net = media === 'copper' ? nets.copper : nets.fiber;
  const ra = net?.byRack.get(rackA.id);
  const rb = net?.byRack.get(rackB.id);
  if (!net || !ra || !rb) return null;
  const sideB = autoInRackPath(project, link.b.componentId, link.b.portId).side;
  const pA = { x: entryPoint(project, rackA, sideA).x, y: ra.y };
  const pB = { x: entryPoint(project, rackB, sideB).x, y: rb.y };
  if (ra.trayId === rb.trayId) return [{ layer: 'overhead', trayId: ra.trayId, points: [pA, pB] }];
  if (!net.backbone) return null;
  const jA = { x: net.backbone.x, y: ra.y };
  const jB = { x: net.backbone.x, y: rb.y };
  return [
    { layer: 'overhead', trayId: ra.trayId, points: [pA, jA] },
    { layer: 'overhead', trayId: net.backbone.trayId, points: [jA, jB] },
    { layer: 'overhead', trayId: rb.trayId, points: [jB, pB] },
  ];
}

/** Route one link with pinned waypoints. `project` must be a view taken after the layout was final. */
export function routeLink(ctx: DemoContext, project: Project, link: Link, nets: TrayNetworks): boolean {
  const legs = routeLegs(project, link, nets);
  if (!legs) return false;
  const route = newRouteFromPoints(project, link.id, legs, true);
  if (!route) return false;
  ctx.project.routes[link.id] = route;
  return true;
}

/**
 * Route about `fraction` of the links: every inter-rack link first (they
 * ride the trays), then in-rack links spread round-robin over the racks
 * until the target count is reached. Returns the number of routes made.
 */
export function routeShare(ctx: DemoContext, fraction: number, nets: TrayNetworks): number {
  const project = view(ctx.project);
  const idx = indexProject(project);
  const target = Math.round(fraction * project.links.length);
  const inter: Link[] = [];
  const intra = new Map<Id, Link[]>();
  for (const link of project.links) {
    const ra = idx.rackOfComponent(link.a.componentId);
    const rb = idx.rackOfComponent(link.b.componentId);
    if (!ra || !rb) continue;
    if (ra.id !== rb.id) {
      inter.push(link);
      continue;
    }
    const q = intra.get(ra.id);
    if (q) q.push(link);
    else intra.set(ra.id, [link]);
  }
  let n = 0;
  for (const link of inter) {
    if (n >= target) break;
    if (routeLink(ctx, project, link, nets)) n++;
  }
  const queues = [...intra.values()];
  let i = 0;
  let remaining = queues.reduce((s, q) => s + q.length, 0);
  while (n < target && remaining > 0) {
    const q = queues[i % queues.length];
    i++;
    const link = q?.shift();
    if (!link) continue;
    remaining--;
    if (routeLink(ctx, project, link, nets)) n++;
  }
  return n;
}

/** Finish a build: hand back a copy no reader has indexed yet. */
export function finishProject(ctx: DemoContext): Project {
  return view(ctx.project);
}
