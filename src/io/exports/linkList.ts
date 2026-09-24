/**
 * Link list: the datacenter netlist. One row per link with both ends
 * (ref / port / lane / optic), the cable and the sheet(s) it lives on.
 */
import { indexProject } from '@/model/query';
import type { Project } from '@/model/types';
import { cableName, endInfo, linkSheets, sortedLinks } from './common';
import { toCsv, type CsvCell } from './csv';

export interface LinkListEnd {
  ref: string;
  port: string;
  lane: number | null;
  optic: string;
}

export interface LinkListRow {
  id: string;
  label: string;
  a: LinkListEnd;
  b: LinkListEnd;
  cable: string;
  cableId: string | null;
  sheets: string[];
}

export const LINK_LIST_HEADER = [
  'Link',
  'Label',
  'A ref',
  'A port',
  'A lane',
  'A optic',
  'B ref',
  'B port',
  'B lane',
  'B optic',
  'Cable',
  'Sheets',
] as const;

export function linkListRows(project: Project): LinkListRow[] {
  const idx = indexProject(project);
  return sortedLinks(project, idx).map((link) => {
    const a = endInfo(project, link, link.a, idx);
    const b = endInfo(project, link, link.b, idx);
    return {
      id: link.id,
      label: link.label ?? '',
      a: { ref: a.ref, port: a.port, lane: a.lane, optic: a.optic },
      b: { ref: b.ref, port: b.port, lane: b.lane, optic: b.optic },
      cable: cableName(link, idx),
      cableId: link.cableDefId,
      sheets: linkSheets(project, link, idx),
    };
  });
}

export function linkListCsv(project: Project): string {
  const rows: CsvCell[][] = [[...LINK_LIST_HEADER]];
  for (const r of linkListRows(project)) {
    rows.push([
      r.id,
      r.label,
      r.a.ref,
      r.a.port,
      r.a.lane,
      r.a.optic,
      r.b.ref,
      r.b.port,
      r.b.lane,
      r.b.optic,
      r.cable,
      r.sheets.join('; '),
    ]);
  }
  return toCsv(rows);
}

export interface LinkListJson {
  format: 'dceda-link-list';
  version: 1;
  project: { id: string; name: string; rev: string };
  links: LinkListRow[];
}

export function linkListJsonObject(project: Project): LinkListJson {
  return {
    format: 'dceda-link-list',
    version: 1,
    project: { id: project.id, name: project.name, rev: project.rev },
    links: linkListRows(project),
  };
}

export function linkListJson(project: Project): string {
  return JSON.stringify(linkListJsonObject(project), null, 2) + '\n';
}
