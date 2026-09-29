import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { autoFillCableSide, FAN_OFFSET, plugCableLeg, unplugCableLeg } from '@/model/cables';
import { createCable, createProject } from '@/model/factories';
import { addComponent, addLink, createChildSheet, rotateComponent } from '@/model/schematic';
import { LEAF, PANEL_LC, place } from '@/model/schematic/testUtils';
import type { CableDef, Project } from '@/model/types';
import { buildScene, boxSelection, hitItem, hitScene, hoverLegs, legKey, selectedCables, selectionBounds, selectionSheet } from './scene';
import { fitRect, screenToWorld, worldToScreen, zoomAt } from './viewport';

const SERVER = 'sym.server-1u';
function fixture() {
  const project = createProject();
  const a = addComponent(project, SERVER, 'root', { x: 100, y: 100 });
  const b = addComponent(project, SERVER, 'root', { x: 450, y: 250 });
  return { project, a, b };
}
/** Leaf SW1 and LC panel PP1 with an 8F MPO-8 → 4×LC trunk plugged eth1/49 → f1..f4 (four cable-owned links), plus a plain link between two servers. */
function cabled() {
  const p0 = createProject('t', '2026-01-01T00:00:00.000Z');
  const leaf = place(p0, LEAF, { x: 0, y: 0 }, { ref: 'SW1' });
  leaf.optics['eth1/49'] = 'xcvr.100g-sr4';
  const panel = place(p0, PANEL_LC, { x: 600, y: 0 }, { ref: 'PP1' });
  const s1 = addComponent(p0, SERVER, 'root', { x: 0, y: 400 });
  const s2 = addComponent(p0, SERVER, 'root', { x: 400, y: 500 });
  const plainId = addLink(p0, { componentId: s1.id, portId: 'eth0' }, { componentId: s2.id, portId: 'eth0' });
  const cable = createCable(builtinCatalog.cables.find((c) => c.id === 'cbl.om4-8f-mpo8-4lc')!, 'CBL1');
  p0.cables.push(cable);
  const project: Project = produce(p0, (d) => {
    plugCableLeg(d, cable.id, 'A', 0, { componentId: leaf.id, portId: 'eth1/49' });
    autoFillCableSide(d, cable.id, 'B', { componentId: panel.id, portId: 'f1' });
  });
  return { project, cableId: cable.id, plainId, leafId: leaf.id, panelId: panel.id };
}
/** The same trunk with its sides swapped (4×LC-duplex on side A, MPO-8 on side B), plugged panel f1..f4 → leaf eth1/49: side A fans, side B is a single pin. */
function reverseCabled() {
  const p0 = createProject('t', '2026-01-01T00:00:00.000Z');
  const trunk = builtinCatalog.cables.find((c) => c.id === 'cbl.om4-8f-mpo8-4lc')!;
  const def: CableDef = { ...trunk, id: 'cbl.custom.reversed', name: '8F OM4 4×LC-duplex → MPO-8', sideA: trunk.sideB!, sideB: trunk.sideA!, endA: trunk.endB, endB: trunk.endA };
  p0.customCatalog.cables.push(def);
  const leaf = place(p0, LEAF, { x: 0, y: 0 }, { ref: 'SW1' });
  leaf.optics['eth1/49'] = 'xcvr.100g-sr4';
  const panel = place(p0, PANEL_LC, { x: 600, y: 0 }, { ref: 'PP1' });
  const cable = createCable(def, 'CBL1');
  p0.cables.push(cable);
  const project: Project = produce(p0, (d) => {
    autoFillCableSide(d, cable.id, 'A', { componentId: panel.id, portId: 'f1' });
    plugCableLeg(d, cable.id, 'B', 0, { componentId: leaf.id, portId: 'eth1/49' });
  });
  return { project, cableId: cable.id, leafId: leaf.id, panelId: panel.id };
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
describe('schematic scene: cables', () => {
  it('groups a cable\'s links into one jacket + fan drawing and keeps plain links as wires', () => {
    const { project, cableId, plainId } = cabled();
    expect(project.links.filter((l) => l.cableId === cableId)).toHaveLength(4);
    const scene = buildScene(project, 'root');
    expect(scene.wires.map((w) => w.link.id)).toEqual([plainId]);
    expect(scene.cables).toHaveLength(1);
    const d = scene.cables[0]!;
    expect(d.cable.id).toBe(cableId);
    expect(d.ends.A.kind).toBe('pin');
    expect(d.ends.B).toMatchObject({ kind: 'fan', anchor: { x: 580 - FAN_OFFSET, y: 25 } });
    expect(d.ends.B.legs).toHaveLength(4);
    expect(d.badge.text).toBe('8F · 4ch');
    // One segment entry per jacket / leg segment, body entries for the badge and the glyph; no 'link' entries for the cable's links.
    const entries = scene.index.all();
    const hits = entries.map((h) => h.hit);
    expect(entries.filter((e) => e.hit.kind === 'cable' && e.hit.part === 'jacket' && e.a)).toHaveLength(d.jacket.length - 1);
    expect(entries.filter((e) => e.hit.kind === 'cable' && e.hit.part === 'jacket' && !e.a)).toHaveLength(1);
    expect(hits.filter((h) => h.kind === 'cable' && h.part === 'leg')).toHaveLength(8);
    expect(hits.filter((h) => h.kind === 'cable' && h.part === 'glyph')).toEqual([{ kind: 'cable', id: cableId, part: 'glyph', side: 'B' }]);
    expect(hits.filter((h) => h.kind === 'link').length).toBe(scene.wires[0]!.points.length - 1);
  });
  it('maps the jacket, the glyph and every leg to the whole cable, with the part kept for hover', () => {
    const { project, cableId, panelId } = cabled();
    const scene = buildScene(project, 'root');
    const d = scene.cables[0]!;
    const furcation = d.ends.B.anchor;
    // Leg 2 runs (540,25) → (570,20) → (580,20): its straight stub is 5 units from the f2 pin, outside the pin's 2-unit pick radius.
    const onLeg = hitScene(scene, { x: 575, y: 20 }, 2);
    expect(onLeg).toEqual({ kind: 'cable', id: cableId, part: 'leg', side: 'B', leg: 1 });
    expect(hitScene(scene, { x: 580, y: 20 }, 2)).toMatchObject({ kind: 'pin', end: { componentId: panelId, portId: 'f2' } });
    const onGlyph = hitScene(scene, furcation, 2);
    expect(onGlyph).toEqual({ kind: 'cable', id: cableId, part: 'glyph', side: 'B' });
    const onJacket = hitScene(scene, d.badge.pos, 2);
    expect(onJacket).toEqual({ kind: 'cable', id: cableId, part: 'jacket' });
    for (const hit of [onLeg!, onGlyph!, onJacket!]) expect(hitItem(hit)).toEqual({ kind: 'cable', id: cableId });
    const bounds = selectionBounds(scene, [{ kind: 'cable', id: cableId }])!;
    expect(bounds.x).toBeLessThanOrEqual(furcation.x);
    expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(580);
    expect(boxSelection(scene, { x: -1000, y: -1000, width: 3000, height: 3000 })).toEqual(expect.arrayContaining([{ kind: 'cable', id: cableId }]));
    expect(selectionSheet(project, [{ kind: 'cable', id: cableId }])).toBe('root');
  });
  it('picks the cable on its badge even where the jacket crosses a symbol body', () => {
    const { project, cableId } = cabled();
    const badge = buildScene(project, 'root').cables[0]!.badge.pos;
    const covered = produce(project, (d) => { place(d, SERVER, { x: badge.x - 60, y: badge.y - 20 }); });
    const scene = buildScene(covered, 'root');
    const server = scene.devices.find((dev) => dev.component.sch.pos.x === badge.x - 60)!;
    const b = server.layout.bounds;
    // Precondition: the badge sits inside the server's body, where a plain wire would be unreachable.
    expect(badge.x).toBeGreaterThan(b.x); expect(badge.x).toBeLessThan(b.x + b.width);
    expect(badge.y).toBeGreaterThan(b.y); expect(badge.y).toBeLessThan(b.y + b.height);
    expect(hitScene(scene, badge, 2)).toEqual({ kind: 'cable', id: cableId, part: 'jacket' });
    expect(hitScene(scene, { x: badge.x + 15, y: badge.y }, 2)).toEqual({ kind: 'cable', id: cableId, part: 'jacket' });
    expect(hitScene(scene, { x: badge.x, y: badge.y + 12 }, 2)).toEqual({ kind: 'component', id: server.component.id });
  });
  it('dangles an unassigned leg from the furcation and drops its link', () => {
    const { project, cableId } = cabled();
    const partial = produce(project, (d) => unplugCableLeg(d, cableId, 'B', 3));
    expect(partial.links.filter((l) => l.cableId === cableId)).toHaveLength(3);
    const scene = buildScene(partial, 'root');
    const leg = scene.cables[0]!.ends.B.legs[3]!;
    expect(leg.state).toBe('dangling');
    expect(leg.points).toHaveLength(2);
    // Last of four legs: DANGLE_LENGTH towards the pins (+x), 1.5 pitches below the fan axis.
    expect(leg.points[1]).toEqual({ x: leg.points[0]!.x + 25, y: leg.points[0]!.y + 12 });
    const mid = { x: (leg.points[0]!.x + leg.points[1]!.x) / 2, y: (leg.points[0]!.y + leg.points[1]!.y) / 2 };
    expect(hitScene(scene, mid, 2)).toEqual({ kind: 'cable', id: cableId, part: 'leg', side: 'B', leg: 3 });
  });
  it('fans side A when that side has several legs, with the glyph hit on side A and the jacket ending on the single B pin', () => {
    const { project, cableId, leafId } = reverseCabled();
    expect(project.links.filter((l) => l.cableId === cableId)).toHaveLength(4);
    const scene = buildScene(project, 'root');
    expect(scene.wires).toHaveLength(0);
    const d = scene.cables[0]!;
    expect(d.ends.A).toMatchObject({ kind: 'fan', anchor: { x: 580 - FAN_OFFSET, y: 25 } });
    expect(d.ends.A.legs.map((l) => l.ref?.portId)).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(d.ends.B).toMatchObject({ kind: 'pin', ref: { componentId: leafId, portId: 'eth1/49' }, legs: [] });
    expect(d.jacket[0]).toEqual(d.ends.A.anchor);
    expect(d.jacket.at(-1)).toEqual(d.ends.B.anchor);
    expect(d.badge.text).toBe('8F · 4ch');
    expect(hitScene(scene, d.ends.A.anchor, 2)).toEqual({ kind: 'cable', id: cableId, part: 'glyph', side: 'A' });
    expect(hitScene(scene, { x: 575, y: 30 }, 2)).toEqual({ kind: 'cable', id: cableId, part: 'leg', side: 'A', leg: 2 });
    const hits = scene.index.all().map((h) => h.hit);
    expect(hits.filter((h) => h.kind === 'cable' && h.part === 'glyph')).toHaveLength(1);
    expect(hits.filter((h) => h.kind === 'link')).toHaveLength(0);
  });
  it('lights a hovered leg with the jacket and the far-side legs carrying its fibers; jacket and glyph light everything', () => {
    const { project, cableId } = cabled();
    const d = buildScene(project, 'root').cables[0]!;
    // Each LC leg of the 8F trunk lands on the single MPO leg: hovering leg B2 lights B2 + A1 (the jacket is always lit).
    expect(hoverLegs(d, { kind: 'cable', id: cableId, part: 'leg', side: 'B', leg: 1 })).toEqual(new Set([legKey('B', 1), legKey('A', 0)]));
    expect(hoverLegs(d, { kind: 'cable', id: cableId, part: 'jacket' })).toBe('all');
    expect(hoverLegs(d, { kind: 'cable', id: cableId, part: 'glyph', side: 'B' })).toBe('all');
    const rev = reverseCabled();
    const r = buildScene(rev.project, 'root').cables[0]!;
    expect(hoverLegs(r, { kind: 'cable', id: rev.cableId, part: 'leg', side: 'A', leg: 2 })).toEqual(new Set([legKey('A', 2), legKey('B', 0)]));
  });
  it('resolves a link a cable owns to that cable for bounds and highlight, but never lists it in box selection', () => {
    const { project, cableId, plainId } = cabled();
    const scene = buildScene(project, 'root');
    const owned = project.links.filter((l) => l.cableId === cableId);
    for (const link of owned) expect(scene.cableOfLink.get(link.id)).toBe(cableId);
    expect(scene.cableOfLink.has(plainId)).toBe(false);
    expect(selectionBounds(scene, [{ kind: 'link', id: owned[0]!.id }])).toEqual(selectionBounds(scene, [{ kind: 'cable', id: cableId }]));
    expect(selectedCables(scene, [{ kind: 'link', id: owned[1]!.id }, { kind: 'link', id: plainId }])).toEqual(new Set([cableId]));
    expect(selectedCables(scene, [{ kind: 'cable', id: cableId }, { kind: 'component', id: 'x' }])).toEqual(new Set([cableId]));
    expect(selectedCables(scene, [{ kind: 'link', id: plainId }])).toEqual(new Set());
    const boxed = boxSelection(scene, { x: -1000, y: -1000, width: 3000, height: 3000 });
    expect(boxed.filter((i) => i.kind === 'link').map((i) => i.id)).toEqual([plainId]);
  });
  it('shows a cable whose far side is on another sheet as an off-sheet stub, never as plain off-sheet wires', () => {
    const { project, cableId, panelId } = cabled();
    const split = produce(project, (d) => {
      d.sheets.push({ id: 'pod', name: 'Pod A', parentId: 'root' });
      d.components.find((c) => c.id === panelId)!.sch.sheetId = 'pod';
    });
    const root = buildScene(split, 'root');
    expect(root.wires.every((w) => !w.link.cableId)).toBe(true);
    expect(root.cables[0]!.ends.B).toMatchObject({ kind: 'offSheet', offSheetLabel: 'PP1:f1 ▸ Pod A' });
    const pod = buildScene(split, 'pod');
    expect(pod.wires).toHaveLength(0);
    expect(pod.cables[0]!.ends.A).toMatchObject({ kind: 'offSheet', offSheetLabel: 'SW1:eth1/49 ▸ Root' });
    expect(pod.cables[0]!.ends.B.kind).toBe('fan');
    expect(selectionSheet(split, [{ kind: 'cable', id: cableId }])).toBe('root');
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
