import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

async function openImport(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('schematic-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Import cutsheet CSV…', exact: true }).click();
  return page.getByRole('dialog', { name: 'Import cutsheet CSV', exact: true });
}

test('imports a representative cutsheet through preview into schematic, Layout and 3D, and survives reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  const dialog = await openImport(page);
  const previous = await page.evaluate(() => { const s = window.__dcStore!.getState(); s.patchLayout({ view: 'elevation', elevationRackIds: ['old-rack'] }); return s.project.id; });
  await dialog.getByLabel('Cutsheet CSV', { exact: true }).setInputFiles(path.resolve('e2e/fixtures/cutsheet.csv'));
  await expect(dialog).toContainText('49 devices · 48 links');
  await expect(dialog).toContainText('46 × 10 Gbps · 2 × 100 Gbps');
  await expect(dialog.getByRole('combobox', { name: 'Endpoint A', exact: true })).toContainText('D · a_end_interface');
  expect(await page.evaluate(() => window.__dcStore!.getState().project.id)).toBe(previous);
  await page.screenshot({ path: 'test-results/cutsheet-preview.png' });
  await dialog.getByRole('button', { name: 'Create design', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().project.components.length)).toBe(49);
  expect(await page.evaluate(async (id) => { const { loadProject } = await import('/src/io/persistence/index.ts'); return !!await loadProject(id); }, previous)).toBe(true);
  await page.screenshot({ path: 'test-results/cutsheet-schematic.png' });
  await page.getByRole('button', { name: 'Devices 1', exact: true }).click();
  await expect(page.getByLabel('Sheet path')).toContainText('12 devices');
  await expect.poll(async () => JSON.parse((await page.getByTestId('schematic-canvas').getAttribute('data-viewport'))!).scale).toBeGreaterThan(0.5);
  await page.screenshot({ path: 'test-results/cutsheet-sheet.png' });
  await page.getByRole('tab', { name: 'Layout', exact: true }).click();
  await expect(page.getByText('5 racks · 49 placed devices · 0 routed cables', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '3D', exact: true }).click();
  await expect(page.getByTestId('viewer3d')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('viewer3d')).toHaveAttribute('data-device-count', '49');
  await expect(page.getByTestId('viewer3d')).toHaveAttribute('data-airwire-count', '48');
  await page.screenshot({ path: 'test-results/cutsheet-3d.png' });
  await page.reload(); await expect(page.getByTestId('schematic-canvas')).toBeVisible();
  expect(await page.evaluate(() => { const p = window.__dcStore!.getState().project; return [p.components.length, p.links.length, p.racks.length]; })).toEqual([49, 48, 5]);
  expect(errors).toEqual([]);
});

test('conflicting rows block import, changing files recovers, and cancel preserves the project', async ({ page }) => {
  const dialog = await openImport(page), previous = await page.evaluate(() => JSON.stringify(window.__dcStore!.getState().project));
  await dialog.getByLabel('Cutsheet CSV', { exact: true }).setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('a_end_interface,b_end_interface,capacity\na_p1,b_p1,10\na_p1,c_p1,100') });
  await expect(dialog.getByRole('alert')).toContainText('Row 3: Port already assigned in row 2');
  await expect(dialog.getByRole('button', { name: 'Create design', exact: true })).toBeDisabled();
  await dialog.getByLabel('Cutsheet CSV', { exact: true }).setInputFiles(path.resolve('e2e/fixtures/cutsheet.csv'));
  await expect(dialog.getByRole('button', { name: 'Create design', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => JSON.stringify(window.__dcStore!.getState().project))).toBe(previous);
});

test('manual column mapping and topology-only import preserve speeds and leave devices unplaced', async ({ page }) => {
  const dialog = await openImport(page);
  await dialog.getByLabel('Cutsheet CSV', { exact: true }).setInputFiles({ name: 'remapped.csv', mimeType: 'text/csv', buffer: Buffer.from('Source,Rate,Destination\ncore_a_xe-0/0/52:0,10000 Mbps,access_1_eth1') });
  for (const [label, option] of [['Endpoint A', 'A · Source'], ['Endpoint B', 'C · Destination'], ['Speed (Gbps)', 'B · Rate']]) {
    await dialog.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  }
  await expect(dialog).toContainText('2 devices · 1 link');
  await dialog.getByRole('checkbox', { name: 'Create draft rack layout' }).uncheck();
  await dialog.getByRole('button', { name: 'Create design', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('tab', { name: 'Layout', exact: true }).click();
  await expect(page.getByTestId('unplaced-bin')).toContainText('2 unplaced');
  expect(await page.evaluate(() => {
    const p = window.__dcStore!.getState().project;
    return { refs: p.components.map((c) => c.ref).sort(), port: p.links[0]!.a.portId, speed: p.customCatalog.footprints[0]!.ports[0]!.speedsGbps, racks: p.racks.length };
  })).toEqual({ refs: ['access_1', 'core_a'], port: 'xe-0/0/52:0', speed: [10], racks: 0 });
});
