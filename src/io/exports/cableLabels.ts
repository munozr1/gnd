/**
 * Cable labels for label printers: two rows per cable, one for each end,
 * reading 'this end → far end' so the tech at either rack sees where the
 * cable goes.
 */
import { indexProject } from '@/model/query';
import type { Project } from '@/model/types';
import { endInfo, endLabel, lengthInfo, linkLabel, sortedLinks, type EndInfo } from './common';
import { toCsv, type CsvCell } from './csv';

export const LABEL_ARROW = '→';

export interface CableLabelRow {
  linkId: string;
  /** Link label ('FAB1') or the derived name. */
  cable: string;
  end: 'A' | 'B';
  /** 'SW1:eth1/49 → SW3:eth1/1' */
  text: string;
  from: string;
  fromLocation: string;
  to: string;
  toLocation: string;
  lengthM: number | null;
}

export const CABLE_LABELS_HEADER = ['Cable', 'End', 'Label', 'From', 'From location', 'To', 'To location', 'Length (m)'] as const;

const location = (e: EndInfo): string => (e.rack ? `${e.rack} ${e.uLabel}` : '');

export function cableLabelRows(project: Project): CableLabelRow[] {
  const idx = indexProject(project);
  const out: CableLabelRow[] = [];
  for (const link of sortedLinks(project, idx)) {
    const a = endInfo(project, link, link.a, idx);
    const b = endInfo(project, link, link.b, idx);
    const cable = linkLabel(project, link, idx);
    const lengthM = lengthInfo(project, link.id).standardM;
    const row = (end: 'A' | 'B', near: EndInfo, far: EndInfo): CableLabelRow => ({
      linkId: link.id,
      cable,
      end,
      text: `${endLabel(near)} ${LABEL_ARROW} ${endLabel(far)}`,
      from: endLabel(near),
      fromLocation: location(near),
      to: endLabel(far),
      toLocation: location(far),
      lengthM,
    });
    out.push(row('A', a, b), row('B', b, a));
  }
  return out;
}

export function cableLabelsCsv(project: Project): string {
  const rows: CsvCell[][] = [[...CABLE_LABELS_HEADER]];
  for (const r of cableLabelRows(project)) {
    rows.push([r.cable, r.end, r.text, r.from, r.fromLocation, r.to, r.toLocation, r.lengthM]);
  }
  return toCsv(rows);
}
