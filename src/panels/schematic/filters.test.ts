import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { createComponent, createLink, createProject, ROOT_SHEET_ID } from '@/model/factories';
import { indexProject } from '@/model/query';
import { filterComponents, isUnassigned, linkSearchText, matchesRefFilter, matchesSearch, normaliseRefGlob, portsMissingOptic, sortLinks, splitGlobs, usedPortIds } from './filters';

const leaf = builtinCatalog.symbols.find((s) => s.id === 'sym.leaf-switch-48x25-8x100')!;
const spine = builtinCatalog.symbols.find((s) => s.id === 'sym.spine-switch-32x400')!;
const server = builtinCatalog.symbols.find((s) => s.id === 'sym.server-1u')!;

function fixture() {
  const project = createProject('t', '2026-01-01T00:00:00.000Z');
  const sw1 = createComponent(leaf, { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: 'SW1' });
  const sw10 = createComponent(leaf, { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: 'SW10' });
  const sp1 = createComponent(spine, { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: 'SP1' });
  const srv1 = createComponent(server, { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: 'SRV1', footprintDefId: null });
  sw1.optics['eth1/49'] = 'xcvr.100g-sr4';
  project.components.push(sw1, sw10, sp1, srv1);
  const l1 = createLink({ componentId: sw1.id, portId: 'eth1/49' }, { componentId: sp1.id, portId: 'eth1/1' }, 'cbl.om4-mpo-trunk', 'FAB1');
  const l2 = createLink({ componentId: sw10.id, portId: 'eth1/49' }, { componentId: sp1.id, portId: 'eth1/2' }, 'cbl.dac-100g');
  const l3 = createLink({ componentId: srv1.id, portId: 'eth0' }, { componentId: sw1.id, portId: 'eth1/1' }, null, 'FAB10');
  project.links.push(l1, l2, l3);
  return { project, idx: indexProject(project), sw1, sw10, sp1, srv1, l1, l2, l3 };
}

describe('ref filters', () => {
  it('treats plain text as a substring and wildcards as an anchored glob', () => {
    expect(matchesRefFilter('', 'SW1')).toBe(true);
    expect(matchesRefFilter('sw', 'SW12')).toBe(true);
    expect(matchesRefFilter('SW1', 'SW12')).toBe(true);
    expect(matchesRefFilter('SW1*', 'SW12')).toBe(true);
    expect(matchesRefFilter('SW?', 'SW12')).toBe(false);
    expect(matchesRefFilter('SRV*', 'SW1')).toBe(false);
  });

  it('normalises bulk globs and splits port glob lists', () => {
    expect(normaliseRefGlob('  ')).toBe('*');
    expect(normaliseRefGlob('SRV*')).toBe('SRV*');
    expect(splitGlobs('eth0, eth1/*  eth2')).toEqual(['eth0', 'eth1/*', 'eth2']);
    expect(splitGlobs('')).toEqual([]);
  });
});

describe('component filters', () => {
  it('filters by ref, kind and unassigned state', () => {
    const f = fixture();
    const all = f.project.components;
    expect(filterComponents(f.idx, all, { ref: 'SW*' }).map((c) => c.ref)).toEqual(['SW1', 'SW10']);
    expect(filterComponents(f.idx, all, { kind: 'server' }).map((c) => c.ref)).toEqual(['SRV1']);
    expect(filterComponents(f.idx, all, { kind: 'switch', ref: '1' }).map((c) => c.ref)).toEqual(['SW1', 'SW10', 'SP1']);
    // SW1:eth1/1 and SP1:eth1/1 are linked optical ports without an optic; SRV1 has no model; SW10's only link is a DAC.
    expect(filterComponents(f.idx, all, { unassignedOnly: true }).map((c) => c.ref)).toEqual(['SW1', 'SP1', 'SRV1']);
  });

  it('reports used ports and missing optics', () => {
    const f = fixture();
    expect([...usedPortIds(f.idx, f.sw1)].sort()).toEqual(['eth1/1', 'eth1/49']);
    expect(portsMissingOptic(f.idx, f.sw1)).toEqual(['eth1/1']);
    expect(portsMissingOptic(f.idx, f.sw10)).toEqual([]);
    expect(portsMissingOptic(f.idx, f.sp1)).toEqual(['eth1/1']);
    expect(isUnassigned(f.idx, f.sw10)).toBe(false);
    expect(isUnassigned(f.idx, f.srv1)).toBe(true);
  });
});

describe('link search', () => {
  it('matches every token against label, ends, cable and optics', () => {
    const f = fixture();
    const text = linkSearchText(f.idx, f.l1);
    expect(text).toContain('FAB1');
    expect(text).toContain('SW1:eth1/49');
    expect(text).toContain('OM4 MPO trunk');
    expect(text).toContain('100G-SR4');
    expect(matchesSearch('sw1 sp1', text)).toBe(true);
    expect(matchesSearch('sw10', text)).toBe(false);
    expect(matchesSearch('', text)).toBe(true);
  });

  it('sorts labelled links naturally and unlabelled ones last', () => {
    const f = fixture();
    expect(sortLinks(f.idx, f.project.links).map((l) => l.id)).toEqual([f.l1.id, f.l3.id, f.l2.id]);
  });
});
