import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { ROOT_SHEET_ID } from '@/model/factories';
import { addComponent } from '@/model/schematic';
import { applySyncPlan, computeSyncPlan } from '@/model/sync';
import { command, useStore, type Command } from '@/store';
import { flush, mount, text, waitFor, type Mounted } from '@/ui/testing';

let mounted: Mounted | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

describe('<App />', () => {
  it('renders the three editor tabs, a menu bar and a status bar', async () => {
    mounted = mount(<App />);
    await flush();
    const tabs = [...mounted.container.querySelectorAll('[role="tab"]')].map(text);
    expect(tabs).toEqual(['Schematic', 'Layout', '3D']);
    expect(mounted.container.querySelector('[role="tab"][data-state="active"]')?.textContent).toBe('Schematic');

    const menus = [...mounted.container.querySelectorAll('nav button')].map(text);
    expect(menus).toEqual(['File', 'Edit', 'View', 'Help']);

    expect(text(mounted.container.querySelector('[data-testid="unrouted"]'))).toMatch(/Unrouted: 0 \/ 0/);
  });

  it('mounts only the active editor once the project is loaded', async () => {
    mounted = mount(<App />);
    const editor = await waitFor(() => mounted!.container.querySelector('[data-editor]'));
    expect(editor.getAttribute('data-editor')).toBe('schematic');
    expect(mounted.container.querySelector('[data-editor="layout"]')).toBeNull();
    expect(useStore.getState().project.id).toBeTruthy();
  });

  it('shows the Out of sync badge on the Layout tab until the sync plan is applied', async () => {
    mounted = mount(<App />);
    await waitFor(() => mounted!.container.querySelector('[data-editor]'));
    const layoutTab = () => [...mounted!.container.querySelectorAll('[role="tab"]')].find((t) => text(t).startsWith('Layout'))!;
    expect(text(layoutTab())).toBe('Layout');

    const execute = (cmd: Command) => {
      let ok = false;
      act(() => {
        ok = useStore.getState().execute(cmd);
      });
      expect(ok).toBe(true);
    };
    execute(command('Add switch', 'schematic', (d) => void addComponent(d, 'sym.leaf-switch-48x25-8x100', ROOT_SHEET_ID, { x: 0, y: 0 })));
    await flush();
    expect(text(layoutTab())).toContain('Out of sync');

    execute(command('Update layout', 'layout', (d) => void applySyncPlan(d, computeSyncPlan(d).changes)));
    await flush();
    expect(text(layoutTab())).toBe('Layout');
  });
});
