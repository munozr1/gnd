import { describe, expect, it } from 'vitest';
import { createLink } from '../factories';
import {
  autoWirePoints,
  dragWireSegment,
  fullWirePolyline,
  hitTestWire,
  sheetWires,
  simplifyWire,
  wireEndpoints,
  wireLabelAnchor,
  wireMidpoint,
  wirePointsFromPolyline,
} from './wires';
import { LEAF, SPINE, fixtureProject, place } from './testUtils';
import { createSheet } from '../factories';

const R = { x: 1, y: 0 };
const L = { x: -1, y: 0 };

describe('autoWirePoints', () => {
  it('jogs at the midpoint between facing pins', () => {
    expect(autoWirePoints({ x: 0, y: 0 }, R, { x: 100, y: 50 }, L)).toEqual([
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ]);
  });

  it('is empty for aligned facing pins', () => {
    expect(autoWirePoints({ x: 0, y: 0 }, R, { x: 100, y: 0 }, L)).toEqual([]);
  });

  it('keeps every segment orthogonal', () => {
    const pts = [{ x: 0, y: 0 }, ...autoWirePoints({ x: 0, y: 0 }, R, { x: 30, y: 70 }, { x: 0, y: -1 }), { x: 30, y: 70 }];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });
});

describe('fullWirePolyline', () => {
  it('joins pin ends with auto elbows when no points are stored', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 0, y: 0 }, { expanded: true });
    const spine = place(p, SPINE, { x: 600, y: 0 }, { expanded: true });
    const link = createLink({ componentId: leaf.id, portId: 'eth1/49' }, { componentId: spine.id, portId: 'eth1/1' });
    p.links.push(link);
    // eth1/49 is R offset 10 -> (220, 10); spine eth1/1 is L offset 10 -> (580, 10)
    expect(fullWirePolyline(link, p)).toEqual([
      { x: 220, y: 10 },
      { x: 580, y: 10 },
    ]);
  });

  it('uses stored wire points verbatim', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 0, y: 0 }, { expanded: true });
    const spine = place(p, SPINE, { x: 600, y: 0 }, { expanded: true });
    const link = createLink({ componentId: leaf.id, portId: 'eth1/49' }, { componentId: spine.id, portId: 'eth1/1' });
    link.sch.wirePoints = [
      { x: 300, y: 10 },
      { x: 300, y: 200 },
      { x: 500, y: 200 },
      { x: 500, y: 10 },
    ];
    p.links.push(link);
    expect(fullWirePolyline(link, p)).toEqual([{ x: 220, y: 10 }, ...link.sch.wirePoints, { x: 580, y: 10 }]);
  });

  it('attaches to visible pins under collapse (a linked pin is never hidden)', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 0, y: 0 });
    const spine = place(p, SPINE, { x: 600, y: 0 });
    const link = createLink({ componentId: leaf.id, portId: 'eth1/40' }, { componentId: spine.id, portId: 'eth1/30' });
    p.links.push(link);
    const ends = wireEndpoints(link, p)!;
    expect(ends.a.hidden).toBe(false);
    expect(ends.b.hidden).toBe(false);
    // eth1/40 is the 12th visible pin on the packed left side.
    expect(ends.a.pos).toEqual({ x: -20, y: 120 });
    expect(fullWirePolyline(link, p).length).toBeGreaterThanOrEqual(2);
  });

  it('is empty when an end cannot be resolved', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 0, y: 0 });
    const link = createLink({ componentId: leaf.id, portId: 'eth1/1' }, { componentId: 'ghost', portId: 'x' });
    expect(fullWirePolyline(link, p)).toEqual([]);
  });

  it('sheetWires lists only links with both ends on the sheet', () => {
    const p = fixtureProject();
    const pod = createSheet('Pod', 'root', { x: 0, y: 0 });
    p.sheets.push(pod);
    const a = place(p, LEAF, { x: 0, y: 0 });
    const b = place(p, SPINE, { x: 600, y: 0 });
    const c = place(p, SPINE, { x: 0, y: 0 }, { sheetId: pod.id });
    const inside = createLink({ componentId: a.id, portId: 'eth1/49' }, { componentId: b.id, portId: 'eth1/1' });
    const cross = createLink({ componentId: a.id, portId: 'eth1/50' }, { componentId: c.id, portId: 'eth1/1' });
    p.links.push(inside, cross);
    expect(sheetWires(p, 'root').map((w) => w.link.id)).toEqual([inside.id]);
    expect(sheetWires(p, pod.id)).toEqual([]);
  });
});

describe('dragWireSegment', () => {
  const base = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 50 },
    { x: 100, y: 50 },
  ];

  it('moves a vertical segment horizontally only', () => {
    const out = dragWireSegment(base, 1, { x: 10, y: 99 });
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 60, y: 0 },
      { x: 60, y: 50 },
      { x: 100, y: 50 },
    ]);
    expect(base[1]).toEqual({ x: 50, y: 0 }); // input untouched
  });

  it('keeps pin ends fixed by inserting a lead when dragging the first segment', () => {
    expect(dragWireSegment(base, 0, { x: 0, y: 20 })).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 20 },
      { x: 50, y: 20 },
      { x: 50, y: 50 },
      { x: 100, y: 50 },
    ]);
  });

  it('keeps pin ends fixed when dragging the last segment', () => {
    expect(dragWireSegment(base, 2, { x: 0, y: -30 })).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 20 },
      { x: 100, y: 20 },
      { x: 100, y: 50 },
    ]);
  });

  it('handles a straight two-point wire', () => {
    const out = dragWireSegment([{ x: 0, y: 0 }, { x: 100, y: 0 }], 0, { x: 0, y: 30 });
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 30 },
      { x: 100, y: 30 },
      { x: 100, y: 0 },
    ]);
    expect(simplifyWire(out)).toEqual(out);
    expect(wirePointsFromPolyline(out)).toEqual([
      { x: 0, y: 30 },
      { x: 100, y: 30 },
    ]);
  });

  it('ignores out-of-range segments', () => {
    expect(dragWireSegment(base, 7, { x: 5, y: 5 })).toEqual(base);
  });
});

describe('labels and hit-testing', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 50 },
    { x: 100, y: 50 },
  ];

  it('finds the midpoint by length', () => {
    expect(wireMidpoint([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toEqual({ x: 50, y: 0 });
    expect(wireMidpoint(pts)).toEqual({ x: 50, y: 25 });
    expect(wireLabelAnchor(pts)).toEqual({ pos: { x: 50, y: 25 }, horizontal: false, segmentIndex: 1 });
    expect(wireMidpoint([])).toEqual({ x: 0, y: 0 });
  });

  it('hits the nearest segment within tolerance', () => {
    expect(hitTestWire(pts, { x: 25, y: 3 }, 5)).toEqual({ segmentIndex: 0, point: { x: 25, y: 0 }, dist: 3 });
    expect(hitTestWire(pts, { x: 52, y: 30 }, 5)?.segmentIndex).toBe(1);
    expect(hitTestWire(pts, { x: 25, y: 10 }, 5)).toBeNull();
    expect(hitTestWire([], { x: 0, y: 0 }, 5)).toBeNull();
  });
});
