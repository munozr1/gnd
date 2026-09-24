import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '@/ui/testing';
import { StatusBarProvider, useStatusBar, useStatusBarFields, useStatusBarWriter } from './StatusBarContext';

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

let renders = 0;
function Reader() {
  const { mode, coords } = useStatusBar();
  return <div data-testid="reader">{[mode, coords].filter(Boolean).join('|')}</div>;
}

let writer: ReturnType<typeof useStatusBarWriter> | null = null;
function Writer() {
  renders++;
  writer = useStatusBarWriter();
  return null;
}

function Editor({ coords }: { coords: string }) {
  useStatusBarFields({ mode: 'Wire', coords });
  return null;
}

describe('status bar context', () => {
  it('writers update readers without re-rendering themselves', () => {
    renders = 0;
    mounted = mount(
      <StatusBarProvider>
        <Reader />
        <Writer />
      </StatusBarProvider>,
    );
    expect(renders).toBe(1);
    act(() => writer!.set({ mode: 'Select', coords: 'x 1 y 2' }));
    expect(mounted.container.querySelector('[data-testid="reader"]')?.textContent).toBe('Select|x 1 y 2');
    expect(renders).toBe(1);
    act(() => writer!.clear());
    expect(mounted.container.querySelector('[data-testid="reader"]')?.textContent).toBe('');
  });

  it('useStatusBarFields publishes while mounted and clears on unmount', () => {
    function Host({ show, coords }: { show: boolean; coords: string }) {
      return (
        <StatusBarProvider>
          <Reader />
          {show && <Editor coords={coords} />}
        </StatusBarProvider>
      );
    }
    mounted = mount(<Host show coords="x 0 y 0" />);
    const reader = () => mounted!.container.querySelector('[data-testid="reader"]')?.textContent;
    expect(reader()).toBe('Wire|x 0 y 0');
    mounted.rerender(<Host show coords="x 5 y 5" />);
    expect(reader()).toBe('Wire|x 5 y 5');
    mounted.rerender(<Host show={false} coords="x 5 y 5" />);
    expect(reader()).toBe('');
  });

  it('is a no-op without a provider', () => {
    mounted = mount(<Editor coords="x" />);
    expect(mounted.container.textContent).toBe('');
  });
});
