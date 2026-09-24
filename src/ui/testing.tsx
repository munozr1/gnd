/**
 * Minimal jsdom render helper for component tests (no testing-library):
 * mounts into a fresh div with React 18's createRoot inside act().
 */
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

export interface Mounted {
  container: HTMLDivElement;
  root: Root;
  rerender(element: ReactElement): void;
  unmount(): void;
}

export function mount(element: ReactElement): Mounted {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));
  return {
    container,
    root,
    rerender: (next) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Await pending microtasks / effects inside act. */
export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Poll (real timers) until `predicate` returns a truthy value, flushing effects between tries. */
export async function waitFor<T>(predicate: () => T, timeoutMs = 2000): Promise<NonNullable<T>> {
  const start = Date.now();
  for (;;) {
    const value = predicate();
    if (value) return value as NonNullable<T>;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

export function click(el: Element | null | undefined): void {
  if (!el) throw new Error('click: element not found');
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

export const text = (el: Element | null | undefined): string => el?.textContent ?? '';
