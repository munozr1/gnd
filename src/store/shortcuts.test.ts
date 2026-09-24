import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '@/model/factories';
import { command, emptyHistory, initialUi, store, useStore } from './index';
import {
  dispatchKeydown,
  formatKeys,
  installShortcutListener,
  isEditableTarget,
  listShortcuts,
  matchesEvent,
  parseKeys,
  registerShortcut,
  setPlatform,
  unregisterShortcut,
} from './shortcuts';

const key = (init: KeyboardEventInit & { key: string }, target: EventTarget = window): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (target !== window) Object.defineProperty(e, 'target', { value: target });
  return e;
};

beforeEach(() => {
  useStore.setState({ project: createProject('Untitled'), history: emptyHistory(), ui: initialUi() });
  setPlatform('mac');
});

afterEach(() => {
  setPlatform(null);
  for (const s of listShortcuts()) unregisterShortcut(s.id);
});

describe('parseKeys / matchesEvent', () => {
  it('parses modifier combinations and aliases', () => {
    expect(parseKeys('mod+shift+z')).toEqual({ key: 'z', mod: true, ctrl: false, alt: false, shift: true, meta: false });
    expect(parseKeys('F8').key).toBe('f8');
    expect(parseKeys('Esc').key).toBe('escape');
    expect(parseKeys('ctrl+alt+Del')).toMatchObject({ key: 'delete', ctrl: true, alt: true });
    expect(parseKeys('mod++').key).toBe('+');
    expect(parseKeys('space').key).toBe(' ');
    expect(() => parseKeys('shift+')).toThrow();
  });

  it("'mod' means cmd on mac and ctrl elsewhere", () => {
    const p = parseKeys('mod+z');
    expect(matchesEvent(p, key({ key: 'z', metaKey: true }), 'mac')).toBe(true);
    expect(matchesEvent(p, key({ key: 'z', ctrlKey: true }), 'mac')).toBe(false);
    expect(matchesEvent(p, key({ key: 'z', ctrlKey: true }), 'other')).toBe(true);
    expect(matchesEvent(p, key({ key: 'z', metaKey: true }), 'other')).toBe(false);
    expect(matchesEvent(p, key({ key: 'z' }), 'mac')).toBe(false);
    expect(matchesEvent(p, key({ key: 'z', metaKey: true, shiftKey: true }), 'mac')).toBe(false);
  });

  it('matches shifted letters, function keys and code-based fallbacks', () => {
    expect(matchesEvent(parseKeys('shift+x'), key({ key: 'X', shiftKey: true }))).toBe(true);
    expect(matchesEvent(parseKeys('x'), key({ key: 'X', shiftKey: true }))).toBe(false);
    expect(matchesEvent(parseKeys('f8'), key({ key: 'F8' }))).toBe(true);
    expect(matchesEvent(parseKeys('mod+shift+z'), key({ key: 'Z', code: 'KeyZ', metaKey: true, shiftKey: true }))).toBe(true);
    // alt+letter on mac yields a special character in `key`; `code` still identifies it.
    expect(matchesEvent(parseKeys('alt+r'), key({ key: '®', code: 'KeyR', altKey: true }))).toBe(true);
    // punctuation that needs shift on most layouts does not require shift in the definition
    expect(matchesEvent(parseKeys('?'), key({ key: '?', shiftKey: true }))).toBe(true);
  });

  it('formats for display per platform', () => {
    expect(formatKeys('mod+shift+z', 'mac')).toBe('⇧⌘Z');
    expect(formatKeys('mod+shift+z', 'other')).toBe('Ctrl+Shift+Z');
    expect(formatKeys('f8', 'other')).toBe('F8');
    expect(formatKeys('delete', 'other')).toBe('Del');
  });
});

describe('isEditableTarget', () => {
  it('flags text inputs, textareas and contenteditable but not buttons or checkboxes', () => {
    const text = document.createElement('input');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const textarea = document.createElement('textarea');
    const button = document.createElement('button');
    const ce = document.createElement('div');
    ce.setAttribute('contenteditable', 'true');
    const inner = document.createElement('span');
    ce.appendChild(inner);
    expect(isEditableTarget(text)).toBe(true);
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(textarea)).toBe(true);
    expect(isEditableTarget(button)).toBe(false);
    expect(isEditableTarget(ce)).toBe(true);
    expect(isEditableTarget(inner)).toBe(true);
    expect(isEditableTarget(document.body)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('dispatch', () => {
  it('runs a matching global shortcut and prevents default', () => {
    const handler = vi.fn();
    registerShortcut({ id: 't.f8', keys: 'f8', handler });
    const e = key({ key: 'F8' });
    expect(dispatchKeydown(e)).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
    expect(dispatchKeydown(key({ key: 'F7' }))).toBe(false);
  });

  it('scopes editor shortcuts to the active tab, preferring them over globals', () => {
    const global = vi.fn();
    const schematic = vi.fn();
    const layout = vi.fn();
    registerShortcut({ id: 'g', keys: 'r', handler: global });
    registerShortcut({ id: 's', keys: 'r', editor: 'schematic', handler: schematic });
    registerShortcut({ id: 'l', keys: 'r', editor: 'layout', handler: layout });

    dispatchKeydown(key({ key: 'r' }));
    expect(schematic).toHaveBeenCalledOnce();
    expect(global).not.toHaveBeenCalled();

    store.getState().setActiveTab('layout');
    dispatchKeydown(key({ key: 'r' }));
    expect(layout).toHaveBeenCalledOnce();

    store.getState().setActiveTab('viewer3d');
    dispatchKeydown(key({ key: 'r' }));
    expect(global).toHaveBeenCalledOnce();
    expect(schematic).toHaveBeenCalledOnce();
    expect(layout).toHaveBeenCalledOnce();
  });

  it('respects `when`, ignores editable targets unless allowed, and honours re-registration', () => {
    const a = vi.fn();
    const b = vi.fn();
    registerShortcut({ id: 'x', keys: 'x', when: () => false, handler: a });
    expect(dispatchKeydown(key({ key: 'x' }))).toBe(false);

    const off = registerShortcut({ id: 'x', keys: 'x', handler: b });
    expect(dispatchKeydown(key({ key: 'x' }))).toBe(true);
    expect(b).toHaveBeenCalledOnce();

    const input = document.createElement('input');
    expect(dispatchKeydown(key({ key: 'x' }, input))).toBe(false);
    registerShortcut({ id: 'x', keys: 'x', handler: b, allowInInputs: true });
    expect(dispatchKeydown(key({ key: 'x' }, input))).toBe(true);

    off(); // stale unregister must not remove the newer registration
    expect(dispatchKeydown(key({ key: 'x' }))).toBe(true);
    unregisterShortcut('x');
    expect(dispatchKeydown(key({ key: 'x' }))).toBe(false);
  });

  it('skips events already handled or from IME composition', () => {
    const handler = vi.fn();
    registerShortcut({ id: 'q', keys: 'q', handler });
    const handled = key({ key: 'q' });
    handled.preventDefault();
    expect(dispatchKeydown(handled)).toBe(false);
    expect(dispatchKeydown(key({ key: 'q', isComposing: true }))).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('installShortcutListener + global undo/redo', () => {
  it('mod+z undoes and mod+shift+z / mod+y redo for the active editor', () => {
    const uninstall = installShortcutListener(window);
    const s = store.getState();
    s.execute(
      command('Rename', 'schematic', (d) => {
        d.name = 'A';
      }),
    );
    s.execute(
      command('Grid', 'layout', (d) => {
        d.room.gridMm = 610;
      }),
    );

    // schematic is active: mod+z undoes the schematic entry only
    window.dispatchEvent(key({ key: 'z', metaKey: true }));
    expect(store.getState().project.name).toBe('Untitled');
    expect(store.getState().project.room.gridMm).toBe(610);

    window.dispatchEvent(key({ key: 'z', metaKey: true, shiftKey: true }));
    expect(store.getState().project.name).toBe('A');

    store.getState().setActiveTab('layout');
    window.dispatchEvent(key({ key: 'z', metaKey: true }));
    expect(store.getState().project.room.gridMm).toBe(600);
    window.dispatchEvent(key({ key: 'y', metaKey: true }));
    expect(store.getState().project.room.gridMm).toBe(610);

    // ctrl+z is not 'mod' on mac
    window.dispatchEvent(key({ key: 'z', ctrlKey: true }));
    expect(store.getState().project.room.gridMm).toBe(610);

    // nothing to undo in the 3D viewer: the event passes through untouched
    store.getState().setActiveTab('viewer3d');
    const e = key({ key: 'z', metaKey: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);

    uninstall();
    store.getState().setActiveTab('layout');
    window.dispatchEvent(key({ key: 'z', metaKey: true }));
    expect(store.getState().project.room.gridMm).toBe(610);
  });

  it('uses ctrl on other platforms', () => {
    setPlatform('other');
    const uninstall = installShortcutListener(window);
    store.getState().execute(
      command('Rename', 'schematic', (d) => {
        d.name = 'A';
      }),
    );
    window.dispatchEvent(key({ key: 'z', ctrlKey: true }));
    expect(store.getState().project.name).toBe('Untitled');
    window.dispatchEvent(key({ key: 'y', ctrlKey: true }));
    expect(store.getState().project.name).toBe('A');
    uninstall();
  });
});
