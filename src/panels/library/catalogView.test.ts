import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { buildCustomDevice } from '@/commands/customDevice';
import { createProject } from '@/model/factories';
import { flattenGroups, groupLibrary, libraryEntries, matchesLibraryQuery, portSummary } from './catalogView';

const leaf = builtinCatalog.symbols.find((s) => s.id === 'sym.leaf-switch-48x25-8x100')!;
const blank = builtinCatalog.symbols.find((s) => s.id === 'sym.blank-panel-1u')!;

describe('portSummary', () => {
  it('counts pins by type in order of first appearance', () => {
    expect(portSummary(leaf)).toBe('48×SFP28 + 8×QSFP28 + 1×RJ45');
    expect(portSummary(blank)).toBe('no ports');
  });
});

describe('libraryEntries / groupLibrary', () => {
  it('lists built-ins with their default footprint height, grouped with Switches first', () => {
    const project = createProject('t', '2026-01-01T00:00:00.000Z');
    const entries = libraryEntries(project);
    expect(entries).toHaveLength(builtinCatalog.symbols.length);
    const leafEntry = entries.find((e) => e.symbol.id === leaf.id)!;
    expect(leafEntry.heightU).toBe(1);
    expect(leafEntry.custom).toBe(false);
    const groups = groupLibrary(entries);
    expect(groups[0]!.category).toBe('Switches');
    expect(groups.map((g) => g.category)).toEqual(['Switches', 'Servers', 'Patch panels', 'Panels']);
    expect(flattenGroups(groups)).toHaveLength(entries.length);
  });

  it('filters by name, kind and port type tokens', () => {
    const entries = libraryEntries(createProject('t', '2026-01-01T00:00:00.000Z'));
    const names = (q: string) => flattenGroups(groupLibrary(entries, q)).map((e) => e.symbol.name);
    expect(names('spine')).toEqual(['Spine switch 32×400G']);
    expect(names('qsfp-dd')).toEqual(['Spine switch 32×400G']);
    expect(names('server osfp')).toEqual(['GPU server 4U']);
    expect(names('patch-panel')).toHaveLength(2);
    expect(names('nothing-matches')).toEqual([]);
    expect(matchesLibraryQuery(entries[0]!, '')).toBe(true);
  });

  it('puts custom devices in a trailing Custom group', () => {
    const project = createProject('t', '2026-01-01T00:00:00.000Z');
    const { symbol, footprint } = buildCustomDevice(
      { name: 'Edge router', kind: 'router', heightU: 2, ports: [{ id: 'xe-0/0/0', type: 'SFP+' }, { id: 'et-0/0/1', type: 'QSFP28', role: 'uplink' }] },
      project,
    );
    project.customCatalog.symbols.push(symbol);
    project.customCatalog.footprints.push(footprint);
    const groups = groupLibrary(libraryEntries(project));
    const custom = groups[groups.length - 1]!;
    expect(custom.category).toBe('Custom');
    expect(custom.entries[0]!.custom).toBe(true);
    expect(custom.entries[0]!.heightU).toBe(2);
    expect(custom.entries[0]!.portSummary).toBe('1×SFP+ + 1×QSFP28');
  });
});
