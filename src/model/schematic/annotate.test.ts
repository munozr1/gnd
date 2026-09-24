import { describe, expect, it } from 'vitest';
import { createSheet } from '../factories';
import { annotate, duplicateRefs, isUnannotated, nextRef, parseRef } from './annotate';
import { LEAF, SERVER_1U, fixtureProject, place } from './testUtils';

describe('ref parsing', () => {
  it('recognises unannotated refs and splits prefix / number', () => {
    expect(isUnannotated('SW?')).toBe(true);
    expect(isUnannotated('SW1')).toBe(false);
    expect(parseRef('SRV12')).toEqual({ prefix: 'SRV', n: 12 });
    expect(parseRef('SW?')).toBeNull();
  });
});

describe('nextRef', () => {
  it('starts at 1 and fills gaps', () => {
    const p = fixtureProject();
    expect(nextRef(p, 'SW')).toBe('SW1');
    place(p, LEAF, { x: 0, y: 0 }, { ref: 'SW1' });
    place(p, LEAF, { x: 0, y: 0 }, { ref: 'SW3' });
    expect(nextRef(p, 'SW')).toBe('SW2');
    expect(nextRef(p, 'SRV')).toBe('SRV1');
  });
});

describe('annotate', () => {
  it('numbers only unannotated refs by default, in y-then-x order, keeping existing numbers', () => {
    const p = fixtureProject();
    const lower = place(p, LEAF, { x: 0, y: 100 });
    const upper = place(p, LEAF, { x: 0, y: 0 });
    const fixed = place(p, LEAF, { x: 0, y: 50 }, { ref: 'SW1' });
    const changes = annotate(p);
    expect(upper.ref).toBe('SW2');
    expect(lower.ref).toBe('SW3');
    expect(fixed.ref).toBe('SW1');
    expect(changes).toEqual([
      { componentId: upper.id, from: 'SW?', to: 'SW2' },
      { componentId: lower.id, from: 'SW?', to: 'SW3' },
    ]);
    expect(annotate(p)).toEqual([]);
  });

  it('numbers each prefix independently', () => {
    const p = fixtureProject();
    const sw = place(p, LEAF, { x: 0, y: 0 });
    const srv = place(p, SERVER_1U, { x: 0, y: 10 });
    annotate(p);
    expect(sw.ref).toBe('SW1');
    expect(srv.ref).toBe('SRV1');
  });

  it("scope 'all' renumbers everything in sheet-then-position order", () => {
    const p = fixtureProject();
    const a = place(p, LEAF, { x: 0, y: 200 }, { ref: 'SW7' });
    const b = place(p, LEAF, { x: 0, y: 0 });
    const c = place(p, LEAF, { x: 100, y: 0 }, { ref: 'SW2' });
    const changes = annotate(p, { scope: 'all' });
    expect([b.ref, c.ref, a.ref]).toEqual(['SW1', 'SW2', 'SW3']);
    // c already was SW2: no change recorded for it.
    expect(changes.map((ch) => ch.componentId)).toEqual([b.id, a.id]);
  });

  it('orders child sheets after their parents', () => {
    const p = fixtureProject();
    const pod = createSheet('Pod A', 'root');
    p.sheets.push(pod);
    const onPod = place(p, LEAF, { x: 0, y: 0 }, { sheetId: pod.id });
    const onRoot = place(p, LEAF, { x: 0, y: 500 });
    annotate(p);
    expect(onRoot.ref).toBe('SW1');
    expect(onPod.ref).toBe('SW2');
  });

  it('restricts to a sheet subtree and avoids numbers used elsewhere', () => {
    const p = fixtureProject();
    const pod = createSheet('Pod A', 'root');
    const rack = createSheet('Rack 1', pod.id);
    p.sheets.push(pod, rack);
    const rootSw = place(p, LEAF, { x: 0, y: 0 }, { ref: 'SW1' });
    const rootUnannotated = place(p, LEAF, { x: 0, y: 600 });
    const podSw = place(p, LEAF, { x: 0, y: 0 }, { sheetId: pod.id, ref: 'SW9' });
    const rackSw = place(p, LEAF, { x: 0, y: 0 }, { sheetId: rack.id });
    annotate(p, { scope: 'all', sheetId: pod.id });
    expect(rootSw.ref).toBe('SW1');
    expect(rootUnannotated.ref).toBe('SW?');
    expect(podSw.ref).toBe('SW2');
    expect(rackSw.ref).toBe('SW3');
  });

  it('falls back to the ref prefix for components with unknown symbols', () => {
    const p = fixtureProject();
    const c = place(p, LEAF, { x: 0, y: 0 }, { ref: 'FW?' });
    c.symbolDefId = 'sym.unknown';
    annotate(p);
    expect(c.ref).toBe('FW1');
  });
});

describe('duplicateRefs', () => {
  it('lists refs shared by several components', () => {
    const p = fixtureProject();
    place(p, LEAF, { x: 0, y: 0 }, { ref: 'SW1' });
    place(p, LEAF, { x: 0, y: 0 }, { ref: 'SW1' });
    place(p, LEAF, { x: 0, y: 0 }, { ref: 'SW2' });
    place(p, LEAF, { x: 0, y: 0 });
    place(p, LEAF, { x: 0, y: 0 });
    const dups = duplicateRefs(p);
    expect([...dups.keys()]).toEqual(['SW1']);
    expect(dups.get('SW1')).toHaveLength(2);
  });
});
