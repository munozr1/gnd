/**
 * Minimal typings for rbush 4 (the package ships none). Scoped to the layout
 * editor; keep in sync with the subset used by ./spatial.ts.
 */
declare module 'rbush' {
  export interface BBox {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }
  export default class RBush<T> {
    constructor(maxEntries?: number);
    insert(item: T): this;
    load(items: readonly T[]): this;
    remove(item: T, equals?: (a: T, b: T) => boolean): this;
    clear(): this;
    search(bbox: BBox): T[];
    all(): T[];
    collides(bbox: BBox): boolean;
    toBBox(item: T): BBox;
    compareMinX(a: T, b: T): number;
    compareMinY(a: T, b: T): number;
    toJSON(): unknown;
    fromJSON(data: unknown): this;
  }
}
