import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { cn } from './cn';

export interface SplitPaneProps {
  /** 'horizontal' places the children side by side; 'vertical' stacks them. */
  direction: 'horizontal' | 'vertical';
  children: [ReactNode, ReactNode];
  /** Which child keeps a fixed pixel size; the other fills the remainder. */
  primary?: 'first' | 'second';
  defaultSize?: number;
  /** Controlled size of the primary pane in px. */
  size?: number;
  onSizeChange?: (size: number) => void;
  minSize?: number;
  maxSize?: number;
  /** Minimum size the non-primary pane keeps while dragging. */
  minSecondarySize?: number;
  /** Hide the second child and give the first the whole area (drawer closed). */
  collapsed?: boolean;
  gutterSize?: number;
  className?: string;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Two panes separated by a draggable gutter. Pointer-driven, no dependencies;
 * double-click the gutter to restore `defaultSize`.
 */
export function SplitPane({
  direction,
  children,
  primary = 'first',
  defaultSize = 280,
  size: sizeProp,
  onSizeChange,
  minSize = 80,
  maxSize = Number.POSITIVE_INFINITY,
  minSecondarySize = 120,
  collapsed = false,
  gutterSize = 4,
  className,
}: SplitPaneProps) {
  const [sizeState, setSizeState] = useState(defaultSize);
  const size = sizeProp ?? sizeState;
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ start: number; startSize: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const horizontal = direction === 'horizontal';
  const [first, second] = children;

  const commit = useCallback(
    (next: number) => {
      if (sizeProp === undefined) setSizeState(next);
      onSizeChange?.(next);
    },
    [sizeProp, onSizeChange],
  );

  const clampToContainer = useCallback(
    (next: number): number => {
      const el = containerRef.current;
      const total = el ? (horizontal ? el.clientWidth : el.clientHeight) : 0;
      const hardMax = total > 0 ? Math.max(minSize, total - gutterSize - minSecondarySize) : maxSize;
      return clamp(next, minSize, Math.min(maxSize, hardMax));
    },
    [horizontal, minSize, maxSize, minSecondarySize, gutterSize],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget;
    if (typeof target.setPointerCapture === 'function' && e.pointerId !== undefined) {
      try {
        target.setPointerCapture(e.pointerId);
      } catch {
        // jsdom and some browsers throw for synthetic pointer ids; dragging still works via window events.
      }
    }
    dragRef.current = { start: horizontal ? e.clientX : e.clientY, startSize: size };
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const pos = horizontal ? e.clientX : e.clientY;
      const delta = (pos - drag.start) * (primary === 'first' ? 1 : -1);
      commit(clampToContainer(drag.startSize + delta));
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.style.cursor = prevCursor;
    };
  }, [dragging, horizontal, primary, commit, clampToContainer]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 10;
    const dec = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const inc = horizontal ? 'ArrowRight' : 'ArrowDown';
    const sign = primary === 'first' ? 1 : -1;
    if (e.key === dec) commit(clampToContainer(size - step * sign));
    else if (e.key === inc) commit(clampToContainer(size + step * sign));
    else return;
    e.preventDefault();
  };

  const primaryStyle = { flex: `0 0 ${size}px`, [horizontal ? 'width' : 'height']: size } as const;
  const fillStyle = { flex: '1 1 0%', minWidth: 0, minHeight: 0 } as const;
  const firstStyle = primary === 'first' ? primaryStyle : fillStyle;
  const secondStyle = primary === 'second' ? primaryStyle : fillStyle;

  return (
    <div
      ref={containerRef}
      className={cn('flex min-h-0 min-w-0 flex-1', horizontal ? 'flex-row' : 'flex-col', className)}
      data-direction={direction}
    >
      <div className="min-h-0 min-w-0 overflow-hidden" style={collapsed ? fillStyle : firstStyle}>
        {first}
      </div>
      {!collapsed && (
        <>
          <div
            role="separator"
            aria-orientation={horizontal ? 'vertical' : 'horizontal'}
            aria-valuenow={Math.round(size)}
            tabIndex={0}
            data-testid="split-gutter"
            onPointerDown={onPointerDown}
            onDoubleClick={() => commit(clampToContainer(defaultSize))}
            onKeyDown={onKeyDown}
            className={cn(
              'relative z-10 shrink-0 bg-border outline-none transition-colors hover:bg-accent/70 focus-visible:bg-accent',
              horizontal ? 'cursor-col-resize' : 'cursor-row-resize',
              dragging && 'bg-accent',
            )}
            style={horizontal ? { width: gutterSize } : { height: gutterSize }}
          />
          <div className="min-h-0 min-w-0 overflow-hidden" style={secondStyle}>
            {second}
          </div>
        </>
      )}
    </div>
  );
}
