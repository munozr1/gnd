/**
 * File > Export bridge. The menu lists whatever '@/io/exports' registers
 * (grouped), so adding an export means adding an entry to exportRegistry —
 * nothing here changes. Failures surface as toasts.
 */
import { EXPORT_GROUPS, exportRegistry, runExport as runRegisteredExport, type ExportEntry, type ExportGroup } from '@/io/exports';
import { store } from '@/store';
import { toast } from '@/ui/Toast';
import { errorMessage } from './format';

export type ExportKind = ExportEntry;

/** All registered exports, in registry order. */
export const EXPORT_KINDS: readonly ExportKind[] = exportRegistry;

/** Exports grouped for the menu, in EXPORT_GROUPS order (empty groups omitted). */
export function exportKindsByGroup(): { group: ExportGroup; kinds: ExportKind[] }[] {
  return EXPORT_GROUPS.map((group) => ({ group, kinds: exportRegistry.filter((e) => e.group === group) })).filter(
    (g) => g.kinds.length > 0,
  );
}

export function exportsModuleAvailable(): boolean {
  return exportRegistry.length > 0;
}

/** Context the exporters can use: the sheet on screen and the racks the user has selected. */
function exportContext() {
  const { ui } = store.getState();
  const rackIds = ui.selection.filter((s) => s.kind === 'rack').map((s) => s.id);
  return { activeSheetId: ui.activeSheetId, ...(rackIds.length ? { rackIds } : {}) };
}

/** Run one export; every failure surfaces as a toast and resolves false. */
export async function runExport(kind: ExportKind): Promise<boolean> {
  try {
    const output = await runRegisteredExport(kind.id, store.getState().project, exportContext());
    toast.ok(output.mode === 'print' ? `Opened ${kind.name} for printing` : `Exported ${output.filename}`);
    return true;
  } catch (err) {
    toast.error(`${kind.name}: ${errorMessage(err)}`);
    return false;
  }
}
