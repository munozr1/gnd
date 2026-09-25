import { describe, expect, it } from 'vitest';
import {
  connectorById,
  connectorCatalog,
  connectorsForLegacy,
  fibersPerLeg,
  legacyConnectorOf,
  portAcceptsConnector,
  requireConnector,
} from './connectors';

const ids = (defs: { id: string }[]): string[] => defs.map((d) => d.id);

describe('connector catalog', () => {
  it('has the ten seed connectors in table order', () => {
    expect(ids([...connectorCatalog])).toEqual([
      'LC-simplex',
      'LC-duplex',
      'SN-duplex',
      'CS-duplex',
      'MPO-8',
      'MPO-12',
      'MPO-16',
      'MPO-24',
      'MMC-16',
      'MMC-24',
    ]);
  });

  it('keeps positionsUsed consistent with fibersUsed and the body size', () => {
    for (const c of connectorCatalog) {
      expect(c.positionsUsed, c.id).toHaveLength(c.fibersUsed);
      expect(new Set(c.positionsUsed).size, c.id).toBe(c.fibersUsed);
      expect(c.fibersUsed, c.id).toBeLessThanOrEqual(c.positions);
      for (const p of c.positionsUsed) {
        expect(Number.isInteger(p) && p >= 1 && p <= c.positions, `${c.id} position ${p}`).toBe(true);
      }
      expect([...c.positionsUsed].sort((a, b) => a - b), `${c.id} positions ascending`).toEqual(c.positionsUsed);
    }
  });

  it('models MPO-8 as a 12-position body using positions 1-4 and 9-12', () => {
    const mpo8 = requireConnector('MPO-8');
    expect(mpo8.positions).toBe(12);
    expect(mpo8.positionsUsed).toEqual([1, 2, 3, 4, 9, 10, 11, 12]);
    expect(mpo8.fibersUsed).toBe(8);
    expect(requireConnector('MPO-12').positionsUsed).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(requireConnector('LC-simplex').positionsUsed).toEqual([1]);
    expect(requireConnector('MMC-24').positionsUsed).toHaveLength(24);
  });

  it('classifies families and VSFF form factors', () => {
    const small = connectorCatalog.filter((c) => c.family === 'small');
    const multi = connectorCatalog.filter((c) => c.family === 'multi');
    expect(ids(small)).toEqual(['LC-simplex', 'LC-duplex', 'SN-duplex', 'CS-duplex']);
    expect(ids(multi)).toEqual(['MPO-8', 'MPO-12', 'MPO-16', 'MPO-24', 'MMC-16', 'MMC-24']);
    expect(ids(connectorCatalog.filter((c) => c.vsff))).toEqual(['SN-duplex', 'CS-duplex', 'MMC-16', 'MMC-24']);
  });

  it('offers a pinned / unpinned gender choice on MPO and MMC only', () => {
    for (const c of connectorCatalog) {
      if (c.family === 'multi') expect(c.genderOptions, c.id).toEqual(['pinned', 'unpinned']);
      else expect(c.genderOptions, c.id).toBeUndefined();
    }
  });

  it('maps every connector onto the legacy ERC / transceiver vocabulary', () => {
    const legacy = Object.fromEntries(connectorCatalog.map((c) => [c.id, c.legacyConnector]));
    expect(legacy).toEqual({
      'LC-simplex': 'LC',
      'LC-duplex': 'LC',
      'SN-duplex': 'SN',
      'CS-duplex': 'CS',
      'MPO-8': 'MPO-12',
      'MPO-12': 'MPO-12',
      'MPO-16': 'MPO-16',
      'MPO-24': 'MPO-24',
      'MMC-16': 'MMC-16',
      'MMC-24': 'MMC-24',
    });
  });

  it('gives every connector a boot colour', () => {
    for (const c of connectorCatalog) expect(c.color, c.id).toMatch(/^#[0-9a-f]{6}$/i);
    expect(requireConnector('LC-duplex').color).toBe(requireConnector('LC-simplex').color);
    expect(requireConnector('MPO-8').color).toBe(requireConnector('MPO-12').color);
  });
});

describe('lookups', () => {
  it('connectorById returns the row or undefined', () => {
    expect(connectorById('LC-duplex')?.name).toBe('LC duplex');
    expect(connectorById('nope')).toBeUndefined();
    // Ids are exact: no case folding on catalog ids.
    expect(connectorById('lc-duplex')).toBeUndefined();
  });

  it('requireConnector throws naming the id', () => {
    expect(requireConnector('MPO-16').positions).toBe(16);
    expect(() => requireConnector('MPO-32')).toThrow('Unknown connector "MPO-32"');
  });

  it('fibersPerLeg is the connector\'s fibersUsed', () => {
    expect(fibersPerLeg(requireConnector('LC-duplex'))).toBe(2);
    expect(fibersPerLeg(requireConnector('MPO-8'))).toBe(8);
    expect(fibersPerLeg(requireConnector('MPO-24'))).toBe(24);
  });

  it('legacyConnectorOf maps an id to the legacy name', () => {
    expect(legacyConnectorOf('MPO-8')).toBe('MPO-12');
    expect(legacyConnectorOf('LC-simplex')).toBe('LC');
    expect(legacyConnectorOf('MMC-16')).toBe('MMC-16');
    expect(legacyConnectorOf('nope')).toBeUndefined();
  });

  it('connectorsForLegacy is the inverse, full-body connector first', () => {
    expect(ids(connectorsForLegacy('LC'))).toEqual(['LC-duplex', 'LC-simplex']);
    expect(ids(connectorsForLegacy('MPO-12'))).toEqual(['MPO-12', 'MPO-8']);
    expect(ids(connectorsForLegacy('MPO-16'))).toEqual(['MPO-16']);
    expect(ids(connectorsForLegacy('SN'))).toEqual(['SN-duplex']);
    expect(ids(connectorsForLegacy(' lc '))).toEqual(['LC-duplex', 'LC-simplex']);
    expect(connectorsForLegacy('RJ45')).toEqual([]);
    expect(connectorsForLegacy('integrated')).toEqual([]);
  });

  it('connectorsForLegacy returns a fresh array each call', () => {
    const a = connectorsForLegacy('LC');
    a.pop();
    expect(connectorsForLegacy('LC')).toHaveLength(2);
  });
});

describe('portAcceptsConnector', () => {
  const all = ids([...connectorCatalog]);
  const accepted = (port: Parameters<typeof portAcceptsConnector>[0]): string[] =>
    all.filter((id) => portAcceptsConnector(port, id));

  it('a fixed LC port takes LC duplex or simplex only', () => {
    expect(accepted({ type: 'LC' })).toEqual(['LC-simplex', 'LC-duplex']);
  });

  it('a fixed MPO-12 port takes MPO-12 or the MPO-8 variant of the same body', () => {
    expect(accepted({ type: 'MPO-12' })).toEqual(['MPO-8', 'MPO-12']);
  });

  it('a fixed port ignores any optic fields', () => {
    expect(accepted({ type: 'LC', opticConnector: 'MPO-12', opticLanes: 4 })).toEqual(['LC-simplex', 'LC-duplex']);
  });

  it('RJ45 never takes a fiber connector', () => {
    expect(accepted({ type: 'RJ45' })).toEqual([]);
    expect(accepted({ type: 'RJ45', opticConnector: 'LC' })).toEqual([]);
  });

  it('a cage with an LC optic takes LC-duplex only', () => {
    expect(accepted({ type: 'SFP+', opticConnector: 'LC', opticLanes: 1 })).toEqual(['LC-duplex']);
    expect(accepted({ type: 'QSFP28', opticConnector: 'LC', opticLanes: 4 })).toEqual(['LC-duplex']);
  });

  it('a cage with a 4-lane MPO-12 optic takes MPO-12 or MPO-8', () => {
    expect(accepted({ type: 'QSFP28', opticConnector: 'MPO-12', opticLanes: 4 })).toEqual(['MPO-8', 'MPO-12']);
    expect(accepted({ type: 'QSFP-DD', opticConnector: 'MPO-12', opticLanes: 1 })).toEqual(['MPO-8', 'MPO-12']);
  });

  it('a cage whose MPO-12 optic uses more than 4 lanes takes MPO-12 only', () => {
    expect(accepted({ type: 'QSFP-DD', opticConnector: 'MPO-12', opticLanes: 6 })).toEqual(['MPO-12']);
  });

  it('an MPO-12 optic with an unknown lane count is treated as the common 4-lane part', () => {
    expect(accepted({ type: 'QSFP28', opticConnector: 'MPO-12' })).toEqual(['MPO-8', 'MPO-12']);
  });

  it('a cage with an MPO-16 optic takes MPO-16 only', () => {
    expect(accepted({ type: 'QSFP-DD', opticConnector: 'MPO-16', opticLanes: 8 })).toEqual(['MPO-16']);
    expect(accepted({ type: 'OSFP', opticConnector: 'MPO-16', opticLanes: 8 })).toEqual(['MPO-16']);
  });

  it('other optic connectors match by legacy name', () => {
    expect(accepted({ type: 'OSFP', opticConnector: 'MMC-16', opticLanes: 8 })).toEqual(['MMC-16']);
    expect(accepted({ type: 'QSFP-DD', opticConnector: 'MPO-24', opticLanes: 12 })).toEqual(['MPO-24']);
    expect(accepted({ type: 'SFP28', opticConnector: 'SN', opticLanes: 1 })).toEqual(['SN-duplex']);
    expect(accepted({ type: 'SFP28', opticConnector: 'CS', opticLanes: 1 })).toEqual(['CS-duplex']);
  });

  it('an integrated DAC / AOC optic, a copper optic, or an empty cage accepts nothing', () => {
    expect(accepted({ type: 'SFP28', opticConnector: 'integrated', opticLanes: 1 })).toEqual([]);
    expect(accepted({ type: 'SFP', opticConnector: 'RJ45', opticLanes: 1 })).toEqual([]);
    expect(accepted({ type: 'QSFP28' })).toEqual([]);
    expect(accepted({ type: 'QSFP28', opticConnector: '' })).toEqual([]);
  });

  it('normalises the optic connector like the ERC rules do', () => {
    expect(portAcceptsConnector({ type: 'SFP+', opticConnector: ' lc ' }, 'LC-duplex')).toBe(true);
    expect(portAcceptsConnector({ type: 'QSFP28', opticConnector: 'mpo-12', opticLanes: 4 }, 'MPO-8')).toBe(true);
    expect(portAcceptsConnector({ type: 'SFP28', opticConnector: 'Integrated' }, 'LC-duplex')).toBe(false);
  });

  it('an unknown connector id is never accepted', () => {
    expect(portAcceptsConnector({ type: 'LC' }, 'LC-quad')).toBe(false);
    expect(portAcceptsConnector({ type: 'SFP+', opticConnector: 'LC' }, '')).toBe(false);
  });
});
