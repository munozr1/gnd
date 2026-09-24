import { registerPanel } from '@/panels/registry';
import { SchematicInspector } from './Inspector';
import { SheetsPanel } from './SheetsPanel';

registerPanel({ id: 'schematic-inspector', editor: 'schematic', side: 'right', title: 'Inspector', component: SchematicInspector, order: 0 });
registerPanel({ id: 'schematic-sheets', editor: 'schematic', side: 'left', title: 'Sheets', component: SheetsPanel, order: 20 });
