import { forwardRef, useEffect, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';
import { cn } from './cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  /** Visual size; default 'sm' (24px). */
  inputSize?: 'sm' | 'md';
}

export const INPUT_CLASS =
  'rounded border border-border bg-bg px-1.5 text-[13px] text-fg outline-none placeholder:text-fg-muted focus:border-accent disabled:opacity-40 select-text';

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { mono = false, inputSize = 'sm', className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(INPUT_CLASS, inputSize === 'sm' ? 'h-6' : 'h-7', mono && 'mono', className)}
      spellCheck={false}
      {...rest}
    />
  );
});

export interface NumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> {
  value: number;
  /** Called with the parsed value on Enter / blur / arrow step. */
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Unit suffix rendered inside the field ('mm', 'U'). */
  unit?: string;
  /** Round committed values to this many decimals (default 3). */
  decimals?: number;
  inputSize?: 'sm' | 'md';
}

const clampNum = (v: number, min: number | undefined, max: number | undefined): number =>
  Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, v));

/**
 * Numeric field that edits a local string and commits on Enter, blur or arrow
 * keys, so half-typed values never reach the model. Escape reverts.
 */
export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { value, onChange, min, max, step = 1, unit, decimals = 3, inputSize = 'sm', className, onBlur, onKeyDown, ...rest },
  ref,
) {
  const format = (v: number) => String(Number(v.toFixed(decimals)));
  const [text, setText] = useState(format(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!editing) setText(format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editing]);

  const commit = (raw: string) => {
    const parsed = Number(raw.trim());
    if (raw.trim() === '' || Number.isNaN(parsed)) {
      setText(format(value));
      return;
    }
    const next = Number(clampNum(parsed, min, max).toFixed(decimals));
    setText(format(next));
    if (next !== value) onChange(next);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'Enter') {
      commit(text);
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setText(format(value));
      e.currentTarget.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const mult = e.shiftKey ? 10 : 1;
      const base = Number(text);
      const from = Number.isNaN(base) ? value : base;
      commit(String(from + (e.key === 'ArrowUp' ? 1 : -1) * step * mult));
    }
  };

  return (
    <span className={cn('relative inline-flex items-center', className)}>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={(e) => {
          setEditing(false);
          commit(e.target.value);
          onBlur?.(e);
        }}
        onKeyDown={handleKeyDown}
        className={cn(INPUT_CLASS, 'mono w-full', inputSize === 'sm' ? 'h-6' : 'h-7', unit && 'pr-7')}
        {...rest}
      />
      {unit && <span className="pointer-events-none absolute right-1.5 text-[11px] text-fg-muted">{unit}</span>}
    </span>
  );
});
