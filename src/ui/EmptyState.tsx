import type { ReactNode } from 'react';
import { cn } from './cn';
import { Icon, type IconName } from './icons';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  /** A button or link shown under the text. */
  action?: ReactNode;
  className?: string;
}

/** Centered placeholder for empty lists and unloaded editors. */
export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex h-full w-full flex-col items-center justify-center gap-1 p-6 text-center', className)}>
      {icon && <Icon name={icon} size={22} className="mb-1 text-fg-muted/70" />}
      <div className="text-[13px] font-medium text-fg">{title}</div>
      {description && <div className="max-w-xs text-xs text-fg-muted">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
