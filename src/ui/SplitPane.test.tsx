import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { SplitPane } from './SplitPane';
import { mount, type Mounted } from './testing';

let mounted: Mounted | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const pointer = (type: string, x: number, y: number) =>
  new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });

describe('<SplitPane />', () => {
  it('resizes the primary pane by dragging the gutter and clamps to minSize', () => {
    const onSizeChange = vi.fn();
    mounted = mount(
      <SplitPane direction="horizontal" defaultSize={200} minSize={100} onSizeChange={onSizeChange}>
        <div>left</div>
        <div>right</div>
      </SplitPane>,
    );
    const gutter = mounted.container.querySelector('[data-testid="split-gutter"]')!;
    const first = mounted.container.firstElementChild!.firstElementChild as HTMLElement;
    expect(first.style.width).toBe('200px');

    act(() => {
      gutter.dispatchEvent(pointer('pointerdown', 200, 0));
    });
    act(() => {
      window.dispatchEvent(pointer('pointermove', 260, 0));
    });
    expect(onSizeChange).toHaveBeenLastCalledWith(260);
    expect(first.style.width).toBe('260px');

    act(() => {
      window.dispatchEvent(pointer('pointermove', -500, 0));
    });
    expect(first.style.width).toBe('100px');
    act(() => {
      window.dispatchEvent(pointer('pointerup', -500, 0));
    });
    expect(gutter.getAttribute('aria-valuenow')).toBe('100');
  });

  it('inverts the drag direction when the second pane is primary', () => {
    mounted = mount(
      <SplitPane direction="vertical" primary="second" defaultSize={150} minSize={50}>
        <div>top</div>
        <div>bottom</div>
      </SplitPane>,
    );
    const gutter = mounted.container.querySelector('[data-testid="split-gutter"]')!;
    const second = mounted.container.firstElementChild!.lastElementChild as HTMLElement;
    expect(second.style.height).toBe('150px');
    act(() => {
      gutter.dispatchEvent(pointer('pointerdown', 0, 300));
    });
    act(() => {
      window.dispatchEvent(pointer('pointermove', 0, 250));
    });
    expect(second.style.height).toBe('200px');
  });

  it('renders only the first child when collapsed', () => {
    mounted = mount(
      <SplitPane direction="vertical" collapsed>
        <div data-testid="a">a</div>
        <div data-testid="b">b</div>
      </SplitPane>,
    );
    expect(mounted.container.querySelector('[data-testid="a"]')).not.toBeNull();
    expect(mounted.container.querySelector('[data-testid="b"]')).toBeNull();
    expect(mounted.container.querySelector('[data-testid="split-gutter"]')).toBeNull();
  });
});
