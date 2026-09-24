/**
 * Cross-editor selection helpers. A SelectionItem identifies a model object
 * by kind + id (waypoints by route/segment/id); the same items are highlighted
 * in every editor, which is what makes cross-probing work.
 */
import { indexProject } from '@/model/query';
import type { Project, SelectionItem } from '@/model/types';

export function selectionKey(item: SelectionItem): string {
  return item.kind === 'waypoint'
    ? `waypoint:${item.routeId}:${item.segmentIndex}:${item.waypointId}`
    : `${item.kind}:${item.id}`;
}

export const sameItem = (a: SelectionItem, b: SelectionItem): boolean => selectionKey(a) === selectionKey(b);

export function isSelected(selection: readonly SelectionItem[], item: SelectionItem): boolean {
  const key = selectionKey(item);
  return selection.some((s) => selectionKey(s) === key);
}

export function dedupeSelection(items: readonly SelectionItem[]): SelectionItem[] {
  const seen = new Set<string>();
  const out: SelectionItem[] = [];
  for (const item of items) {
    const key = selectionKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Union; returns `current` unchanged when nothing new is added. */
export function mergeSelection(current: readonly SelectionItem[], items: readonly SelectionItem[]): SelectionItem[] {
  const keys = new Set(current.map(selectionKey));
  const added = dedupeSelection(items).filter((i) => !keys.has(selectionKey(i)));
  return added.length === 0 ? (current as SelectionItem[]) : [...current, ...added];
}

/** Flip membership of each item. */
export function toggleSelection(current: readonly SelectionItem[], items: readonly SelectionItem[]): SelectionItem[] {
  const toggled = new Set(dedupeSelection(items).map(selectionKey));
  const kept = current.filter((i) => !toggled.has(selectionKey(i)));
  const keptKeys = new Set(current.map(selectionKey));
  const added = dedupeSelection(items).filter((i) => !keptKeys.has(selectionKey(i)));
  return [...kept, ...added];
}

/** Whether the object a selection item refers to still exists in the project. */
export function selectionItemExists(project: Project, item: SelectionItem): boolean {
  const idx = indexProject(project);
  switch (item.kind) {
    case 'component':
      return idx.componentById.has(item.id);
    case 'link':
      return idx.linkById.has(item.id);
    case 'rack':
      return idx.rackById.has(item.id);
    case 'tray':
      return project.trays.some((t) => t.id === item.id);
    case 'sheet':
      return project.sheets.some((s) => s.id === item.id);
    case 'keepout':
      return project.keepouts.some((k) => k.id === item.id);
    case 'accessory':
      return project.accessories.some((a) => a.id === item.id);
    case 'waypoint': {
      const seg = project.routes[item.routeId]?.segments[item.segmentIndex];
      return seg !== undefined && seg.points.some((w) => w.id === item.waypointId);
    }
  }
}

/** Drop items that no longer exist. Returns `selection` itself when nothing changed. */
export function pruneSelection(project: Project, selection: readonly SelectionItem[]): SelectionItem[] {
  if (selection.length === 0) return selection as SelectionItem[];
  const kept = selection.filter((item) => selectionItemExists(project, item));
  return kept.length === selection.length ? (selection as SelectionItem[]) : kept;
}
