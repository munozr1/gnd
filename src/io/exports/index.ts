/**
 * Export registry: every File ▸ Export entry as a pure generator plus the
 * delivery mode (download, or open for print-to-PDF). `runExport` is what the
 * menu calls; the generators are re-exported for tests and other callers.
 */
import { indexProject } from '@/model/query';
import type { Id, Project } from '@/model/types';
import { bomCsv } from './bom';
import { cableLabelsCsv } from './cableLabels';
import { cableScheduleCsv } from './cableSchedule';
import { fileSlug } from './common';
import { downloadBlob, openBlobInNewTab } from './download';
import { linkListCsv, linkListJson } from './linkList';
import { rackElevationFileName, rackElevationSheetsSvg, rackElevationSheetSvg, rackSheetsHtml } from './rackElevationSvg';
import { capture3dPng } from './screenshot3d';
import { schematicFileName, schematicSheetsHtml, schematicSheetsSvg, schematicSvg } from './schematicSvg';

export * from './csv';
export * from './common';
export * from './linkList';
export * from './cableSchedule';
export * from './bom';
export * from './cableLabels';
export * from './svg';
export * from './print';
export * from './rackElevationSvg';
export * from './schematicSvg';
export * from './screenshot3d';
export * from './download';

export type ExportGroup = 'Lists' | 'Sheets' | '3D';

/** What the caller knows about the UI when running an export. All optional. */
export interface ExportContext {
  /** Sheet to plot for the single-sheet schematic export (default: root sheet). */
  activeSheetId?: Id;
  /** Racks to plot (selected / shown in elevation); default: all racks. */
  rackIds?: readonly Id[];
  /** Title-block date, yyyy-mm-dd (default: today). */
  date?: string;
}

export interface ExportOutput {
  filename: string;
  blob: Blob;
  /** 'download' (default) saves the file; 'print' opens it in a new tab for print-to-PDF. */
  mode?: 'download' | 'print';
}

export interface ExportEntry {
  id: string;
  name: string;
  group: ExportGroup;
  description: string;
  run(project: Project, ctx?: ExportContext): ExportOutput | Promise<ExportOutput>;
}

const csv = (text: string): Blob => new Blob([text], { type: 'text/csv;charset=utf-8' });
const svg = (text: string): Blob => new Blob([text], { type: 'image/svg+xml;charset=utf-8' });
const html = (text: string): Blob => new Blob([text], { type: 'text/html;charset=utf-8' });
const json = (text: string): Blob => new Blob([text], { type: 'application/json' });

const base = (project: Project): string => fileSlug(project.name);

function racksFor(project: Project, ctx?: ExportContext): Id[] | undefined {
  if (!ctx?.rackIds || ctx.rackIds.length === 0) return undefined;
  const idx = indexProject(project);
  const ids = ctx.rackIds.filter((id) => idx.rack(id) !== undefined);
  return ids.length ? ids : undefined;
}

export const exportRegistry: readonly ExportEntry[] = [
  {
    id: 'link-list-csv',
    name: 'Link list (CSV)',
    group: 'Lists',
    description: 'Every link with both ends, optics, cable and sheet — the netlist.',
    run: (p) => ({ filename: `${base(p)}-link-list.csv`, blob: csv(linkListCsv(p)) }),
  },
  {
    id: 'link-list-json',
    name: 'Link list (JSON)',
    group: 'Lists',
    description: 'The link list as JSON for scripts.',
    run: (p) => ({ filename: `${base(p)}-link-list.json`, blob: json(linkListJson(p)) }),
  },
  {
    id: 'cable-schedule-csv',
    name: 'Cable schedule (CSV)',
    group: 'Lists',
    description: 'Rack / U / port at both ends, cable type, stock length and layer path per cable.',
    run: (p) => ({ filename: `${base(p)}-cable-schedule.csv`, blob: csv(cableScheduleCsv(p)) }),
  },
  {
    id: 'bom-csv',
    name: 'BOM (CSV)',
    group: 'Lists',
    description: 'Racks, devices, optics, cables by length, trays and accessories.',
    run: (p) => ({ filename: `${base(p)}-bom.csv`, blob: csv(bomCsv(p)) }),
  },
  {
    id: 'cable-labels-csv',
    name: 'Cable labels (CSV)',
    group: 'Lists',
    description: 'Two label rows per cable (one per end) for label printers.',
    run: (p) => ({ filename: `${base(p)}-cable-labels.csv`, blob: csv(cableLabelsCsv(p)) }),
  },
  {
    id: 'rack-elevation-svg',
    name: 'Rack elevation (SVG)',
    group: 'Sheets',
    description: 'Front + rear of the selected rack (or every rack, stacked) as SVG.',
    run: (p, ctx) => {
      const ids = racksFor(p, ctx);
      const date = ctx?.date;
      if (ids && ids.length === 1) {
        const rack = indexProject(p).rack(ids[0]!)!;
        return { filename: rackElevationFileName(p, rack), blob: svg(rackElevationSheetSvg(p, rack.id, { date })) };
      }
      return { filename: `${base(p)}-rack-elevations.svg`, blob: svg(rackElevationSheetsSvg(p, { rackIds: ids, date })) };
    },
  },
  {
    id: 'rack-elevation-pdf',
    name: 'Rack elevation sheets (print / PDF)…',
    group: 'Sheets',
    description: 'One page per rack, front and rear, opened in a new tab for print-to-PDF.',
    run: (p, ctx) => ({
      filename: `${base(p)}-rack-elevations.html`,
      blob: html(rackSheetsHtml(p, { rackIds: racksFor(p, ctx), date: ctx?.date })),
      mode: 'print',
    }),
  },
  {
    id: 'schematic-svg',
    name: 'Schematic plot — current sheet (SVG)',
    group: 'Sheets',
    description: 'The active sheet as SVG with a title block.',
    run: (p, ctx) => {
      const sheet = p.sheets.find((s) => s.id === ctx?.activeSheetId) ?? p.sheets.find((s) => s.parentId === null) ?? p.sheets[0];
      if (!sheet) throw new Error('The project has no sheets');
      return { filename: schematicFileName(p, sheet), blob: svg(schematicSvg(p, sheet.id, { date: ctx?.date })) };
    },
  },
  {
    id: 'schematic-all-svg',
    name: 'Schematic plot — all sheets (SVG)',
    group: 'Sheets',
    description: 'Every sheet, one page each, stacked in one SVG.',
    run: (p, ctx) => ({ filename: schematicFileName(p), blob: svg(schematicSheetsSvg(p, { date: ctx?.date })) }),
  },
  {
    id: 'schematic-pdf',
    name: 'Schematic plot — all sheets (print / PDF)…',
    group: 'Sheets',
    description: 'Every sheet on its own page, opened in a new tab for print-to-PDF.',
    run: (p, ctx) => ({ filename: `${base(p)}-schematic.html`, blob: html(schematicSheetsHtml(p, { date: ctx?.date })), mode: 'print' }),
  },
  {
    id: 'screenshot-3d-png',
    name: '3D screenshot (PNG)',
    group: '3D',
    description: 'The current 3D view as a PNG (open the 3D tab first).',
    run: async (p) => ({ filename: `${base(p)}-3d.png`, blob: await capture3dPng() }),
  },
];

export const EXPORT_GROUPS: readonly ExportGroup[] = ['Lists', 'Sheets', '3D'];

export function exportById(id: string): ExportEntry | undefined {
  return exportRegistry.find((e) => e.id === id);
}

/** Download the file, or open it in a new tab for print mode. */
export function deliverExport(output: ExportOutput): void {
  if (output.mode === 'print') openBlobInNewTab(output.blob);
  else downloadBlob(output.blob, output.filename);
}

/** Generate one export and deliver it. Throws on unknown ids and generator errors. */
export async function runExport(id: string, project: Project, ctx?: ExportContext): Promise<ExportOutput> {
  const entry = exportById(id);
  if (!entry) throw new Error(`Unknown export "${id}"`);
  const output = await entry.run(project, ctx);
  deliverExport(output);
  return output;
}
