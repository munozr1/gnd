import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import {
  assignFootprint,
  assignOptic,
  bulkAssign,
  compatibleFootprints,
  compatibleOptics,
  defaultCableFor,
  defaultCableForLink,
  globMatch,
} from './assignment';
import { GPU, LEAF, PANEL_LC, SERVER_1U, SERVER_2U, SPINE, fixtureProject, place, symbol } from './testUtils';

const xcvr = (id: string) => builtinCatalog.transceivers.find((t) => t.id === id)!;

describe('assignFootprint / assignOptic', () => {
  it('sets and clears assignments', () => {
    const p = fixtureProject();
    const a = place(p, SERVER_1U, { x: 0, y: 0 });
    const b = place(p, SERVER_1U, { x: 0, y: 0 });
    expect(assignFootprint(p, [a.id, b.id, 'ghost'], null)).toBe(2);
    expect(a.footprintDefId).toBeNull();
    expect(assignFootprint(p, [a.id], 'fp.server-1u')).toBe(1);
    expect(assignFootprint(p, [a.id], 'fp.server-1u')).toBe(0);
    assignOptic(p, a.id, 'eth0', 'xcvr.25g-sr');
    expect(a.optics).toEqual({ eth0: 'xcvr.25g-sr' });
    assignOptic(p, a.id, 'eth0', null);
    expect(a.optics).toEqual({});
    expect(() => assignOptic(p, 'ghost', 'eth0', null)).toThrow(/Component not found/);
  });
});

describe('glob', () => {
  it('supports * and ? and is anchored', () => {
    expect(globMatch('SRV*', 'SRV12')).toBe(true);
    expect(globMatch('SRV*', 'SW1')).toBe(false);
    expect(globMatch('SW1?', 'SW12')).toBe(true);
    expect(globMatch('SW1?', 'SW1')).toBe(false);
    expect(globMatch('eth1/4?', 'eth1/49')).toBe(true);
    expect(globMatch('srv*', 'SRV3')).toBe(true);
  });
});

describe('bulkAssign', () => {
  it('assigns a footprint and optics to every matching ref, skipping optics that do not fit', () => {
    const p = fixtureProject();
    const s1 = place(p, SERVER_1U, { x: 0, y: 0 }, { ref: 'SRV1' });
    const s2 = place(p, SERVER_1U, { x: 0, y: 0 }, { ref: 'SRV2' });
    const s3 = place(p, SERVER_2U, { x: 0, y: 0 }, { ref: 'SRV3' });
    const sw = place(p, LEAF, { x: 0, y: 0 }, { ref: 'SW1' });
    const n = bulkAssign(p, {
      refGlob: 'SRV*',
      footprintDefId: 'fp.server-1u',
      optics: [{ portGlob: 'eth?', opticId: 'xcvr.25g-sr' }],
    });
    expect(n).toBe(3);
    for (const s of [s1, s2, s3]) expect(s.footprintDefId).toBe('fp.server-1u');
    expect(s1.optics).toEqual({ eth0: 'xcvr.25g-sr', eth1: 'xcvr.25g-sr' });
    // 2U server: eth0/eth1 are QSFP28 (no fit), eth2/eth3 are SFP28.
    expect(s3.optics).toEqual({ eth2: 'xcvr.25g-sr', eth3: 'xcvr.25g-sr' });
    expect(sw.footprintDefId).toBe('fp.leaf-switch-48x25-8x100');
    expect(sw.optics).toEqual({});
  });

  it('leaves footprints alone when not specified', () => {
    const p = fixtureProject();
    const s = place(p, SERVER_1U, { x: 0, y: 0 }, { ref: 'SRV1' });
    bulkAssign(p, { refGlob: 'SRV1', optics: [{ portGlob: 'bmc*', opticId: 'xcvr.1g-t' }] });
    expect(s.footprintDefId).toBe('fp.server-1u');
    // bmc0 is a fixed RJ45 port: an SFP optic does not fit.
    expect(s.optics).toEqual({});
  });
});

describe('compatibility', () => {
  it('lists footprints whose ports cover the symbol pins with compatible cages', () => {
    const ids = (symId: string) => compatibleFootprints(builtinCatalog, symbol(symId)).map((f) => f.id);
    expect(ids(LEAF)).toEqual(['fp.leaf-switch-48x25-8x100']);
    expect(ids(SPINE)).toEqual(['fp.spine-switch-32x400']);
    expect(ids(SERVER_1U)[0]).toBe('fp.server-1u');
    expect(ids(SERVER_1U)).not.toContain('fp.server-2u');
    expect(ids(GPU)).toEqual(['fp.gpu-server-4u']);
    expect(ids('sym.blank-panel-1u')[0]).toBe('fp.blank-panel-1u');
  });

  it('lists optics that fit a cage, including backward-compatible ones', () => {
    const ids = (t: Parameters<typeof compatibleOptics>[1]) => compatibleOptics(builtinCatalog, t).map((x) => x.id).sort();
    expect(ids('SFP28')).toEqual(['xcvr.10g-lr', 'xcvr.10g-sr', 'xcvr.1g-t', 'xcvr.25g-lr', 'xcvr.25g-sr']);
    expect(ids('QSFP-DD')).toEqual(['xcvr.100g-lr4', 'xcvr.100g-sr4', 'xcvr.400g-dr4', 'xcvr.400g-sr8']);
    expect(ids('QSFP28')).toEqual(['xcvr.100g-lr4', 'xcvr.100g-sr4']);
    expect(ids('RJ45')).toEqual([]);
  });
});

describe('defaultCableFor', () => {
  it('picks the cable from media and connector', () => {
    const c = builtinCatalog;
    expect(defaultCableFor(c, xcvr('xcvr.25g-sr'), xcvr('xcvr.25g-sr'))).toBe('cbl.om4-duplex');
    expect(defaultCableFor(c, 'xcvr.25g-lr', 'xcvr.10g-lr')).toBe('cbl.os2-duplex');
    expect(defaultCableFor(c, 'xcvr.100g-sr4', 'xcvr.100g-sr4')).toBe('cbl.om4-mpo-trunk');
    expect(defaultCableFor(c, 'xcvr.400g-dr4', 'xcvr.400g-dr4')).toBe('cbl.os2-mpo-trunk');
    expect(defaultCableFor(c, 'xcvr.1g-t', 'xcvr.1g-t')).toBe('cbl.cat6a');
  });

  it('returns null for mismatches and missing optics', () => {
    const c = builtinCatalog;
    expect(defaultCableFor(c, 'xcvr.25g-sr', 'xcvr.25g-lr')).toBeNull();
    expect(defaultCableFor(c, 'xcvr.100g-sr4', 'xcvr.25g-sr')).toBeNull();
    expect(defaultCableFor(c, 'xcvr.25g-sr', null)).toBeNull();
    expect(defaultCableFor(c, 'nope', 'xcvr.25g-sr')).toBeNull();
  });

  it('treats fixed LC / RJ45 ports as connectors when resolving a link', () => {
    const p = fixtureProject();
    const leaf = place(p, LEAF, { x: 0, y: 0 });
    const panel = place(p, PANEL_LC, { x: 0, y: 0 });
    const srv = place(p, SERVER_1U, { x: 0, y: 0 });
    leaf.optics['eth1/1'] = 'xcvr.25g-sr';
    expect(defaultCableForLink(p, { a: { componentId: leaf.id, portId: 'eth1/1' }, b: { componentId: panel.id, portId: 'f1' } })).toBe(
      'cbl.om4-duplex',
    );
    expect(defaultCableForLink(p, { a: { componentId: leaf.id, portId: 'mgmt0' }, b: { componentId: srv.id, portId: 'bmc0' } })).toBe(
      'cbl.cat6a',
    );
    // Bare cages with no optics have no connector yet.
    expect(defaultCableForLink(p, { a: { componentId: leaf.id, portId: 'eth1/2' }, b: { componentId: srv.id, portId: 'eth0' } })).toBeNull();
  });
});
