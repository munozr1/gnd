/**
 * File > Export entries. The exporter module ('@/io/exports') is built in a
 * later milestone, so it is resolved through `import.meta.glob`: a lazy
 * dynamic import that also tolerates the module not existing yet.
 */
import type { Project } from '@/model/types';
import { store } from '@/store';
import { toast } from '@/ui/Toast';
import { errorMessage } from './format';

export interface ExportKind {
  id: string;
  label: string;
  /** Named export expected on '@/io/exports' (called with the project). */
  fn: string;
}

export const EXPORT_KINDS: readonly ExportKind[] = [
  { id: 'link-list-csv', label: 'Link list (CSV)', fn: 'exportLinkListCsv' },
  { id: 'link-list-json', label: 'Link list (JSON)', fn: 'exportLinkListJson' },
  { id: 'cable-schedule-csv', label: 'Cable schedule (CSV)', fn: 'exportCableSchedule' },
  { id: 'bom-csv', label: 'BOM (CSV)', fn: 'exportBom' },
  { id: 'cable-labels-csv', label: 'Cable labels (CSV)', fn: 'exportCableLabels' },
  { id: 'rack-elevations-svg', label: 'Rack elevation sheets (SVG)', fn: 'exportRackElevations' },
  { id: 'schematic-plot-svg', label: 'Schematic plot (SVG)', fn: 'exportSchematicPlot' },
];

type ExportsModule = Record<string, unknown>;
type ExportFn = (project: Project) => unknown;
type GenericExportFn = (kind: string, project: Project) => unknown;

const candidates = import.meta.glob<ExportsModule>(['/src/io/exports/index.ts', '/src/io/exports.ts']);

export const NOT_AVAILABLE_MESSAGE = 'Exports not available yet';

export function exportsModuleAvailable(): boolean {
  return Object.keys(candidates).length > 0;
}

/** Run one export; every failure surfaces as a toast and resolves false. */
export async function runExport(kind: ExportKind): Promise<boolean> {
  const loader = candidates['/src/io/exports/index.ts'] ?? candidates['/src/io/exports.ts'];
  if (!loader) {
    toast.warning(NOT_AVAILABLE_MESSAGE);
    return false;
  }
  try {
    const mod = await loader();
    const project = store.getState().project;
    const generic = mod['runExport'] ?? mod['downloadExport'];
    if (typeof generic === 'function') {
      await (generic as GenericExportFn)(kind.id, project);
    } else {
      const fn = mod[kind.fn];
      if (typeof fn !== 'function') {
        toast.warning(`${kind.label}: ${NOT_AVAILABLE_MESSAGE.toLowerCase()}`);
        return false;
      }
      await (fn as ExportFn)(project);
    }
    toast.ok(`Exported ${kind.label}`);
    return true;
  } catch (err) {
    toast.error(`Export failed: ${errorMessage(err)}`);
    return false;
  }
}
