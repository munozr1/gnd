/**
 * Pure layout for the Cable Builder's live preview: where the jacket, the
 * furcation boots and every leg's connector glyph and label sit inside a
 * width × height box. Side A legs on the left, jacket in the middle, side B
 * legs on the right; a side with more than one leg fans out from a furcation
 * point. The dialog turns this into SVG; the tests read it directly. No
 * React.
 */
import { connectorById, diameterForFiberCount, type CableKind, type ConnectorFamily, type ResolvedSide } from '@/model/cables';

/** The part of a `ResolvedCable` the preview needs. */
export interface PreviewSpec {
  fiberCount: number;
  channels?: number;
  sideA: ResolvedSide;
  sideB: ResolvedSide;
  kind: CableKind;
  /** Jacket colour; defaults to the OM4 aqua. */
  color?: string;
  diameterMm?: number;
}

export type PreviewSideId = 'A' | 'B';

export interface PreviewLeg {
  index: number;
  /** Centre of the connector glyph. */
  x: number;
  y: number;
  label: string;
  positions: number[];
  /** Boot colour: the leg's override, else the connector's catalog colour. */
  color: string;
  connector: string;
  family: ConnectorFamily;
  /** Fibers in the plug: 1 draws one ferrule, 2 a duplex pair, more a multi-fiber body. */
  fibers: number;
}

export interface PreviewSide {
  legs: PreviewLeg[];
  /** Present when the side has more than one leg: where the jacket splits. */
  furcation?: { x: number; y: number };
  /** Where the legs' stems start: the furcation, or the jacket end on a single-leg side. */
  origin: { x: number; y: number };
  /** Legs beyond MAX_LEGS_DRAWN that are not laid out. */
  hiddenLegs: number;
}

export interface PreviewLayout {
  width: number;
  height: number;
  jacket: { x1: number; x2: number; y: number; thickness: number; color: string };
  sides: Record<PreviewSideId, PreviewSide>;
  badge: { x: number; y: number; text: string };
}

/** A 144F trunk into LC would be 72 legs; beyond this the side reports `hiddenLegs` instead. */
export const MAX_LEGS_DRAWN = 16;
/** Connector glyph width (a multi-fiber body; small plugs are drawn inside the same box). */
export const GLYPH_W = 24;
const PAD = 10;
const LABEL_W = 28;
/** Horizontal run from the furcation to the leg glyphs. */
const LEG_RUN = 48;
const ROW = 18;
const MIN_HEIGHT = 120;
const DEFAULT_COLOR = '#2dd4bf';

const drawn = (side: ResolvedSide): number => Math.min(side.legs.length, MAX_LEGS_DRAWN);

/** A height that gives every drawn leg its own row (plus room for the badge). */
export function previewHeight(spec: Pick<PreviewSpec, 'sideA' | 'sideB'>): number {
  return Math.max(MIN_HEIGHT, Math.max(drawn(spec.sideA), drawn(spec.sideB)) * ROW + 2 * PAD + 28);
}

export function previewLayout(spec: PreviewSpec, width: number, height: number): PreviewLayout {
  const cy = height / 2;
  const diameter = spec.diameterMm ?? diameterForFiberCount(spec.fiberCount);
  const thickness = Math.min(12, Math.max(3, Math.round(diameter)));
  const color = spec.color || DEFAULT_COLOR;
  const A = laySide(spec.sideA, 'A', PAD + LABEL_W + GLYPH_W / 2, cy, height);
  const B = laySide(spec.sideB, 'B', width - PAD - LABEL_W - GLYPH_W / 2, cy, height);
  const x1 = A.origin.x;
  const x2 = B.origin.x;
  const channels = spec.channels ?? spec.fiberCount / 2;
  return {
    width,
    height,
    jacket: { x1, x2, y: cy, thickness, color },
    sides: { A, B },
    badge: { x: (x1 + x2) / 2, y: cy - thickness / 2 - 10, text: `${spec.fiberCount}F · ${channels}ch` },
  };
}

function laySide(side: ResolvedSide, id: PreviewSideId, glyphX: number, cy: number, height: number): PreviewSide {
  // +1 points from this side's glyphs towards the jacket.
  const dir = id === 'A' ? 1 : -1;
  const conn = connectorById(side.connector);
  const n = drawn(side);
  const spacing = n <= 1 ? 0 : Math.min(ROW, (height - 2 * PAD - 12) / (n - 1));
  const legs: PreviewLeg[] = side.legs.slice(0, n).map((leg, i) => ({
    index: leg.index,
    x: glyphX,
    y: n <= 1 ? cy : cy + (i - (n - 1) / 2) * spacing,
    label: leg.label,
    positions: [...leg.positions],
    color: leg.color ?? conn?.color ?? DEFAULT_COLOR,
    connector: side.connector,
    family: conn?.family ?? 'small',
    fibers: leg.positions.length,
  }));
  const jacketEnd = glyphX + dir * (GLYPH_W / 2);
  const out: PreviewSide = { legs, origin: { x: jacketEnd, y: cy }, hiddenLegs: side.legs.length - n };
  if (side.legs.length > 1) {
    const furcation = { x: jacketEnd + dir * LEG_RUN, y: cy };
    out.furcation = furcation;
    out.origin = furcation;
  }
  return out;
}
