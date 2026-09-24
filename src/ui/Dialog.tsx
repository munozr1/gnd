import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { IconButton } from './IconButton';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export type DialogWidth = 'sm' | 'md' | 'lg' | 'xl';

const WIDTHS: Record<DialogWidth, string> = {
  sm: 'w-[360px]',
  md: 'w-[480px]',
  lg: 'w-[680px]',
  xl: 'w-[900px]',
};

export interface DialogContentProps {
  title: ReactNode;
  description?: ReactNode;
  /** Buttons row; usually a DialogClose and a primary Button. */
  footer?: ReactNode;
  width?: DialogWidth;
  /** Body fills the remaining height and scrolls. */
  className?: string;
  bodyClassName?: string;
  hideClose?: boolean;
  children?: ReactNode;
}

/** Centered modal with a compact title bar. Pair with <Dialog open onOpenChange>. */
export function DialogContent({
  title,
  description,
  footer,
  width = 'md',
  className,
  bodyClassName,
  hideClose = false,
  children,
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/60" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-md border border-border bg-panel text-fg shadow-2xl outline-none',
          WIDTHS[width],
          className,
        )}
      >
        <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3">
          <DialogPrimitive.Title className="flex-1 truncate text-[13px] font-semibold">{title}</DialogPrimitive.Title>
          {!hideClose && (
            <DialogPrimitive.Close asChild>
              <IconButton label="Close" icon="close" noTooltip />
            </DialogPrimitive.Close>
          )}
        </header>
        {description ? (
          <DialogPrimitive.Description className="px-3 pt-2 text-xs text-fg-muted">{description}</DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{typeof title === 'string' ? title : 'Dialog'}</DialogPrimitive.Description>
        )}
        <div className={cn('min-h-0 flex-1 overflow-auto p-3', bodyClassName)}>{children}</div>
        {footer && <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-3 py-2">{footer}</footer>}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
