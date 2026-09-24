/**
 * Symbol geometry: where a component's body and pins sit on the sheet.
 *
 * Local frame: the body is the rect (0,0)-(width,height) with its top-left at
 * `component.sch.pos`. Pins hang off the body edges by PIN_LENGTH; a pin's
 * `pos` is its outer (wire-connection) end. Mirror (x -> -x) is applied first,
 * then rotation, both about `component.sch.pos`.
 *
 * Collapse mode (component.expandedPins !== true): a side with more than
 * MAX_VISIBLE_PINS_PER_SIDE pins shows only its used pins plus the first few
 * unused ones, re-packed at PIN_PITCH, followed by a '+N unused' stub. The body
 * shrinks to the packed extent so a 56-port switch stays readable.
 */
import { add, boundsOf, rotate90, type Rect } from '../geometry';
import { indexProject } from '../query';
import type { Component, Id, PinSide, Project, SymbolDef, SymbolPin, Vec2 } from '../types';

export const PIN_PITCH = 10;
export const PIN_LENGTH = 20;
export const GRID = 10;
/** A collapsed side shows at most this many pins (used pins always show). */
export const MAX_VISIBLE_PINS_PER_SIDE = 12;
/** A collapsed body never packs below this size along the pin axis. */
export const MIN_BODY_SIZE = 40;

export interface PinPlacement {
  portId: string;
  pin: SymbolPin;
  /** Declared side on the symbol definition (before rotation / mirror). */
  side: PinSide;
  /** Wire connection point (outer pin end), world coordinates. */
  pos: Vec2;
  /** Where the pin meets the body edge, world coordinates. */
  bodyPos: Vec2;
  /** Unit vector pointing away from the body, world coordinates. */
  dir: Vec2;
}

export interface CollapsedStub {
  side: PinSide;
  /** Hidden (unused) pin count shown as '+N unused'. */
  count: number;
  hiddenPortIds: string[];
  pos: Vec2;
  bodyPos: Vec2;
  dir: Vec2;
}

export interface PinLayoutOptions {
  collapsed: boolean;
  usedPortIds: ReadonlySet<string>;
}

export interface SymbolLayout {
  pins: Map<string, PinPlacement>;
  stubs: CollapsedStub[];
  /** Packed body size in local (unrotated) units. */
  width: number;
  height: number;
  /** World axis-aligned bounds of the body (excluding pins). */
  bounds: Rect;
  /** True when at least one side hides pins behind a stub. */
  collapsed: boolean;
}

export const isCollapsed = (component: Pick<Component, 'expandedPins'>): boolean =>
  component.expandedPins !== true;

/** 'eth1/49 QSFP28' */
export const portLabel = (pin: Pick<SymbolPin, 'portId' | 'type'>): string => `${pin.portId} ${pin.type}`;

const SIDE_DIR: Record<PinSide, Vec2> = {
  L: { x: -1, y: 0 },
  R: { x: 1, y: 0 },
  T: { x: 0, y: -1 },
  B: { x: 0, y: 1 },
};

/** Squash -0 so consumers can compare directions / positions with ===. */
const clean = (p: Vec2): Vec2 => ({ x: p.x + 0, y: p.y + 0 });

/** Local -> world for points (mirror, then rotate, then translate). */
export function localToWorld(p: Vec2, component: Pick<Component, 'sch'>): Vec2 {
  const m = component.sch.mirrored ? { x: -p.x, y: p.y } : p;
  return clean(add(component.sch.pos, rotate90(m, component.sch.rotation)));
}

/** Local -> world for directions (mirror, then rotate; no translation). */
export function localToWorldDir(d: Vec2, component: Pick<Component, 'sch'>): Vec2 {
  const m = component.sch.mirrored ? { x: -d.x, y: d.y } : d;
  return clean(rotate90(m, component.sch.rotation));
}

/** World -> local (exact inverse of localToWorld: un-translate, un-rotate, un-mirror; -0 squashed like localToWorld). */
export function worldToLocal(p: Vec2, component: Pick<Component, 'sch'>): Vec2 {
  const rel = { x: p.x - component.sch.pos.x, y: p.y - component.sch.pos.y };
  const inverse = ((360 - component.sch.rotation) % 360) as 0 | 90 | 180 | 270;
  const r = rotate90(rel, inverse);
  return clean(component.sch.mirrored ? { x: -r.x, y: r.y } : r);
}

/** Which world edge a pin points out of, given its world direction. */
export function worldSide(dir: Vec2): PinSide {
  if (Math.abs(dir.x) >= Math.abs(dir.y)) return dir.x < 0 ? 'L' : 'R';
  return dir.y < 0 ? 'T' : 'B';
}

interface SidePlan {
  side: PinSide;
  visible: { pin: SymbolPin; offset: number }[];
  hidden: SymbolPin[];
  stubOffset: number | null;
  /** Length needed along the side to fit everything. */
  extent: number;
}

function planSide(side: PinSide, pins: SymbolPin[], opts: PinLayoutOptions): SidePlan {
  const sorted = [...pins].sort((a, b) => a.offset - b.offset);
  const natural = (): SidePlan => ({
    side,
    visible: sorted.map((pin) => ({ pin, offset: pin.offset })),
    hidden: [],
    stubOffset: null,
    extent: sorted.length ? sorted[sorted.length - 1]!.offset + PIN_PITCH : 0,
  });
  if (!opts.collapsed || sorted.length <= MAX_VISIBLE_PINS_PER_SIDE) return natural();

  const used = sorted.filter((p) => opts.usedPortIds.has(p.portId));
  const unused = sorted.filter((p) => !opts.usedPortIds.has(p.portId));
  const keepUnused = Math.max(0, MAX_VISIBLE_PINS_PER_SIDE - used.length);
  const hidden = unused.slice(keepUnused);
  if (hidden.length === 0) return natural();

  const shown = new Set(unused.slice(0, keepUnused).map((p) => p.portId));
  const visiblePins = sorted.filter((p) => opts.usedPortIds.has(p.portId) || shown.has(p.portId));
  const visible = visiblePins.map((pin, i) => ({ pin, offset: PIN_PITCH * (i + 1) }));
  const stubOffset = PIN_PITCH * (visible.length + 1);
  return { side, visible, hidden, stubOffset, extent: stubOffset + PIN_PITCH };
}

/** Full layout of a symbol instance: pins, stubs and packed body bounds. */
export function symbolLayout(symbol: SymbolDef, component: Component, opts: PinLayoutOptions): SymbolLayout {
  const bySide: Record<PinSide, SymbolPin[]> = { L: [], R: [], T: [], B: [] };
  for (const pin of symbol.pins) bySide[pin.side].push(pin);
  const plans = (['L', 'R', 'T', 'B'] as const).map((side) => planSide(side, bySide[side], opts));
  const plan = (side: PinSide): SidePlan => plans.find((p) => p.side === side)!;

  const verticalCollapsed = plan('L').hidden.length > 0 || plan('R').hidden.length > 0;
  const horizontalCollapsed = plan('T').hidden.length > 0 || plan('B').hidden.length > 0;
  const height = verticalCollapsed
    ? Math.max(MIN_BODY_SIZE, plan('L').extent, plan('R').extent)
    : symbol.height;
  const width = horizontalCollapsed
    ? Math.max(MIN_BODY_SIZE, plan('T').extent, plan('B').extent)
    : symbol.width;

  const localBodyPos = (side: PinSide, offset: number): Vec2 => {
    switch (side) {
      case 'L':
        return { x: 0, y: offset };
      case 'R':
        return { x: width, y: offset };
      case 'T':
        return { x: offset, y: 0 };
      case 'B':
        return { x: offset, y: height };
    }
  };
  const place = (side: PinSide, offset: number): { pos: Vec2; bodyPos: Vec2; dir: Vec2 } => {
    const body = localBodyPos(side, offset);
    const d = SIDE_DIR[side];
    const outer = { x: body.x + d.x * PIN_LENGTH, y: body.y + d.y * PIN_LENGTH };
    return {
      pos: localToWorld(outer, component),
      bodyPos: localToWorld(body, component),
      dir: localToWorldDir(d, component),
    };
  };

  const pins = new Map<string, PinPlacement>();
  const stubs: CollapsedStub[] = [];
  for (const p of plans) {
    for (const v of p.visible) {
      pins.set(v.pin.portId, { portId: v.pin.portId, pin: v.pin, side: p.side, ...place(p.side, v.offset) });
    }
    if (p.stubOffset !== null) {
      stubs.push({
        side: p.side,
        count: p.hidden.length,
        hiddenPortIds: p.hidden.map((h) => h.portId),
        ...place(p.side, p.stubOffset),
      });
    }
  }

  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ].map((c) => localToWorld(c, component));

  return {
    pins,
    stubs,
    width,
    height,
    bounds: boundsOf(corners),
    collapsed: verticalCollapsed || horizontalCollapsed,
  };
}

const defaultOptions = (component: Component): PinLayoutOptions => ({
  collapsed: isCollapsed(component),
  usedPortIds: new Set<string>(),
});

/** Pin connection points keyed by port id. Hidden (collapsed) pins are absent; see `collapsedStubs`. */
export function pinPositions(
  symbol: SymbolDef,
  component: Component,
  opts: PinLayoutOptions = defaultOptions(component),
): Map<string, PinPlacement> {
  return symbolLayout(symbol, component, opts).pins;
}

/** '+N unused' stubs, one per collapsed side. */
export function collapsedStubs(
  symbol: SymbolDef,
  component: Component,
  opts: PinLayoutOptions = defaultOptions(component),
): CollapsedStub[] {
  return symbolLayout(symbol, component, opts).stubs;
}

/**
 * World bounds of the body. Without `opts` the collapse state comes from
 * `component.expandedPins` and no pins are treated as used, which matches the
 * exact layout unless more than MAX_VISIBLE_PINS_PER_SIDE pins on a side are used.
 */
export function symbolBounds(
  symbol: SymbolDef,
  component: Component,
  opts: PinLayoutOptions = defaultOptions(component),
): Rect {
  return symbolLayout(symbol, component, opts).bounds;
}

/** Body bounds grown by PIN_LENGTH on every side; useful for hit-testing / selection boxes. */
export function symbolBoundsWithPins(layout: SymbolLayout): Rect {
  const b = layout.bounds;
  return { x: b.x - PIN_LENGTH, y: b.y - PIN_LENGTH, width: b.width + 2 * PIN_LENGTH, height: b.height + 2 * PIN_LENGTH };
}

/**
 * Wire attachment point for a port: its pin if visible, else the stub of the
 * side it is hidden on, else (unknown port) undefined.
 */
export function pinEndpoint(
  layout: SymbolLayout,
  portId: string,
): { pos: Vec2; dir: Vec2; hidden: boolean } | undefined {
  const pin = layout.pins.get(portId);
  if (pin) return { pos: pin.pos, dir: pin.dir, hidden: false };
  const stub = layout.stubs.find((s) => s.hiddenPortIds.includes(portId));
  if (stub) return { pos: stub.pos, dir: stub.dir, hidden: true };
  return undefined;
}

// ---------------------------------------------------------------------------
// Project-aware helpers (memoised per project identity)
// ---------------------------------------------------------------------------

/** Port ids on a component that have at least one link. */
export function usedPortIds(project: Project, componentId: Id): Set<string> {
  const idx = indexProject(project);
  const out = new Set<string>();
  for (const l of idx.linksOf(componentId)) {
    if (l.a.componentId === componentId) out.add(l.a.portId);
    if (l.b.componentId === componentId) out.add(l.b.portId);
  }
  return out;
}

export function layoutOptionsFor(project: Project, component: Component): PinLayoutOptions {
  return { collapsed: isCollapsed(component), usedPortIds: usedPortIds(project, component.id) };
}

const layoutCache = new WeakMap<Project, Map<Id, SymbolLayout>>();

/** Layout of a component in a project, using its links for the collapse rules. Cached per project object. */
export function componentLayout(project: Project, componentId: Id): SymbolLayout | undefined {
  let perProject = layoutCache.get(project);
  if (!perProject) {
    perProject = new Map();
    layoutCache.set(project, perProject);
  }
  const cached = perProject.get(componentId);
  if (cached) return cached;
  const idx = indexProject(project);
  const component = idx.component(componentId);
  if (!component) return undefined;
  const symbol = idx.symbolOf(component);
  if (!symbol) return undefined;
  const layout = symbolLayout(symbol, component, layoutOptionsFor(project, component));
  perProject.set(componentId, layout);
  return layout;
}
