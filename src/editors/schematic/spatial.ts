/**
 * Thin typed wrapper over rbush (which ships no type declarations). Typing
 * the subset we use here, rather than declaring an ambient module, keeps
 * this directory self-contained and cannot clash with a declaration another
 * module might add later.
 */
// @ts-ignore rbush ships no type declarations
import RBushUntyped from 'rbush';

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SpatialIndex<T extends BBox> {
  load(items: readonly T[]): SpatialIndex<T>;
  insert(item: T): SpatialIndex<T>;
  remove(item: T): SpatialIndex<T>;
  search(box: BBox): T[];
  collides(box: BBox): boolean;
  all(): T[];
  clear(): SpatialIndex<T>;
}

type Ctor = new <T extends BBox>(maxEntries?: number) => SpatialIndex<T>;

const RBush = RBushUntyped as unknown as Ctor;

export function createSpatialIndex<T extends BBox>(items?: readonly T[]): SpatialIndex<T> {
  const tree = new RBush<T>();
  if (items && items.length) tree.load(items);
  return tree;
}

export const bboxOfRect = (r: { x: number; y: number; width: number; height: number }, pad = 0): BBox => ({
  minX: r.x - pad,
  minY: r.y - pad,
  maxX: r.x + r.width + pad,
  maxY: r.y + r.height + pad,
});

export const bboxOfPoints = (a: { x: number; y: number }, b: { x: number; y: number }, pad = 0): BBox => ({
  minX: Math.min(a.x, b.x) - pad,
  minY: Math.min(a.y, b.y) - pad,
  maxX: Math.max(a.x, b.x) + pad,
  maxY: Math.max(a.y, b.y) + pad,
});

export const bboxOfPoint = (p: { x: number; y: number }, pad: number): BBox => ({
  minX: p.x - pad,
  minY: p.y - pad,
  maxX: p.x + pad,
  maxY: p.y + pad,
});
