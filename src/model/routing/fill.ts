/**
 * Tray and vertical-manager fill: cross-section area used by the cables that
 * ride them, and side-by-side slots for rendering.
 */
import { indexProject, type ProjectIndex } from '../query';
import type { Id, Link, Project, Side } from '../types';
import { managerCrossSection, managerFor } from './positions';

export const DEFAULT_CABLE_DIAMETER_MM = 3;
/** Gap between neighbouring cables in a tray, mm. */
const CABLE_GAP_MM = 1;

export interface FillStats {
  areaMm2: number;
  usedMm2: number;
  fraction: number;
  cableCount: number;
}

export function cableDiameterMm(idx: ProjectIndex, link: Link | undefined): number {
  return (link && idx.cableOf(link)?.diameterMm) || DEFAULT_CABLE_DIAMETER_MM;
}

const cableAreaMm2 = (d: number): number => Math.PI * (d / 2) ** 2;

/** Ids of links whose route has a segment riding the tray, in route order. */
export function cablesInTray(project: Project, trayId: Id): Id[] {
  const out: Id[] = [];
  for (const route of Object.values(project.routes)) {
    if (route.segments.some((s) => s.trayId === trayId)) out.push(route.linkId);
  }
  return out;
}

function fillOf(idx: ProjectIndex, linkIds: readonly Id[], areaMm2: number): FillStats {
  let usedMm2 = 0;
  for (const id of linkIds) usedMm2 += cableAreaMm2(cableDiameterMm(idx, idx.link(id)));
  return { areaMm2, usedMm2, fraction: areaMm2 > 0 ? usedMm2 / areaMm2 : 0, cableCount: linkIds.length };
}

/** Cross-section fill of a tray, or null when the tray does not exist. */
export function trayFill(project: Project, trayId: Id): FillStats | null {
  const tray = project.trays.find((t) => t.id === trayId);
  if (!tray) return null;
  return fillOf(indexProject(project), cablesInTray(project, trayId), tray.widthMm * tray.depthMm);
}

/** Ids of links whose route uses the manager on a side of a rack. */
export function routesUsingManager(project: Project, rackId: Id, side: Side): Id[] {
  const idx = indexProject(project);
  const out: Id[] = [];
  for (const route of Object.values(project.routes)) {
    const link = idx.link(route.linkId);
    if (!link) continue;
    const a = route.aRack.side === side && idx.rackOfComponent(link.a.componentId)?.id === rackId;
    const b = route.bRack.side === side && idx.rackOfComponent(link.b.componentId)?.id === rackId;
    if (a || b) out.push(route.linkId);
  }
  return out;
}

/** Cross-section fill of the vertical manager on a side (default cross-section when none is fitted). */
export function managerFill(project: Project, rackId: Id, side: Side): FillStats {
  const { widthMm, depthMm } = managerCrossSection(managerFor(project, rackId, side));
  return fillOf(indexProject(project), routesUsingManager(project, rackId, side), widthMm * depthMm);
}

export interface CableSlot {
  /** Lateral offset from the tray centreline, mm (negative = left of travel direction). */
  lateralMm: number;
  /** Height of the cable centre above the tray floor, mm. */
  verticalMm: number;
  /** Stacking row, 0 = bottom. */
  row: number;
  index: number;
  diameterMm: number;
}

/** Side-by-side slots for every cable in a tray, packed left to right and stacked when the width is exceeded. */
export function trayCableSlots(project: Project, trayId: Id): Map<Id, CableSlot> {
  const out = new Map<Id, CableSlot>();
  const tray = project.trays.find((t) => t.id === trayId);
  if (!tray) return out;
  const idx = indexProject(project);
  const ids = cablesInTray(project, trayId);
  const rows: { ids: Id[]; widths: number[]; width: number; height: number }[] = [];
  for (const id of ids) {
    const d = cableDiameterMm(idx, idx.link(id));
    let row = rows[rows.length - 1];
    if (!row || (row.ids.length > 0 && row.width + CABLE_GAP_MM + d > tray.widthMm)) {
      row = { ids: [], widths: [], width: 0, height: 0 };
      rows.push(row);
    }
    row.width += (row.ids.length ? CABLE_GAP_MM : 0) + d;
    row.height = Math.max(row.height, d);
    row.ids.push(id);
    row.widths.push(d);
  }
  let vertical = 0;
  let index = 0;
  rows.forEach((row, r) => {
    let cursor = -row.width / 2;
    row.ids.forEach((id, i) => {
      const d = row.widths[i]!;
      out.set(id, { lateralMm: cursor + d / 2, verticalMm: vertical + d / 2, row: r, index: index++, diameterMm: d });
      cursor += d + CABLE_GAP_MM;
    });
    vertical += row.height + CABLE_GAP_MM;
  });
  return out;
}

/** Slot of one cable in a tray, or null when it does not ride that tray. */
export function cableOffsetInTray(project: Project, trayId: Id, linkId: Id): CableSlot | null {
  return trayCableSlots(project, trayId).get(linkId) ?? null;
}
