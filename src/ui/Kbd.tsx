import type { HTMLAttributes } from 'react';
import { cn } from './cn';

/** Keycap for menus, tooltips and the shortcuts dialog. Pass pre-formatted text ('⌘Z'). */
export function Kbd({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        'mono inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border bg-panel-2 px-1 text-[11px] leading-none text-fg-muted',
        className,
      )}
      {...rest}
    />
  );
}
