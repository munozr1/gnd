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
/** Unplace the device at U1 of the third rack through the store so the Unplaced bin has one row. */
async function unplaceOne(page: Page) {
  return page.evaluate(async () => {
    const { layout } = await import('/src/commands/index.ts');
    const s = window.__dcStore!.getState(), p = s.project;
    const placement = p.placements.find((x) => x.rackId === p.racks[2]!.id && x.uPosition === 1)!;
    if (!s.execute(layout.unplaceComponent(placement.componentId))) throw new Error(s.ui.lastError ?? 'unplace failed');
    const c = p.components.find((c) => c.id === placement.componentId)!;
    return { id: c.id, ref: c.ref, racks: p.racks.length };
  });
}
/** Where the device sits now: rack count, and the kind / name of its rack and its U (nulls when unplaced). */
const frameOf = (page: Page, id: string) => page.evaluate((id) => {
  const p = window.__dcStore!.getState().project, pl = p.placements.find((x) => x.componentId === id), r = p.racks.find((r) => r.id === pl?.rackId);
  return { racks: p.racks.length, kind: r?.kind ?? null, name: r?.name ?? null, u: pl?.uPosition ?? null };
}, id);

test('Own frame places an unplaced device as its own patch frame and undo removes both', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await loadPod(page);
  const { id, ref, racks } = await unplaceOne(page);
  await page.getByRole('tab', { name: 'Layout', exact: true }).click();
  await expect(page.getByTestId('floor-canvas').locator('canvas')).toBeVisible();
  await expect(page.getByTestId('unplaced-bin')).toContainText('1 unplaced');
  await page.getByRole('button', { name: `Place ${ref} as its own frame`, exact: true }).click();
  await expect.poll(() => frameOf(page, id)).toEqual({ racks: racks + 1, kind: 'patch-frame', name: `PF-${ref}`, u: 1 });
  await expect(page.getByText(`${ref} placed as its own frame`, { exact: true })).toBeVisible();
  await expect(page.locator('[data-rack-count]')).toHaveAttribute('data-rack-count', String(racks + 1));
  const selection = await page.evaluate(() => window.__dcStore!.getState().ui.selection);
  expect(selection).toEqual([{ kind: 'rack', id: expect.any(String) }]);
  await expect(page.getByTestId('unplaced-bin')).toContainText('0 unplaced');
  await page.screenshot({ path: 'test-results/patch-frame-own.png' });
  await page.getByTestId('floor-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => frameOf(page, id)).toEqual({ racks, kind: null, name: null, u: null });
  await expect(page.getByTestId('unplaced-bin')).toContainText('1 unplaced');
  expect(errors).toEqual([]);
});

test('dragging a device from the Unplaced bin onto empty floor creates a patch frame at the drop point', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await loadPod(page);
  const { id, ref, racks } = await unplaceOne(page);
  await page.getByRole('tab', { name: 'Layout', exact: true }).click();
  await expect(page.getByTestId('floor-canvas').locator('canvas')).toBeVisible();
  // An empty spot 1.5 m below the rack row, as screen coordinates on the fitted floor.
  const target = await page.evaluate(async () => {
    const { rackFloorRect } = await import('/src/model/routing/index.ts');
    const p = window.__dcStore!.getState().project, rects = p.racks.map(rackFloorRect);
    const world = { x: Math.min(...rects.map((r) => r.x)), y: Math.max(...rects.map((r) => r.y + r.height)) + 1500 };
    const el = document.querySelector<HTMLElement>('[data-testid="floor-canvas"]')!, r = el.getBoundingClientRect(), v = JSON.parse(el.dataset.viewport!);
    return { world, x: r.x + v.x + world.x * v.scale, y: r.y + v.y + world.y * v.scale, grid: p.room.gridMm };
  });
  const from = await page.locator(`[data-component-id="${id}"]`).boundingBox();
  if (!from) throw new Error('Unplaced row is not visible');
  const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 24, start.y, { steps: 4 });
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await expect(page.getByTestId('floor-drop-hint')).toHaveText('Drop here to place as its own patch frame');
  await page.mouse.up();
  await expect.poll(() => frameOf(page, id)).toEqual({ racks: racks + 1, kind: 'patch-frame', name: `PF-${ref}`, u: 1 });
  const pos = await page.evaluate((id) => { const p = window.__dcStore!.getState().project; return p.racks.find((r) => r.id === p.placements.find((x) => x.componentId === id)!.rackId)!.pos; }, id);
  expect(Math.abs(pos.x - target.world.x)).toBeLessThanOrEqual(target.grid);
  expect(Math.abs(pos.y - target.world.y)).toBeLessThanOrEqual(target.grid);
  await expect(page.getByTestId('floor-drop-hint')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/patch-frame-drop.png' });
  expect(errors).toEqual([]);
});
