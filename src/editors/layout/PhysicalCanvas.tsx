import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Layer, Shape, Stage } from 'react-konva/lib/ReactKonvaCore';
import type { Rect } from '@/model/geometry';
import type { Vec2 } from '@/model/types';
import { isEditableTarget } from '@/store/shortcuts';
import { fitRect, screenToWorld, zoomAt, type Viewport } from './viewport';

export interface CanvasPointer { shift: boolean; ctrl: boolean; alt: boolean }
interface Props {
  testId: string;
  label: string;
  bounds: Rect;
  resetKey: string;
  paint: (ctx: CanvasRenderingContext2D, scale: number) => void;
  frame?: Rect | null;
  onFrame?: () => void;
  onDown?: (point: Vec2, event: CanvasPointer) => void;
  onMove?: (point: Vec2, event: CanvasPointer) => void;
  onUp?: (point: Vec2) => void;
  onDoubleClick?: (point: Vec2) => void;
  onCancel?: () => void;
  onDrop?: (point: Vec2, data: DataTransfer) => void;
  /** An HTML5 drag is over the canvas at `point` (fired from dragover; `data.types` is readable, `getData` is not until the drop). */
  onDragMove?: (point: Vec2, data: DataTransfer) => void;
  /** The drag left the canvas (or was cancelled) without dropping. */
  onDragLeave?: () => void;
  children?: ReactNode;
}
export function PhysicalCanvas({ testId, label, bounds, resetKey, paint, frame, onFrame, onDown, onMove, onUp, onDoubleClick, onCancel, onDrop, onDragMove, onDragLeave, children }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, scale: 0.1 });
  const viewRef = useRef(view); viewRef.current = view;
  const pan = useRef<{ point: Vec2; view: Viewport } | null>(null);
  const space = useRef(false);
  const fitted = useRef('');
  useEffect(() => {
    if (!host.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height }); });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!size.width || !size.height) return;
    const key = `${resetKey}:${size.width}:${size.height}`;
    if (key !== fitted.current) { fitted.current = key; setView(fitRect(bounds, size)); }
  }, [bounds, size, resetKey]);
  useEffect(() => { if (frame && size.width && size.height) { setView(fitRect(frame, size)); onFrame?.(); } }, [frame, size, onFrame]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !isEditableTarget(e.target)) { space.current = true; e.preventDefault(); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') space.current = false; };
    const blur = () => { space.current = false; pan.current = null; };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = element.getBoundingClientRect();
      setView((v) => zoomAt(v, { x: e.clientX - r.x, y: e.clientY - r.y }, Math.exp(-Math.max(-200, Math.min(200, e.deltaY)) * 0.002)));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  const screen = (e: { clientX: number; clientY: number }) => { const r = host.current!.getBoundingClientRect(); return { x: e.clientX - r.x, y: e.clientY - r.y }; };
  const point = (e: { clientX: number; clientY: number }) => screenToWorld(viewRef.current, screen(e));
  const mods = (e: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean }): CanvasPointer => ({ shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey });
  return <div ref={host} data-testid={testId} data-viewport={JSON.stringify(view)} role="region" aria-label={label} tabIndex={0} className="relative h-full w-full min-h-0 overflow-hidden bg-bg outline-none" style={{ touchAction: 'none' }}
    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); } }}
    onContextMenu={(e) => e.preventDefault()}
    onPointerDown={(e) => {
      if ((e.target as HTMLElement).closest('button, input')) return;
      e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId);
      if (e.button === 1 || e.button === 2 || space.current) { e.preventDefault(); pan.current = { point: screen(e), view }; }
      else if (e.button === 0) onDown?.(point(e), mods(e));
    }}
    onPointerMove={(e) => {
      if (pan.current) { const p = screen(e), g = pan.current; setView({ ...g.view, x: g.view.x + p.x - g.point.x, y: g.view.y + p.y - g.point.y }); }
      else onMove?.(point(e), mods(e));
    }}
    onPointerUp={(e) => { if (!pan.current) onUp?.(point(e)); pan.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
    onPointerCancel={() => { pan.current = null; onCancel?.(); }}
    onDoubleClick={(e) => onDoubleClick?.(point(e))}
    onDragOver={(e) => { if (onDrop) { e.preventDefault(); onDragMove?.(point(e), e.dataTransfer); } }}
    // dragleave also fires when moving onto a child; only report a real exit.
    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onDragLeave?.(); }}
    onDrop={(e) => { e.preventDefault(); onDrop?.(point(e), e.dataTransfer); }}>
    {size.width > 0 && size.height > 0 && <Stage width={size.width} height={size.height} x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale} listening={false}>
      <Layer listening={false}><Shape sceneFunc={(ctx) => paint(ctx._context, view.scale)} /></Layer>
    </Stage>}
    {children}
  </div>;
}
