import { describe, expect, it } from 'vitest';
import { createProject } from '@/model/factories';
import { addComponent, addLink, createChildSheet, rotateComponent } from '@/model/schematic';
import { buildScene, boxSelection, hitScene, selectionBounds, selectionSheet } from './scene';
import { fitRect, screenToWorld, worldToScreen, zoomAt } from './viewport';

const SERVER = 'sym.server-1u';
function fixture() {
  const project = createProject();
  const a = addComponent(project, SERVER, 'root', { x: 100, y: 100 });
  const b = addComponent(project, SERVER, 'root', { x: 450, y: 250 });
  return { project, a, b };
}
describe('schematic scene', () => {
  it('hits rotated ports before wires, rejects nearby empty space, and selects bodies', () => {
    const { project, a } = fixture();
    rotateComponent(project, a.id);
    const scene = buildScene(project, 'root');
    const device = scene.devices.find((d) => d.component.id === a.id)!;
    const pin = device.layout.pins.get('eth0')!;
    expect(hitScene(scene, pin.pos, 3)).toMatchObject({ kind: 'pin', end: { componentId: a.id, portId: 'eth0' } });
    const r = device.layout.bounds;
    expect(hitScene(scene, { x: r.x + r.width / 2, y: r.y + r.height / 2 }, 3)).toEqual({ kind: 'component', id: a.id });
    expect(hitScene(scene, { x: -500, y: -500 }, 4)).toBeNull();
  });
  it('indexes individual wire segments and includes links in bounds and box selection', () => {
    const { project, a, b } = fixture();
    const id = addLink(project, { componentId: a.id, portId: 'eth0' }, { componentId: b.id, portId: 'eth0' });
    const scene = buildScene(project, 'root');
    expect(scene.wires).toHaveLength(1);
    expect(selectionBounds(scene, [{ kind: 'link', id }])).not.toBeNull();
    const items = boxSelection(scene, { x: -1000, y: -1000, width: 3000, height: 3000 });
    expect(items).toEqual(expect.arrayContaining([{ kind: 'component', id: a.id }, { kind: 'component', id: b.id }, { kind: 'link', id }]));
    const wire = scene.wires[0]!;
    expect(wire.points.length).toBeGreaterThan(2);
    expect(scene.index.all().filter((h) => h.hit.kind === 'link')).toHaveLength(wire.points.length - 1);
  });
  it('draws cross-sheet endpoints on each sheet, including a parent-child link', () => {
    const { project, a } = fixture();
    const sheet = createChildSheet(project, 'root', 'Pod', { x: 700, y: 100 });
    const c = addComponent(project, SERVER, sheet.id, { x: 0, y: 0 });
    const id = addLink(project, { componentId: a.id, portId: 'eth0' }, { componentId: c.id, portId: 'eth0' });
    const root = buildScene(project, 'root');
    const child = buildScene(project, sheet.id);
    expect(root.wires[0]?.offSheetLabel).toContain('Pod');
    expect(child.wires[0]?.offSheetLabel).toContain('Root');
    expect(root.sheets[0]?.pins).toHaveLength(1);
    expect(selectionSheet(project, [{ kind: 'component', id: c.id }])).toBe(sheet.id);
    expect(selectionSheet(project, [{ kind: 'link', id }])).toBe('root');
  });
});
describe('schematic viewport', () => {
  it('keeps the cursor world point fixed when zooming, including at the scale limit', () => {
    const vp = { x: 75, y: -120, scale: 1.5 }, cursor = { x: 600, y: 350 };
    const before = screenToWorld(vp, cursor);
    for (const factor of [0.01, 0.8, 1.25, 100]) {
      const after = zoomAt(vp, cursor, factor);
      expect(screenToWorld(after, cursor).x).toBeCloseTo(before.x);
      expect(screenToWorld(after, cursor).y).toBeCloseTo(before.y);
    }
  });
  it('fits negative coordinates in a resized viewport without clipping', () => {
    const rect = { x: -500, y: -200, width: 900, height: 600 };
    const vp = fitRect(rect, { width: 800, height: 500 });
    const start = worldToScreen(vp, rect);
    const end = worldToScreen(vp, { x: rect.x + rect.width, y: rect.y + rect.height });
    expect(start.x).toBeGreaterThanOrEqual(48);
    expect(start.y).toBeGreaterThanOrEqual(48);
    expect(end.x).toBeLessThanOrEqual(752);
    expect(end.y).toBeLessThanOrEqual(452);
  });
});
