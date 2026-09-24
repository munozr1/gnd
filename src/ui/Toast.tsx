/**
 * Minimal non-blocking toasts: a module-level queue plus one viewport
 * component. `toast('Saved')` works from anywhere, React or not.
 */
import { useSyncExternalStore } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons';

export type ToastTone = 'info' | 'ok' | 'warning' | 'error';

export interface ToastItem {
  id: number;
  message: string;
  title?: string;
  tone: ToastTone;
  durationMs: number;
}

export interface ToastOptions {
  tone?: ToastTone;
  title?: string;
  /** 0 keeps the toast until dismissed. */
  durationMs?: number;
}

const DEFAULT_DURATION: Record<ToastTone, number> = { info: 3000, ok: 2500, warning: 5000, error: 7000 };

let items: readonly ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

const emit = () => listeners.forEach((l) => l());

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const getSnapshot = (): readonly ToastItem[] => items;

export function dismissToast(id: number): void {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  if (!items.some((i) => i.id === id)) return;
  items = items.filter((i) => i.id !== id);
  emit();
}

export function clearToasts(): void {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  if (items.length === 0) return;
  items = [];
  emit();
}

function arm(item: ToastItem): void {
  const existing = timers.get(item.id);
  if (existing) clearTimeout(existing);
  if (item.durationMs > 0) timers.set(item.id, setTimeout(() => dismissToast(item.id), item.durationMs));
}

/** Show a toast; returns its id. An identical live message is refreshed instead of duplicated. */
export function toast(message: string, opts: ToastOptions = {}): number {
  const tone = opts.tone ?? 'info';
  const durationMs = opts.durationMs ?? DEFAULT_DURATION[tone];
  const dup = items.find((i) => i.message === message && i.tone === tone && i.title === opts.title);
  if (dup) {
    const refreshed = { ...dup, durationMs };
    items = items.map((i) => (i.id === dup.id ? refreshed : i));
    arm(refreshed);
    emit();
    return dup.id;
  }
  const item: ToastItem = { id: nextId++, message, tone, durationMs, ...(opts.title ? { title: opts.title } : {}) };
  items = [...items, item];
  arm(item);
  emit();
  return item.id;
}

toast.info = (message: string, opts: Omit<ToastOptions, 'tone'> = {}) => toast(message, { ...opts, tone: 'info' });
toast.ok = (message: string, opts: Omit<ToastOptions, 'tone'> = {}) => toast(message, { ...opts, tone: 'ok' });
toast.warning = (message: string, opts: Omit<ToastOptions, 'tone'> = {}) => toast(message, { ...opts, tone: 'warning' });
toast.error = (message: string, opts: Omit<ToastOptions, 'tone'> = {}) => toast(message, { ...opts, tone: 'error' });

export function useToasts(): readonly ToastItem[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const TONE_ICON: Record<ToastTone, IconName> = { info: 'info', ok: 'ok', warning: 'warning', error: 'error' };
const TONE_CLASS: Record<ToastTone, string> = {
  info: 'border-l-info text-info',
  ok: 'border-l-ok text-ok',
  warning: 'border-l-warning text-warning',
  error: 'border-l-error text-error',
};

/** Fixed bottom-right stack; mount once near the app root. */
export function ToastViewport() {
  const list = useToasts();
  if (list.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-8 right-3 z-[60] flex w-[320px] flex-col gap-1.5" role="region" aria-label="Notifications">
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          data-tone={t.tone}
          onClick={() => dismissToast(t.id)}
          className={cn(
            'pointer-events-auto flex cursor-pointer items-start gap-2 rounded border border-border border-l-2 bg-panel-2 px-2.5 py-2 text-[13px] text-fg shadow-xl',
            TONE_CLASS[t.tone],
          )}
        >
          <Icon name={TONE_ICON[t.tone]} className="mt-px shrink-0" />
          <div className="min-w-0 flex-1 text-fg">
            {t.title && <div className="font-medium">{t.title}</div>}
            <div className="break-words text-fg-muted">{t.message}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
