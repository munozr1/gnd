import { expect, test, type Page } from '@playwright/test';

/** Demo pod on the Pod A sheet, plus a 24× LC patch panel next to the first leaf; SR4 optics on the leaf's free uplinks eth1/51 and eth1/52. */
async function loadPod(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('schematic-canvas')).toBeVisible();
  const ids = await page.evaluate(async () => {
    const { buildPodProject } = await import('/src/model/demo/pod.ts');
    const { schematic } = await import('/src/commands/index.ts');
    const p = buildPodProject(), s = window.__dcStore!.getState();
    s.replaceProject(p);
    const pod = p.sheets.find((x) => x.name === 'Pod A')!;
    s.setActiveSheet(pod.id);
    const leaf = p.components.find((c) => c.value === 'leaf-a')!;
    const add = schematic.addComponent('sym.fiber-patch-panel-24lc', pod.id, { x: leaf.sch.pos.x + 700, y: leaf.sch.pos.y });
    if (!s.execute(add) || !add.result) throw new Error(s.ui.lastError ?? 'add panel failed');
    s.execute(schematic.setOptic(leaf.id, 'eth1/51', 'xcvr.100g-sr4'));
    s.execute(schematic.setOptic(leaf.id, 'eth1/52', 'xcvr.100g-sr4'));
    const panel = window.__dcStore!.getState().project.components.find((c) => c.id === add.result)!;
    // Zoom onto the leaf + panel so their pins are comfortably clickable.
    window.__dcStore!.getState().revealSelection([{ kind: 'component', id: leaf.id }, { kind: 'component', id: panel.id }], 'schematic');
    return { leafId: leaf.id, leafRef: leaf.ref, panelId: panel.id, panelRef: panel.ref };
  });
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().ui.schematic.viewportRequest)).toBeNull();
  await page.evaluate(() => window.__dcStore!.getState().clearSelection());
  return ids;
}
/** Screen position of a pin's connection point. */
async function pin(page: Page, componentId: string, port: string) {
  return page.evaluate(async ({ componentId, port }) => {
    const { componentLayout } = await import('/src/model/schematic/index.ts');
    const project = window.__dcStore!.getState().project;
    const layout = componentLayout(project, componentId)!;
    const p = layout.pins.get(port);
    if (!p) throw new Error(`pin ${port} is not visible`);
    const canvas = document.querySelector<HTMLElement>('[data-testid="schematic-canvas"]')!;
    const v = JSON.parse(canvas.dataset.viewport!), r = canvas.getBoundingClientRect();
    return { x: r.x + v.x + p.pos.x * v.scale, y: r.y + v.y + p.pos.y * v.scale };
  }, { componentId, port });
}
const state = (page: Page) => page.evaluate(() => {
  const s = window.__dcStore!.getState(), c = s.project.cables[0];
  return {
    cables: s.project.cables.length,
    cabling: s.ui.schematic.cabling,
    plugs: c ? c.plugs.map((p) => `${p.side}${p.leg + 1}:${p.portId ?? '-'}`) : [],
    cableLinks: s.project.links.filter((l) => l.cableId === c?.id).map((l) => `${l.a.portId}.${l.a.lane}>${l.b.portId}`),
    links: s.project.links.length,
    selection: s.ui.selection,
  };
});
const shiftClick = async (page: Page, p: { x: number; y: number }) => { await page.keyboard.down('Shift'); await page.mouse.click(p.x, p.y); await page.keyboard.up('Shift'); };

test('connecting an 8F MPO-8 → 4×LC trunk: plug side A, refuse an LC leg on an MPO port, auto-fill F1..F4, undo', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  const { leafId, leafRef, panelId, panelRef } = await loadPod(page);
  await page.getByRole('combobox', { name: 'Connect cable' }).click();
  await page.getByRole('option', { name: '8F OM4 MPO-8 → 4×LC-duplex', exact: true }).click();
  await expect.poll(() => state(page)).toMatchObject({ cables: 1, cabling: { side: 'A', leg: 0 }, plugs: ['A1:-', 'B1:-', 'B2:-', 'B3:-', 'B4:-'], links: 80 });
  const hud = page.getByTestId('cabling-hud');
  await expect(hud).toContainText('Cable CBL1');
  await expect(hud).toContainText('8F OM4 · Trunk (breakout) · MPO-8 → 4×LC-duplex · 4 channels');
  await expect(page.getByText('Cable CBL1: plug side A leg 1 of 1 · Shift+click auto-fill · Enter finish')).toBeVisible();

  const a = await pin(page, leafId, 'eth1/51');
  await page.mouse.click(a.x, a.y);
  await expect.poll(() => state(page)).toMatchObject({ cabling: { side: 'B', leg: 0 }, plugs: ['A1:eth1/51', 'B1:-', 'B2:-', 'B3:-', 'B4:-'], links: 80 });
  await expect(hud).toContainText(`${leafRef}:eth1/51`);
  await expect(page.getByText('Cable CBL1: plug side B leg 1 of 4 · Shift+click auto-fill · Enter finish')).toBeVisible();

  // An LC leg on the SR4's MPO port is refused with a clear message and nothing changes.
  const mpo = await pin(page, leafId, 'eth1/52');
  await page.mouse.click(mpo.x, mpo.y);
  await expect(page.getByRole('alert').filter({ hasText: 'LC-duplex leg 1 cannot plug into eth1/52 (MPO-12 port)' })).toBeVisible();
  expect(await state(page)).toMatchObject({ cabling: { side: 'B', leg: 0 }, plugs: ['A1:eth1/51', 'B1:-', 'B2:-', 'B3:-', 'B4:-'] });

  // Shift+click F1 auto-fills legs 1–4 onto F1–F4; every leg is plugged so the flow finishes on its own.
  const f1 = await pin(page, panelId, 'f1');
  await shiftClick(page, f1);
  await expect.poll(() => state(page)).toEqual({
    cables: 1,
    cabling: null,
    plugs: ['A1:eth1/51', 'B1:f1', 'B2:f2', 'B3:f3', 'B4:f4'],
    cableLinks: ['eth1/51.0>f1', 'eth1/51.1>f2', 'eth1/51.2>f3', 'eth1/51.3>f4'],
    links: 84,
    selection: [{ kind: 'cable', id: expect.any(String) }],
  });
  await expect(page.getByText('Cable CBL1 connected', { exact: true })).toBeVisible();
  await expect(page.getByTestId('cabling-hud-idle')).toBeVisible();
  const inspector = page.getByTestId('cable-inspector');
  await expect(inspector).toContainText('connected');
  await expect(inspector).toContainText('4 of 4 channels');
  await expect(inspector).toContainText(`${panelRef}:f4`);
  await page.screenshot({ path: 'test-results/cable-connect.png' });

  // Undo peels the steps back: auto-fill, plug A, connect.
  await page.getByTestId('schematic-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => state(page)).toMatchObject({ cables: 1, plugs: ['A1:eth1/51', 'B1:-', 'B2:-', 'B3:-', 'B4:-'], cableLinks: [], links: 80 });
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => state(page)).toMatchObject({ cables: 1, plugs: ['A1:-', 'B1:-', 'B2:-', 'B3:-', 'B4:-'] });
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => state(page)).toMatchObject({ cables: 0, links: 80, selection: [] });
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect.poll(() => state(page)).toMatchObject({ cables: 1 });
  expect(errors).toEqual([]);
});

test('Escape finishes with unassigned legs kept, the inspector unplugs and continues, Delete removes the cable', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  const { leafId, panelId } = await loadPod(page);
  await page.getByRole('combobox', { name: 'Connect cable' }).click();
  await page.getByRole('option', { name: '8F OM4 MPO-8 → 4×LC-duplex', exact: true }).click();
  await expect.poll(() => state(page)).toMatchObject({ cabling: { side: 'A', leg: 0 } });
  const a = await pin(page, leafId, 'eth1/52');
  await page.mouse.click(a.x, a.y);
  const f3 = await pin(page, panelId, 'f3');
  await page.mouse.click(f3.x, f3.y);
  await expect.poll(() => state(page)).toMatchObject({ cabling: { side: 'B', leg: 1 }, plugs: ['A1:eth1/52', 'B1:f3', 'B2:-', 'B3:-', 'B4:-'], cableLinks: ['eth1/52.0>f3'] });
  await page.keyboard.press('Escape');
  await expect(page.getByText('3 legs unassigned', { exact: true })).toBeVisible();
  await expect.poll(() => state(page)).toMatchObject({ cables: 1, cabling: null, selection: [{ kind: 'cable', id: expect.any(String) }] });

  const inspector = page.getByTestId('cable-inspector');
  await expect(inspector).toContainText('3 unassigned');
  await inspector.getByRole('button', { name: 'Unplug leg B1', exact: true }).click();
  await expect.poll(() => state(page)).toMatchObject({ plugs: ['A1:eth1/52', 'B1:-', 'B2:-', 'B3:-', 'B4:-'], cableLinks: [] });
  await inspector.getByRole('button', { name: 'Plug leg B3', exact: true }).click();
  await expect.poll(() => state(page)).toMatchObject({ cabling: { side: 'B', leg: 2 } });
  await expect(page.getByTestId('cabling-hud')).toContainText('side B · leg 3');
  const f9 = await pin(page, panelId, 'f9');
  await page.mouse.click(f9.x, f9.y);
  await expect.poll(() => state(page)).toMatchObject({ plugs: ['A1:eth1/52', 'B1:-', 'B2:-', 'B3:f9', 'B4:-'], cableLinks: ['eth1/52.2>f9'], cabling: { side: 'B', leg: 0 } });
  await page.getByTestId('cabling-hud').getByRole('button', { name: 'Finish', exact: true }).click();
  await expect.poll(() => state(page)).toMatchObject({ cabling: null, selection: [{ kind: 'cable', id: expect.any(String) }] });

  await page.getByTestId('schematic-canvas').focus();
  await page.keyboard.press('Delete');
  await expect.poll(() => state(page)).toMatchObject({ cables: 0, links: 80, selection: [] });
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => state(page)).toMatchObject({ cables: 1, plugs: ['A1:eth1/52', 'B1:-', 'B2:-', 'B3:f9', 'B4:-'], cableLinks: ['eth1/52.2>f9'] });
  expect(errors).toEqual([]);
});

test('the library Connect button starts the connecting flow from the schematic dock panel and from the layout tab', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await loadPod(page);
  // Schematic tab: the collapsed 'Fiber cables' dock panel.
  await page.getByRole('button', { name: 'Fiber cables', exact: true }).click();
  await page.getByTestId('cables-library').getByRole('button', { name: 'Connect 8F OM4 MPO-8 → 4×LC-duplex', exact: true }).click();
  await expect.poll(() => state(page)).toMatchObject({ cables: 1, cabling: { side: 'A', leg: 0 }, plugs: ['A1:-', 'B1:-', 'B2:-', 'B3:-', 'B4:-'], selection: [{ kind: 'cable', id: expect.any(String) }] });
  await expect(page.getByTestId('cabling-hud')).toContainText('Cable CBL1');
  // One right-dock inspector shows the cable (the schematic Inspector hosts it).
  await expect(page.getByTestId('cable-inspector')).toHaveCount(1);
  await expect(page.getByTestId('cable-inspector')).toContainText('5 unassigned');
  await page.keyboard.press('Escape');
  await expect.poll(() => state(page)).toMatchObject({ cabling: null, cables: 1 });
  // Layout tab: the Library panel's Fiber cables section switches back to the schematic and starts a second cable.
  // The tab reads 'Layout Out of sync' once the cable exists, so match the prefix.
  await page.getByRole('tab', { name: /^Layout/ }).click();
  await page.getByTestId('layout-library').locator('[data-cable-def="cbl.om4-8f-mpo8-4lc"]').getByRole('button', { name: /^Connect/ }).click();
  await expect(page.getByRole('tab', { name: 'Schematic', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => page.evaluate(() => { const s = window.__dcStore!.getState(); return { cables: s.project.cables.map((c) => c.label), cabling: s.ui.schematic.cabling?.side ?? null }; })).toEqual({ cables: ['CBL1', 'CBL2'], cabling: 'A' });
  await expect(page.getByTestId('cabling-hud')).toContainText('Cable CBL2');
  expect(errors).toEqual([]);
});
