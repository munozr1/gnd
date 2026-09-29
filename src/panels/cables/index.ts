/**
 * Fiber cable UI: the Cable Builder dialog ('cable-builder'), the "Fiber
 * cables" list (a section of the layout Library panel, and a collapsed dock
 * panel on the schematic tab) and the connecting flow (cabling.ts, the
 * CablingHud mounted by the schematic editor, the CableInspector rendered by
 * the schematic Inspector). Importing this module registers the dialog and
 * panel with '@/panels/registry'; App.tsx imports it once for the side effect.
 */
import { registerDialog, registerPanel } from '@/panels/registry';
import { CABLE_BUILDER_DIALOG, CableBuilderDialog } from './CableBuilderDialog';
import { CablesDockPanel } from './CableLibrarySection';

export { CableBuilderDialog, CABLE_BUILDER_DIALOG, DEFAULT_FORM, FIBER_COUNTS, formToDef, type CableBuilderForm } from './CableBuilderDialog';
export { CableLibrarySection, CablesDockPanel, fiberCableRows, type CableLibrarySectionProps, type FiberCableRow } from './CableLibrarySection';
export { CableInspector } from './CableInspector';
export { CablingHud } from './CablingHud';
export * from './cabling';
export * from './preview';

export const CABLES_PANEL_ID = 'cables.library';

registerDialog({ id: CABLE_BUILDER_DIALOG, component: CableBuilderDialog });
registerPanel({ id: CABLES_PANEL_ID, editor: 'schematic', side: 'left', title: 'Fiber cables', component: CablesDockPanel, order: 30, collapsed: true });
