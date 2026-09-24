/**
 * Bill of materials. Sections: racks by size, devices by model, optics by
 * type, cables by type × standard length, trays by kind (with total metres)
 * and rack accessories by type. One flat CSV (Section column) so it opens as
 * a single table; `bomSections` gives the structured form.
 */
import { polylineLength } from '@/model/geometry';
import { indexProject } from '@/model/query';
import type { AccessoryDef, Project, Rack, RackAccessory, RackAccessoryType, Tray, TrayKind } from '@/model/types';
import { formatM, lengthInfo, naturalCompare } from './common';
import { toCsv, type CsvCell } from './csv';

export interface BomRow {
  item: string;
  quantity: number;
  /** Per-unit stock length (cables) or total run length (trays), metres. */
  lengthM: number | null;
  notes: string;
}

export type BomSectionId = 'racks' | 'devices' | 'optics' | 'cables' | 'trays' | 'accessories';

export interface BomSection {
  id: BomSectionId;
  title: string;
  rows: BomRow[];
}

export const BOM_HEADER = ['Section', 'Item', 'Quantity', 'Length (m)', 'Notes'] as const;

const MAX_LISTED_NAMES = 40;

/** 'A01, A02, … (+12 more)' */
function listNames(names: readonly string[]): string {
  const sorted = [...names].sort(naturalCompare);
  if (sorted.length <= MAX_LISTED_NAMES) return sorted.join(', ');
  return `${sorted.slice(0, MAX_LISTED_NAMES).join(', ')} (+${sorted.length - MAX_LISTED_NAMES} more)`;
}

const TRAY_KIND_LABEL: Record<TrayKind, string> = {
  'fiber-runway': 'Fiber runway',
  ladder: 'Ladder rack',
  basket: 'Wire basket',
};

export const ACCESSORY_TYPE_LABEL: Record<RackAccessoryType, string> = {
  vcm: 'Vertical cable manager',
  hcm: 'Horizontal cable manager',
  'fiber-enclosure': 'Fiber enclosure',
  'top-entry': 'Rack top entry',
};

/** Catalog accessory matching an instance's type and size, if any. */
export function matchAccessoryDef(defs: readonly AccessoryDef[], acc: RackAccessory): AccessoryDef | undefined {
  return defs.find(
    (d) =>
      d.type === acc.type &&
      (d.widthMm === undefined || acc.widthMm === undefined || d.widthMm === acc.widthMm) &&
      (d.heightU === undefined || acc.heightU === undefined || d.heightU === acc.heightU),
  );
}

function racksSection(project: Project): BomSection {
  const defs = indexProject(project).catalog.catalog.racks;
  const groups = new Map<string, { racks: Rack[]; item: string }>();
  for (const r of project.racks) {
    const key = `${r.heightU}|${r.widthMm}|${r.depthMm}`;
    let g = groups.get(key);
    if (!g) {
      const def = defs.find((d) => d.heightU === r.heightU && d.widthMm === r.widthMm && d.depthMm === r.depthMm);
      g = { racks: [], item: def?.name ?? `Rack ${r.heightU}U ${r.widthMm}×${r.depthMm} mm` };
      groups.set(key, g);
    }
    g.racks.push(r);
  }
  const rows = [...groups.values()]
    .map((g) => ({ item: g.item, quantity: g.racks.length, lengthM: null, notes: listNames(g.racks.map((r) => r.name)) }))
    .sort((a, b) => naturalCompare(a.item, b.item));
  return { id: 'racks', title: 'Racks', rows };
}

function devicesSection(project: Project): BomSection {
  const idx = indexProject(project);
  const groups = new Map<string, { item: string; notes: string; refs: string[] }>();
  for (const c of project.components) {
    const fp = idx.footprintOf(c);
    const key = fp ? fp.id : `unassigned:${c.symbolDefId}`;
    let g = groups.get(key);
    if (!g) {
      const symbol = idx.symbolOf(c);
      g = fp
        ? { item: fp.vendor ? `${fp.vendor} ${fp.model}` : fp.model, notes: `${fp.kind}, ${fp.heightU}U`, refs: [] }
        : { item: `Unassigned model (${symbol?.name ?? c.symbolDefId})`, notes: 'no physical model assigned', refs: [] };
      groups.set(key, g);
    }
    g.refs.push(c.ref);
  }
  const rows = [...groups.values()]
    .map((g) => ({ item: g.item, quantity: g.refs.length, lengthM: null, notes: `${g.notes}; ${listNames(g.refs)}` }))
    .sort((a, b) => naturalCompare(a.item, b.item));
  return { id: 'devices', title: 'Devices', rows };
}

function opticsSection(project: Project): BomSection {
  const idx = indexProject(project);
  const counts = new Map<string, number>();
  for (const c of project.components) {
    for (const opticId of Object.values(c.optics)) counts.set(opticId, (counts.get(opticId) ?? 0) + 1);
  }
  const rows = [...counts.entries()]
    .map(([id, quantity]) => {
      const x = idx.catalog.transceiver(id);
      return {
        item: x?.name ?? id,
        quantity,
        lengthM: null,
        notes: x ? `${x.formFactor}, ${x.speedGbps}G, ${x.media}, ${x.connector}, reach ${x.reachM} m` : 'unknown transceiver',
      };
    })
    .sort((a, b) => naturalCompare(a.item, b.item));
  return { id: 'optics', title: 'Optics', rows };
}

function cablesSection(project: Project): BomSection {
  const idx = indexProject(project);
  const groups = new Map<string, { item: string; media: string; lengthM: number | null; routed: number; estimated: number; unknown: number }>();
  for (const link of project.links) {
    const cable = idx.cableOf(link);
    const len = lengthInfo(project, link.id);
    const key = `${cable?.id ?? 'unassigned'}|${len.standardM ?? 'unknown'}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        item: cable?.name ?? 'Unassigned cable',
        media: cable?.media ?? '',
        lengthM: len.standardM,
        routed: 0,
        estimated: 0,
        unknown: 0,
      };
      groups.set(key, g);
    }
    if (len.basis === 'routed') g.routed++;
    else if (len.basis === 'estimated') g.estimated++;
    else g.unknown++;
  }
  const rows = [...groups.values()]
    .map((g) => {
      const parts: string[] = [];
      if (g.media) parts.push(g.media);
      if (g.routed) parts.push(`${g.routed} routed`);
      if (g.estimated) parts.push(`${g.estimated} estimated`);
      if (g.unknown) parts.push(`${g.unknown} with an unplaced end (length unknown)`);
      return { item: g.item, quantity: g.routed + g.estimated + g.unknown, lengthM: g.lengthM, notes: parts.join('; ') };
    })
    .sort((a, b) => naturalCompare(a.item, b.item) || (a.lengthM ?? Infinity) - (b.lengthM ?? Infinity));
  return { id: 'cables', title: 'Cables', rows };
}

function traysSection(project: Project): BomSection {
  const defs = indexProject(project).catalog.catalog.trays;
  const groups = new Map<string, { item: string; trays: Tray[]; metres: number }>();
  for (const t of project.trays) {
    const key = `${t.kind}|${t.widthMm}`;
    let g = groups.get(key);
    if (!g) {
      const def = defs.find((d) => d.kind === t.kind && d.widthMm === t.widthMm);
      g = { item: def?.name ?? `${TRAY_KIND_LABEL[t.kind]} ${t.widthMm} mm`, trays: [], metres: 0 };
      groups.set(key, g);
    }
    g.trays.push(t);
    g.metres += polylineLength(t.points) / 1000;
  }
  const rows = [...groups.values()]
    .map((g) => {
      const layers = [...new Set(g.trays.map((t) => t.layer))].join(', ');
      const fittings = g.trays.reduce((n, t) => n + t.fittings.length, 0);
      return {
        item: g.item,
        quantity: g.trays.length,
        lengthM: Math.round(g.metres * 100) / 100,
        notes: `${g.trays.length === 1 ? 'run' : 'runs'} totalling ${formatM(Math.round(g.metres * 100) / 100)} m, ${layers}; ${fittings} fittings`,
      };
    })
    .sort((a, b) => naturalCompare(a.item, b.item));
  return { id: 'trays', title: 'Trays', rows };
}

function accessoriesSection(project: Project): BomSection {
  const defs = indexProject(project).catalog.catalog.accessories;
  const groups = new Map<string, { item: string; notes: string; count: number }>();
  for (const acc of project.accessories) {
    const key = `${acc.type}|${acc.widthMm ?? ''}|${acc.heightU ?? ''}`;
    let g = groups.get(key);
    if (!g) {
      const def = matchAccessoryDef(defs, acc);
      const size = [acc.widthMm !== undefined ? `${acc.widthMm} mm wide` : '', acc.heightU !== undefined ? `${acc.heightU}U` : '']
        .filter(Boolean)
        .join(', ');
      g = { item: def?.name ?? `${ACCESSORY_TYPE_LABEL[acc.type]}${size ? ` ${size}` : ''}`, notes: size, count: 0 };
      groups.set(key, g);
    }
    g.count++;
  }
  const rows = [...groups.values()]
    .map((g) => ({ item: g.item, quantity: g.count, lengthM: null, notes: g.notes }))
    .sort((a, b) => naturalCompare(a.item, b.item));
  return { id: 'accessories', title: 'Rack accessories', rows };
}

export function bomSections(project: Project): BomSection[] {
  return [
    racksSection(project),
    devicesSection(project),
    opticsSection(project),
    cablesSection(project),
    traysSection(project),
    accessoriesSection(project),
  ];
}

export function bomCsv(project: Project): string {
  const rows: CsvCell[][] = [[...BOM_HEADER]];
  for (const section of bomSections(project)) {
    for (const r of section.rows) rows.push([section.title, r.item, r.quantity, formatM(r.lengthM), r.notes]);
  }
  return toCsv(rows);
}
