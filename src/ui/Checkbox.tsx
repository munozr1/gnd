import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { useId, type ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './icons';

export interface CheckboxProps {
  checked?: boolean | 'indeterminate';
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean | 'indeterminate') => void;
  label?: ReactNode;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
  'aria-label'?: string;
}

/** 14px checkbox with an optional inline label. */
export function Checkbox({ checked, defaultChecked, onCheckedChange, label, disabled, className, id, name, ...aria }: CheckboxProps) {
  const autoId = useId();
  const boxId = id ?? autoId;
  return (
    <span className={cn('inline-flex items-center gap-1.5', disabled && 'opacity-40', className)}>
      <CheckboxPrimitive.Root
        id={boxId}
        name={name}
        checked={checked}
        defaultChecked={defaultChecked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={aria['aria-label']}
        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-border bg-bg text-white outline-none focus-visible:ring-1 focus-visible:ring-accent data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent"
      >
        <CheckboxPrimitive.Indicator>
          {checked === 'indeterminate' ? <span className="block h-px w-2 bg-accent" /> : <Icon name="check" size={10} strokeWidth={2.5} />}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {label !== undefined && (
        <label htmlFor={boxId} className="cursor-default select-none text-[13px] text-fg">
          {label}
        </label>
      )}
    </span>
  );
}
