import { expect, test, type Page } from '@playwright/test';

/**
 * Acceptance walk-through of docs/specs/cables-task.md against the real app:
 * the Demo pod, a 24× LC patch panel placed as its own free-standing frame on
 * the floor plan, and the seeded 8F OM4 MPO-8 → 4×LC-duplex trunk. The
 * derivation table itself is a unit test (src/model/cables/deriveSides.test.ts);
 * the Cable Builder preview is covered by cable-builder.spec.ts. Screenshots
 * land in test-results/accept-*.png.
 */

const TRUNK_ID = 'cbl.om4-8f-mpo8-4lc';
const TRUNK_NAME = '8F OM4 MPO-8 → 4×LC-duplex';

/** Demo pod on the Pod A sheet; the panel next to the first leaf and placed as its own patch frame; SR4 optics on the leaf's free uplinks eth1/51 (MPO) and eth1/52 (MPO). */
async function loadPod(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('schematic-canvas')).toBeVisible();
  const ids = await page.evaluate(async () => {
    const { buildPodProject } = await import('/src/model/demo/pod.ts');
    const { schematic, layout } = await import('/src/commands/index.ts');
    const p = buildPodProject(), s = window.__dcStore!.getState();
    s.replaceProject(p);
    const pod = p.sheets.find((x) => x.name === 'Pod A')!;
    s.setActiveSheet(pod.id);
    const exec = <T extends { label: string }>(cmd: T): T => {
      if (!s.execute(cmd as unknown as Parameters<typeof s.execute>[0])) throw new Error(window.__dcStore!.getState().ui.lastError ?? `${cmd.label} failed`);
      return cmd;
    };
    const leaf = p.components.find((c) => c.value === 'leaf-a')!;
    const panelId = exec(schematic.addComponent('sym.fiber-patch-panel-24lc', pod.id, { x: leaf.sch.pos.x + 700, y: leaf.sch.pos.y })).result!;
    exec(schematic.setOptic(leaf.id, 'eth1/51', 'xcvr.100g-sr4'));
    exec(schematic.setOptic(leaf.id, 'eth1/52', 'xcvr.100g-sr4'));
    const frameId = exec(layout.placeInNewFrame(panelId)).result!;
    const panel = window.__dcStore!.getState().project.components.find((c) => c.id === panelId)!;
    const frame = window.__dcStore!.getState().project.racks.find((r) => r.id === frameId)!;
    window.__dcStore!.getState().revealSelection([{ kind: 'component', id: leaf.id }, { kind: 'component', id: panelId }], 'schematic');
    return { leafId: leaf.id, leafRef: leaf.ref, panelId, panelRef: panel.ref, frameId, frameName: frame.name, frameKind: frame.kind, sheetId: pod.id };
  });
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().ui.schematic.viewportRequest)).toBeNull();
  await page.evaluate(() => window.__dcStore!.getState().clearSelection());
  expect(ids.frameKind).toBe('patch-frame');
  return ids;
}

/** Screen position of a schematic pin's connection point. */
async function pin(page: Page, componentId: string, port: string) {
  return page.evaluate(async ({ componentId, port }) => {
    const { componentLayout } = await import('/src/model/schematic/index.ts');
    const layout = componentLayout(window.__dcStore!.getState().project, componentId)!;
    const p = layout.pins.get(port);
    if (!p) throw new Error(`pin ${port} is not visible`);
    const canvas = document.querySelector<HTMLElement>('[data-testid="schematic-canvas"]')!;
    const v = JSON.parse(canvas.dataset.viewport!), r = canvas.getBoundingClientRect();
    return { x: r.x + v.x + p.pos.x * v.scale, y: r.y + v.y + p.pos.y * v.scale };
  }, { componentId, port });
}

/** Screen position of a schematic-unit point on the canvas. */
async function schematicScreen(page: Page, pos: { x: number; y: number }) {
  return page.evaluate((pos) => {
    const canvas = document.querySelector<HTMLElement>('[data-testid="schematic-canvas"]')!;
    const v = JSON.parse(canvas.dataset.viewport!), r = canvas.getBoundingClientRect();
    return { x: r.x + v.x + pos.x * v.scale, y: r.y + v.y + pos.y * v.scale };
  }, pos);
}

const state = (page: Page) => page.evaluate(() => {
  const s = window.__dcStore!.getState(), c = s.project.cables[0];
  return {
    cables: s.project.cables.length,
    cabling: s.ui.schematic.cabling,
    plugs: c ? c.plugs.map((p) => `${p.side}${p.leg + 1}:${p.portId ?? '-'}`) : [],
    cableLinks: c ? s.project.links.filter((l) => l.cableId === c.id).map((l) => `${l.a.portId}.${l.a.lane}>${l.b.portId}`) : [],
    links: s.project.links.length,
    selection: s.ui.selection,
  };
});

/** How the schematic draws the cable: jacket, both ends and the badge. */
const schematicDrawing = (page: Page, sheetId: string) => page.evaluate(async (sheetId) => {
  const { cableSchematicDrawing } = await import('/src/model/cables/index.ts');
  const p = window.__dcStore!.getState().project, cable = p.cables[0]!;
  const d = cableSchematicDrawing(p, cable, sheetId);
  if (!d) return null;
  return {
    badge: d.badge,
    jacketPoints: d.jacket.length,
    a: { kind: d.ends.A.kind, legs: d.ends.A.legs.length },
    b: { kind: d.ends.B.kind, legs: d.ends.B.legs.map((l) => ({ leg: l.leg, port: l.ref?.portId ?? null, points: l.points.length })), anchor: d.ends.B.anchor },
  };
}, sheetId);

/** The cable as the floor plan sees it. */
const floorState = (page: Page, cableId: string) => page.evaluate(async (cableId) => {
  const { furcationFloorPos } = await import('/src/model/cables/index.ts');
  const { floorCables } = await import('/src/editors/layout/physicalScene.ts');
  const { portFloorPos } = await import('/src/model/routing/index.ts');
  const p = window.__dcStore!.getState().project, cable = p.cables.find((c) => c.id === cableId)!;
  const route = p.routes[cableId];
  const floor = floorCables(p).find((c) => c.cable.id === cableId);
  const ports = cable.plugs.filter((x) => x.side === 'B' && x.componentId && x.portId).map((x) => portFloorPos(p, x.componentId!, x.portId!));
  return {
    furcation: furcationFloorPos(p, cable, 'B'),
    route: route ? { owner: route.owner ?? null, waypoints: route.segments.flatMap((seg) => seg.points.map((w) => ({ x: w.pos.x, y: w.pos.y, pinned: w.pinned }))) } : null,
    routed: floor?.routed ?? false,
    jacketEnd: floor?.jacket.at(-1) ?? null,
    legs: floor?.legs.map((l) => ({ port: l.ref.portId, end: l.points[1] })) ?? [],
    ports,
  };
}, cableId);

/** Screen position of a floor-plan point (mm) on the fitted floor canvas. */
async function floorScreen(page: Page, pos: { x: number; y: number }) {
  return page.evaluate((pos) => {
    const el = document.querySelector<HTMLElement>('[data-testid="floor-canvas"]')!, r = el.getBoundingClientRect(), v = JSON.parse(el.dataset.viewport!);
    return { x: r.x + v.x + pos.x * v.scale, y: r.y + v.y + pos.y * v.scale };
  }, pos);
}

const shiftClick = async (page: Page, p: { x: number; y: number }) => { await page.keyboard.down('Shift'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Shift'); };
const customCables = (page: Page) => page.evaluate(() => window.__dcStore!.getState().project.customCatalog.cables.map((c) => c.id));

test('acceptance: creating a definition in the Cable Builder is undoable and redoable', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await loadPod(page);
  await page.getByTestId('library-list').getByRole('button', { name: 'New cable…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cable Builder' });
  await expect(dialog.getByTestId('cable-summary')).toHaveText('8F OM4 · Trunk (breakout) · MPO-8 → 4×LC-duplex · 4 channels');
  await expect(dialog.locator('[data-testid="cable-leg"][data-side="A"]')).toHaveCount(1);
  await expect(dialog.locator('[data-testid="cable-leg"][data-side="B"]')).toHaveCount(4);
  await expect(dialog.getByTestId('cable-preview')).toHaveAttribute('data-kind', 'trunk');
  await page.screenshot({ path: 'test-results/accept-builder-trunk.png' });
  await dialog.getByLabel('Side B connector', { exact: true }).click();
  await page.getByRole('option', { name: 'MPO-8 · multi · 8F' }).click();
  await expect(dialog.getByTestId('cable-summary')).toHaveText('8F OM4 · Straight · MPO-8 ↔ MPO-8 · 4 channels');
  await expect(dialog.getByTestId('cable-preview')).toHaveAttribute('data-kind', 'straight');
  await expect(dialog.getByTestId('cable-furcation')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/accept-builder-straight.png' });
  await dialog.getByLabel('Cable name').fill('Acceptance straight');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => customCables(page)).toEqual(['cbl.custom.acceptance-straight']);
  await page.getByTestId('schematic-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => customCables(page)).toEqual([]);
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => customCables(page)).toEqual(['cbl.custom.acceptance-straight']);
  // The redone definition is connectable again.
  await page.getByRole('combobox', { name: 'Connect cable' }).click();
  await expect(page.getByRole('option', { name: 'Acceptance straight · 8F OM4 MPO-8 ↔ MPO-8', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('acceptance: connect the trunk to an own-frame panel, refuse an LC leg on MPO, auto-fill F1–F4, schematic fan-out, reassign a leg with undo/redo', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  const { leafId, leafRef, panelId, panelRef, sheetId } = await loadPod(page);
  await page.getByRole('combobox', { name: 'Connect cable' }).click();
  await page.getByRole('option', { name: TRUNK_NAME, exact: true }).click();
  await expect.poll(() => state(page)).toMatchObject({ cables: 1, cabling: { side: 'A', leg: 0 }, plugs: ['A1:-', 'B1:-', 'B2:-', 'B3:-', 'B4:-'] });
  const hud = page.getByTestId('cabling-hud');
  await expect(hud).toContainText('8F OM4 · Trunk (breakout) · MPO-8 → 4×LC-duplex · 4 channels');

  // Side A: the switch's MPO port.
  const a = await pin(page, leafId, 'eth1/51');
  await page.mouse.click(a.x, a.y);
  await expect.poll(() => state(page)).toMatchObject({ cabling: { side: 'B', leg: 0 }, plugs: ['A1:eth1/51', 'B1:-', 'B2:-', 'B3:-', 'B4:-'] });
  await expect(hud).toContainText(`${leafRef}:eth1/51`);

  // An LC leg on the other SR4's MPO port is refused with a clear message; nothing changes.
  const mpo = await pin(page, leafId, 'eth1/52');
  await page.mouse.click(mpo.x, mpo.y);
  await expect(page.getByRole('alert').filter({ hasText: 'LC-duplex leg 1 cannot plug into eth1/52 (MPO-12 port)' })).toBeVisible();
  expect(await state(page)).toMatchObject({ cabling: { side: 'B', leg: 0 }, plugs: ['A1:eth1/51', 'B1:-', 'B2:-', 'B3:-', 'B4:-'] });
  await page.screenshot({ path: 'test-results/accept-refused.png' });

  // Auto-fill from F1 lands legs 1–4 on F1–F4 and finishes the flow.
  const f1 = await pin(page, panelId, 'f1');
  await shiftClick(page, f1);
  await expect.poll(() => state(page)).toMatchObject({
    cabling: null,
    plugs: ['A1:eth1/51', 'B1:f1', 'B2:f2', 'B3:f3', 'B4:f4'],
    cableLinks: ['eth1/51.0>f1', 'eth1/51.1>f2', 'eth1/51.2>f3', 'eth1/51.3>f4'],
    links: 84,
    selection: [{ kind: 'cable', id: expect.any(String) }],
  });
  await expect(page.getByText('Cable CBL1 connected', { exact: true })).toBeVisible();
  const inspector = page.getByTestId('cable-inspector');
  await expect(inspector).toContainText('4 of 4 channels');
  await expect(inspector).toContainText(`${panelRef}:f4`);

  // The schematic draws one jacket from the MPO pin to a fan at side B with four thin legs and an '8F · 4ch' badge.
  const drawing = await schematicDrawing(page, sheetId);
  expect(drawing).not.toBeNull();
  expect(drawing!.badge.text).toBe('8F · 4ch');
  expect(drawing!.jacketPoints).toBeGreaterThanOrEqual(2);
  expect(drawing!.a).toEqual({ kind: 'pin', legs: 0 });
  expect(drawing!.b.kind).toBe('fan');
  expect(drawing!.b.legs.map((l) => l.port)).toEqual(['f1', 'f2', 'f3', 'f4']);
  expect(drawing!.b.legs.every((l) => l.points >= 2)).toBe(true);
  // Hovering the fan glyph names the cable; hovering leg 3 names its port.
  const glyph = await schematicScreen(page, drawing!.b.anchor);
  await page.mouse.move(glyph.x, glyph.y);
  await expect(page.getByTestId('cable-hover')).toHaveText(`CBL1 · ${TRUNK_NAME}`);
  await page.screenshot({ path: 'test-results/accept-schematic.png' });
  const leg3 = drawing!.b.legs[2]!;
  const legMid = await page.evaluate(async ({ sheetId, leg }) => {
    const { cableSchematicDrawing } = await import('/src/model/cables/index.ts');
    const p = window.__dcStore!.getState().project;
    const d = cableSchematicDrawing(p, p.cables[0]!, sheetId)!;
    const pts = d.ends.B.legs.find((l) => l.leg === leg)!.points;
    const p0 = pts[pts.length - 2]!, p1 = pts[pts.length - 1]!;
    return { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  }, { sheetId, leg: leg3.leg });
  const legScreen = await schematicScreen(page, legMid);
  await page.mouse.move(legScreen.x, legScreen.y);
  await expect(page.getByTestId('cable-hover')).toHaveText(`CBL1 · ${TRUNK_NAME} · side B leg 3 → ${panelRef}:f3`);
  // Clicking a leg selects the whole cable.
  await page.evaluate(() => window.__dcStore!.getState().clearSelection());
  await page.mouse.click(legScreen.x, legScreen.y);
  await expect.poll(() => state(page)).toMatchObject({ selection: [{ kind: 'cable', id: expect.any(String) }] });

  // Reassign leg 4 from F4 to F9 through the inspector, then undo / redo both steps.
  await inspector.getByRole('button', { name: 'Unplug leg B4', exact: true }).click();
  await expect.poll(() => state(page)).toMatchObject({ plugs: ['A1:eth1/51', 'B1:f1', 'B2:f2', 'B3:f3', 'B4:-'], cableLinks: ['eth1/51.0>f1', 'eth1/51.1>f2', 'eth1/51.2>f3'] });
  await inspector.getByRole('button', { name: 'Plug leg B4', exact: true }).click();
  await expect.poll(() => state(page)).toMatchObject({ cabling: { side: 'B', leg: 3 } });
  const f9 = await pin(page, panelId, 'f9');
  await page.mouse.click(f9.x, f9.y);
  await expect.poll(() => state(page)).toMatchObject({ cabling: null, plugs: ['A1:eth1/51', 'B1:f1', 'B2:f2', 'B3:f3', 'B4:f9'], cableLinks: ['eth1/51.0>f1', 'eth1/51.1>f2', 'eth1/51.2>f3', 'eth1/51.3>f9'] });
  await page.getByTestId('schematic-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => state(page)).toMatchObject({ plugs: ['A1:eth1/51', 'B1:f1', 'B2:f2', 'B3:f3', 'B4:-'] });
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => state(page)).toMatchObject({ plugs: ['A1:eth1/51', 'B1:f1', 'B2:f2', 'B3:f3', 'B4:f4'], cableLinks: ['eth1/51.0>f1', 'eth1/51.1>f2', 'eth1/51.2>f3', 'eth1/51.3>f4'] });
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => state(page)).toMatchObject({ plugs: ['A1:eth1/51', 'B1:f1', 'B2:f2', 'B3:f3', 'B4:-'] });
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => state(page)).toMatchObject({ plugs: ['A1:eth1/51', 'B1:f1', 'B2:f2', 'B3:f3', 'B4:f9'], cableLinks: ['eth1/51.0>f1', 'eth1/51.1>f2', 'eth1/51.2>f3', 'eth1/51.3>f9'] });
  // Undo all the way back removes the cable and its links; redo brings the connection back.
  for (let i = 0; i < 5; i++) await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => state(page)).toMatchObject({ cables: 0, links: 80, cableLinks: [] });
  for (let i = 0; i < 3; i++) await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => state(page)).toMatchObject({ cables: 1, plugs: ['A1:eth1/51', 'B1:f1', 'B2:f2', 'B3:f3', 'B4:f4'], links: 84 });
  expect(errors).toEqual([]);
});

test('acceptance: the trunk fans out on the floor plan and in 3D; moving the own-frame panel keeps the pinned jacket route and re-dresses only the legs', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  const { leafId, panelId, frameId } = await loadPod(page);
  const cableId = await page.evaluate(async ({ leafId, panelId }) => {
    const { cables } = await import('/src/commands/index.ts');
    const s = window.__dcStore!.getState();
    const create = cables.createCable('cbl.om4-8f-mpo8-4lc', { plugsA: [{ componentId: leafId, portId: 'eth1/51' }] });
    if (!s.execute(create)) throw new Error(window.__dcStore!.getState().ui.lastError ?? 'create failed');
    const fill = cables.autoFillSide(create.result!, 'B', { componentId: panelId, portId: 'f1' });
    if (!window.__dcStore!.getState().execute(fill)) throw new Error(window.__dcStore!.getState().ui.lastError ?? 'auto-fill failed');
    return create.result!;
  }, { leafId, panelId });
  await page.getByRole('tab', { name: /^Layout/ }).click();
  await expect(page.getByTestId('floor-canvas').locator('canvas')).toBeVisible();
  const floor = page.locator('[data-rack-count]');
  await expect(floor).toHaveAttribute('data-rack-count', '7');
  await expect(floor).toHaveAttribute('data-cable-count', '1');
  await expect(floor).toHaveAttribute('data-furcation-count', '1');
  const initial = await floorState(page, cableId);
  expect(initial.furcation).toMatchObject({ pinned: false });
  expect(initial.legs.map((l) => l.port)).toEqual(['f1', 'f2', 'f3', 'f4']);
  expect(initial.legs.map((l) => l.end)).toEqual(initial.ports);
  await page.screenshot({ path: 'test-results/accept-layout-ratsnest.png' });

  // Drag the furcation node (pins it), then route the jacket with X + Enter.
  const n = await floorScreen(page, initial.furcation!.pos);
  await page.mouse.move(n.x, n.y);
  await expect(floor).toHaveAttribute('data-hover-furcation', `${cableId}:B`);
  await page.mouse.down();
  await page.mouse.move(n.x - 30, n.y - 30, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await floorState(page, cableId)).furcation?.pinned).toBe(true);
  const pinnedAt = (await floorState(page, cableId)).furcation!.pos;
  await expect(page.getByRole('checkbox', { name: 'Furcation B pinned' })).toBeChecked();
  await page.getByTestId('floor-canvas').focus();
  await page.keyboard.press('x');
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().ui.layout.routingLinkId)).toBe(cableId);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await floorState(page, cableId)).route?.owner).toBe('cable');
  const routed = await floorState(page, cableId);
  expect(routed.routed).toBe(true);
  expect(routed.route!.waypoints.every((w) => w.pinned)).toBe(true);
  expect(routed.jacketEnd).toEqual(pinnedAt);
  expect(routed.legs.map((l) => l.port)).toEqual(['f1', 'f2', 'f3', 'f4']);
  // Close-up of the routed jacket, the pinned furcation node and the four legs.
  await page.evaluate((cableId) => window.__dcStore!.getState().revealSelection([{ kind: 'cable', id: cableId }], 'layout'), cableId);
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().ui.layout.viewportRequest)).toBeNull();
  await page.screenshot({ path: 'test-results/accept-layout.png' });
  await page.getByRole('button', { name: 'Fit floor', exact: true }).click();
  await page.evaluate(() => window.__dcStore!.getState().clearSelection());

  // Drag the patch frame 1 m across the floor: the pinned jacket route and furcation stay, only the legs re-dress to the moved ports.
  const framePos = await page.evaluate((frameId) => window.__dcStore!.getState().project.racks.find((r) => r.id === frameId)!.pos, frameId);
  const centre = await page.evaluate(async (frameId) => {
    const { rackCenter } = await import('/src/model/routing/index.ts');
    return rackCenter(window.__dcStore!.getState().project.racks.find((r) => r.id === frameId)!);
  }, frameId);
  const from = await floorScreen(page, centre), to = await floorScreen(page, { x: centre.x, y: centre.y + 1000 });
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(from.x + 5, from.y + 5, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate((frameId) => window.__dcStore!.getState().project.racks.find((r) => r.id === frameId)!.pos, frameId)).not.toEqual(framePos);
  const moved = await floorState(page, cableId);
  expect(moved.route!.waypoints).toEqual(routed.route!.waypoints);
  expect(moved.furcation).toEqual({ pos: pinnedAt, pinned: true });
  expect(moved.jacketEnd).toEqual(pinnedAt);
  expect(moved.legs.map((l) => l.port)).toEqual(['f1', 'f2', 'f3', 'f4']);
  expect(moved.ports).not.toEqual(routed.ports);
  expect(moved.legs.map((l) => l.end)).toEqual(moved.ports);
  await expect(floor).toHaveAttribute('data-furcation-count', '1');
  await page.evaluate((cableId) => window.__dcStore!.getState().revealSelection([{ kind: 'cable', id: cableId }], 'layout'), cableId);
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().ui.layout.viewportRequest)).toBeNull();
  await page.screenshot({ path: 'test-results/accept-layout-moved.png' });
  await page.getByRole('button', { name: 'Fit floor', exact: true }).click();
  // Undo puts the frame back and the legs follow again.
  await page.getByTestId('floor-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => page.evaluate((frameId) => window.__dcStore!.getState().project.racks.find((r) => r.id === frameId)!.pos, frameId)).toEqual(framePos);
  expect((await floorState(page, cableId)).legs.map((l) => l.end)).toEqual(routed.ports);

  // 3D: the installed cable is a jacket tube, one boot at the furcation, four leg tubes and connector shapes at the ends.
  await page.evaluate((cableId) => window.__dcStore!.getState().revealSelection([{ kind: 'cable', id: cableId }], 'viewer3d'), cableId);
  const viewer = page.getByTestId('viewer3d');
  await expect(viewer).toHaveAttribute('data-ready', 'true');
  await expect(viewer).toHaveAttribute('data-installed-count', '1');
  await expect(viewer).toHaveAttribute('data-rack-count', '7');
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().ui.viewer3d.frameRequest)).toBe(false);
  const parts = await page.evaluate(async (cableId) => {
    const { buildInstalledCable3d } = await import('/src/editors/viewer3d/cables3d.ts');
    const p = window.__dcStore!.getState().project;
    const c = buildInstalledCable3d(p, p.cables.find((x) => x.id === cableId)!)!;
    return { routed: c.routed, jacketPoints: c.jacket.points.length, jacketRadius: c.jacket.radius, boots: c.boots.map((b) => b.side), legs: c.legs.map((l) => ({ side: l.side, leg: l.leg, plugged: l.plugged, points: l.points.length })), connectors: c.connectors.length };
  }, cableId);
  expect(parts.routed).toBe(true);
  expect(parts.jacketPoints).toBeGreaterThanOrEqual(2);
  expect(parts.jacketRadius).toBeGreaterThan(0);
  expect(parts.boots).toEqual(['B']);
  expect(parts.legs).toEqual([0, 1, 2, 3].map((leg) => ({ side: 'B', leg, plugged: true, points: expect.any(Number) })));
  expect(parts.connectors).toBeGreaterThanOrEqual(5);
  await expect(viewer.getByText('CBL1', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/accept-3d.png' });
  // Close-up on the patch frame: the boot at the furcation and the four leg tubes into the panel.
  await page.evaluate((frameId) => window.__dcStore!.getState().revealSelection([{ kind: 'rack', id: frameId }], 'viewer3d'), frameId);
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().ui.viewer3d.frameRequest)).toBe(false);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/accept-3d-closeup.png' });
  expect(errors).toEqual([]);
});
