import { describe, expect, it } from 'vitest';
import { runDrc } from '../drc';
import { runErc } from '../erc';
import { indexProject, portKey, uRange } from '../query';
import { duplicateRefs, isUnannotated } from '../schematic/annotate';
import { isOutOfSync } from '../sync/diff';
import type { Project } from '../types';
import { buildPodProject } from './pod';

const symbolOf = (p: Project, id: string) => indexProject(p).symbolOf(indexProject(p).component(id)!)!;

describe('buildPodProject', () => {
  const project = buildPodProject();
  const idx = indexProject(project);

  it('builds the 2 × 8 fabric with dual-homed servers on hierarchical sheets', () => {
    expect(project.name).toBe('Demo pod');
    expect(project.sheets.map((s) => s.name)).toEqual(['Root', 'Spine', 'Pod A']);
    const spineSheet = project.sheets.find((s) => s.name === 'Spine')!;
    const podSheet = project.sheets.find((s) => s.name === 'Pod A')!;
    expect(spineSheet.parentId).toBe('root');
    expect(podSheet.parentId).toBe('root');
    expect(spineSheet.sch).toBeDefined();

    const byKind = (kind: string) => project.components.filter((c) => symbolOf(project, c.id).kind === kind);
    const spines = project.components.filter((c) => c.value === 'spine');
    const leafs = project.components.filter((c) => c.value?.startsWith('leaf'));
    expect(spines).toHaveLength(2);
    expect(leafs).toHaveLength(8);
    expect(byKind('server')).toHaveLength(32);
    expect(spines.every((c) => c.sch.sheetId === spineSheet.id)).toBe(true);
    expect(leafs.every((c) => c.sch.sheetId === podSheet.id)).toBe(true);
    // 16 fabric links + 32 servers × 2.
    expect(project.links).toHaveLength(80);
    const fabric = project.links.filter((l) => l.label?.startsWith('FAB'));
    expect(fabric).toHaveLength(16);
    expect(fabric.every((l) => l.cableDefId === 'cbl.om4-mpo-trunk')).toBe(true);
    for (const leaf of leafs) {
      expect(leaf.optics['eth1/49']).toBe('xcvr.100g-sr4');
      expect(leaf.optics['eth1/50']).toBe('xcvr.100g-sr4');
    }
    for (const srv of byKind('server')) {
      const links = idx.linksOf(srv.id);
      expect(links).toHaveLength(2);
      expect(links.every((l) => l.cableDefId === 'cbl.om4-duplex')).toBe(true);
      expect(srv.optics).toEqual({ eth0: 'xcvr.25g-sr', eth1: 'xcvr.25g-sr' });
      const leafIds = new Set(links.map((l) => (l.a.componentId === srv.id ? l.b.componentId : l.a.componentId)));
      expect(leafIds.size).toBe(2);
    }
  });

  it('assigns default footprints, unique annotated refs and grid-aligned positions', () => {
    for (const c of project.components) {
      expect(c.footprintDefId).toBe(symbolOf(project, c.id).defaultFootprintIds[0]);
      expect(isUnannotated(c.ref)).toBe(false);
      expect(c.sch.pos.x % 10).toBe(0);
      expect(c.sch.pos.y % 10).toBe(0);
    }
    expect(duplicateRefs(project).size).toBe(0);
    expect(project.components.map((c) => c.ref).slice(0, 4)).toEqual(['SW1', 'SW2', 'SW3', 'SW4']);
  });

  it('never reuses a port', () => {
    const keys = project.links.flatMap((l) => [portKey(l.a), portKey(l.b)]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('is ERC clean of errors', () => {
    const issues = runErc(project);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(issues.filter((i) => i.severity === 'warning')).toEqual([]);
  });

  it('places every device in one rack row with managers, top entries and a runway', () => {
    expect(project.racks.map((r) => r.name)).toEqual(['A01', 'A02', 'A03', 'A04', 'A05', 'A06']);
    expect(project.racks.every((r) => r.row === 'A')).toBe(true);
    expect(project.racks.slice(0, 2).every((r) => r.widthMm === 800)).toBe(true);
    const ys = new Set(project.racks.map((r) => r.pos.y));
    expect(ys.size).toBe(1);
    for (let i = 1; i < project.racks.length; i++) {
      const prev = project.racks[i - 1]!;
      expect(project.racks[i]!.pos.x - (prev.pos.x + prev.widthMm)).toBe(600);
    }
    for (const c of project.components) {
      expect(uRange(idx, c.id)).not.toBeNull();
    }
    // Spines at the top of A01/A02, leaf pairs at U41-42, servers from U1.
    const placementOf = (ref: string) => idx.placement(project.components.find((c) => c.ref === ref)!.id)!;
    expect(placementOf('SW1')).toMatchObject({ rackId: project.racks[0]!.id, uPosition: 41 });
    expect(placementOf('SW2')).toMatchObject({ rackId: project.racks[1]!.id, uPosition: 41 });
    expect(placementOf('SW3')).toMatchObject({ rackId: project.racks[2]!.id, uPosition: 42 });
    expect(placementOf('SW4')).toMatchObject({ rackId: project.racks[2]!.id, uPosition: 41 });
    expect(placementOf('SRV1')).toMatchObject({ rackId: project.racks[2]!.id, uPosition: 1 });
    expect(placementOf('SRV8')).toMatchObject({ rackId: project.racks[2]!.id, uPosition: 8 });
    expect(placementOf('SRV9')).toMatchObject({ rackId: project.racks[3]!.id, uPosition: 1 });

    for (const rack of project.racks) {
      const acc = project.accessories.filter((a) => a.rackId === rack.id);
      expect(acc.filter((a) => a.type === 'vcm').map((a) => a.side).sort()).toEqual(['left', 'right']);
      expect(acc.filter((a) => a.type === 'top-entry').map((a) => a.side).sort()).toEqual(['left', 'right']);
    }
    expect(project.trays).toHaveLength(1);
    const tray = project.trays[0]!;
    expect(tray.kind).toBe('fiber-runway');
    expect(tray.layer).toBe('overhead');
    expect(tray.elevationMm).toBe(2600);
    expect(tray.fittings.filter((f) => f.type === 'waterfall').map((f) => f.rackId)).toEqual(project.racks.map((r) => r.id));
  });

  it('is in sync and routes about a quarter of the links along the runway with pinned waypoints', () => {
    expect(isOutOfSync(project)).toBe(false);
    const routed = Object.keys(project.routes);
    expect(routed).toHaveLength(20);
    const fabricIds = new Set(project.links.filter((l) => l.label?.startsWith('FAB')).map((l) => l.id));
    expect(routed.filter((id) => fabricIds.has(id))).toHaveLength(16);
    const tray = project.trays[0]!;
    for (const route of Object.values(project.routes)) {
      expect(route.linkId in project.routes).toBe(true);
      for (const seg of route.segments) {
        expect(seg.points.every((w) => w.pinned)).toBe(true);
        if (fabricIds.has(route.linkId)) {
          expect(seg.layer).toBe('overhead');
          expect(seg.trayId).toBe(tray.id);
          expect(seg.points.every((w) => w.pos.y === tray.points[0]!.y)).toBe(true);
          expect(seg.points.every((w) => w.anchor !== undefined)).toBe(true);
        } else {
          expect(seg.layer).toBe('in-rack');
        }
      }
      expect(route.aRack.entry).not.toBeNull();
      expect(route.bRack.entry).not.toBeNull();
    }
  });

  it('passes DRC with only unrouted-link warnings', () => {
    const issues = runDrc(project);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(issues.length).toBeGreaterThan(0);
    expect(new Set(issues.map((i) => i.rule))).toEqual(new Set(['unrouted-link']));
    expect(issues).toHaveLength(60);
  });

  it('honours the options and gives every build a fresh id', () => {
    const small = buildPodProject({ spines: 3, leafs: 5, serversPerLeaf: 2 });
    expect(small.id).not.toBe(project.id);
    expect(small.components.filter((c) => c.value === 'spine')).toHaveLength(3);
    expect(small.components.filter((c) => c.value?.startsWith('leaf'))).toHaveLength(5);
    // 3 pairs (the last is a single leaf) × 2 servers, each dual-homed.
    expect(small.components.filter((c) => c.value === 'server')).toHaveLength(6);
    expect(small.links).toHaveLength(5 * 3 + 6 * 2);
    expect(small.racks).toHaveLength(6);
    expect(runErc(small).filter((i) => i.severity === 'error')).toEqual([]);
    expect(runDrc(small).filter((i) => i.severity === 'error')).toEqual([]);
    expect(isOutOfSync(small)).toBe(false);
    expect(() => buildPodProject({ serversPerLeaf: 41 })).toThrow(RangeError);
  });
});
