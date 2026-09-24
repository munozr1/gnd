import { describe, expect, it } from 'vitest';
import { formatPortRange, parsePortRange, tryParsePortRange } from './portRange';

describe('parsePortRange', () => {
  it("expands 'eth1/49-eth1/56' to 8 ids", () => {
    const ids = parsePortRange('eth1/49-eth1/56');
    expect(ids).toHaveLength(8);
    expect(ids[0]).toBe('eth1/49');
    expect(ids[7]).toBe('eth1/56');
  });

  it('accepts the numeric shorthand and mixed lists', () => {
    expect(parsePortRange('eth1/49-56')).toEqual(parsePortRange('eth1/49-eth1/56'));
    expect(parsePortRange('eth1/1, eth1/3 eth1/5-6')).toEqual(['eth1/1', 'eth1/3', 'eth1/5', 'eth1/6']);
    expect(parsePortRange('')).toEqual([]);
  });

  it('keeps zero padding and supports descending ranges', () => {
    expect(parsePortRange('ge-0/0/01-03')).toEqual(['ge-0/0/01', 'ge-0/0/02', 'ge-0/0/03']);
    expect(parsePortRange('eth3-eth1')).toEqual(['eth3', 'eth2', 'eth1']);
  });

  it('passes known ids containing a dash through untouched', () => {
    expect(parsePortRange('Ethernet1-1', new Set(['Ethernet1-1']))).toEqual(['Ethernet1-1']);
  });

  it('rejects malformed specs with a readable message', () => {
    expect(() => parsePortRange('eth1/49-eth2/56')).toThrow(/different port prefixes/);
    expect(() => parsePortRange('eth1/a-b')).toThrow(/port number/);
    expect(() => parsePortRange('eth1/1-9999')).toThrow(/longer than/);
    expect(tryParsePortRange('eth1/-')).toMatchObject({ ids: null });
    expect(tryParsePortRange('eth1/1-2')).toMatchObject({ ids: ['eth1/1', 'eth1/2'] });
  });
});

describe('formatPortRange', () => {
  it('collapses consecutive runs and round-trips', () => {
    const ids = parsePortRange('eth1/49-eth1/56');
    expect(formatPortRange(ids)).toBe('eth1/49-eth1/56');
    expect(formatPortRange(['eth1/1', 'eth1/2', 'eth1/4', 'mgmt0'])).toBe('eth1/1-eth1/2, eth1/4, mgmt0');
    expect(parsePortRange(formatPortRange(['eth1/1', 'eth1/2', 'eth1/4', 'mgmt0']))).toEqual(['eth1/1', 'eth1/2', 'eth1/4', 'mgmt0']);
    expect(formatPortRange([])).toBe('');
  });
});
