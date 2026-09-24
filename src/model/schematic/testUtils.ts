/** Fixture helpers shared by the schematic tests. Not exported from the index. */
import { builtinCatalog } from '@/catalog';
import { ROOT_SHEET_ID, createComponent, createProject } from '../factories';
import type { Component, Id, Project, Route, SymbolDef, Vec2 } from '../types';

export const symbol = (id: string): SymbolDef => {
  const s = builtinCatalog.symbols.find((x) => x.id === id);
  if (!s) throw new Error(`fixture: unknown symbol ${id}`);
  return s;
};

export const LEAF = 'sym.leaf-switch-48x25-8x100';
export const SPINE = 'sym.spine-switch-32x400';
export const SERVER_1U = 'sym.server-1u';
export const SERVER_2U = 'sym.server-2u';
export const GPU = 'sym.gpu-server-4u';
export const PANEL_LC = 'sym.fiber-patch-panel-24lc';

export function fixtureProject(): Project {
  return createProject('fixture', '2026-01-01T00:00:00.000Z');
}

/** Add a component to a project (plain push; use mutations.addComponent for the annotated path). */
export function place(
  project: Project,
  symbolId: string,
  pos: Vec2,
  opts: { ref?: string; sheetId?: Id; expanded?: boolean; value?: string } = {},
): Component {
  const c = createComponent(symbol(symbolId), {
    sheetId: opts.sheetId ?? ROOT_SHEET_ID,
    pos,
    ...(opts.ref !== undefined ? { ref: opts.ref } : {}),
    ...(opts.value !== undefined ? { value: opts.value } : {}),
  });
  if (opts.expanded) c.expandedPins = true;
  project.components.push(c);
  return c;
}

export function emptyRoute(linkId: Id): Route {
  return {
    linkId,
    aRack: { side: 'left', entry: null, pinned: false },
    bRack: { side: 'left', entry: null, pinned: false },
    segments: [],
  };
}
