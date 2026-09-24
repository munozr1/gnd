import { expect, test, type Page } from '@playwright/test';

async function load(page: Page, kind: 'empty' | 'pair' | 'demo' = 'pair') {
  await page.goto('/');
  await expect(page.getByTestId('schematic-canvas')).toBeVisible();
  await page.evaluate(async (kind) => {
    const { createProject } = await import('/src/model/factories.ts');
    const { addComponent } = await import('/src/model/schematic/index.ts');
    const { buildPodProject } = await import('/src/model/demo/pod.ts');
    const project = kind === 'demo' ? buildPodProject() : createProject('Schematic browser test');
    if (kind === 'pair') {
      addComponent(project, 'sym.server-1u', 'root', { x: 100, y: 100 });
      addComponent(project, 'sym.server-1u', 'root', { x: 450, y: 250 });
    }
    window.__dcStore!.getState().replaceProject(project);
  }, kind);
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect(page.getByTestId('schematic-canvas').locator('canvas').first()).toBeVisible();
}
async function point(page: Page, componentIndex: number, port?: string) {
  return page.evaluate(async ({ componentIndex, port }) => {
    const { componentLayout } = await import('/src/model/schematic/index.ts');
    const project = window.__dcStore!.getState().project;
    const c = project.components[componentIndex]!;
    const layout = componentLayout(project, c.id)!;
    const p = port ? layout.pins.get(port)!.pos : { x: layout.bounds.x + layout.bounds.width / 2, y: layout.bounds.y + layout.bounds.height / 2 };
    const canvas = document.querySelector<HTMLElement>('[data-testid="schematic-canvas"]')!;
    const v = JSON.parse(canvas.dataset.viewport!);
    const r = canvas.getBoundingClientRect();
    return { x: r.x + v.x + p.x * v.scale, y: r.y + v.y + p.y * v.scale };
  }, { componentIndex, port });
}
const counts = (page: Page) => page.evaluate(() => ({ components: window.__dcStore!.getState().project.components.length, links: window.__dcStore!.getState().project.links.length }));

test('library placement, click-click and drag wiring, label, undo and reload', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page);
  await page.keyboard.press('a');
  const dialog = page.getByRole('dialog', { name: 'Add symbol' });
  await dialog.getByLabel('Search library').fill('1U server');
  await dialog.getByRole('option').first().click();
  const canvas = page.getByTestId('schematic-canvas');
  await canvas.click({ position: { x: 650, y: 100 } });
  await expect.poll(() => counts(page)).toEqual({ components: 3, links: 0 });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  const a = await point(page, 0, 'eth0'), b = await point(page, 1, 'eth0');
  await page.keyboard.press('w');
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await expect.poll(() => counts(page)).toEqual({ components: 3, links: 1 });
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  await page.getByRole('textbox', { name: 'Wire label', exact: true }).fill('server-uplink');
  await page.keyboard.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().project.links[0]?.label)).toBe('server-uplink');
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => counts(page)).toEqual({ components: 3, links: 0 });
  await page.keyboard.press('ControlOrMeta+Shift+z');
  const c = await point(page, 0, 'eth1'), d = await point(page, 1, 'eth1');
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(d.x, d.y, { steps: 10 }); await page.mouse.up();
  await expect.poll(() => counts(page)).toEqual({ components: 3, links: 2 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1300); // autosave is deliberately debounced by 1 second
  await page.reload();
  await expect(page.getByTestId('schematic-canvas')).toBeVisible();
  await expect.poll(() => counts(page)).toEqual({ components: 3, links: 2 });
  expect(errors).toEqual([]);
});

test('drag preview cancels, commits as one undo, and supports rotate/mirror', async ({ page }) => {
  await load(page);
  const original = await page.evaluate(() => window.__dcStore!.getState().project.components[0]!.sch);
  let p = await point(page, 0);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 70, p.y + 60, { steps: 6 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await page.evaluate(() => window.__dcStore!.getState().project.components[0]!.sch)).toEqual(original);
  p = await point(page, 0);
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 70, p.y + 60, { steps: 6 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().project.components[0]!.sch.pos)).not.toEqual(original.pos);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => window.__dcStore!.getState().project.components[0]!.sch)).toEqual(original);
  await page.keyboard.press('r');
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().project.components[0]!.sch.rotation)).toBe(90);
  await page.keyboard.press('x');
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().project.components[0]!.sch.mirrored)).toBe(true);
});

test('sheets create, navigate, duplicate, and reveal a device from another sheet', async ({ page }) => {
  await load(page, 'empty');
  await page.getByRole('button', { name: 'New child', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Sheet name').fill('Pod A');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().ui.activeSheetId)).not.toBe('root');
  await page.keyboard.press('a');
  const dialog = page.getByRole('dialog', { name: 'Add symbol' });
  await dialog.getByLabel('Search library').fill('1U server');
  await dialog.getByRole('option').first().click();
  await page.getByTestId('schematic-canvas').click({ position: { x: 200, y: 200 } });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Sheet name').fill('Pod B');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => counts(page)).toEqual({ components: 2, links: 0 });
  expect(await page.evaluate(() => new Set(window.__dcStore!.getState().project.components.map((c) => c.ref)).size)).toBe(2);
  await page.evaluate(() => {
    const s = window.__dcStore!.getState();
    s.setActiveSheet('root');
    s.revealSelection([{ kind: 'component', id: s.project.components[0]!.id }], 'schematic');
  });
  await expect.poll(() => page.evaluate(() => {
    const s = window.__dcStore!.getState();
    return s.ui.activeSheetId === s.project.components[0]!.sch.sheetId && s.ui.schematic.viewportRequest === null;
  })).toBe(true);
});

test('Demo pod renders without browser errors and can navigate to its devices', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await load(page, 'demo');
  await expect.poll(() => counts(page)).toEqual({ components: 42, links: 80 });
  await page.getByRole('button', { name: 'Pod A', exact: true }).click();
  await expect(page.getByLabel('Sheet path')).toContainText('40 devices');
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await expect.poll(async () => JSON.parse((await page.getByTestId('schematic-canvas').getAttribute('data-viewport'))!).scale).toBeLessThan(1);
  await page.screenshot({ path: 'test-results/schematic-demo.png' });
  expect(errors).toEqual([]);
});

test('wire segment reshaping preserves pin endpoints and rejects occupied ports', async ({ page }) => {
  await load(page);
  const a = await point(page, 0, 'eth0'), b = await point(page, 1, 'eth0');
  await page.mouse.click(a.x, a.y); await page.mouse.click(b.x, b.y);
  await expect.poll(() => counts(page)).toEqual({ components: 2, links: 1 });
  await page.keyboard.press('Escape');
  await page.mouse.click(a.x, a.y);
  await expect(page.getByText('This port is already connected.', { exact: true })).toBeVisible();
  await expect.poll(() => counts(page)).toEqual({ components: 2, links: 1 });
  const segment = await page.evaluate(async () => {
    const { buildScene, hitScene } = await import('/src/editors/schematic/scene.ts');
    const project = window.__dcStore!.getState().project;
    const scene = buildScene(project, 'root');
    const wire = scene.wires[0]!;
    const canvas = document.querySelector<HTMLElement>('[data-testid="schematic-canvas"]')!;
    const v = JSON.parse(canvas.dataset.viewport!), r = canvas.getBoundingClientRect();
    for (let i = 1; i < wire.points.length; i++) {
      const a = wire.points[i - 1]!, b = wire.points[i]!;
      const p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (hitScene(scene, p, 3)?.kind === 'link') return { x: r.x + v.x + p.x * v.scale, y: r.y + v.y + p.y * v.scale };
    }
    throw new Error('No exposed wire segment');
  });
  await page.mouse.move(segment.x, segment.y); await page.mouse.down();
  await page.mouse.move(segment.x + 50, segment.y + 50, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().project.links[0]!.sch.wirePoints.length)).toBeGreaterThan(0);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => window.__dcStore!.getState().project.links[0]!.sch.wirePoints)).toEqual([]);
  expect(await point(page, 0, 'eth0')).toEqual(a);
  expect(await point(page, 1, 'eth0')).toEqual(b);
});

test('inspector validates references, edits optics, and keeps edits undoable', async ({ page }) => {
  await load(page);
  const p = await point(page, 0);
  await page.mouse.click(p.x, p.y);
  const ref = page.getByRole('textbox', { name: 'Reference', exact: true });
  await ref.fill('SRV2'); await ref.press('Enter');
  await expect(page.getByText('Reference already used', { exact: true })).toBeVisible();
  await ref.fill('HOST1'); await ref.press('Enter');
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().project.components[0]!.ref)).toBe('HOST1');
  await ref.fill('Discard this edit'); await ref.press('Escape');
  expect(await page.evaluate(() => window.__dcStore!.getState().project.components[0]!.ref)).toBe('HOST1');
  await page.getByRole('button', { name: 'All ports', exact: true }).click();
  await page.getByRole('combobox', { name: 'Optic on eth0', exact: true }).click();
  await page.getByRole('option', { name: '25G-SR', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().project.components[0]!.optics.eth0)).toBe('xcvr.25g-sr');
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => window.__dcStore!.getState().project.components[0]!.optics.eth0)).toBeUndefined();
});
