import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'default' | 'primary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Pressed / toggled look (tool buttons). */
  active?: boolean;
}

const BASE =
  'inline-flex items-center justify-center gap-1 rounded border text-[13px] leading-none whitespace-nowrap select-none outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent disabled:opacity-40 disabled:pointer-events-none';

const VARIANTS: Record<ButtonVariant, string> = {
  default: 'bg-panel-2 border-border text-fg hover:bg-[#262b36]',
  primary: 'bg-accent border-accent text-white hover:brightness-110',
  ghost: 'bg-transparent border-transparent text-fg hover:bg-panel-2',
  danger: 'bg-transparent border-border text-error hover:bg-error/10',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-6 px-2',
  md: 'h-7 px-2.5',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'sm', active = false, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      data-active={active || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], active && 'bg-accent/20 border-accent/60 text-fg', className)}
      {...rest}
    />
  );
});
