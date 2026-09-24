import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons';
import { Tooltip } from './Tooltip';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name; also the tooltip text. */
  label: string;
  icon?: IconName;
  /** Custom glyph instead of a named icon. */
  children?: React.ReactNode;
  shortcut?: string;
  size?: 'sm' | 'md';
  active?: boolean;
  variant?: 'ghost' | 'default';
  /** Disable the tooltip (keeps aria-label). */
  noTooltip?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon,
    children,
    shortcut,
    size = 'sm',
    active = false,
    variant = 'ghost',
    noTooltip = false,
    className,
    type = 'button',
    ...rest
  },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      data-active={active || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded border text-fg-muted outline-none transition-colors hover:text-fg focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-40 disabled:pointer-events-none',
        variant === 'ghost' ? 'border-transparent hover:bg-panel-2' : 'border-border bg-panel-2 hover:bg-[#262b36]',
        size === 'sm' ? 'h-6 w-6' : 'h-7 w-7',
        active && 'bg-accent/20 border-accent/60 text-fg',
        className,
      )}
      {...rest}
    >
      {icon ? <Icon name={icon} /> : children}
    </button>
  );
  if (noTooltip) return button;
  return (
    <Tooltip content={label} shortcut={shortcut}>
      {button}
    </Tooltip>
  );
});
