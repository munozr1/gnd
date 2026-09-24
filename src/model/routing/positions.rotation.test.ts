/**
 * Adversarial tests for physical positions under rack rotation 0/90/180/270.
 */
import { describe, expect, it } from 'vitest';
import { createProject } from '../factories';
import { rectContains, rectsIntersect, type Rect } from '../geometry';
import type { Rotation } from '../types';
import { autoInRackPath, inRackPolyline3d } from './dressing';
import {
  DEFAULT_DEVICE_WIDTH_MM,
  facePointToFloor,
  managerFloorCenter,
  managerFloorRect,
  portFloorPos,
  portWorldPos,
  rackAcrossDir,
  rackCenter,
  rackEntryPoints,
  rackFloorRect,
  rackFrontDir,
  rackLocalToFloor,
} from './positions';
import { addAccessory, addDevice, addRack, place, twoRackFixture } from './test-fixtures';

const ROTS: Rotation[] = [0, 90, 180, 270];
const inset = (600 - DEFAULT_DEVICE_WIDTH_MM) / 2;
const ETH1_X = 24.610416666666666;
const close = (a: { x: number; y: number }, b: { x: number; y: number }): void => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};
const onRectEdge = (r: Rect, p: { x: number; y: number }): boolean =>
  rectContains(r, p) &&
  (Math.abs(p.x - r.x) < 1e-6 ||
    Math.abs(p.x - (r.x + r.width)) < 1e-6 ||
    Math.abs(p.y - r.y) < 1e-6 ||
    Math.abs(p.y - (r.y + r.height)) < 1e-6);

describe('rack axes', () => {
  it('front and across directions stay perpendicular unit vectors', () => {
    for (const rotationDeg of ROTS) {
      const f = rackFrontDir({ rotationDeg });
      const u = rackAcrossDir({ rotationDeg });
      expect(Math.hypot(f.x, f.y)).toBeCloseTo(1, 12);
      expect(Math.hypot(u.x, u.y)).toBeCloseTo(1, 12);
      expect(f.x * u.x + f.y * u.y).toBeCloseTo(0, 12);
      // Right-handed on the canvas: rotating "across" by +90 gives "front".
      expect(-u.y).toBeCloseTo(f.x, 12);
      expect(u.x).toBeCloseTo(f.y, 12);
    }
  });

  it('rack-local corners map onto the floor rect for every rotation', () => {
    const p = createProject();
    for (const rot of ROTS) {
      const r = addRack(p, `R${rot}`, { x: 1000, y: 1000 }, rot);
      const rect = rackFloorRect(r);
      const corners = [
        { across: 0, depth: 0 },
        { across: 600, depth: 0 },
        { across: 0, depth: 1070 },
        { across: 600, depth: 1070 },
      ].map((l) => rackLocalToFloor(r, l));
      for (const c of corners) expect(onRectEdge(rect, c)).toBe(true);
      close(rackLocalToFloor(r, { across: 300, depth: 535 }), rackCenter(r));
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      expect(Math.min(...xs)).toBeCloseTo(rect.x, 6);
      expect(Math.max(...xs)).toBeCloseTo(rect.x + rect.width, 6);
      expect(Math.min(...ys)).toBeCloseTo(rect.y, 6);
      expect(Math.max(...ys)).toBeCloseTo(rect.y + rect.height, 6);
    }
  });
});

describe('port positions under rotation', () => {
  const expectedFront: Record<Rotation, { x: number; y: number }> = {
    0: { x: 1000 + inset + ETH1_X, y: 2070 },
    90: { x: 1000, y: 1000 + inset + ETH1_X },
    180: { x: 1600 - (inset + ETH1_X), y: 1000 },
    270: { x: 2070, y: 1600 - (inset + ETH1_X) },
  };

  it('a front port sits on the front edge at each rotation', () => {
    for (const rot of ROTS) {
      const { project, sw1, r1 } = twoRackFixture();
      r1.rotationDeg = rot;
      const pos = portFloorPos(project, sw1.id, 'eth1/1')!;
      close(pos, expectedFront[rot]);
      expect(onRectEdge(rackFloorRect(r1), pos)).toBe(true);
      // The port lies on the face the front direction points to.
      const c = rackCenter(r1);
      const f = rackFrontDir(r1);
      expect((pos.x - c.x) * f.x + (pos.y - c.y) * f.y).toBeCloseTo(535, 6);
    }
  });

  it('a rear-placed device moves its front ports to the rear edge, mirrored, at each rotation', () => {
    for (const rot of ROTS) {
      const { project, sw1, r1 } = twoRackFixture();
      r1.rotationDeg = rot;
      place(project, sw1.id, r1.id, 40, 'rear');
      const pos = portFloorPos(project, sw1.id, 'eth1/1')!;
      const front = expectedFront[rot];
      const c = rackCenter(r1);
      // Point reflection through the rack centre: rear face, mirrored across the width.
      close(pos, { x: 2 * c.x - front.x, y: 2 * c.y - front.y });
      expect(onRectEdge(rackFloorRect(r1), pos)).toBe(true);
    }
  });

  it('a rear port and a rear-placed front port with the same faceplate x coincide', () => {
    for (const rot of ROTS) {
      const p = createProject();
      const r = addRack(p, 'R', { x: 1000, y: 1000 }, rot);
      const pp = addDevice(p, 'sym.fiber-patch-panel-24lc', 'PP1', { rackId: r.id, u: 10 });
      const rear = portFloorPos(p, pp.id, 'r1')!;
      place(p, pp.id, r.id, 10, 'rear');
      const flipped = portFloorPos(p, pp.id, 'f1')!;
      close(rear, flipped);
      close(rear, facePointToFloor(r, 'rear', inset + 29.22083333333333));
    }
  });

  it('world position projects back to the floor position at every rotation', () => {
    for (const rot of ROTS) {
      const { project, sw1, r1 } = twoRackFixture();
      r1.rotationDeg = rot;
      const w = portWorldPos(project, sw1.id, 'eth1/49')!;
      const fl = portFloorPos(project, sw1.id, 'eth1/49')!;
      expect(w.x).toBe(fl.x);
      expect(w.z).toBe(fl.y);
      expect(w.y).toBeCloseTo(39 * 44.45 + 26, 6);
      expect([w.x, w.y, w.z].every(Number.isFinite)).toBe(true);
    }
  });
});

describe('entry points and managers under rotation', () => {
  const expectedTopLeft: Record<Rotation, { x: number; y: number }> = {
    0: { x: 1150, y: 1535 },
    90: { x: 1535, y: 1150 },
    180: { x: 1450, y: 1535 },
    270: { x: 1535, y: 1450 },
  };

  it('top entries sit at the roof quarter points, mirrored through the centre', () => {
    const p = createProject();
    for (const rot of ROTS) {
      const r = addRack(p, `R${rot}`, { x: 1000, y: 1000 }, rot);
      const e = rackEntryPoints(p, r);
      const c = rackCenter(r);
      close(e.topLeft, expectedTopLeft[rot]);
      close(e.topRight, { x: 2 * c.x - e.topLeft.x, y: 2 * c.y - e.topLeft.y });
      close(e.bottom, c);
      expect(rectContains(rackFloorRect(r), e.topLeft)).toBe(true);
      expect(rectContains(rackFloorRect(r), e.topRight)).toBe(true);
      // Left entry is on the viewer's left: negative along the across direction.
      const u = rackAcrossDir(r);
      expect((e.topLeft.x - c.x) * u.x + (e.topLeft.y - c.y) * u.y).toBeCloseTo(-150, 6);
    }
  });

  it('a faced top entry shifts along the front direction', () => {
    for (const rot of ROTS) {
      const p = createProject();
      const r = addRack(p, 'R', { x: 1000, y: 1000 }, rot);
      addAccessory(p, r.id, 'top-entry', { side: 'left', face: 'front' });
      addAccessory(p, r.id, 'top-entry', { side: 'right', face: 'rear' });
      const e = rackEntryPoints(p, r);
      const c = rackCenter(r);
      const f = rackFrontDir(r);
      expect((e.topLeft.x - c.x) * f.x + (e.topLeft.y - c.y) * f.y).toBeCloseTo(267.5, 6);
      expect((e.topRight.x - c.x) * f.x + (e.topRight.y - c.y) * f.y).toBeCloseTo(-267.5, 6);
      expect(rectContains(rackFloorRect(r), e.topLeft)).toBe(true);
      expect(rectContains(rackFloorRect(r), e.topRight)).toBe(true);
    }
  });

  it('fitted managers stand flush beside the rack on the correct side at every rotation', () => {
    for (const rot of ROTS) {
      const p = createProject();
      const r = addRack(p, 'R', { x: 1000, y: 1000 }, rot);
      addAccessory(p, r.id, 'vcm', { side: 'left', widthMm: 152 });
      addAccessory(p, r.id, 'vcm', { side: 'right', widthMm: 254 });
      const rect = rackFloorRect(r);
      const c = rackCenter(r);
      const u = rackAcrossDir(r);
      for (const [side, w, sign] of [['left', 152, -1], ['right', 254, 1]] as const) {
        const mr = managerFloorRect(p, r.id, side)!;
        const mc = managerFloorCenter(p, r.id, side)!;
        expect(rectsIntersect(rect, mr)).toBe(false);
        // Touches the rack: the manager rect's centre is exactly half its width beyond the rack edge.
        const along = (mc.x - c.x) * u.x + (mc.y - c.y) * u.y;
        expect(along).toBeCloseTo(sign * (300 + w / 2), 6);
        expect(mr.width * mr.height).toBeCloseTo(w * 1070, 6);
        // Same footprint extent along the rack's depth axis.
        const rotated = rot === 90 || rot === 270;
        if (rotated) {
          expect(mr.x).toBeCloseTo(rect.x, 6);
          expect(mr.width).toBeCloseTo(rect.width, 6);
          expect(mr.height).toBeCloseTo(w, 6);
        } else {
          expect(mr.y).toBeCloseTo(rect.y, 6);
          expect(mr.height).toBeCloseTo(rect.height, 6);
          expect(mr.width).toBeCloseTo(w, 6);
        }
        expect(rectContains(mr, mc)).toBe(true);
      }
    }
  });

  it('without a manager the column falls back inside the frame on the same side', () => {
    for (const rot of ROTS) {
      const p = createProject();
      const r = addRack(p, 'R', { x: 1000, y: 1000 }, rot);
      const c = rackCenter(r);
      const u = rackAcrossDir(r);
      const l = managerFloorCenter(p, r.id, 'left')!;
      const rr = managerFloorCenter(p, r.id, 'right')!;
      expect((l.x - c.x) * u.x + (l.y - c.y) * u.y).toBeCloseTo(-260, 6);
      expect((rr.x - c.x) * u.x + (rr.y - c.y) * u.y).toBeCloseTo(260, 6);
      expect(rectContains(rackFloorRect(r), l)).toBe(true);
      expect(rectContains(rackFloorRect(r), rr)).toBe(true);
      expect(managerFloorRect(p, r.id, 'left')).toBeNull();
    }
  });
});

describe('in-rack polyline under rotation', () => {
  it('runs from the port across to the manager column and up through the entry on the same side', () => {
    for (const rot of ROTS) {
      const { project, sw1, r1 } = twoRackFixture();
      r1.rotationDeg = rot;
      const path = autoInRackPath(project, sw1.id, 'eth1/49');
      expect(path.side).toBe('left');
      const pts = inRackPolyline3d(project, sw1.id, 'eth1/49', path, 2600)!;
      const port = portWorldPos(project, sw1.id, 'eth1/49')!;
      const mgr = managerFloorCenter(project, r1.id, 'left')!;
      const entry = rackEntryPoints(project, r1).topLeft;
      expect(pts).toHaveLength(5);
      expect(pts[0]).toEqual(port);
      close({ x: pts[1]!.x, y: pts[1]!.z }, mgr);
      expect(pts[1]!.y).toBe(port.y);
      close({ x: pts[2]!.x, y: pts[2]!.z }, mgr);
      close({ x: pts[3]!.x, y: pts[3]!.z }, entry);
      close({ x: pts[4]!.x, y: pts[4]!.z }, entry);
      expect(pts[4]!.y).toBe(2600);
      for (const q of pts) expect([q.x, q.y, q.z].every(Number.isFinite)).toBe(true);
    }
  });
});
