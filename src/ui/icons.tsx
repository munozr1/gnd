/**
 * Tiny inline icon set (16x16 grid, stroked with currentColor) so the shell
 * has no icon-font dependency. Add names here rather than pasting SVG inline.
 */
import type { ReactNode, SVGProps } from 'react';

export type IconName =
  | 'chevron-down'
  | 'chevron-right'
  | 'chevron-up'
  | 'close'
  | 'error'
  | 'warning'
  | 'info'
  | 'check'
  | 'undo'
  | 'redo'
  | 'plus'
  | 'trash'
  | 'folder'
  | 'save'
  | 'search'
  | 'sync'
  | 'play'
  | 'list'
  | 'dot'
  | 'ok'
  | 'file'
  | 'keyboard';

const PATHS: Record<IconName, ReactNode> = {
  'chevron-down': <path d="M4 6l4 4 4-4" />,
  'chevron-right': <path d="M6 4l4 4-4 4" />,
  'chevron-up': <path d="M4 10l4-4 4 4" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  error: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5" />
    </>
  ),
  warning: (
    <>
      <path d="M8 2.25L14.25 13H1.75L8 2.25z" />
      <path d="M8 6.25v3.25M8 11.25v.25" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v4M8 4.75v.25" />
    </>
  ),
  check: <path d="M3 8.5l3 3 7-7" />,
  ok: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M5.25 8.25l2 2 3.5-4" />
    </>
  ),
  undo: <path d="M6.5 4L3 7.5 6.5 11M3 7.5h6.5a3 3 0 010 6H8" />,
  redo: <path d="M9.5 4L13 7.5 9.5 11M13 7.5H6.5a3 3 0 000 6H8" />,
  plus: <path d="M8 3v10M3 8h10" />,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.75 8.5h5.5l.75-8.5M6.75 7v4M9.25 7v4" />,
  folder: <path d="M2 4.5A1.5 1.5 0 013.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0114 6v6a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12V4.5z" />,
  save: <path d="M3 3h8l2 2v8H3V3zM5.5 3v3.5h5V3M5.5 13V9h5v4" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3.5 3.5" />
    </>
  ),
  sync: <path d="M13 8A5 5 0 004.5 4.4M3 8a5 5 0 008.5 3.6M4.5 2v2.5H7M11.5 14v-2.5H9" />,
  play: <path d="M5 3l8 5-8 5V3z" />,
  list: <path d="M3 4h1M6 4h7M3 8h1M6 8h7M3 12h1M6 12h7" />,
  dot: <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" />,
  file: <path d="M4 2h5l3 3v9H4V2zM9 2v3h3" />,
  keyboard: <path d="M2 4.5h12v7H2v-7zM4.5 7h1M7.5 7h1M10.5 7h1M4.5 9h7" />,
};

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 14, className, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

export type SeverityLike = 'error' | 'warning' | 'info' | 'ignore';

/** Severity glyph with its theme colour, for issue lists and status counts. */
export function SeverityIcon({ severity, size = 14 }: { severity: SeverityLike; size?: number }) {
  const name: IconName = severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'info';
  const color =
    severity === 'error'
      ? 'text-error'
      : severity === 'warning'
        ? 'text-warning'
        : severity === 'info'
          ? 'text-info'
          : 'text-fg-muted';
  return <Icon name={name} size={size} className={`shrink-0 ${color}`} />;
}
