import { describe, expect, it } from 'vitest';
import { requireConnector } from './connectors';
import { connectorAlternatives, defaultLegLabel, deriveSides, type DeriveSidesResult } from './deriveSides';

/** Narrows to the ok branch, failing loudly with the derivation error otherwise. */
function ok(r: DeriveSidesResult): Extract<DeriveSidesResult, { ok: true }> {
  if (!r.ok) throw new Error(r.error);
  return r;
}

function fail(r: DeriveSidesResult): string {
  if (r.ok) throw new Error('expected a derivation error');
  return r.error;
}

describe('deriveSides', () => {
  describe('required results table', () => {
    it.each([
      [8, 'MPO-8', 'LC-duplex', 1, 4, 'trunk', 4],
      [12, 'MPO-12', 'LC-duplex', 1, 6, 'trunk', 6],
      [24, 'MPO-24', 'LC-duplex', 1, 12, 'trunk', 12],
      [16, 'MMC-16', 'MPO-8', 1, 2, 'trunk', 8],
      [24, 'MPO-24', 'MPO-12', 1, 2, 'trunk', 12],
      [8, 'MPO-8', 'MPO-8', 1, 1, 'straight', 4],
      [144, 'MPO-12', 'MPO-12', 12, 12, 'straight', 72],
      [2, 'LC-duplex', 'LC-duplex', 1, 1, 'straight', 1],
    ] as const)('%iF %s → %s: %i / %i legs, %s, %i channels', (fiberCount, a, b, legsA, legsB, kind, channels) => {
      const r = ok(deriveSides(fiberCount, a, b));
      expect(r.sideA.connector).toBe(a);
      expect(r.sideB.connector).toBe(b);
      expect(r.sideA.legs).toHaveLength(legsA);
      expect(r.sideB.legs).toHaveLength(legsB);
      expect(r.kind).toBe(kind);
      expect(r.channels).toBe(channels);
    });

    it('16F MPO-12 → LC-duplex is an error: 16 is not divisible by 12', () => {
      const error = fail(deriveSides(16, 'MPO-12', 'LC-duplex'));
      expect(error).toBe("16 fibers can't be split evenly into MPO-12 legs (12 each). Use MPO-16 or MPO-8.");
      expect(error).toContain('MPO-16');
      expect(error).toContain('MPO-8');
    });
  });

  describe('legs', () => {
    it('numbers legs from 0 and gives each the connector positions as its own array', () => {
      const r = ok(deriveSides(8, 'MPO-8', 'LC-duplex'));
      expect(r.sideA.legs).toEqual([{ index: 0, label: 'A', positions: [1, 2, 3, 4, 9, 10, 11, 12] }]);
      expect(r.sideB.legs.map((l) => l.index)).toEqual([0, 1, 2, 3]);
      expect(r.sideB.legs.map((l) => l.label)).toEqual(['1', '2', '3', '4']);
      for (const leg of r.sideB.legs) expect(leg.positions).toEqual([1, 2]);
      expect(r.sideB.legs[0]!.positions).not.toBe(r.sideB.legs[1]!.positions);
      expect(r.sideA.legs[0]!.positions).not.toBe(requireConnector('MPO-8').positionsUsed);
    });

    it('labels the twelve legs of a 144F MPO-12 trunk A..L on both sides', () => {
      const r = ok(deriveSides(144, 'MPO-12', 'MPO-12'));
      const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
      expect(r.sideA.legs.map((l) => l.label)).toEqual(letters);
      expect(r.sideB.legs.map((l) => l.label)).toEqual(letters);
      expect(r.sideA.legs.every((l) => l.positions.length === 12)).toBe(true);
    });

    it('a single leg is still labelled 1 (small) or A (multi)', () => {
      const r = ok(deriveSides(2, 'LC-duplex', 'LC-duplex'));
      expect(r.sideA.legs[0]!.label).toBe('1');
      expect(ok(deriveSides(16, 'MMC-16', 'MPO-8')).sideA.legs[0]!.label).toBe('A');
      expect(ok(deriveSides(16, 'MMC-16', 'MPO-8')).sideB.legs.map((l) => l.label)).toEqual(['A', 'B']);
    });

    it('carries on past Z with AA, AB, … for very large multi-fiber leg counts', () => {
      const r = ok(deriveSides(288, 'MPO-8', 'MPO-8'));
      expect(r.sideA.legs).toHaveLength(36);
      expect(r.sideA.legs[25]!.label).toBe('Z');
      expect(r.sideA.legs[26]!.label).toBe('AA');
      expect(r.sideA.legs[27]!.label).toBe('AB');
      expect(r.kind).toBe('straight');
      expect(r.channels).toBe(144);
    });

    it('LC-simplex legs carry one position each and are numbered', () => {
      const r = ok(deriveSides(2, 'LC-duplex', 'LC-simplex'));
      expect(r.sideB.legs).toEqual([
        { index: 0, label: '1', positions: [1] },
        { index: 1, label: '2', positions: [1] },
      ]);
      expect(r.kind).toBe('trunk');
    });

    it('omits color unless overridden', () => {
      const r = ok(deriveSides(8, 'MPO-8', 'LC-duplex'));
      expect('color' in r.sideA.legs[0]!).toBe(false);
      expect(r.sideB.legs.some((l) => 'color' in l)).toBe(false);
    });
  });

  describe('overrides', () => {
    it('applies label and colour overrides per leg and keeps defaults elsewhere', () => {
      const r = ok(
        deriveSides(8, 'MPO-8', 'LC-duplex', {
          legLabelsA: ['Trunk'],
          legColorsA: ['#ff0000'],
          legLabelsB: ['', 'two', undefined as unknown as string, 'four'],
          legColorsB: [undefined as unknown as string, '#00ff00'],
        }),
      );
      expect(r.sideA.legs[0]).toEqual({ index: 0, label: 'Trunk', positions: [1, 2, 3, 4, 9, 10, 11, 12], color: '#ff0000' });
      expect(r.sideB.legs.map((l) => l.label)).toEqual(['1', 'two', '3', 'four']);
      expect(r.sideB.legs.map((l) => l.color)).toEqual([undefined, '#00ff00', undefined, undefined]);
    });

    it('ignores overrides beyond the leg count', () => {
      const r = ok(deriveSides(2, 'LC-duplex', 'LC-duplex', { legLabelsA: ['x', 'y', 'z'], legColorsB: ['#1', '#2'] }));
      expect(r.sideA.legs).toHaveLength(1);
      expect(r.sideA.legs[0]!.label).toBe('x');
      expect(r.sideB.legs[0]!.color).toBe('#1');
    });
  });

  describe('errors', () => {
    it('rejects odd, zero, negative and non-integer fiber counts', () => {
      expect(fail(deriveSides(7, 'LC-simplex', 'LC-simplex'))).toBe('Fiber count must be a positive even number, got 7.');
      expect(fail(deriveSides(0, 'LC-duplex', 'LC-duplex'))).toBe('Fiber count must be a positive even number, got 0.');
      expect(fail(deriveSides(-8, 'MPO-8', 'MPO-8'))).toBe('Fiber count must be a positive even number, got -8.');
      expect(fail(deriveSides(8.5, 'MPO-8', 'MPO-8'))).toBe('Fiber count must be a positive even number, got 8.5.');
      expect(fail(deriveSides(Number.NaN, 'MPO-8', 'MPO-8'))).toContain('positive even number');
    });

    it('names an unknown connector on either side', () => {
      expect(fail(deriveSides(8, 'MPO-9', 'LC-duplex'))).toBe('Unknown connector "MPO-9".');
      expect(fail(deriveSides(8, 'MPO-8', 'LC'))).toBe('Unknown connector "LC".');
    });

    it('reports a side B split failure with the same message style', () => {
      expect(fail(deriveSides(8, 'MPO-8', 'MPO-12'))).toBe(
        "8 fibers can't be split evenly into MPO-12 legs (12 each). Use MPO-8.",
      );
    });

    it('reports side A before side B when both fail', () => {
      expect(fail(deriveSides(10, 'MPO-8', 'MPO-12'))).toMatch(/^10 fibers can't be split evenly into MPO-8 legs \(8 each\)\./);
    });

    it('suggests VSFF alternatives first for a VSFF connector', () => {
      expect(fail(deriveSides(32, 'MMC-24', 'LC-duplex'))).toBe(
        "32 fibers can't be split evenly into MMC-24 legs (24 each). Use MMC-16.",
      );
    });

    it('falls back to other families when nothing in the same family fits', () => {
      expect(fail(deriveSides(2, 'MPO-12', 'LC-duplex'))).toBe(
        "2 fibers can't be split evenly into MPO-12 legs (12 each). Use LC-duplex, SN-duplex, CS-duplex or LC-simplex.",
      );
    });
  });

  describe('connectorAlternatives', () => {
    const idsOf = (n: number, id: string): string[] => connectorAlternatives(n, requireConnector(id)).map((c) => c.id);

    it('prefers the same family and form factor, fewest legs first', () => {
      expect(idsOf(16, 'MPO-12')).toEqual(['MPO-16', 'MPO-8']);
      expect(idsOf(48, 'MPO-16')).toEqual(['MPO-24', 'MPO-12', 'MPO-8']);
      expect(idsOf(32, 'MMC-24')).toEqual(['MMC-16']);
    });

    it('widens to the family, then to every connector', () => {
      expect(idsOf(4, 'MPO-12')).toEqual(['LC-duplex', 'SN-duplex', 'CS-duplex', 'LC-simplex']);
      // Same family + form factor wins even when other small connectors would fit too.
      expect(idsOf(6, 'LC-simplex')).toEqual(['LC-duplex']);
      // No VSFF multi connector splits 8, so the hint widens to the MPO family.
      expect(idsOf(8, 'MMC-16')).toEqual(['MPO-8']);
    });

    it('never suggests the connector that failed', () => {
      expect(idsOf(12, 'MPO-8')).not.toContain('MPO-8');
      expect(idsOf(12, 'MPO-8')).toEqual(['MPO-12']);
    });
  });

  describe('defaultLegLabel', () => {
    it('numbers small legs and letters multi-fiber legs', () => {
      expect(defaultLegLabel('small', 0)).toBe('1');
      expect(defaultLegLabel('small', 11)).toBe('12');
      expect(defaultLegLabel('multi', 0)).toBe('A');
      expect(defaultLegLabel('multi', 25)).toBe('Z');
      expect(defaultLegLabel('multi', 26)).toBe('AA');
      expect(defaultLegLabel('multi', 51)).toBe('AZ');
      expect(defaultLegLabel('multi', 52)).toBe('BA');
    });
  });
});
