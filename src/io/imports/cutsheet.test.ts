// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { indexProject } from '@/model/query';
import { isOutOfSync } from '@/model/sync';
import { runDrc } from '@/model/drc';
import { serializeProject, parseProject } from '@/io/persistence';
import { buildCutsheetProject, detectCutsheetMapping, parseCapacity, parseEndpoint, planCutsheet, readCutsheetCsv } from './cutsheet';

const sample = readFileSync(new URL('../../../e2e/fixtures/cutsheet.csv', import.meta.url), 'utf8');
const csv = (rows: string) => readCutsheetCsv(`a_end_interface,b_end_interface,capacity,state,Link Type\n${rows}`);

describe('cutsheet parsing and validation', () => {
  it('recognizes D/E/F and preserves every source connection in a representative cutsheet', () => {
    const table = readCutsheetCsv(sample);
    expect(detectCutsheetMapping(table)).toEqual({ a: 3, b: 4, speed: 5, state: 2, linkType: 1 });
    const plan = planCutsheet(table);
    expect(plan.errors).toEqual([]); expect(plan.warnings).toEqual([]);
    expect(plan.sourceRows).toBe(48); expect(plan.devices).toHaveLength(49); expect(plan.links).toHaveLength(48);
    expect(plan.links.filter((l) => l.speed === 10)).toHaveLength(46); expect(plan.links.filter((l) => l.speed === 100)).toHaveLength(2);
    expect(plan.links[0]).toMatchObject({ row: 2, a: { device: 'example-dist-r101', port: 'xe-0/0/0' }, b: { device: 'example-access-001', port: 'eth1' }, speed: 10, state: 'RESERVED' });
    expect(plan.links.some((l) => l.a.port === 'xe-0/0/52:0')).toBe(true);
  });
  it('reads BOM, CRLF, quoted commas, escaped quotes, multiline text and trailing blanks', () => {
    const table = readCutsheetCsv('\uFEFFa,b,c\r\n"one,two","say ""hi""","line1\nline2"\r\n,,\r\n');
    expect(table.headers).toEqual(['a', 'b', 'c']);
    expect(table.rows).toEqual([['one,two', 'say "hi"', 'line1\nline2'], ['', '', '']]);
  });
  it.each(['a,b,c\n"oops,x,y', 'a,b,c\n"one"two,b,c', 'a,b,c\none"two,b,c'])('rejects malformed quotes: %s', (input) => expect(() => readCutsheetCsv(input)).toThrow(/quot/i));
  it('keeps hostname underscores and breakout suffixes intact', () => {
    expect(parseEndpoint(' site_dist_r101_xe-0/0/52:3 ')).toEqual({ device: 'site_dist_r101', port: 'xe-0/0/52:3' });
    expect(parseEndpoint('no-port')).toBeNull(); expect(parseEndpoint('switch_')).toBeNull();
  });
  it.each([['10', 10], ['100G', 100], ['25 Gbps', 25], ['10000 Mbps', 10], ['0.4 Tbps', 400], ['0', null], ['-10', null], ['', null], ['10x', null]])('normalizes speed %s', (input, expected) => expect(parseCapacity(String(input))).toBe(expected));
  it('deduplicates reversed rows and blocks port reuse, speed conflicts and invalid rows', () => {
    const duplicate = planCutsheet(csv('a_p1,b_p1,10,UP,Fiber\nb_p1,a_p1,10,UP,Fiber'));
    expect(duplicate.links).toHaveLength(1); expect(duplicate.warnings[0]?.row).toBe(3);
    for (const row of ['a_p1,c_p1,10,UP,Fiber', 'a_p1,b_p1,100,UP,Fiber', 'bad,c_p1,10,UP,Fiber', 'a_p2,c_p1,no,UP,Fiber', 'a_p1,a_p1,10,UP,Fiber', 'a_p2,b_p2,10']) {
      const plan = planCutsheet(csv(`a_p1,b_p1,10,UP,Fiber\n${row}`));
      expect(plan.errors[0]?.row).toBe(3);
      expect(() => buildCutsheetProject(plan, { name: 'Invalid', draftRacks: true })).toThrow();
    }
  });
  it('supports remapped columns and prevents overlapping mappings or empty imports', () => {
    const table = readCutsheetCsv('Rate,Destination,Source\n100,bb_et-1,aa_et-2');
    expect(planCutsheet(table).errors).toHaveLength(1);
    expect(planCutsheet(table, { a: 2, b: 1, speed: 0, state: -1, linkType: -1 }).links[0]?.a.device).toBe('aa');
    expect(planCutsheet(table, { a: 1, b: 1, speed: 0, state: -1, linkType: -1 }).errors).toHaveLength(1);
    expect(planCutsheet(csv(',,,,' )).errors[0]?.message).toContain('No connection rows');
  });
});

describe('cutsheet design generation', () => {
  it('creates a synced, editable design with exact endpoint names and speeds and collision-free draft racks', () => {
    const plan = planCutsheet(readCutsheetCsv(sample)), project = buildCutsheetProject(plan, { name: 'Imported site', draftRacks: true });
    const idx = indexProject(project);
    expect(project.components).toHaveLength(49); expect(project.links).toHaveLength(48);
    expect(project.racks).toHaveLength(5); expect(project.sheets).toHaveLength(5);
    expect(project.components.map((c) => c.ref).sort()).toEqual([...plan.devices].sort());
    for (const source of plan.links) {
      const link = project.links[plan.links.indexOf(source)]!;
      for (const [end, expected] of [[link.a, source.a], [link.b, source.b]] as const) {
        expect(idx.component(end.componentId)?.ref).toBe(expected.device); expect(end.portId).toBe(expected.port);
        expect(idx.portOf(idx.component(end.componentId)!, end.portId)?.speedsGbps).toEqual([source.speed]);
      }
      expect(link.cableDefId).toBeNull(); expect(link.label).toContain(source.state); expect(link.label).toContain(source.linkType);
    }
    expect(project.components.every((c) => Object.keys(c.optics).length === 0)).toBe(true);
    expect(project.placements.every((p) => p.rackId && p.uPosition)).toBe(true);
    expect(isOutOfSync(project)).toBe(false);
    expect(runDrc(project).filter((i) => i.severity === 'error')).toEqual([]);
    expect(parseProject(serializeProject(project))).toEqual(project);
  });
  it('can create only the topology with every device in the Unplaced bin', () => {
    const project = buildCutsheetProject(planCutsheet(readCutsheetCsv(sample)), { name: 'Logical only', draftRacks: false });
    expect(project.racks).toEqual([]); expect(project.placements).toHaveLength(49);
    expect(project.placements.every((p) => p.rackId === null && p.uPosition === null)).toBe(true);
    expect(isOutOfSync(project)).toBe(false);
  });
  it('gives repeated imports independent IDs and handles names with colliding slugs', () => {
    const plan = planCutsheet(csv('a.b_p1,a-b_p1,10,,\na.b_p2,a_b_p1,10,,'));
    const a = buildCutsheetProject(plan, { name: 'A', draftRacks: true }), b = buildCutsheetProject(plan, { name: 'B', draftRacks: true });
    expect(a.id).not.toBe(b.id); expect(new Set(a.components.map((c) => c.symbolDefId)).size).toBe(3);
    expect(a.components.every((c) => !b.components.some((other) => other.id === c.id))).toBe(true);
  });
});
