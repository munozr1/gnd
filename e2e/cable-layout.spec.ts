import { expect, test, type Page } from '@playwright/test';

/**
 * Demo pod, plus a 24× LC patch panel placed at U20 of a rack other than the
 * first Pod A leaf's, an SR4 optic on that leaf's free uplink eth1/51, and an
 * 8F MPO-8 → 4×LC trunk connected eth1/51 → f1..f4 through the store commands.
 */
async function loadTrunk(page: Page) {
  await page.goto('/');
  await expect(page.getByTestId('schematic-canvas')).toBeVisible();
  return page.evaluate(async () => {
    const { buildPodProject } = await import('/src/model/demo/pod.ts');
    const { schematic, layout, cables } = await import('/src/commands/index.ts');
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
    const leafRack = p.placements.find((x) => x.componentId === leaf.id)!.rackId!;
    const others = p.racks.filter((r) => r.id !== leafRack);
    exec(layout.placeComponent(panelId, others[0]!.id, 20));
    const cableId = exec(cables.createCable('cbl.om4-8f-mpo8-4lc', { plugsA: [{ componentId: leaf.id, portId: 'eth1/51' }] })).result!;
    exec(cables.autoFillSide(cableId, 'B', { componentId: panelId, portId: 'f1' }));
    return { leafId: leaf.id, leafRef: leaf.ref, panelId, cableId, rackA: others[0]!.id, rackB: others[1]!.id };
  });
}

/** The cable as the layout sees it: furcation, jacket route, legs and the floor tool state. */
const cableState = (page: Page, cableId: string) =>
  page.evaluate(async (cableId) => {
    const { furcationFloorPos } = await import('/src/model/cables/index.ts');
    const { floorCables } = await import('/src/editors/layout/physicalScene.ts');
    const s = window.__dcStore!.getState(), p = s.project, cable = p.cables.find((c) => c.id === cableId)!;
    const route = p.routes[cableId];
    const floor = floorCables(p).find((c) => c.cable.id === cableId);
    return {
      stored: cable.furcation?.B ?? null,
      effective: furcationFloorPos(p, cable, 'B'),
      route: route ? { owner: route.owner ?? null, waypoints: route.segments.flatMap((seg) => seg.points.map((w) => ({ x: w.pos.x, y: w.pos.y, pinned: w.pinned }))), bSide: route.bRack.side } : null,
      routed: floor?.routed ?? false,
      jacketEnd: floor?.jacket.at(-1) ?? null,
      legs: floor?.legs.map((l) => ({ port: l.ref.portId, end: l.points[1] })) ?? [],
      tool: s.ui.layout.tool,
      routing: s.ui.layout.routingLinkId,
      selection: s.ui.selection,
    };
  }, cableId);

/** Screen position of side B's furcation node on the fitted floor plan. */
async function nodeScreen(page: Page, cableId: string) {
  return page.evaluate(async (cableId) => {
    const { furcationFloorPos } = await import('/src/model/cables/index.ts');
    const p = window.__dcStore!.getState().project, cable = p.cables.find((c) => c.id === cableId)!;
    const f = furcationFloorPos(p, cable, 'B')!;
    const el = document.querySelector<HTMLElement>('[data-testid="floor-canvas"]')!, r = el.getBoundingClientRect(), v = JSON.parse(el.dataset.viewport!);
    return { x: r.x + v.x + f.pos.x * v.scale, y: r.y + v.y + f.pos.y * v.scale };
  }, cableId);
}

const unroutedCount = async (page: Page) => Number(/Unrouted:\s*(\d+)/.exec((await page.getByTestId('unrouted').textContent()) ?? '')?.[1]);

test('a trunk fans out on the floor plan: drag pins the furcation, P toggles it, X + Enter routes the jacket, and moving the panel re-dresses only the legs', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  const { cableId, panelId, rackB } = await loadTrunk(page);
  // The tab reads 'Layout Out of sync' once the schematic changed, so match the prefix.
  await page.getByRole('tab', { name: /^Layout/ }).click();
  await expect(page.getByTestId('floor-canvas').locator('canvas')).toBeVisible();
  const floor = page.locator('[data-rack-count]');
  await expect(floor).toHaveAttribute('data-cable-count', '1');
  await expect(floor).toHaveAttribute('data-furcation-count', '1');
  const routedBefore = Number(await floor.getAttribute('data-route-count'));
  const unroutedBefore = await unroutedCount(page);
  const initial = await cableState(page, cableId);
  expect(initial.stored).toBeNull();
  expect(initial.effective).toMatchObject({ pinned: false });
  expect(initial.legs.map((l) => l.port)).toEqual(['f1', 'f2', 'f3', 'f4']);

  // Hovering the node names the cable; dragging it selects the cable and pins the furcation where it lands.
  const n = await nodeScreen(page, cableId);
  await page.mouse.move(n.x, n.y);
  await expect(floor).toHaveAttribute('data-hover-furcation', `${cableId}:B`);
  await page.mouse.down();
  await page.mouse.move(n.x + 40, n.y + 30, { steps: 6 });
  await page.mouse.up();
  const dragged = await cableState(page, cableId);
  expect(dragged.selection).toEqual([{ kind: 'cable', id: cableId }]);
  expect(dragged.stored?.pinned).toBe(true);
  expect(dragged.effective?.pinned).toBe(true);
  expect(dragged.effective?.pos).not.toEqual(initial.effective?.pos);
  await expect(page.getByTestId('layout-inspector')).toHaveAttribute('data-kind', 'cable');
  await expect(page.getByRole('textbox', { name: 'Cable label' })).toHaveValue('CBL1');
  await expect(page.getByRole('checkbox', { name: 'Furcation B pinned' })).toBeChecked();
  await page.screenshot({ path: 'test-results/cable-layout-floor.png' });

  // P unpins (the node returns to the breakout-length default) and pins it again there.
  await page.getByTestId('floor-canvas').focus();
  await page.keyboard.press('p');
  await expect.poll(async () => (await cableState(page, cableId)).effective?.pinned).toBe(false);
  expect((await cableState(page, cableId)).effective?.pos).toEqual(initial.effective?.pos);
  await page.keyboard.press('p');
  await expect.poll(async () => (await cableState(page, cableId)).effective?.pinned).toBe(true);
  const pinnedAt = (await cableState(page, cableId)).effective!.pos;

  // X starts routing the jacket from side A's port; Enter finishes it at the furcation.
  await page.keyboard.press('x');
  await expect.poll(() => page.evaluate(() => window.__dcStore!.getState().ui.layout.routingLinkId)).toBe(cableId);
  expect(await page.evaluate(() => window.__dcStore!.getState().ui.layout.tool)).toBe('route');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await cableState(page, cableId)).route?.owner).toBe('cable');
  const routed = await cableState(page, cableId);
  expect(routed.tool).toBe('select');
  expect(routed.routing).toBeNull();
  expect(routed.routed).toBe(true);
  expect(routed.route!.waypoints.length).toBeGreaterThanOrEqual(2);
  expect(routed.route!.waypoints.every((w) => w.pinned)).toBe(true);
  expect(routed.jacketEnd).toEqual(pinnedAt);
  expect(routed.legs.map((l) => l.port)).toEqual(['f1', 'f2', 'f3', 'f4']);
  await expect(floor).toHaveAttribute('data-route-count', String(routedBefore + 1));
  // The trunk's four channel links now count as routed.
  await expect.poll(() => unroutedCount(page)).toBe(unroutedBefore - 4);
  await expect(page.getByTestId('layout-inspector')).toContainText('In-rack dressing');

  // Moving the panel to another rack keeps the pinned jacket route and its waypoints; only the legs re-dress to the new ports.
  await page.evaluate(async ({ panelId, rackB }) => {
    const { layout } = await import('/src/commands/index.ts');
    const s = window.__dcStore!.getState();
    if (!s.execute(layout.moveDevice(panelId, rackB, 25))) throw new Error(window.__dcStore!.getState().ui.lastError ?? 'move failed');
  }, { panelId, rackB });
  const moved = await cableState(page, cableId);
  expect(moved.route!.waypoints).toEqual(routed.route!.waypoints);
  expect(moved.effective).toEqual({ pos: pinnedAt, pinned: true });
  expect(moved.jacketEnd).toEqual(pinnedAt);
  expect(moved.legs.map((l) => l.port)).toEqual(['f1', 'f2', 'f3', 'f4']);
  expect(moved.legs.map((l) => l.end)).not.toEqual(routed.legs.map((l) => l.end));
  const ports = await page.evaluate(async (panelId) => {
    const { portFloorPos } = await import('/src/model/routing/index.ts');
    const p = window.__dcStore!.getState().project;
    return ['f1', 'f2', 'f3', 'f4'].map((id) => portFloorPos(p, panelId, id));
  }, panelId);
  expect(moved.legs.map((l) => l.end)).toEqual(ports);
  await expect(floor).toHaveAttribute('data-furcation-count', '1');
  await page.screenshot({ path: 'test-results/cable-layout-moved.png' });

  // The elevation draws the legs as stubs to a furcation node at the manager column and the routed jacket out of the rack top.
  await page.getByRole('button', { name: 'Elevation', exact: true }).click();
  await expect(page.getByTestId('elevation-view')).toHaveAttribute('data-device-count', '43');
  await page.screenshot({ path: 'test-results/cable-layout-elevation.png' });
  expect(errors).toEqual([]);
});
