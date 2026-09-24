import * as Menu from '@radix-ui/react-dropdown-menu';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';
import { cn } from './cn';
import { Icon } from './icons';

export const DropdownMenu = Menu.Root;
export const DropdownMenuTrigger = Menu.Trigger;
export const DropdownMenuGroup = Menu.Group;
export const DropdownMenuSub = Menu.Sub;
export const DropdownMenuRadioGroup = Menu.RadioGroup;

export const MENU_CONTENT_CLASS =
  'z-50 min-w-[180px] max-h-[70vh] overflow-auto rounded border border-border bg-panel-2 p-1 text-[13px] text-fg shadow-xl';

export const MENU_ITEM_CLASS =
  'relative flex h-6 cursor-default select-none items-center gap-2 rounded px-2 pl-6 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-white data-[disabled]:pointer-events-none data-[disabled]:opacity-40';

export const DropdownMenuContent = forwardRef<ElementRef<typeof Menu.Content>, ComponentPropsWithoutRef<typeof Menu.Content>>(
  function DropdownMenuContent({ className, sideOffset = 4, ...rest }, ref) {
    return (
      <Menu.Portal>
        <Menu.Content ref={ref} sideOffset={sideOffset} className={cn(MENU_CONTENT_CLASS, className)} {...rest} />
      </Menu.Portal>
    );
  },
);

export const DropdownMenuSubContent = forwardRef<
  ElementRef<typeof Menu.SubContent>,
  ComponentPropsWithoutRef<typeof Menu.SubContent>
>(function DropdownMenuSubContent({ className, sideOffset = 2, ...rest }, ref) {
  return (
    <Menu.Portal>
      <Menu.SubContent ref={ref} sideOffset={sideOffset} className={cn(MENU_CONTENT_CLASS, className)} {...rest} />
    </Menu.Portal>
  );
});

export interface MenuItemExtras {
  /** Pre-formatted shortcut label shown right-aligned. */
  shortcut?: string;
  inset?: boolean;
}

/** Right-aligned shortcut hint inside a menu item. */
export function MenuShortcut({ children }: { children: ReactNode }) {
  return <span className="ml-auto pl-6 text-[11px] text-fg-muted group-data-[highlighted]:text-white/80">{children}</span>;
}

export const DropdownMenuItem = forwardRef<
  ElementRef<typeof Menu.Item>,
  ComponentPropsWithoutRef<typeof Menu.Item> & MenuItemExtras
>(function DropdownMenuItem({ className, shortcut, children, ...rest }, ref) {
  return (
    <Menu.Item ref={ref} className={cn(MENU_ITEM_CLASS, 'group', className)} {...rest}>
      {children}
      {shortcut && <MenuShortcut>{shortcut}</MenuShortcut>}
    </Menu.Item>
  );
});

export const DropdownMenuCheckboxItem = forwardRef<
  ElementRef<typeof Menu.CheckboxItem>,
  ComponentPropsWithoutRef<typeof Menu.CheckboxItem> & MenuItemExtras
>(function DropdownMenuCheckboxItem({ className, shortcut, children, ...rest }, ref) {
  return (
    <Menu.CheckboxItem ref={ref} className={cn(MENU_ITEM_CLASS, 'group', className)} {...rest}>
      <Menu.ItemIndicator className="absolute left-1.5 inline-flex items-center">
        <Icon name="check" size={12} />
      </Menu.ItemIndicator>
      {children}
      {shortcut && <MenuShortcut>{shortcut}</MenuShortcut>}
    </Menu.CheckboxItem>
  );
});

export const DropdownMenuRadioItem = forwardRef<
  ElementRef<typeof Menu.RadioItem>,
  ComponentPropsWithoutRef<typeof Menu.RadioItem> & MenuItemExtras
>(function DropdownMenuRadioItem({ className, shortcut, children, ...rest }, ref) {
  return (
    <Menu.RadioItem ref={ref} className={cn(MENU_ITEM_CLASS, 'group', className)} {...rest}>
      <Menu.ItemIndicator className="absolute left-1.5 inline-flex items-center">
        <Icon name="dot" size={12} />
      </Menu.ItemIndicator>
      {children}
      {shortcut && <MenuShortcut>{shortcut}</MenuShortcut>}
    </Menu.RadioItem>
  );
});

export const DropdownMenuSubTrigger = forwardRef<
  ElementRef<typeof Menu.SubTrigger>,
  ComponentPropsWithoutRef<typeof Menu.SubTrigger>
>(function DropdownMenuSubTrigger({ className, children, ...rest }, ref) {
  return (
    <Menu.SubTrigger ref={ref} className={cn(MENU_ITEM_CLASS, 'data-[state=open]:bg-panel', className)} {...rest}>
      {children}
      <span className="ml-auto pl-4">
        <Icon name="chevron-right" size={12} />
      </span>
    </Menu.SubTrigger>
  );
});

export const DropdownMenuLabel = forwardRef<ElementRef<typeof Menu.Label>, ComponentPropsWithoutRef<typeof Menu.Label>>(
  function DropdownMenuLabel({ className, ...rest }, ref) {
    return <Menu.Label ref={ref} className={cn('px-2 py-1 text-[11px] uppercase tracking-wide text-fg-muted', className)} {...rest} />;
  },
);

export const DropdownMenuSeparator = forwardRef<
  ElementRef<typeof Menu.Separator>,
  ComponentPropsWithoutRef<typeof Menu.Separator>
>(function DropdownMenuSeparator({ className, ...rest }, ref) {
  return <Menu.Separator ref={ref} className={cn('my-1 h-px bg-border', className)} {...rest} />;
});
