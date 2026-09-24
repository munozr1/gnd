import { useState, type ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './icons';

export interface PanelProps {
  title: ReactNode;
  /** Right-aligned header content (buttons, counts). */
  actions?: ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}

/** Titled dock panel: 24px header, scrolling body, optional collapse. */
export function Panel({
  title,
  actions,
  collapsible = false,
  defaultCollapsed = false,
  collapsed: collapsedProp,
  onCollapsedChange,
  className,
  bodyClassName,
  children,
}: PanelProps) {
  const [collapsedState, setCollapsedState] = useState(defaultCollapsed);
  const collapsed = collapsedProp ?? collapsedState;
  const setCollapsed = (next: boolean) => {
    if (collapsedProp === undefined) setCollapsedState(next);
    onCollapsedChange?.(next);
  };

  return (
    <section
      className={cn('flex min-h-0 flex-col border-border bg-panel', collapsed ? 'shrink-0' : 'flex-1', className)}
      data-collapsed={collapsed || undefined}
    >
      <header className="flex h-6 shrink-0 items-center gap-1 border-b border-border bg-panel-2 px-1">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            className="flex h-5 flex-1 items-center gap-1 rounded px-0.5 text-left text-[12px] font-medium text-fg outline-none hover:bg-panel focus-visible:ring-1 focus-visible:ring-accent"
          >
            <Icon name={collapsed ? 'chevron-right' : 'chevron-down'} size={12} className="text-fg-muted" />
            <span className="truncate">{title}</span>
          </button>
        ) : (
          <span className="flex-1 truncate px-1 text-[12px] font-medium text-fg">{title}</span>
        )}
        {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      </header>
      {!collapsed && <div className={cn('min-h-0 flex-1 overflow-auto', bodyClassName)}>{children}</div>}
    </section>
  );
}
