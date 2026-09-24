import { expect, test, type Page } from '@playwright/test';

async function loadPod(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('schematic-canvas')).toBeVisible();
  await page.evaluate(async () => {
    const { buildPodProject } = await import('/src/model/demo/pod.ts');
    const p = buildPodProject(), s = window.__dcStore!.getState();
    s.replaceProject(p);
    s.setActiveSheet(p.sheets.find((s) => s.name === 'Pod A')!.id);
  });
}
async function floorPoint(page: Page, index = 2) {
  return page.evaluate(async (index) => {
    const { rackCenter } = await import('/src/model/routing/index.ts');
    const p = rackCenter(window.__dcStore!.getState().project.racks[index]!);
    const el = document.querySelector<HTMLElement>('[data-testid="floor-canvas"]')!, r = el.getBoundingClientRect(), v = JSON.parse(el.dataset.viewport!);
    return { x: r.x + v.x + p.x * v.scale, y: r.y + v.y + p.y * v.scale };
  }, index);
}
async function elevationPoint(page: Page, u: number) {
  return page.evaluate(async (u) => {
    const { layoutColumns, deviceRect } = await import('/src/editors/layout/elevation/geometry.ts');
    const s = window.__dcStore!.getState(), p = s.project, rack = p.racks[2]!;
    const c = layoutColumns([rack], p.accessories, s.ui.layout.elevationFace)[0]!, d = deviceRect(c, u, 1);
    const el = document.querySelector<HTMLElement>('[data-testid="elevation-canvas"]')!, r = el.getBoundingClientRect(), v = JSON.parse(el.dataset.viewport!);
    return { x: r.x + v.x + (d.x + d.width / 2) * v.scale, y: r.y + v.y + (d.y + d.height / 2) * v.scale };
  }, u);
}

test('Pod A floor renders, rack movement updates physical data and undo restores it', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await loadPod(page);
  await page.getByRole('tab', { name: 'Layout', exact: true }).click();
  await expect(page.getByTestId('floor-canvas').locator('canvas')).toBeVisible();
  await expect(page.getByText('6 racks · 42 placed devices · 20 routed cables', { exact: true })).toBeVisible();
  const before = await page.evaluate(() => window.__dcStore!.getState().project.racks[2]!.pos);
  const p = await floorPoint(page);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x, p.y + 55, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().project.racks[2]!.pos)).not.toEqual(before);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().project.racks[2]!.pos)).toEqual(before);
  await page.screenshot({ path: 'test-results/pod-floor.png' });
  const q = await floorPoint(page); await page.mouse.dblclick(q.x, q.y);
  await expect(page.getByTestId('elevation-view')).toHaveAttribute('data-device-count', '10');
  expect(errors).toEqual([]);
});

test('Pod A elevation moves a server, rejects an occupied slot, and unplaces with undo', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await loadPod(page); await page.getByRole('tab', { name: 'Layout', exact: true }).click();
  const p = await floorPoint(page); await page.mouse.dblclick(p.x, p.y);
  await expect(page.getByTestId('elevation-view')).toHaveAttribute('data-device-count', '10');
  const id = await page.evaluate(() => { const p = window.__dcStore!.getState().project; return p.placements.find((x) => x.rackId === p.racks[2]!.id && x.uPosition === 1)!.componentId; });
  const placement = () => page.evaluate((id) => window.__dcStore!.getState().project.placements.find((p) => p.componentId === id), id);
  let a = await elevationPoint(page, 1), b = await elevationPoint(page, 12);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await placement())?.uPosition).toBe(12);
  a = await elevationPoint(page, 12); b = await elevationPoint(page, 2);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await placement())?.uPosition).toBe(12);
  await page.screenshot({ path: 'test-results/pod-elevation.png' });
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await placement())?.uPosition).toBe(1);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await placement())?.rackId).toBeNull();
  await expect(page.getByTestId('unplaced-bin')).toContainText('1 unplaced');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await placement())?.uPosition).toBe(1);
  expect(errors).toEqual([]);
});

test('Pod A 3D renders, filters airwires, captures PNG and cross-probes to layout', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await loadPod(page); await page.getByRole('tab', { name: '3D', exact: true }).click();
  const viewer = page.getByTestId('viewer3d');
  await expect(viewer).toHaveAttribute('data-ready', 'true');
  await expect(viewer).toHaveAttribute('data-device-count', '42');
  await expect(viewer).toHaveAttribute('data-cable-count', '20');
  await expect(viewer).toHaveAttribute('data-airwire-count', '60');
  await expect(viewer.getByRole('button', { name: 'A03', exact: true })).toBeVisible();
  await viewer.getByRole('checkbox', { name: 'Airwires', exact: true }).click();
  await expect(viewer).toHaveAttribute('data-airwire-count', '0');
  await page.screenshot({ path: 'test-results/pod-3d.png' });
  const downloadPromise = page.waitForEvent('download'); await viewer.getByRole('button', { name: 'Save PNG' }).click();
  const download = await downloadPromise; expect(download.suggestedFilename()).toBe('Demo pod-3d.png');
  await download.saveAs('test-results/pod-3d-export.png');
  await viewer.getByRole('button', { name: 'A03', exact: true }).click();
  await viewer.getByRole('button', { name: 'Frame selection' }).click();
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().ui.viewer3d.frameRequest)).toBe(false);
  await viewer.getByRole('button', { name: 'Show in layout' }).click();
  await expect(page.getByRole('tab', { name: 'Layout', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => window.__dcStore!.getState().ui.selection[0]?.kind)).toBe('rack');
  expect(errors).toEqual([]);
});
