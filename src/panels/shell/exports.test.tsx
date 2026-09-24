import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { clearToasts, ToastViewport } from '@/ui/Toast';
import { mount, type Mounted } from '@/ui/testing';
import { EXPORT_KINDS, exportsModuleAvailable, NOT_AVAILABLE_MESSAGE, runExport } from './exports';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  clearToasts();
});

describe('runExport', () => {
  it('toasts instead of throwing while the exports module is missing', async () => {
    mounted = mount(<ToastViewport />);
    const kind = EXPORT_KINDS[0]!;
    let ok: boolean | null = null;
    await act(async () => {
      ok = await runExport(kind);
    });
    if (exportsModuleAvailable()) {
      // Module exists in this checkout: either it ran or reported a missing function, never threw.
      expect(typeof ok).toBe('boolean');
      return;
    }
    expect(ok).toBe(false);
    expect(mounted.container.textContent).toContain(NOT_AVAILABLE_MESSAGE);
  });
});
