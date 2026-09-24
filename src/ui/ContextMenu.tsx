import * as CM from '@radix-ui/react-context-menu';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from './cn';
import { MENU_CONTENT_CLASS, MENU_ITEM_CLASS, MenuShortcut, type MenuItemExtras } from './DropdownMenu';
import { Icon } from './icons';

export const ContextMenu = CM.Root;
export const ContextMenuTrigger = CM.Trigger;
export const ContextMenuGroup = CM.Group;
export const ContextMenuSub = CM.Sub;
export const ContextMenuRadioGroup = CM.RadioGroup;

export const ContextMenuContent = forwardRef<ElementRef<typeof CM.Content>, ComponentPropsWithoutRef<typeof CM.Content>>(
  function ContextMenuContent({ className, ...rest }, ref) {
    return (
      <CM.Portal>
        <CM.Content ref={ref} className={cn(MENU_CONTENT_CLASS, className)} {...rest} />
      </CM.Portal>
    );
  },
);

export const ContextMenuSubContent = forwardRef<ElementRef<typeof CM.SubContent>, ComponentPropsWithoutRef<typeof CM.SubContent>>(
  function ContextMenuSubContent({ className, ...rest }, ref) {
    return (
      <CM.Portal>
        <CM.SubContent ref={ref} className={cn(MENU_CONTENT_CLASS, className)} {...rest} />
      </CM.Portal>
    );
  },
);

export const ContextMenuItem = forwardRef<ElementRef<typeof CM.Item>, ComponentPropsWithoutRef<typeof CM.Item> & MenuItemExtras>(
  function ContextMenuItem({ className, shortcut, children, ...rest }, ref) {
    return (
      <CM.Item ref={ref} className={cn(MENU_ITEM_CLASS, 'group', className)} {...rest}>
        {children}
        {shortcut && <MenuShortcut>{shortcut}</MenuShortcut>}
      </CM.Item>
    );
  },
);

export const ContextMenuCheckboxItem = forwardRef<
  ElementRef<typeof CM.CheckboxItem>,
  ComponentPropsWithoutRef<typeof CM.CheckboxItem> & MenuItemExtras
>(function ContextMenuCheckboxItem({ className, shortcut, children, ...rest }, ref) {
  return (
    <CM.CheckboxItem ref={ref} className={cn(MENU_ITEM_CLASS, 'group', className)} {...rest}>
      <CM.ItemIndicator className="absolute left-1.5 inline-flex items-center">
        <Icon name="check" size={12} />
      </CM.ItemIndicator>
      {children}
      {shortcut && <MenuShortcut>{shortcut}</MenuShortcut>}
    </CM.CheckboxItem>
  );
});

export const ContextMenuRadioItem = forwardRef<
  ElementRef<typeof CM.RadioItem>,
  ComponentPropsWithoutRef<typeof CM.RadioItem> & MenuItemExtras
>(function ContextMenuRadioItem({ className, shortcut, children, ...rest }, ref) {
  return (
    <CM.RadioItem ref={ref} className={cn(MENU_ITEM_CLASS, 'group', className)} {...rest}>
      <CM.ItemIndicator className="absolute left-1.5 inline-flex items-center">
        <Icon name="dot" size={12} />
      </CM.ItemIndicator>
      {children}
      {shortcut && <MenuShortcut>{shortcut}</MenuShortcut>}
    </CM.RadioItem>
  );
});

export const ContextMenuSubTrigger = forwardRef<ElementRef<typeof CM.SubTrigger>, ComponentPropsWithoutRef<typeof CM.SubTrigger>>(
  function ContextMenuSubTrigger({ className, children, ...rest }, ref) {
    return (
      <CM.SubTrigger ref={ref} className={cn(MENU_ITEM_CLASS, 'data-[state=open]:bg-panel', className)} {...rest}>
        {children}
        <span className="ml-auto pl-4">
          <Icon name="chevron-right" size={12} />
        </span>
      </CM.SubTrigger>
    );
  },
);

export const ContextMenuLabel = forwardRef<ElementRef<typeof CM.Label>, ComponentPropsWithoutRef<typeof CM.Label>>(
  function ContextMenuLabel({ className, ...rest }, ref) {
    return <CM.Label ref={ref} className={cn('px-2 py-1 text-[11px] uppercase tracking-wide text-fg-muted', className)} {...rest} />;
  },
);

export const ContextMenuSeparator = forwardRef<ElementRef<typeof CM.Separator>, ComponentPropsWithoutRef<typeof CM.Separator>>(
  function ContextMenuSeparator({ className, ...rest }, ref) {
    return <CM.Separator ref={ref} className={cn('my-1 h-px bg-border', className)} {...rest} />;
  },
);
