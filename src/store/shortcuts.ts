/**
 * Global keyboard shortcut registry.
 *
 * Shortcuts are registered by id (re-registering an id replaces it) and
 * dispatched from a single keydown listener. Editor-scoped shortcuts only
 * fire while their tab is active and take priority over global ones; among
 * equals, the most recently registered wins. Events from text inputs are
 * ignored unless a shortcut opts in with `allowInInputs`.
 */
import type { EditorId } from '@/model/types';
import { store } from './index';

export type Platform = 'mac' | 'other';

export interface ShortcutDef {
  id: string;
  /** 'mod+z', 'mod+shift+z', 'f8', 'shift+x', 'delete', 'escape', or several alternatives. */
  keys: string | string[];
  /** Only active while this editor tab is active; omit for global. */
  editor?: EditorId;
  /** Extra guard evaluated at dispatch time. */
  when?: () => boolean;
  handler: (e: KeyboardEvent) => void;
  /** Fire even when focus is in an input/textarea/contenteditable. */
  allowInInputs?: boolean;
  /** preventDefault on match; default true. */
  preventDefault?: boolean;
  description?: string;
}

export interface ParsedKeys {
  key: string;
  /** cmd on mac, ctrl elsewhere; resolved at match time. */
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

interface Registered extends ShortcutDef {
  parsed: ParsedKeys[];
  seq: number;
}

const registry = new Map<string, Registered>();
let seq = 0;
let platformOverride: Platform | null = null;

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

export function detectPlatform(): Platform {
  if (platformOverride) return platformOverride;
  if (typeof navigator === 'undefined') return 'other';
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const p = nav.userAgentData?.platform ?? nav.platform ?? nav.userAgent ?? '';
  return /mac|iphone|ipad|ipod/i.test(p) ? 'mac' : 'other';
}

/** Force a platform (tests, or a user preference); null restores detection. */
export function setPlatform(platform: Platform | null): void {
  platformOverride = platform;
}

// ---------------------------------------------------------------------------
// Key parsing and matching
// ---------------------------------------------------------------------------

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  del: 'delete',
  space: ' ',
  spacebar: ' ',
  return: 'enter',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  plus: '+',
  minus: '-',
  pgup: 'pageup',
  pgdn: 'pagedown',
  ins: 'insert',
};

const normalizeKeyName = (k: string): string => {
  const lower = k.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
};

export function parseKeys(keys: string): ParsedKeys {
  const p: ParsedKeys = { key: '', mod: false, ctrl: false, alt: false, shift: false, meta: false };
  // Allow a literal '+' as the key ('mod++' / 'mod+plus').
  const parts = keys.trim().toLowerCase().replace(/\+\+$/, '+plus').split('+');
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    switch (part) {
      case 'mod':
        p.mod = true;
        break;
      case 'ctrl':
      case 'control':
        p.ctrl = true;
        break;
      case 'alt':
      case 'option':
        p.alt = true;
        break;
      case 'shift':
        p.shift = true;
        break;
      case 'meta':
      case 'cmd':
      case 'command':
      case 'win':
      case 'super':
        p.meta = true;
        break;
      default:
        p.key = normalizeKeyName(part);
    }
  }
  if (!p.key) throw new Error(`Shortcut '${keys}' has no key`);
  return p;
}

/** Candidate names for an event: its key, plus the letter/digit from `code` (survives alt/shift remaps). */
function eventKeyNames(e: KeyboardEvent): string[] {
  const names: string[] = [];
  if (typeof e.key === 'string' && e.key.length > 0) names.push(normalizeKeyName(e.key));
  if (typeof e.code === 'string') {
    const m = /^(?:Key|Digit)(.)$/.exec(e.code);
    if (m?.[1]) names.push(m[1].toLowerCase());
  }
  return names;
}

export function matchesEvent(p: ParsedKeys, e: KeyboardEvent, platform: Platform = detectPlatform()): boolean {
  const mac = platform === 'mac';
  const wantCtrl = p.ctrl || (p.mod && !mac);
  const wantMeta = p.meta || (p.mod && mac);
  if (!!e.ctrlKey !== wantCtrl || !!e.metaKey !== wantMeta || !!e.altKey !== p.alt) return false;
  // Punctuation like '?' or '+' already implies shift on most layouts; don't require it.
  const symbolKey = p.key.length === 1 && !/[a-z0-9]/.test(p.key);
  if (!symbolKey && !!e.shiftKey !== p.shift) return false;
  return eventKeyNames(e).includes(p.key);
}

/** Human-readable form for menus and tooltips: '⇧⌘Z' on mac, 'Ctrl+Shift+Z' elsewhere. */
export function formatKeys(keys: string, platform: Platform = detectPlatform()): string {
  const p = parseKeys(keys);
  const mac = platform === 'mac';
  const named: Record<string, string> = {
    escape: 'Esc',
    delete: 'Del',
    backspace: mac ? '⌫' : 'Backspace',
    enter: mac ? '↩' : 'Enter',
    ' ': 'Space',
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    tab: 'Tab',
  };
  const key = named[p.key] ?? (p.key.length === 1 ? p.key.toUpperCase() : p.key.replace(/^f(\d+)$/, 'F$1'));
  if (mac) {
    const mods = [p.ctrl ? '⌃' : '', p.alt ? '⌥' : '', p.shift ? '⇧' : '', p.mod || p.meta ? '⌘' : ''].join('');
    return mods + key;
  }
  const mods: string[] = [];
  if (p.ctrl || p.mod) mods.push('Ctrl');
  if (p.alt) mods.push('Alt');
  if (p.shift) mods.push('Shift');
  if (p.meta) mods.push('Win');
  return [...mods, key].join('+');
}

// ---------------------------------------------------------------------------
// Registry and dispatch
// ---------------------------------------------------------------------------

export function registerShortcut(def: ShortcutDef): () => void {
  const list = Array.isArray(def.keys) ? def.keys : [def.keys];
  const entry: Registered = { ...def, parsed: list.map(parseKeys), seq: ++seq };
  registry.set(def.id, entry);
  return () => {
    if (registry.get(def.id) === entry) registry.delete(def.id);
  };
}

export function unregisterShortcut(id: string): void {
  registry.delete(id);
}

export function listShortcuts(): ShortcutDef[] {
  return [...registry.values()].map(({ parsed: _parsed, seq: _seq, ...def }) => def);
}

const TEXTLESS_INPUT_TYPES = new Set(['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file']);

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object' || !('tagName' in target)) return false;
  const el = target as HTMLElement & { isContentEditable?: boolean; type?: string };
  const tag = String(el.tagName).toUpperCase();
  if (tag === 'INPUT') return !TEXTLESS_INPUT_TYPES.has(String(el.type ?? 'text').toLowerCase());
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return typeof el.closest === 'function' && el.closest('[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]') !== null;
}

const rank = (s: Registered): number => (s.editor !== undefined ? 1_000_000 : 0) + s.seq;

/**
 * Find and run the best matching shortcut for a keydown. Returns true when
 * one handled the event. `activeEditor` defaults to the store's active tab.
 */
export function dispatchKeydown(e: KeyboardEvent, activeEditor: EditorId = store.getState().ui.activeTab): boolean {
  if (e.defaultPrevented || e.isComposing) return false;
  const inInput = isEditableTarget(e.target);
  const platform = detectPlatform();
  let best: Registered | undefined;
  for (const s of registry.values()) {
    if (s.editor !== undefined && s.editor !== activeEditor) continue;
    if (inInput && !s.allowInInputs) continue;
    if (best && rank(s) < rank(best)) continue;
    if (!s.parsed.some((p) => matchesEvent(p, e, platform))) continue;
    if (s.when && !s.when()) continue;
    best = s;
  }
  if (!best) return false;
  if (best.preventDefault !== false) e.preventDefault();
  best.handler(e);
  return true;
}

/** Undo/redo for whichever editor tab is active. Idempotent. */
export function registerGlobalShortcuts(): () => void {
  const tab = () => store.getState().ui.activeTab;
  const offs = [
    registerShortcut({
      id: 'global.undo',
      keys: 'mod+z',
      description: 'Undo',
      when: () => store.getState().canUndo(tab()),
      handler: () => void store.getState().undo(tab()),
    }),
    registerShortcut({
      id: 'global.redo',
      keys: ['mod+shift+z', 'mod+y'],
      description: 'Redo',
      when: () => store.getState().canRedo(tab()),
      handler: () => void store.getState().redo(tab()),
    }),
  ];
  return () => offs.forEach((off) => off());
}

/**
 * Install the keydown listener on `target` (window by default) and register
 * the global shortcuts. Returns an uninstall function.
 */
export function installShortcutListener(target: EventTarget = window): () => void {
  registerGlobalShortcuts();
  const listener = (e: Event) => {
    dispatchKeydown(e as KeyboardEvent);
  };
  target.addEventListener('keydown', listener);
  return () => target.removeEventListener('keydown', listener);
}
