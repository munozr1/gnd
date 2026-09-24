import { describe, expect, it } from 'vitest';
import { drcRuleById, runDrc } from '../drc';
import { runErc } from '../erc';
import { indexProject, portKey, uRange } from '../query';
import { duplicateRefs, isUnannotated } from '../schematic/annotate';
import { isOutOfSync } from '../sync/diff';
import type { Project } from '../types';
import { buildLargeProject } from './large';

/** No U overlap, every device inside its rack. */
function expectValidPlacements(project: Project): void {
  const idx = indexProject(project);
  for (const rack of project.racks) {
    const ranges = idx
      .componentsInRack(rack.id)
      .map((c) => uRange(idx, c.id)!)
      .sort((a, b) => a.bottom - b.bottom);
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i]!;
      expect(r.bottom).toBeGreaterThanOrEqual(1);
      expect(r.top).toBeLessThanOrEqual(rack.heightU);
      if (i > 0) expect(r.bottom).toBeGreaterThan(ranges[i - 1]!.top);
    }
  }
  for (const c of project.components) expect(uRange(idx, c.id)).not.toBeNull();
}

describe('buildLargeProject', () => {
  const t0 = performance.now();
  const project = buildLargeProject({ racks: 50, devicesPerRack: 20, linksTarget: 5000 });
  const buildMs = performance.now() - t0;

  it('builds 50 racks / 1,000+ devices / 5,000 links quickly', () => {
    expect(buildMs).toBeLessThan(10_000);
    expect(project.racks).toHaveLength(50);
    expect(project.components.length).toBeGreaterThanOrEqual(1000);
    expect(project.links).toHaveLength(5000);
    expect(new Set(project.racks.map((r) => r.row))).toEqual(new Set(['A', 'B', 'C', 'D', 'E']));
    expect(project.racks.filter((r) => r.row === 'A')).toHaveLength(10);
    expect(project.sheets.map((s) => s.name)).toEqual(['Root', 'Spine', 'Row A', 'Row B', 'Row C', 'Row D', 'Row E']);
    expect(project.components.filter((c) => c.value === 'spine')).toHaveLength(4);
    expect(project.components.filter((c) => c.value === 'leaf')).toHaveLength(50);
    expect(project.links.filter((l) => l.label?.startsWith('FAB'))).toHaveLength(100);
  });

  it('never reuses a port and keeps refs unique', () => {
    const keys = project.links.flatMap((l) => [portKey(l.a), portKey(l.b)]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(duplicateRefs(project).size).toBe(0);
    expect(project.components.every((c) => !isUnannotated(c.ref))).toBe(true);
  });

  it('places everything validly and stays in sync', () => {
    expectValidPlacements(project);
    expect(isOutOfSync(project)).toBe(false);
    expect(runDrc(project, ['u-collision', 'unplaced-component', 'out-of-sync'].map((id) => drcRuleById(id)!))).toEqual([]);
  });

  it('routes about 40% of the links over the trays and in rack', () => {
    const routes = Object.values(project.routes);
    expect(routes.length).toBe(Math.round(0.4 * project.links.length));
    const layers = new Set(routes.flatMap((r) => r.segments.map((s) => s.layer)));
    expect(layers).toEqual(new Set(['overhead', 'in-rack']));
    const trayIds = new Set(routes.flatMap((r) => r.segments.map((s) => s.trayId).filter((id): id is string => !!id)));
    // Every row runway and ladder plus both backbones carry something.
    expect(trayIds.size).toBe(project.trays.length);
    expect(routes.some((r) => r.segments.length === 3)).toBe(true);
    expect(routes.every((r) => r.segments.every((s) => s.points.every((w) => w.pinned)))).toBe(true);
  });

  it('has no ERC or DRC errors', () => {
    expect(runErc(project).filter((i) => i.severity === 'error')).toEqual([]);
    const drc = runDrc(project);
    expect(drc.filter((i) => i.severity === 'error')).toEqual([]);
    expect(drc.some((i) => i.rule === 'unrouted-link')).toBe(true);
  });

  it('scales down with the options and caps the links at the target', () => {
    const small = buildLargeProject({ racks: 3, devicesPerRack: 5, linksTarget: 40, spines: 2, racksPerRow: 2 });
    expect(small.racks).toHaveLength(3);
    expect(small.racks.map((r) => r.name)).toEqual(['A01', 'A02', 'B01']);
    expect(small.components).toHaveLength(3 * 5 + 2);
    expect(small.links).toHaveLength(40);
    expectValidPlacements(small);
    expect(isOutOfSync(small)).toBe(false);
    expect(runDrc(small).filter((i) => i.severity === 'error')).toEqual([]);
    const keys = small.links.flatMap((l) => [portKey(l.a), portKey(l.b)]);
    expect(new Set(keys).size).toBe(keys.length);

    const oneRow = buildLargeProject({ racks: 2, devicesPerRack: 1, linksTarget: 10, spines: 1 });
    expect(oneRow.components).toHaveLength(3);
    expect(oneRow.trays.every((t) => !t.name?.includes('backbone'))).toBe(true);
    expect(runDrc(oneRow).filter((i) => i.severity === 'error')).toEqual([]);
  });
});
