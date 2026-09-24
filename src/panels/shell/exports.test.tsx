import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { exportRegistry } from '@/io/exports';
import { clearToasts, ToastViewport } from '@/ui/Toast';
import { mount, type Mounted } from '@/ui/testing';
import { EXPORT_KINDS, exportKindsByGroup, exportsModuleAvailable, runExport } from './exports';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  clearToasts();
});

describe('export menu bridge', () => {
  it('lists every registered export exactly once, grouped', () => {
    expect(exportsModuleAvailable()).toBe(true);
    expect(EXPORT_KINDS).toBe(exportRegistry);
    const listed = exportKindsByGroup().flatMap((g) => g.kinds.map((k) => k.id));
    expect([...listed].sort()).toEqual(exportRegistry.map((e) => e.id).sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('toasts instead of throwing when an export fails', async () => {
    mounted = mount(<ToastViewport />);
    // The 3D screenshot needs the viewer mounted; in jsdom it must fail cleanly.
    const kind = EXPORT_KINDS.find((k) => k.id === 'screenshot-3d-png')!;
    let ok: boolean | null = null;
    await act(async () => {
      ok = await runExport(kind);
    });
    expect(ok).toBe(false);
    expect(mounted.container.textContent).toContain(kind.name);
  });
});
