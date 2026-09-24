import type { HTMLAttributes } from 'react';
import { cn } from './cn';

/** 28px horizontal bar; put ToolbarGroups, separators and a spacer inside. */
export function Toolbar({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="toolbar"
      className={cn('flex h-7 shrink-0 items-center gap-1 border-b border-border bg-panel px-1', className)}
      {...rest}
    />
  );
}

export function ToolbarGroup({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center gap-0.5', className)} {...rest} />;
}

export function ToolbarSeparator({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div role="separator" className={cn('mx-1 h-4 w-px shrink-0 bg-border', className)} {...rest} />;
}

export function ToolbarSpacer() {
  return <div className="flex-1" />;
}

/** Small uppercase caption inside a toolbar. */
export function ToolbarLabel({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('px-1 text-[11px] uppercase tracking-wide text-fg-muted', className)} {...rest} />;
}
