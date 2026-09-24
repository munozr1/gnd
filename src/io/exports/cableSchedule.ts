/**
 * Cable schedule: what the installers pull. One row per link with both ends
 * located physically (rack / U / ref / port / optic), the cable type, the
 * stock length (routed along the full pathway, or a Manhattan estimate for
 * unrouted links) and the layer path.
 */
import { indexProject } from '@/model/query';
import type { Project } from '@/model/types';
import { cableName, endInfo, layerPath, lengthInfo, linkLabel, sortedLinks, type EndInfo } from './common';
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
] as const;

export function cableScheduleRows(project: Project): CableScheduleRow[] {
  const idx = indexProject(project);
  return sortedLinks(project, idx).map((link) => {
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

export function cableScheduleCsv(project: Project): string {
  const rows: CsvCell[][] = [[...CABLE_SCHEDULE_HEADER]];
  for (const r of cableScheduleRows(project)) {
    rows.push([
      r.label,
      r.a.rack,
      r.a.uLabel,
      r.a.ref,
      r.a.portLabel,
      r.a.optic,
      r.b.rack,
      r.b.uLabel,
      r.b.ref,
      r.b.portLabel,
      r.b.optic,
      r.cable,
      r.lengthM,
      r.basis,
      r.layerPath,
      r.routed ? (r.needsReview ? 'yes' : 'no') : '',
    ]);
  }
  return toCsv(rows);
}
