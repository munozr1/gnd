/**
 * Cable schedule: what the installers pull. One row per plain link with both
 * ends located physically (rack / U / ref / port / optic), the cable type,
 * the stock length (routed along the full pathway, or a Manhattan estimate
 * for unrouted links) and the layer path; then one row per installed cable
 * (label, definition, fibers, channels, kind, both sides, length, layers)
 * followed by one sub-row per leg (label, side, port, fibers carried,
 * channels). The links a cable owns are folded into its rows.
 */
import { indexProject } from '@/model/query';
import type { Project } from '@/model/types';
import { compactNumbers, installedCables, type CableLegInfo, type InstalledCable } from './cableInstances';
import { cableName, endInfo, layerPath, lengthInfo, linkLabel, plainLinks, type EndInfo } from './common';
import { toCsv, type CsvCell } from './csv';

export interface CableScheduleRow {
  id: string;
  label: string;
  a: EndInfo;
  b: EndInfo;
  cable: string;
  /** Stock length in metres, null when an end is unplaced. */
  lengthM: number | null;
  /** 'routed' | 'estimated' | ''. */
  basis: 'routed' | 'estimated' | '';
  /** 'in-rack→overhead→in-rack'; '' for unrouted links. */
  layerPath: string;
  routed: boolean;
  needsReview: boolean;
}

export interface CableScheduleLegRow {
  cableId: string;
  cableLabel: string;
  side: 'A' | 'B';
  /** 'A' / '1' … (the leg label), with the leg's connector. */
  label: string;
  connector: string;
  /** 'PP1:f1'; '' when unassigned. */
  port: string;
  end: EndInfo | null;
  /** '1-4, 9-12'. */
  positions: string;
  /** '1-4'. */
  channels: string;
}

export interface CableScheduleCableRow {
  id: string;
  label: string;
  /** Definition display name: '8F OM4 MPO-8 → 4×LC-duplex'. */
  cable: string;
  fiberCount: number | null;
  channels: number | null;
  kind: 'straight' | 'trunk' | '';
  sideA: string;
  sideB: string;
  /** First plugged leg of each side (where the side lands). */
  a: EndInfo | null;
  b: EndInfo | null;
  /** Port list of each side without the ref ('f1–f4'), for the port columns. */
  aPorts: string;
  bPorts: string;
  lengthM: number | null;
  basis: 'declared' | 'routed' | 'estimated' | '';
  layerPath: string;
  routed: boolean;
  needsReview: boolean;
  legs: CableScheduleLegRow[];
}

export const CABLE_SCHEDULE_HEADER = [
  'Label',
  'A rack',
  'A U',
  'A ref',
  'A port',
  'A optic',
  'B rack',
  'B U',
  'B ref',
  'B port',
  'B optic',
  'Cable',
  'Length (m)',
  'Length basis',
  'Layer path',
  'Needs review',
  'Row',
  'Fibers',
  'Channels',
  'Kind',
  'Side A',
  'Side B',
  'Leg',
  'Leg side',
  'Leg port',
  'Fibers carried',
  'Leg channels',
] as const;

/** Plain links only: the links installed cables own are reported under `cableScheduleCableRows`. */
export function cableScheduleRows(project: Project): CableScheduleRow[] {
  const idx = indexProject(project);
  return plainLinks(project, idx).map((link) => {
    const len = lengthInfo(project, link.id);
    const route = project.routes[link.id];
    return {
      id: link.id,
      label: linkLabel(project, link, idx),
      a: endInfo(project, link, link.a, idx),
      b: endInfo(project, link, link.b, idx),
      cable: cableName(link, idx),
      lengthM: len.standardM,
      basis: len.basis,
      layerPath: layerPath(project, link.id),
      routed: route !== undefined,
      needsReview: route?.needsReview === true,
    };
  });
}

const legRow = (c: InstalledCable, leg: CableLegInfo): CableScheduleLegRow => ({
  cableId: c.cable.id,
  cableLabel: c.cable.label,
  side: leg.side,
  label: leg.label,
  connector: leg.connector,
  port: leg.port,
  end: leg.end,
  positions: compactNumbers(leg.positions),
  channels: compactNumbers(leg.channels),
});

/** One row per installed cable (label order) with its leg sub-rows. */
export function cableScheduleCableRows(project: Project): CableScheduleCableRow[] {
  const idx = indexProject(project);
  return installedCables(project, idx).map((c) => {
    const route = project.routes[c.cable.id];
    return {
      id: c.cable.id,
      label: c.cable.label,
      cable: c.name,
      fiberCount: c.fiberCount,
      channels: c.channels,
      kind: c.kind,
      sideA: c.sideA.summary,
      sideB: c.sideB.summary,
      a: c.sideA.first,
      b: c.sideB.first,
      aPorts: c.sideA.portLabels,
      bPorts: c.sideB.portLabels,
      lengthM: c.length.lengthM,
      basis: c.length.basis,
      layerPath: layerPath(project, c.cable.id),
      routed: route !== undefined,
      needsReview: route?.needsReview === true,
      legs: c.legs.map((leg) => legRow(c, leg)),
    };
  });
}

const endCells = (e: EndInfo | null, port?: string): CsvCell[] =>
  e ? [e.rack, e.uLabel, e.ref, port ?? e.portLabel, e.optic] : ['', '', '', '', ''];

const blank = (n: number): CsvCell[] => Array.from({ length: n }, () => '');

const review = (routed: boolean, needsReview: boolean): string => (routed ? (needsReview ? 'yes' : 'no') : '');

export function cableScheduleCsv(project: Project): string {
  const rows: CsvCell[][] = [[...CABLE_SCHEDULE_HEADER]];
  for (const r of cableScheduleRows(project)) {
    rows.push([
      r.label,
      ...endCells(r.a),
      ...endCells(r.b),
      r.cable,
      r.lengthM,
      r.basis,
      r.layerPath,
      review(r.routed, r.needsReview),
      'link',
      ...blank(10),
    ]);
  }
  for (const c of cableScheduleCableRows(project)) {
    rows.push([
      c.label,
      ...endCells(c.a, c.aPorts),
      ...endCells(c.b, c.bPorts),
      c.cable,
      c.lengthM,
      c.basis,
      c.layerPath,
      review(c.routed, c.needsReview),
      'cable',
      c.fiberCount,
      c.channels,
      c.kind,
      c.sideA,
      c.sideB,
      ...blank(5),
    ]);
    for (const leg of c.legs) {
      const a = leg.side === 'A' ? leg.end : null;
      const b = leg.side === 'B' ? leg.end : null;
      rows.push([
        c.label,
        ...endCells(a),
        ...endCells(b),
        leg.connector,
        ...blank(4),
        'leg',
        ...blank(5),
        leg.label,
        leg.side,
        leg.port,
        leg.positions,
        leg.channels,
      ]);
    }
  }
  return toCsv(rows);
}
