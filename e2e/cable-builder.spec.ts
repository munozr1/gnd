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
const customCables = (page: Page) =>
  page.evaluate(() => window.__dcStore!.getState().project.customCatalog.cables.map((c) => ({ id: c.id, name: c.name, fiberCount: c.fiberCount, endA: c.endA, endB: c.endB, media: c.media })));

/** Pick an option in one of the dialog's Radix selects. */
async function choose(page: Page, dialogLabel: string, option: string | RegExp) {
  await page.getByRole('dialog', { name: 'Cable Builder' }).getByLabel(dialogLabel, { exact: true }).click();
  await page.getByRole('option', { name: option }).click();
}

test('Cable Builder: the acceptance trunk previews, switches to straight, saves to the catalog and undoes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await loadPod(page);
  await page.getByTestId('library-list').getByRole('button', { name: 'New cable…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cable Builder' });
  await expect(dialog).toBeVisible();
  const summary = dialog.getByTestId('cable-summary');
  // Defaults: 8F OM4 MPO-8 → LC-duplex = 1 MPO leg, 4 LC legs, trunk, 4 channels.
  await expect(summary).toContainText('Trunk (breakout)');
  await expect(summary).toContainText('4 channels');
  await expect(summary).toHaveText('8F OM4 · Trunk (breakout) · MPO-8 → 4×LC-duplex · 4 channels');
  await expect(dialog.locator('[data-testid="cable-leg"][data-side="A"]')).toHaveCount(1);
  await expect(dialog.locator('[data-testid="cable-leg"][data-side="B"]')).toHaveCount(4);
  await expect(dialog.getByTestId('cable-furcation')).toHaveCount(1);
  await expect(dialog.getByTestId('cable-furcation')).toHaveAttribute('data-side', 'B');
  await expect(dialog.getByLabel('Cable name')).toHaveValue('8F OM4 MPO-8 → 4×LC-duplex');
  // Hovering a leg shows its positions.
  await dialog.locator('[data-testid="cable-leg"][data-side="A"]').hover();
  await expect(dialog.getByTestId('cable-leg-tip')).toHaveText('Leg A · MPO-8 · positions 1, 2, 3, 4, 9, 10, 11, 12');
  await dialog.locator('[data-testid="cable-leg"][data-side="B"]').nth(2).hover();
  await expect(dialog.getByTestId('cable-leg-tip')).toHaveText('Leg 3 · LC-duplex · positions 1, 2');
  await page.screenshot({ path: 'test-results/cable-builder-trunk.png' });

  // Side B → MPO-8: straight, no furcation, name follows.
  await choose(page, 'Side B connector', 'MPO-8 · multi · 8F');
  await expect(summary).toContainText('Straight');
  await expect(summary).toHaveText('8F OM4 · Straight · MPO-8 ↔ MPO-8 · 4 channels');
  await expect(dialog.getByTestId('cable-furcation')).toHaveCount(0);
  await expect(dialog.locator('[data-testid="cable-leg"]')).toHaveCount(2);
  await expect(dialog.getByLabel('Cable name')).toHaveValue('8F OM4 MPO-8 ↔ MPO-8');

  // OS2 changes the jacket colour; a typed name sticks.
  await choose(page, 'Fiber type', 'OS2');
  await expect(dialog.getByLabel('Jacket colour hex')).toHaveValue('#facc15');
  await dialog.getByLabel('Cable name').fill('Spine trunk');
  await choose(page, 'Fiber type', 'OM4');
  await expect(dialog.getByLabel('Cable name')).toHaveValue('Spine trunk');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Added Spine trunk to the cable library', { exact: true })).toBeVisible();
  await expect.poll(() => customCables(page)).toEqual([{ id: 'cbl.custom.spine-trunk', name: 'Spine trunk', fiberCount: 8, endA: 'MPO-12', endB: 'MPO-12', media: 'OM4' }]);

  // The definition shows in the layout library's Fiber cables section and on the schematic dock panel.
  await page.getByRole('tab', { name: 'Layout', exact: true }).click();
  const layoutRow = page.getByTestId('layout-library').locator('[data-cable-def="cbl.custom.spine-trunk"]');
  await expect(layoutRow).toContainText('Spine trunk');
  await expect(layoutRow).toContainText('8F OM4 · Straight · MPO-8 ↔ MPO-8 · 4 channels');
  await expect(layoutRow).toContainText('custom');
  await expect(page.getByTestId('layout-library').locator('[data-cable-def="cbl.om4-8f-mpo8-4lc"]')).toContainText('Trunk (breakout)');
  await page.getByRole('tab', { name: 'Schematic', exact: true }).click();
  await page.getByRole('button', { name: 'Fiber cables', exact: true }).click();
  await expect(page.getByTestId('cables-library').locator('[data-cable-def="cbl.custom.spine-trunk"]')).toBeVisible();

  // Undo on the schematic tab removes the definition again.
  await page.getByTestId('schematic-canvas').click({ position: { x: 20, y: 20 } });
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => customCables(page)).toEqual([]);
  await expect(page.getByTestId('cables-library').locator('[data-cable-def="cbl.custom.spine-trunk"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Cable Builder: an uneven split blocks Save, and a custom strand map is checked and can be reset', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  await loadPod(page);
  await page.getByTestId('library-list').getByRole('button', { name: 'New cable…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cable Builder' });
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  await choose(page, 'Fiber count', '16F');
  await expect(dialog.getByTestId('cable-summary')).toHaveText('16F OM4 · Trunk (breakout) · 2×MPO-8 → 8×LC-duplex · 8 channels');
  await expect(dialog.getByTestId('cable-furcation')).toHaveCount(2);
  await choose(page, 'Side A connector', 'MPO-12 · multi · 12F');
  await expect(dialog.getByTestId('cable-error')).toHaveText("16 fibers can't be split evenly into MPO-12 legs (12 each). Use MPO-16 or MPO-8.");
  await expect(save).toBeDisabled();
  await choose(page, 'Side A connector', 'MPO-16 · multi · 16F');
  await expect(dialog.getByTestId('cable-error')).toHaveCount(0);
  await expect(save).toBeEnabled();

  await dialog.getByText('Advanced', { exact: true }).click();
  await expect(dialog.getByTestId('strand-map-mode')).toHaveText('derived');
  await expect(dialog.getByRole('button', { name: 'Reset to derived' })).toBeDisabled();
  // Fiber 1 lands on one slot of LC leg 1; wiring it to the other slot doubles that slot and leaves a hole.
  const pos = dialog.getByLabel('Fiber 1 side B position');
  const derivedPos = await pos.inputValue();
  expect(['1', '2']).toContain(derivedPos);
  await pos.fill(derivedPos === '1' ? '2' : '1');
  await pos.press('Enter');
  await expect(dialog.getByTestId('strand-map-mode')).toHaveText('custom');
  await expect(dialog.getByTestId('strand-map-problems')).toContainText('is wired 2 times');
  await expect(dialog.getByTestId('cable-error')).toContainText('Custom strand map');
  await expect(save).toBeDisabled();
  await page.screenshot({ path: 'test-results/cable-builder-strand-map.png' });
  await dialog.getByRole('button', { name: 'Reset to derived' }).click();
  await expect(dialog.getByTestId('strand-map-mode')).toHaveText('derived');
  await expect(dialog.getByTestId('strand-map-problems')).toHaveCount(0);
  await expect(pos).toHaveValue(derivedPos);
  await expect(save).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  expect(await customCables(page)).toEqual([]);
  expect(errors).toEqual([]);
});
