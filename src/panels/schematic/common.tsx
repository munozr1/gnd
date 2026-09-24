/**
 * Small shared pieces for the schematic-side panels and dialogs: running a
 * command with error surfacing, a text field that commits on Enter / blur,
 * compact label/control rows and the 'none' sentinel Radix Select needs
 * (it refuses empty-string item values).
 */
import { forwardRef, useEffect, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import type { Command } from '@/store/commands';
import { store } from '@/store';
import { cn } from '@/ui/cn';
import { Input } from '@/ui/Input';

/** Select value standing in for null / unassigned. */
export const NONE = '__none__';
export const fromSelect = (v: string): string | null => (v === NONE ? null : v);
export const toSelect = (v: string | null | undefined): string => v ?? NONE;

/**
 * Run a command through the store. The bootstrap toasts `ui.lastError` when
 * it changes; clearing it first makes a repeated identical failure toast too.
 */
export function execute(cmd: Command): boolean {
  const s = store.getState();
  if (s.ui.lastError !== null) s.setLastError(null);
  return s.execute(cmd);
}

export interface CommitInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  /** Called with the trimmed text on Enter / blur when it differs from `value`. */
  onCommit: (value: string) => void;
  /** Return an error message to block the commit (shown under the field). */
  validate?: (value: string) => string | null;
  mono?: boolean;
  inputSize?: 'sm' | 'md';
}

/** Text field editing a local copy; Enter/blur commit, Escape reverts. */
export const CommitInput = forwardRef<HTMLInputElement, CommitInputProps>(function CommitInput(
  { value, onCommit, validate, className, onKeyDown, onBlur, ...rest },
  ref,
) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) {
      setText(value);
      setError(null);
    }
  }, [value, editing]);

  const commit = (raw: string): boolean => {
    const next = raw.trim();
    if (next === value.trim()) {
      setText(value);
      setError(null);
      return true;
    }
    const problem = validate?.(next) ?? null;
    if (problem) {
      setError(problem);
      return false;
    }
    setError(null);
    onCommit(next);
    return true;
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'Enter') {
      if (commit(text)) e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setText(value);
      setError(null);
      e.currentTarget.blur();
    }
  };

  return (
    <span className={cn('flex min-w-0 flex-col', className)}>
      <Input
        ref={ref}
        value={text}
        aria-invalid={error ? true : undefined}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={(e) => {
          setEditing(false);
          commit(e.target.value);
          onBlur?.(e);
        }}
        onKeyDown={handleKeyDown}
        className={cn('w-full', error && 'border-error')}
        {...rest}
      />
      {error && <span className="mt-0.5 text-[11px] text-error">{error}</span>}
    </span>
  );
});

/** Label on the left (fixed width), control on the right. */
export function Field({ label, children, className, hint }: { label: ReactNode; children: ReactNode; className?: string; hint?: ReactNode }) {
  return (
    <label className={cn('flex min-h-6 items-start gap-2 text-[13px]', className)}>
      <span className="w-[76px] shrink-0 truncate pt-1 text-[12px] text-fg-muted" title={typeof label === 'string' ? label : undefined}>
        {label}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        {children}
        {hint && <span className="text-[11px] text-fg-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** Section heading inside a panel or dialog body. */
export function Section({ title, actions, children, className }: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-1.5 border-b border-border px-2 py-2 last:border-b-0', className)}>
      <header className="flex h-5 items-center gap-1">
        <span className="flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-fg-muted">{title}</span>
        {actions}
      </header>
      {children}
    </section>
  );
}

/** Read-only key/value line. */
export function Readout({ label, children, mono = false }: { label: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex min-h-5 items-center gap-2 text-[13px]">
      <span className="w-[76px] shrink-0 truncate text-[12px] text-fg-muted">{label}</span>
      <span className={cn('min-w-0 flex-1 truncate text-fg', mono && 'mono')}>{children}</span>
    </div>
  );
}

/** Column header cell for the compact tables. */
export const TH = ({ children, className, style }: { children?: ReactNode; className?: string; style?: React.CSSProperties }) => (
  <div className={cn('truncate px-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-muted', className)} style={style}>
    {children}
  </div>
);

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));
