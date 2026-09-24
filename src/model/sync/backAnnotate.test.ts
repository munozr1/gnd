import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createLink } from '@/model/factories';
import type { BackAnnotation, Project } from '@/model/types';
import {
  acceptBackAnnotation,
  proposeFootprintChange,
  proposePortSwap,
  proposeRefRename,
  rejectBackAnnotation,
  validateFootprintChange,
  validatePortSwap,
  validateRefRename,
} from './backAnnotate';
import { computeSyncPlan, isOutOfSync } from './diff';
import { GPU_4U_FP, SERVER_2U_FP, addRoute, buildFabric, edit, place, placementOf, syncAll } from './testFixtures';

const propose = (project: Project, fn: (draft: Project) => BackAnnotation) => {
  let annotation!: BackAnnotation;
  const next = produce(project, (d) => {
    annotation = fn(d);
  });
  return { next, annotation };
};

const accept = (project: Project, id: string) => {
  let result!: ReturnType<typeof acceptBackAnnotation>;
  const next = produce(project, (d) => {
    result = acceptBackAnnotation(d, id);
  });
  return { next, result };
};

describe('port swap', () => {
  it('validates the target: same component, same port type, free, and different from the current port', () => {
    const f = buildFabric();
    const p = syncAll(f.project);
    expect(validatePortSwap(p, f.uplinkId, 'a', 'eth1/50')).toBeNull();
    expect(validatePortSwap(p, f.uplinkId, 'a', 'eth1/49')).toMatch(/already on/);
    expect(validatePortSwap(p, f.uplinkId, 'a', 'eth1/2')).toMatch(/is SFP28, not QSFP28/);
    expect(validatePortSwap(p, f.uplinkId, 'a', 'eth9/9')).toMatch(/no port/);
    expect(validatePortSwap(p, f.downlinkId, 'b', 'eth1/49')).toMatch(/not SFP28/);
    expect(validatePortSwap(p, 'nope', 'a', 'eth1/50')).toMatch(/does not exist/);

    const busy = edit(p, (d) => {
      d.links.push(createLink({ componentId: f.leafId, portId: 'eth1/50' }, { componentId: f.spineId, portId: 'eth1/2' }));
    });
    expect(validatePortSwap(busy, f.uplinkId, 'a', 'eth1/50')).toMatch(/already in use/);
    expect(() =>
      produce(busy, (d) => {
        proposePortSwap(d, f.uplinkId, 'a', 'eth1/50');
      }),
    ).toThrow(/already in use/);
  });

  it('treats breakout lanes individually when checking for a free port', () => {
    const f = buildFabric();
    let p = edit(f.project, (d) => {
      // Two lanes of SW1:eth1/50 already used; lane 2 is free.
      d.links.push(
        createLink({ componentId: f.leafId, portId: 'eth1/50', lane: 0 }, { componentId: f.spineId, portId: 'eth1/3' }),
        createLink({ componentId: f.leafId, portId: 'eth1/50', lane: 1 }, { componentId: f.spineId, portId: 'eth1/4' }),
      );
      d.links.find((l) => l.id === f.uplinkId)!.a.lane = 0;
    });
    p = syncAll(p);
    expect(validatePortSwap(p, f.uplinkId, 'a', 'eth1/50')).toMatch(/already in use/);
    const laneTwo = edit(p, (d) => {
      d.links.find((l) => l.id === f.uplinkId)!.a.lane = 2;
    });
    expect(validatePortSwap(laneTwo, f.uplinkId, 'a', 'eth1/50')).toBeNull();
    // A whole-port link cannot land on a port with lanes in use.
    const wholePort = edit(p, (d) => {
      delete d.links.find((l) => l.id === f.uplinkId)!.a.lane;
    });
    expect(validatePortSwap(wholePort, f.uplinkId, 'a', 'eth1/50')).toMatch(/already in use/);
  });

  it('records a proposal and supersedes an earlier one for the same link end', () => {
    const f = buildFabric();
    const p = syncAll(f.project);
    const first = propose(p, (d) => proposePortSwap(d, f.uplinkId, 'a', 'eth1/50'));
    expect(first.annotation).toEqual({
      id: first.annotation.id,
      kind: 'port-swap',
      linkId: f.uplinkId,
      end: 'a',
      fromPortId: 'eth1/49',
      toPortId: 'eth1/50',
    });
    expect(first.next.backAnnotations).toEqual([first.annotation]);
    const second = propose(first.next, (d) => proposePortSwap(d, f.uplinkId, 'a', 'eth1/51'));
    expect(second.next.backAnnotations).toEqual([second.annotation]);
    const otherEnd = propose(second.next, (d) => proposePortSwap(d, f.uplinkId, 'b', 'eth1/9'));
    expect(otherEnd.next.backAnnotations).toHaveLength(2);
    // A proposal changes nothing in the schematic yet.
    expect(otherEnd.next.links).toBe(p.links);
    expect(isOutOfSync(otherEnd.next)).toBe(false);
  });

  it('accepting moves the link end, its optic and the syncState copy; the layout stays in sync', () => {
    const f = buildFabric();
    let p = edit(f.project, (d) => {
      d.components.find((c) => c.id === f.leafId)!.optics['eth1/49'] = 'xcvr.100g-sr4';
    });
    p = syncAll(p);
    p = edit(p, (d) => {
      addRoute(d, f.uplinkId);
    });
    const { next: proposed, annotation } = propose(p, (d) => proposePortSwap(d, f.uplinkId, 'a', 'eth1/50'));
    const { next, result } = accept(proposed, annotation.id);
    expect(result).toEqual({ ok: true, annotation, unplaced: false });
    const link = next.links.find((l) => l.id === f.uplinkId)!;
    expect(link.a).toEqual({ componentId: f.leafId, portId: 'eth1/50' });
    expect(link.b).toEqual({ componentId: f.spineId, portId: 'eth1/1' });
    expect(next.components.find((c) => c.id === f.leafId)!.optics).toEqual({ 'eth1/50': 'xcvr.100g-sr4' });
    expect(next.syncState.links[f.uplinkId]).toEqual({
      a: { componentId: f.leafId, portId: 'eth1/50' },
      b: { componentId: f.spineId, portId: 'eth1/1' },
    });
    expect(next.routes[f.uplinkId]?.needsReview).toBeUndefined();
    expect(next.backAnnotations).toEqual([]);
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('keeps an existing optic on the target port instead of overwriting it', () => {
    const f = buildFabric();
    let p = edit(f.project, (d) => {
      const leaf = d.components.find((c) => c.id === f.leafId)!;
      leaf.optics['eth1/49'] = 'xcvr.100g-sr4';
      leaf.optics['eth1/50'] = 'xcvr.100g-lr4';
    });
    p = syncAll(p);
    const { next: proposed, annotation } = propose(p, (d) => proposePortSwap(d, f.uplinkId, 'a', 'eth1/50'));
    const { next } = accept(proposed, annotation.id);
    expect(next.components.find((c) => c.id === f.leafId)!.optics).toEqual({
      'eth1/49': 'xcvr.100g-sr4',
      'eth1/50': 'xcvr.100g-lr4',
    });
  });

  it('fails to accept a proposal whose target port got taken, leaving it pending', () => {
    const f = buildFabric();
    const p = syncAll(f.project);
    const { next: proposed, annotation } = propose(p, (d) => proposePortSwap(d, f.uplinkId, 'a', 'eth1/50'));
    const taken = edit(proposed, (d) => {
      d.links.push(createLink({ componentId: f.leafId, portId: 'eth1/50' }, { componentId: f.spineId, portId: 'eth1/2' }));
    });
    const { next, result } = accept(taken, annotation.id);
    expect(result).toEqual({ ok: false, error: 'SW1:eth1/50 is already in use' });
    expect(next.backAnnotations).toEqual([annotation]);
    expect(next.links.find((l) => l.id === f.uplinkId)!.a.portId).toBe('eth1/49');
  });

  it('fails to accept when the link end moved in the schematic since the proposal', () => {
    const f = buildFabric();
    const p = syncAll(f.project);
    const { next: proposed, annotation } = propose(p, (d) => proposePortSwap(d, f.uplinkId, 'a', 'eth1/50'));
    const moved = edit(proposed, (d) => {
      d.links.find((l) => l.id === f.uplinkId)!.a.portId = 'eth1/52';
    });
    const { result } = accept(moved, annotation.id);
    expect(result).toEqual({ ok: false, error: 'Link end has changed since the proposal was made' });
  });
});

describe('ref rename', () => {
  it('enforces uniqueness and non-empty refs', () => {
    const f = buildFabric();
    expect(validateRefRename(f.project, f.leafId, 'LEAF1')).toBeNull();
    expect(validateRefRename(f.project, f.leafId, 'SW2')).toMatch(/already used/);
    expect(validateRefRename(f.project, f.leafId, 'SW1')).toMatch(/already has/);
    expect(validateRefRename(f.project, f.leafId, '   ')).toMatch(/empty/);
    expect(validateRefRename(f.project, 'nope', 'X')).toMatch(/does not exist/);
    expect(() =>
      produce(f.project, (d) => {
        proposeRefRename(d, f.leafId, 'SW2');
      }),
    ).toThrow(/already used/);
  });

  it('accepting renames the component and its syncState copy without touching placements', () => {
    const f = buildFabric();
    const p = syncAll(f.project);
    const { next: proposed, annotation } = propose(p, (d) => proposeRefRename(d, f.leafId, ' LEAF1 '));
    expect(annotation).toMatchObject({ kind: 'ref-rename', componentId: f.leafId, from: 'SW1', to: 'LEAF1' });
    const { next, result } = accept(proposed, annotation.id);
    expect(result).toEqual({ ok: true, annotation, unplaced: false });
    expect(next.components.find((c) => c.id === f.leafId)!.ref).toBe('LEAF1');
    expect(next.syncState.components[f.leafId]).toEqual({ ref: 'LEAF1', footprintDefId: 'fp.leaf-switch-48x25-8x100' });
    expect(next.placements).toBe(p.placements);
    expect(next.backAnnotations).toEqual([]);
    expect(isOutOfSync(next)).toBe(false);
  });

  it('fails to accept when the ref was taken in the meantime', () => {
    const f = buildFabric();
    const p = syncAll(f.project);
    const { next: proposed, annotation } = propose(p, (d) => proposeRefRename(d, f.leafId, 'LEAF1'));
    const clash = edit(proposed, (d) => {
      d.components.find((c) => c.id === f.serverId)!.ref = 'LEAF1';
    });
    const { next, result } = accept(clash, annotation.id);
    expect(result).toEqual({ ok: false, error: 'Reference LEAF1 is already used by another component' });
    expect(next.backAnnotations).toHaveLength(1);
  });
});

describe('footprint change', () => {
  it('validates the target model exists in the catalog', () => {
    const f = buildFabric();
    expect(validateFootprintChange(f.project, f.serverId, SERVER_2U_FP)).toBeNull();
    expect(validateFootprintChange(f.project, f.serverId, null)).toBeNull();
    expect(validateFootprintChange(f.project, f.serverId, 'fp.server-1u')).toMatch(/already uses/);
    expect(validateFootprintChange(f.project, f.serverId, 'fp.nope')).toMatch(/Unknown footprint/);
    expect(() =>
      produce(f.project, (d) => {
        proposeFootprintChange(d, f.serverId, 'fp.nope');
      }),
    ).toThrow(/Unknown footprint/);
  });

  it('accepting updates the component and syncState and keeps the slot when the model fits', () => {
    const f = buildFabric();
    const p = syncAll(f.project);
    const { next: proposed, annotation } = propose(p, (d) => proposeFootprintChange(d, f.serverId, SERVER_2U_FP));
    expect(annotation).toMatchObject({ kind: 'footprint-change', from: 'fp.server-1u', to: SERVER_2U_FP });
    const { next, result } = accept(proposed, annotation.id);
    expect(result).toEqual({ ok: true, annotation, unplaced: false });
    expect(next.components.find((c) => c.id === f.serverId)!.footprintDefId).toBe(SERVER_2U_FP);
    expect(next.syncState.components[f.serverId]).toEqual({ ref: 'SRV1', footprintDefId: SERVER_2U_FP });
    expect(placementOf(next, f.serverId)).toMatchObject({ rackId: f.rackId, uPosition: 1 });
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('accepting unplaces the device when the new model does not fit its slot', () => {
    const f = buildFabric();
    let p = edit(f.project, (d) => place(d, f.serverId, f.rackId, 42));
    p = syncAll(p);
    const { next: proposed, annotation } = propose(p, (d) => proposeFootprintChange(d, f.serverId, GPU_4U_FP));
    const { next, result } = accept(proposed, annotation.id);
    expect(result).toEqual({ ok: true, annotation, unplaced: true });
    expect(placementOf(next, f.serverId)).toEqual({ componentId: f.serverId, rackId: null, uPosition: null, face: 'front' });
    expect(next.syncState.components[f.serverId]?.footprintDefId).toBe(GPU_4U_FP);
    expect(computeSyncPlan(next).changes).toEqual([]);
  });

  it('supersedes an earlier model proposal for the same component', () => {
    const f = buildFabric();
    const a = propose(f.project, (d) => proposeFootprintChange(d, f.serverId, SERVER_2U_FP));
    const b = propose(a.next, (d) => proposeFootprintChange(d, f.serverId, GPU_4U_FP));
    expect(b.next.backAnnotations).toEqual([b.annotation]);
  });
});

describe('reject', () => {
  it('drops the proposal and reports whether one was found', () => {
    const f = buildFabric();
    const { next: proposed, annotation } = propose(f.project, (d) => proposeRefRename(d, f.leafId, 'LEAF1'));
    let found = false;
    const next = produce(proposed, (d) => {
      found = rejectBackAnnotation(d, annotation.id);
    });
    expect(found).toBe(true);
    expect(next.backAnnotations).toEqual([]);
    expect(next.components).toBe(proposed.components);
    let missing = true;
    produce(next, (d) => {
      missing = rejectBackAnnotation(d, annotation.id);
    });
    expect(missing).toBe(false);
  });

  it('accepting an unknown id fails cleanly', () => {
    const f = buildFabric();
    const { result } = accept(f.project, 'nope');
    expect(result).toEqual({ ok: false, error: 'No pending back-annotation nope' });
  });
});
