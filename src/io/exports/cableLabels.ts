/**
 * Cable labels for label printers: two rows per plain-link cable, one for
 * each end, reading 'this end → far end' so the tech at either rack sees
 * where the cable goes. An installed cable (trunk or cord) gets one row per
 * jacket end ('CBL1 A SW1:eth1/50 → PP1:f1–f4') and one per leg end
 * ('CBL1 B1 → PP1:f1'), so every connector at a furcation is identified.
 */
import { indexProject } from '@/model/query';
import type { Project } from '@/model/types';
import { installedCables, type CableSideInfo, type InstalledCable } from './cableInstances';
import { endInfo, endLabel, lengthInfo, linkLabel, plainLinks, type EndInfo } from './common';
import { toCsv, type CsvCell } from './csv';

export const LABEL_ARROW = '→';

export type CableLabelKind = 'link' | 'jacket' | 'leg';

export interface CableLabelRow {
  /** The link id, or the cable id for jacket / leg rows. */
  linkId: string;
  kind: CableLabelKind;
  /** Link label ('FAB1') or the derived name; the cable label ('CBL1') for installed cables. */
  cable: string;
  /** 'A' / 'B' for a link or jacket end; side + leg label ('B1', 'AA') for a leg end. */
  end: string;
  /** 'SW1:eth1/49 → SW3:eth1/1'. */
  text: string;
  from: string;
  fromLocation: string;
  to: string;
  toLocation: string;
  lengthM: number | null;
}

export const CABLE_LABELS_HEADER = ['Cable', 'End', 'Label', 'From', 'From location', 'To', 'To location', 'Length (m)', 'Kind'] as const;

const location = (e: EndInfo | null): string => (e?.rack ? `${e.rack} ${e.uLabel}` : '');

function cableRows(c: InstalledCable): CableLabelRow[] {
  const out: CableLabelRow[] = [];
  const lengthM = c.length.lengthM;
  const jacket = (near: CableSideInfo, far: CableSideInfo): CableLabelRow => ({
    linkId: c.cable.id,
    kind: 'jacket',
    cable: c.cable.label,
    end: near.side,
    text: `${c.cable.label} ${near.side} ${near.ports} ${LABEL_ARROW} ${far.ports}`,
    from: near.ports,
    fromLocation: location(near.first),
    to: far.ports,
    toLocation: location(far.first),
    lengthM,
  });
  out.push(jacket(c.sideA, c.sideB), jacket(c.sideB, c.sideA));
  for (const leg of c.legs) {
    const far = leg.side === 'A' ? c.sideB : c.sideA;
    out.push({
      linkId: c.cable.id,
      kind: 'leg',
      cable: c.cable.label,
      end: `${leg.side}${leg.label}`,
      text: `${c.cable.label} ${leg.side}${leg.label} ${LABEL_ARROW} ${leg.port || 'unassigned'}`,
      from: leg.port,
      fromLocation: location(leg.end),
      to: far.ports,
      toLocation: location(far.first),
      lengthM,
    });
  }
  return out;
}

export function cableLabelRows(project: Project): CableLabelRow[] {
  const idx = indexProject(project);
  const out: CableLabelRow[] = [];
  for (const link of plainLinks(project, idx)) {
    const a = endInfo(project, link, link.a, idx);
    const b = endInfo(project, link, link.b, idx);
    const cable = linkLabel(project, link, idx);
    const lengthM = lengthInfo(project, link.id).standardM;
    const row = (end: 'A' | 'B', near: EndInfo, far: EndInfo): CableLabelRow => ({
      linkId: link.id,
      kind: 'link',
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
  for (const c of installedCables(project, idx)) out.push(...cableRows(c));
  return out;
}

export function cableLabelsCsv(project: Project): string {
  const rows: CsvCell[][] = [[...CABLE_LABELS_HEADER]];
  for (const r of cableLabelRows(project)) {
    rows.push([r.cable, r.end, r.text, r.from, r.fromLocation, r.to, r.toLocation, r.lengthM, r.kind]);
  }
  return toCsv(rows);
}
