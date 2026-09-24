import { describe, expect, it } from 'vitest';
import { createLink } from '../factories';
import {
  addComponent,
  addLink,
  clearRef,
  deleteComponents,
  deleteLinks,
  mirrorComponent,
  moveComponents,
  rotateComponent,
  setComponentRef,
  setComponentValue,
  setLinkCable,
  setLinkLabel,
  setLinkWirePoints,
  toggleExpandedPins,
} from './mutations';
import { LEAF, SERVER_1U, SPINE, emptyRoute, fixtureProject, place } from './testUtils';

describe('addComponent', () => {
  it('snaps to the grid, annotates and creates no placement', () => {
    const p = fixtureProject();
    const a = addComponent(p, LEAF, 'root', { x: 103, y: 96 }, { value: 'leaf-a' });
    const b = addComponent(p, LEAF, 'root', { x: 0, y: 0 });
    expect(a.sch.pos).toEqual({ x: 100, y: 100 });
    expect(a.ref).toBe('SW1');
    expect(a.value).toBe('leaf-a');
    expect(a.footprintDefId).toBe('fp.leaf-switch-48x25-8x100');
    expect(b.ref).toBe('SW2');
    expect(p.components).toHaveLength(2);
    expect(p.placements).toEqual([]);
    const c = addComponent(p, SERVER_1U, 'root', { x: 0, y: 0 }, { annotate: false, footprintDefId: null });
    expect(c.ref).toBe('SRV?');
    expect(c.footprintDefId).toBeNull();
  });

  it('rejects unknown symbols and sheets', () => {
    const p = fixtureProject();
    expect(() => addComponent(p, 'sym.nope', 'root', { x: 0, y: 0 })).toThrow(/Unknown symbol/);
    expect(() => addComponent(p, LEAF, 'nope', { x: 0, y: 0 })).toThrow(/Sheet not found/);
  });
});

describe('moveComponents', () => {
  it('translates positions, carries internal wires and re-routes partial ones', () => {
    const p = fixtureProject();
    const a = place(p, LEAF, { x: 0, y: 0 });
    const b = place(p, SPINE, { x: 600, y: 0 });
    const c = place(p, SPINE, { x: 600, y: 600 });
    const ab = createLink({ componentId: a.id, portId: 'eth1/49' }, { componentId: b.id, portId: 'eth1/1' });
    const ac = createLink({ componentId: a.id, portId: 'eth1/50' }, { componentId: c.id, portId: 'eth1/1' });
    ab.sch.wirePoints = [{ x: 300, y: 10 }, { x: 300, y: 50 }];
    ac.sch.wirePoints = [{ x: 300, y: 20 }];
    p.links.push(ab, ac);
    moveComponents(p, [a.id, b.id], { x: 10, y: -20 });
    expect(a.sch.pos).toEqual({ x: 10, y: -20 });
    expect(b.sch.pos).toEqual({ x: 610, y: -20 });
    expect(c.sch.pos).toEqual({ x: 600, y: 600 });
    expect(ab.sch.wirePoints).toEqual([{ x: 310, y: -10 }, { x: 310, y: 30 }]);
    expect(ac.sch.wirePoints).toEqual([]);
  });
});

describe('rotate / mirror / expand', () => {
  it('cycles rotation and clears attached wires', () => {
    const p = fixtureProject();
    const a = place(p, LEAF, { x: 0, y: 0 });
    const b = place(p, SPINE, { x: 600, y: 0 });
    const l = createLink({ componentId: a.id, portId: 'eth1/49' }, { componentId: b.id, portId: 'eth1/1' });
    l.sch.wirePoints = [{ x: 1, y: 1 }];
    p.links.push(l);
    rotateComponent(p, a.id);
    expect(a.sch.rotation).toBe(90);
    expect(l.sch.wirePoints).toEqual([]);
    rotateComponent(p, a.id);
    rotateComponent(p, a.id);
    rotateComponent(p, a.id);
    expect(a.sch.rotation).toBe(0);
    rotateComponent(p, a.id, -1);
    expect(a.sch.rotation).toBe(270);
  });

  it('toggles mirror and expanded pins without leaving false flags behind', () => {
    const p = fixtureProject();
    const a = place(p, LEAF, { x: 0, y: 0 });
    mirrorComponent(p, a.id);
    expect(a.sch.mirrored).toBe(true);
    mirrorComponent(p, a.id);
    expect('mirrored' in a.sch).toBe(false);
    expect(toggleExpandedPins(p, a.id)).toBe(true);
    expect(a.expandedPins).toBe(true);
    expect(toggleExpandedPins(p, a.id)).toBe(false);
    expect('expandedPins' in a).toBe(false);
  });
});

describe('deleteComponents', () => {
  it('removes components with their links, placements and routes but not syncState', () => {
    const p = fixtureProject();
    const a = place(p, LEAF, { x: 0, y: 0 });
    const b = place(p, SPINE, { x: 600, y: 0 });
    const c = place(p, SPINE, { x: 600, y: 600 });
    const ab = createLink({ componentId: a.id, portId: 'eth1/49' }, { componentId: b.id, portId: 'eth1/1' });
    const bc = createLink({ componentId: b.id, portId: 'eth1/2' }, { componentId: c.id, portId: 'eth1/1' });
    p.links.push(ab, bc);
    p.routes[ab.id] = emptyRoute(ab.id);
    p.routes[bc.id] = emptyRoute(bc.id);
    p.placements.push(
      { componentId: a.id, rackId: null, uPosition: null, face: 'front' },
      { componentId: c.id, rackId: null, uPosition: null, face: 'front' },
    );
    p.syncState.components[a.id] = { ref: a.ref, footprintDefId: a.footprintDefId };
    const r = deleteComponents(p, [a.id, 'ghost']);
    expect(r).toEqual({ componentIds: [a.id], linkIds: [ab.id] });
    expect(p.components.map((x) => x.id)).toEqual([b.id, c.id]);
    expect(p.links.map((l) => l.id)).toEqual([bc.id]);
    expect(Object.keys(p.routes)).toEqual([bc.id]);
    expect(p.placements.map((x) => x.componentId)).toEqual([c.id]);
    expect(p.syncState.components[a.id]).toBeDefined();
  });
});

describe('addLink / deleteLinks', () => {
  it('creates a link with a cable derived from the optics', () => {
    const p = fixtureProject();
    const a = place(p, LEAF, { x: 0, y: 0 });
    const s = place(p, SERVER_1U, { x: 400, y: 0 });
    a.optics['eth1/1'] = 'xcvr.25g-sr';
    s.optics.eth0 = 'xcvr.25g-sr';
    const id = addLink(p, { componentId: a.id, portId: 'eth1/1' }, { componentId: s.id, portId: 'eth0' });
    const l = p.links.find((x) => x.id === id)!;
    expect(l.cableDefId).toBe('cbl.om4-duplex');
    const id2 = addLink(p, { componentId: a.id, portId: 'eth1/2' }, { componentId: s.id, portId: 'eth1' }, null);
    expect(p.links.find((x) => x.id === id2)!.cableDefId).toBeNull();
    const id3 = addLink(p, { componentId: a.id, portId: 'mgmt0' }, { componentId: s.id, portId: 'bmc0' }, 'cbl.cat6a');
    expect(p.links.find((x) => x.id === id3)!.cableDefId).toBe('cbl.cat6a');
  });

  it('rejects occupied, unknown and self-connected ports, honouring lanes', () => {
    const p = fixtureProject();
    const a = place(p, LEAF, { x: 0, y: 0 }, { ref: 'SW1' });
    const s1 = place(p, SERVER_1U, { x: 400, y: 0 }, { ref: 'SRV1' });
    const s2 = place(p, SERVER_1U, { x: 400, y: 60 }, { ref: 'SRV2' });
    addLink(p, { componentId: a.id, portId: 'eth1/1' }, { componentId: s1.id, portId: 'eth0' });
    expect(() => addLink(p, { componentId: a.id, portId: 'eth1/1' }, { componentId: s2.id, portId: 'eth0' })).toThrow(
      /SW1:eth1\/1 is already connected/,
    );
    expect(() => addLink(p, { componentId: a.id, portId: 'eth1/2' }, { componentId: a.id, portId: 'eth1/2' })).toThrow(/two different ports/);
    expect(() => addLink(p, { componentId: a.id, portId: 'nope' }, { componentId: s2.id, portId: 'eth0' })).toThrow(/has no port nope/);
    expect(() => addLink(p, { componentId: 'ghost', portId: 'x' }, { componentId: s2.id, portId: 'eth0' })).toThrow(/Component not found/);

    addLink(p, { componentId: a.id, portId: 'eth1/49', lane: 0 }, { componentId: s1.id, portId: 'eth1' });
    addLink(p, { componentId: a.id, portId: 'eth1/49', lane: 1 }, { componentId: s2.id, portId: 'eth1' });
    expect(() => addLink(p, { componentId: a.id, portId: 'eth1/49', lane: 1 }, { componentId: s2.id, portId: 'eth0' })).toThrow(
      /eth1\/49\.1 is already connected/,
    );
    expect(() => addLink(p, { componentId: a.id, portId: 'eth1/49' }, { componentId: s2.id, portId: 'eth0' })).toThrow(/already connected/);
    expect(p.links).toHaveLength(3);
  });

  it('deleteLinks removes routes too', () => {
    const p = fixtureProject();
    const a = place(p, LEAF, { x: 0, y: 0 });
    const b = place(p, SPINE, { x: 600, y: 0 });
    const l = createLink({ componentId: a.id, portId: 'eth1/49' }, { componentId: b.id, portId: 'eth1/1' });
    p.links.push(l);
    p.routes[l.id] = emptyRoute(l.id);
    deleteLinks(p, [l.id, 'ghost']);
    expect(p.links).toEqual([]);
    expect(p.routes).toEqual({});
  });
});

describe('property setters', () => {
  it('sets link label, cable and wire points', () => {
    const p = fixtureProject();
    const a = place(p, LEAF, { x: 0, y: 0 });
    const b = place(p, SPINE, { x: 600, y: 0 });
    const l = createLink({ componentId: a.id, portId: 'eth1/49' }, { componentId: b.id, portId: 'eth1/1' });
    p.links.push(l);
    setLinkLabel(p, l.id, 'uplink-1');
    expect(l.label).toBe('uplink-1');
    setLinkLabel(p, l.id, '');
    expect('label' in l).toBe(false);
    setLinkCable(p, l.id, 'cbl.om4-mpo-trunk');
    expect(l.cableDefId).toBe('cbl.om4-mpo-trunk');
    const pts = [{ x: 1, y: 2 }];
    setLinkWirePoints(p, l.id, pts);
    expect(l.sch.wirePoints).toEqual(pts);
    expect(l.sch.wirePoints[0]).not.toBe(pts[0]);
    expect(() => setLinkLabel(p, 'ghost', 'x')).toThrow(/Link not found/);
  });

  it('sets component value and enforces unique refs', () => {
    const p = fixtureProject();
    const a = place(p, LEAF, { x: 0, y: 0 }, { ref: 'SW1' });
    const b = place(p, LEAF, { x: 0, y: 0 }, { ref: 'SW2' });
    setComponentValue(p, a.id, 'leaf-a');
    expect(a.value).toBe('leaf-a');
    setComponentValue(p, a.id, undefined);
    expect('value' in a).toBe(false);
    setComponentRef(p, a.id, ' SW10 ');
    expect(a.ref).toBe('SW10');
    expect(() => setComponentRef(p, b.id, 'SW10')).toThrow(/already used/);
    expect(() => setComponentRef(p, b.id, '  ')).toThrow(/empty/);
    setComponentRef(p, b.id, 'SW2');
    clearRef(p, b.id);
    expect(b.ref).toBe('SW?');
  });
});
