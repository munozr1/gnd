/**
 * Library panel + dialogs, registered into the shell at module load.
 * Import this module (once) from the app to activate it.
 */
import { registerDialog, registerPanel } from '@/panels/registry';
import { CustomDeviceDialog } from './CustomDeviceDialog';
import { LibraryDialog, LIBRARY_DIALOG } from './LibraryDialog';
import { CUSTOM_DEVICE_DIALOG } from './LibraryList';
import { LibraryPanel } from './LibraryPanel';

export { LibraryList, startPlacing, CUSTOM_DEVICE_DIALOG } from './LibraryList';
export { LibraryPanel } from './LibraryPanel';
export { LibraryDialog, LIBRARY_DIALOG } from './LibraryDialog';
export { CustomDeviceDialog, expandPortRows, PORT_TYPES, type PortRowForm } from './CustomDeviceDialog';
export * from './catalogView';

export const LIBRARY_PANEL_ID = 'library';

registerPanel({ id: LIBRARY_PANEL_ID, editor: 'schematic', side: 'left', title: 'Library', component: LibraryPanel, order: 10 });
registerDialog({ id: LIBRARY_DIALOG, component: LibraryDialog });
registerDialog({ id: CUSTOM_DEVICE_DIALOG, component: CustomDeviceDialog });
