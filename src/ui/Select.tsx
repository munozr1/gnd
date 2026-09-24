import * as SelectPrimitive from '@radix-ui/react-select';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './icons';

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
  name?: string;
}

/** Compact single-value picker. Options are `{ value, label }`. */
export function Select({
  value,
  defaultValue,
  onValueChange,
  options,
  placeholder = 'Select…',
  disabled,
  size = 'sm',
  className,
  name,
  ...aria
}: SelectProps) {
  return (
    <SelectPrimitive.Root value={value} defaultValue={defaultValue} onValueChange={onValueChange} disabled={disabled} name={name}>
      <SelectPrimitive.Trigger
        aria-label={aria['aria-label']}
        className={cn(
          'inline-flex items-center justify-between gap-1 rounded border border-border bg-bg px-1.5 text-[13px] text-fg outline-none focus:border-accent data-[placeholder]:text-fg-muted disabled:opacity-40',
          size === 'sm' ? 'h-6' : 'h-7',
          className,
        )}
      >
        <span className="truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon className="shrink-0 text-fg-muted">
          <Icon name="chevron-down" size={12} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={2}
          className="z-50 max-h-[50vh] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded border border-border bg-panel-2 text-[13px] text-fg shadow-xl"
        >
          <SelectPrimitive.ScrollUpButton className="flex h-5 items-center justify-center text-fg-muted">
            <Icon name="chevron-up" size={12} />
          </SelectPrimitive.ScrollUpButton>
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex h-6 cursor-default select-none items-center rounded pl-6 pr-2 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-white data-[disabled]:opacity-40"
              >
                <SelectPrimitive.ItemIndicator className="absolute left-1.5 inline-flex items-center">
                  <Icon name="check" size={12} />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{o.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
          <SelectPrimitive.ScrollDownButton className="flex h-5 items-center justify-center text-fg-muted">
            <Icon name="chevron-down" size={12} />
          </SelectPrimitive.ScrollDownButton>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
