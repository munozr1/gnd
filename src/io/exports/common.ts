/**
 * Shared readers for the exporters: how a link end, a cable and a length are
 * described in the lists. Pure functions over a Project; nothing here touches
 * the DOM.
 */
import { indexProject, type ProjectIndex } from '@/model/query';
import { sheetPath } from '@/model/schematic/hierarchy';
import { linkLengthM, type LinkLength } from '@/model/routing/length';
import { routePath3d } from '@/model/routing/path3d';
import type { CableDef, Face, Id, Link, LinkEnd, Project, RoutingLayer } from '@/model/types';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** 'R2' < 'R10'. */
export const naturalCompare = (a: string, b: string): number => collator.compare(a, b);

/** File-name safe slug of a display name. */
export const fileSlug = (name: string): string =>
  name
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'project';

/** ISO date (yyyy-mm-dd) used in title blocks. */
export const isoDate = (d: Date = new Date()): string => d.toISOString().slice(0, 10);

export interface EndInfo {
  componentId: Id;
  ref: string;
  port: string;
  lane: number | null;
  /** 'eth1/49', or 'eth1/49.2' for a breakout lane. */
  portLabel: string;
  /** Transceiver name, 'integrated' for a DAC / AOC end without a pluggable, '' when none. */
  optic: string;
  opticId: string | null;
  /** Rack name, '' when the component is unplaced. */
  rack: string;
  rackId: Id | null;
  /** Bottom U of the device, null when unplaced. */
  u: number | null;
  /** 'U41' or 'U41-42' for a multi-U device; '' when unplaced. */
  uLabel: string;
  face: Face | null;
  /** 'Root / Pod A'. */
  sheet: string;
}

export function endInfo(project: Project, link: Link, end: LinkEnd, idx: ProjectIndex = indexProject(project)): EndInfo {
  return portInfo(project, end, idx, idx.cableOf(link));
}

/** `endInfo` for a port that no link names (a cable leg): `cableDef` only decides whether an empty cage reads 'integrated'. */
export function portInfo(project: Project, end: LinkEnd, idx: ProjectIndex = indexProject(project), cableDef?: CableDef): EndInfo {
  const c = idx.component(end.componentId);
  const ref = c?.ref ?? end.componentId;
  const lane = end.lane ?? null;
  const portLabel = lane === null ? end.portId : `${end.portId}.${lane}`;
  const assigned = c ? idx.catalog.transceiver(c.optics[end.portId]) : undefined;
  const optic = assigned ? assigned.name : cableDef?.integrated ? 'integrated' : '';
  const placement = c ? idx.placement(c.id) : undefined;
  const rack = placement?.rackId ? idx.rack(placement.rackId) : undefined;
  const u = rack && placement?.uPosition !== null && placement?.uPosition !== undefined ? placement.uPosition : null;
  const heightU = c ? idx.heightUOf(c) : 1;
  const uLabel = u === null ? '' : heightU > 1 ? `U${u}-${u + heightU - 1}` : `U${u}`;
  return {
    componentId: end.componentId,
    ref,
    port: end.portId,
    lane,
    portLabel,
    optic,
    opticId: assigned?.id ?? null,
    rack: rack?.name ?? '',
    rackId: rack?.id ?? null,
    u,
    uLabel,
    face: u === null ? null : (placement?.face ?? 'front'),
    sheet: c ? sheetPath(project, c.sch.sheetId) : '',
  };
}

/** 'SW1:eth1/49' (with lane suffix). */
export const endLabel = (e: Pick<EndInfo, 'ref' | 'portLabel'>): string => `${e.ref}:${e.portLabel}`;

/** Display label of a link: its label, else 'A — B'. */
export function linkLabel(project: Project, link: Link, idx: ProjectIndex = indexProject(project)): string {
  return idx.linkLabel(link);
}

export function cableName(link: Link, idx: ProjectIndex): string {
  return idx.cableOf(link)?.name ?? '';
}

/** Distinct sheet paths of a link's ends, A first. */
export function linkSheets(project: Project, link: Link, idx: ProjectIndex = indexProject(project)): string[] {
  const out: string[] = [];
  for (const end of [link.a, link.b]) {
    const c = idx.component(end.componentId);
    if (!c) continue;
    const s = sheetPath(project, c.sch.sheetId);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Whether a link is realised by an installed cable that still exists (the lists fold such links into the cable's rows). */
export function ownedByCable(link: Link, idx: ProjectIndex): boolean {
  return link.cableId !== undefined && idx.cable(link.cableId) !== undefined;
}

/** `sortedLinks` without the links installed cables own — the rows the plain-link lists print. */
export function plainLinks(project: Project, idx: ProjectIndex = indexProject(project)): Link[] {
  return sortedLinks(project, idx).filter((l) => !ownedByCable(l, idx));
}

/** Links in a stable, human order: by label (natural), then by the A end. */
export function sortedLinks(project: Project, idx: ProjectIndex = indexProject(project)): Link[] {
  return [...project.links].sort((x, y) => {
    const byLabel = naturalCompare(idx.linkLabel(x), idx.linkLabel(y));
    if (byLabel !== 0) return byLabel;
    const byA = naturalCompare(idx.endLabel(x.a), idx.endLabel(y.a));
    return byA !== 0 ? byA : naturalCompare(x.id, y.id);
  });
}

export const LAYER_ARROW = '→';

const LAYER_NAME: Record<RoutingLayer, string> = { overhead: 'overhead', underfloor: 'underfloor', 'in-rack': 'in-rack' };

/**
 * Layers a cable passes through in order, duplicates collapsed:
 * 'in-rack→overhead→in-rack'. From the full 3D path when it resolves, else
 * from the route's own segments; '' for an unrouted link.
 */
export function layerPath(project: Project, linkId: Id): string {
  const route = project.routes[linkId];
  if (!route) return '';
  const path = routePath3d(project, linkId);
  const layers: RoutingLayer[] = path
    ? path.segmentsByLayer.map((s) => s.layer)
    : route.segments.filter((s) => s.points.length > 0).map((s) => s.layer);
  const collapsed: RoutingLayer[] = [];
  for (const l of layers) if (collapsed[collapsed.length - 1] !== l) collapsed.push(l);
  return collapsed.map((l) => LAYER_NAME[l]).join(LAYER_ARROW);
}

export interface LengthInfo {
  /** Standard (stock) length in metres, or null when an end is unplaced. */
  standardM: number | null;
  /** 'routed' | 'estimated' | '' (unknown). */
  basis: 'routed' | 'estimated' | '';
  detail: LinkLength | null;
}

export function lengthInfo(project: Project, linkId: Id): LengthInfo {
  const detail = linkLengthM(project, linkId);
  if (!detail) return { standardM: null, basis: '', detail: null };
  return { standardM: detail.standardM, basis: detail.est ? 'estimated' : 'routed', detail };
}

/** Metres for a CSV cell: integers stay integers, otherwise two decimals. */
export function formatM(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return '';
  return Number.isInteger(m) ? String(m) : m.toFixed(2);
}
