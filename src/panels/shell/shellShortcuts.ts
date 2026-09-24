/**
 * Shell-level shortcuts: tab switching, F8, checks, open/save. Editor tools
 * register their own with `editor` scoping.
 */
import { registerShortcut } from '@/store/shortcuts';
import { store } from '@/store';
import { runChecks } from './useChecks';
import { saveProjectFile } from './projectActions';

export const SHELL_KEYS = {
  tabSchematic: 'alt+1',
  tabLayout: 'alt+2',
  tabViewer3d: 'alt+3',
  updateLayout: 'f8',
  runErc: 'mod+e',
  runDrc: 'mod+shift+e',
  open: 'mod+o',
  save: 'mod+s',
  shortcuts: 'mod+/',
  issues: 'mod+shift+m',
} as const;

export function registerShellShortcuts(): () => void {
  const s = () => store.getState();
  const offs = [
    registerShortcut({
      id: 'shell.tab.schematic',
      keys: SHELL_KEYS.tabSchematic,
      description: 'Show Schematic',
      allowInInputs: true,
      handler: () => s().setActiveTab('schematic'),
    }),
    registerShortcut({
      id: 'shell.tab.layout',
      keys: SHELL_KEYS.tabLayout,
      description: 'Show Layout',
      allowInInputs: true,
      handler: () => s().setActiveTab('layout'),
    }),
    registerShortcut({
      id: 'shell.tab.viewer3d',
      keys: SHELL_KEYS.tabViewer3d,
      description: 'Show 3D viewer',
      allowInInputs: true,
      handler: () => s().setActiveTab('viewer3d'),
    }),
    registerShortcut({
      id: 'shell.update-layout',
      keys: SHELL_KEYS.updateLayout,
      description: 'Update Layout from Schematic',
      handler: () => s().openDialog('update-layout'),
    }),
    registerShortcut({
      id: 'shell.run-erc',
      keys: SHELL_KEYS.runErc,
      description: 'Run ERC',
      handler: () => {
        s().setIssuesDrawerOpen(true);
        void runChecks(['erc'], { notify: true });
      },
    }),
    registerShortcut({
      id: 'shell.run-drc',
      keys: SHELL_KEYS.runDrc,
      description: 'Run DRC',
      handler: () => {
        s().setIssuesDrawerOpen(true);
        void runChecks(['drc'], { notify: true });
      },
    }),
    registerShortcut({
      id: 'shell.open-project',
      keys: SHELL_KEYS.open,
      description: 'Open project…',
      allowInInputs: true,
      handler: () => s().openDialog('project-picker'),
    }),
    registerShortcut({
      id: 'shell.save-project',
      keys: SHELL_KEYS.save,
      description: 'Save project as JSON',
      allowInInputs: true,
      handler: () => saveProjectFile(),
    }),
    registerShortcut({
      id: 'shell.shortcuts',
      keys: [SHELL_KEYS.shortcuts, '?'],
      description: 'Keyboard shortcuts',
      handler: () => s().openDialog('shortcuts'),
    }),
    registerShortcut({
      id: 'shell.issues',
      keys: SHELL_KEYS.issues,
      description: 'Toggle issues drawer',
      handler: () => s().toggleIssuesDrawer(),
    }),
  ];
  return () => offs.forEach((off) => off());
}
