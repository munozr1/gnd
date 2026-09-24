/**
 * Small building blocks shared by the layout panels: a command runner that
 * surfaces errors through the shell, compact label/field rows and section
 * headers for the inspector, a text field that commits on Enter/blur, and a
 * vertex-list editor for polygons (room, keep-outs).
 */
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { Vec2 } from '@/model/types';
import { store, type Command } from '@/store';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { IconButton } from '@/ui/IconButton';
import { Input, NumberInput } from '@/ui/Input';

/**
 * Execute a command. The last error is cleared first so the shell (which
 * toasts `ui.lastError` on change) reports a repeated failure again.
 */
export function run(cmd: Command): boolean {
  const s = store.getState();
  s.setLastError(null);
  return s.execute(cmd);
}

/** Inspector section: uppercase 11px header with optional right-side actions. */
export function Section({
  title,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('border-b border-border last:border-b-0', className)}>
      <header className="flex h-6 items-center gap-1 px-2">
        <span className="flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-fg-muted">{title}</span>
        {actions && <span className="flex shrink-0 items-center gap-0.5">{actions}</span>}
      </header>
      <div className="flex flex-col gap-1 px-2 pb-2">{children}</div>
    </section>
  );
}

/** Label / control row. */
export function Field({ label, children, hint }: { label: ReactNode; children?: ReactNode; hint?: ReactNode }) {
  return (
    <label className="flex min-h-6 items-center gap-2">
      <span className="w-20 shrink-0 truncate text-[12px] text-fg-muted">{label}</span>
      <span className="flex min-w-0 flex-1 items-center gap-1">{children}</span>
      {hint && <span className="shrink-0 text-[11px] text-fg-muted">{hint}</span>}
    </label>
  );
}

/** Read-only key/value row. */
export function Stat({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex h-5 items-center gap-2">
      <span className="w-20 shrink-0 truncate text-[12px] text-fg-muted">{label}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-fg">{value}</span>
    </div>
  );
}

export function Note({ tone = 'muted', children }: { tone?: 'muted' | 'warning' | 'error' | 'info'; children: ReactNode }) {
  const color = tone === 'warning' ? 'text-warning' : tone === 'error' ? 'text-error' : tone === 'info' ? 'text-info' : 'text-fg-muted';
  return <p className={cn('text-[11px] leading-4', color)}>{children}</p>;
}

export interface TextFieldProps {
  value: string;
  /** Called on Enter / blur when the text differs from `value`. */
  onCommit: (next: string) => void;
  placeholder?: string;
  mono?: boolean;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}

/** Text input that edits a local copy and commits on Enter or blur; Escape reverts. */
export function TextField({ value, onCommit, placeholder, mono, className, disabled, ...aria }: TextFieldProps) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commit();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setText(value);
      e.currentTarget.blur();
    }
  };
  return (
    <Input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => setEditing(true)}
      onBlur={() => {
        setEditing(false);
        commit();
      }}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      mono={mono}
      disabled={disabled}
      aria-label={aria['aria-label']}
      className={cn('w-full', className)}
    />
  );
}

/** Editable list of polygon vertices (mm). Keeps at least `min` points. */
export function VertexList({ points, onChange, min = 3 }: { points: readonly Vec2[]; onChange: (next: Vec2[]) => void; min?: number }) {
  const update = (i: number, p: Vec2) => onChange(points.map((q, j) => (j === i ? p : q)));
  const remove = (i: number) => onChange(points.filter((_, j) => j !== i));
  const add = () => {
    const last = points[points.length - 1] ?? { x: 0, y: 0 };
    const first = points[0] ?? last;
    onChange([...points, { x: (last.x + first.x) / 2, y: (last.y + first.y) / 2 }]);
  };
  return (
    <div className="flex flex-col gap-0.5">
      {points.map((p, i) => (
        <div key={i} className="flex items-center gap-1" data-vertex={i}>
          <span className="w-5 shrink-0 text-[11px] text-fg-muted">{i + 1}</span>
          <NumberInput aria-label={`Vertex ${i + 1} x`} value={p.x} unit="mm" decimals={0} step={100} onChange={(x) => update(i, { x, y: p.y })} className="flex-1" />
          <NumberInput aria-label={`Vertex ${i + 1} y`} value={p.y} unit="mm" decimals={0} step={100} onChange={(y) => update(i, { x: p.x, y })} className="flex-1" />
          <IconButton label="Remove vertex" icon="trash" disabled={points.length <= min} onClick={() => remove(i)} />
        </div>
      ))}
      <div>
        <Button variant="ghost" onClick={add}>
          + Add vertex
        </Button>
      </div>
    </div>
  );
}

export const fmtM = (m: number): string => `${m.toFixed(2)} m`;
export const fmtPct = (f: number): string => `${Math.round(f * 100)}%`;
export const fmtMm = (mm: number): string => `${Math.round(mm)} mm`;

/** Clickable list row used for cross-probing (devices in a rack, cables in a tray, ...). */
export function ListRow({
  onClick,
  selected,
  children,
  right,
  title,
}: {
  onClick?: () => void;
  selected?: boolean;
  children: ReactNode;
  right?: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      data-selected={selected || undefined}
      className={cn(
        'flex h-6 w-full items-center gap-2 rounded px-1 text-left text-[12px] outline-none hover:bg-panel-2 focus-visible:ring-1 focus-visible:ring-accent',
        selected && 'bg-accent/15',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {right !== undefined && <span className="shrink-0 text-[11px] text-fg-muted">{right}</span>}
    </button>
  );
}
