/**
 * Minimal row windowing for long flat lists (5,000 links, 1,000 components):
 * fixed row height, one scroll container, overscan on both sides. Returns the
 * visible index range plus the padding that keeps the scrollbar honest.
 */
import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react';

export interface VirtualWindow {
  /** Attach to the scroll container (must have a bounded height and overflow auto). */
  ref: React.RefObject<HTMLDivElement>;
  onScroll: (e: UIEvent<HTMLDivElement>) => void;
  start: number;
  /** Exclusive. */
  end: number;
  topPad: number;
  bottomPad: number;
  totalHeight: number;
  scrollToIndex: (i: number) => void;
}

const FALLBACK_HEIGHT = 600;

export function useVirtualRows(count: number, rowHeight: number, overscan = 8): VirtualWindow {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(FALLBACK_HEIGHT);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setHeight(el.clientHeight || FALLBACK_HEIGHT);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback((e: UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop), []);

  const scrollToIndex = useCallback(
    (i: number) => {
      const el = ref.current;
      if (!el) return;
      const top = i * rowHeight;
      const viewTop = el.scrollTop;
      const viewBottom = viewTop + el.clientHeight;
      if (top < viewTop) el.scrollTop = top;
      else if (top + rowHeight > viewBottom) el.scrollTop = Math.max(0, top + rowHeight - el.clientHeight);
      setScrollTop(el.scrollTop);
    },
    [rowHeight],
  );

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + height) / rowHeight) + overscan);
  return {
    ref,
    onScroll,
    start,
    end: Math.max(start, end),
    topPad: start * rowHeight,
    bottomPad: Math.max(0, (count - end) * rowHeight),
    totalHeight: count * rowHeight,
    scrollToIndex,
  };
}
