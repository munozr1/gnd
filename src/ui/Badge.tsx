import type { HTMLAttributes } from 'react';
import { cn } from './cn';

export type BadgeTone = 'neutral' | 'accent' | 'error' | 'warning' | 'info' | 'ok';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-panel-2 text-fg-muted border-border',
  accent: 'bg-accent/15 text-accent-2 border-accent/40',
  error: 'bg-error/15 text-error border-error/40',
  warning: 'bg-warning/15 text-warning border-warning/40',
  info: 'bg-info/15 text-info border-info/40',
  ok: 'bg-ok/15 text-ok border-ok/40',
};

export function Badge({ tone = 'neutral', className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-4 items-center gap-1 whitespace-nowrap rounded-full border px-1.5 text-[11px] font-medium leading-none',
        TONES[tone],
        className,
      )}
      {...rest}
    />
  );
}
