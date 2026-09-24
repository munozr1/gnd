import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToasts, dismissToast, toast, ToastViewport } from './Toast';
import { mount, type Mounted } from './testing';
import { act } from 'react';

let mounted: Mounted | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  clearToasts();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  clearToasts();
  vi.useRealTimers();
});

describe('toast', () => {
  it('renders, auto-dismisses and can be dismissed by click', () => {
    mounted = mount(<ToastViewport />);
    act(() => {
      toast('Saved');
      toast.error('Boom');
    });
    const items = mounted.container.querySelectorAll('[data-tone]');
    expect(items).toHaveLength(2);
    expect(items[0]?.getAttribute('data-tone')).toBe('info');
    expect(items[1]?.getAttribute('role')).toBe('alert');

    act(() => {
      vi.advanceTimersByTime(3001);
    });
    expect(mounted.container.querySelectorAll('[data-tone]')).toHaveLength(1);

    act(() => {
      mounted!.container.querySelector('[data-tone="error"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(mounted.container.querySelector('[data-tone]')).toBeNull();
  });

  it('refreshes an identical live toast instead of duplicating it', () => {
    mounted = mount(<ToastViewport />);
    let a = 0;
    let b = 0;
    act(() => {
      a = toast('Same');
      vi.advanceTimersByTime(2000);
      b = toast('Same');
    });
    expect(a).toBe(b);
    expect(mounted.container.querySelectorAll('[data-tone]')).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    // Timer was re-armed by the second call, so it is still visible 4 s after the first.
    expect(mounted.container.querySelectorAll('[data-tone]')).toHaveLength(1);
    act(() => dismissToast(a));
    expect(mounted.container.querySelector('[data-tone]')).toBeNull();
  });
});
