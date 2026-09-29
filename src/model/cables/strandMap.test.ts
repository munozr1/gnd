import { describe, expect, it } from 'vitest';
import type { CablePolarity, StrandLink } from '@/model/types';
import { deriveSides, type DeriveSidesResult } from './deriveSides';
import { deriveStrandMap, isBijection, strandMapFiberCount } from './strandMap';

function sides(fiberCount: number, a: string, b: string): Extract<DeriveSidesResult, { ok: true }> {
  const r = deriveSides(fiberCount, a, b);
  if (!r.ok) throw new Error(r.error);
  return r;
}

function mapOf(fiberCount: number, a: string, b: string, polarity: CablePolarity): StrandLink[] {
  const s = sides(fiberCount, a, b);
  return deriveStrandMap(fiberCount, s.sideA, s.sideB, polarity);
}

const link = (aLeg: number, aPos: number, bLeg: number, bPos: number): StrandLink => ({
  a: { leg: aLeg, pos: aPos },
  b: { leg: bLeg, pos: bPos },
});

/** The B slot fiber at A (leg, pos) lands on. */
function landing(map: StrandLink[], aLeg: number, aPos: number): [leg: number, pos: number] {
  const l = map.find((x) => x.a.leg === aLeg && x.a.pos === aPos);
  if (!l) throw new Error(`no fiber at A leg ${aLeg} pos ${aPos}`);
  return [l.b.leg, l.b.pos];
}

const POLARITIES: CablePolarity[] = ['A', 'B', 'C'];

const TABLE = [
  [8, 'MPO-8', 'LC-duplex'],
  [12, 'MPO-12', 'LC-duplex'],
  [24, 'MPO-24', 'LC-duplex'],
  [16, 'MMC-16', 'MPO-8'],
  [24, 'MPO-24', 'MPO-12'],
  [8, 'MPO-8', 'MPO-8'],
  [144, 'MPO-12', 'MPO-12'],
  [2, 'LC-duplex', 'LC-duplex'],
] as const;

describe('deriveStrandMap', () => {
  describe('every table row, every polarity', () => {
    it.each(TABLE)('%iF %s → %s is a bijection with one link per fiber', (fiberCount, a, b) => {
      const s = sides(fiberCount, a, b);
      for (const polarity of POLARITIES) {
        const map = deriveStrandMap(fiberCount, s.sideA, s.sideB, polarity);
        expect(map).toHaveLength(fiberCount);
        expect(strandMapFiberCount(map)).toBe(fiberCount);
        expect(isBijection(map, s.sideA, s.sideB)).toEqual({ ok: true, problems: [] });
      }
    });

    it.each(TABLE)('%iF %s → %s numbers fibers along side A: map[n-1].a is A\'s nth slot', (fiberCount, a, b) => {
      const s = sides(fiberCount, a, b);
      const seqA = s.sideA.legs.flatMap((leg) => leg.positions.map((pos) => ({ leg: leg.index, pos })));
      for (const polarity of POLARITIES) {
        expect(deriveStrandMap(fiberCount, s.sideA, s.sideB, polarity).map((l) => l.a)).toEqual(seqA);
      }
    });
  });

  describe('8F MPO-8 → 4×LC-duplex (multi → duplex: outer-in channels)', () => {
    it('polarity A: channel k = MPO positions (k, 13-k) lands on LC leg k positions 1 and 2', () => {
      expect(mapOf(8, 'MPO-8', 'LC-duplex', 'A')).toEqual([
        link(0, 1, 0, 1),
        link(0, 2, 1, 1),
        link(0, 3, 2, 1),
        link(0, 4, 3, 1),
        link(0, 9, 3, 2),
        link(0, 10, 2, 2),
        link(0, 11, 1, 2),
        link(0, 12, 0, 2),
      ]);
    });

    it('polarity B: the MPO leg is reversed (p ↔ 13-p), so every LC leg sees its channel Tx/Rx swapped', () => {
      const map = mapOf(8, 'MPO-8', 'LC-duplex', 'B');
      expect(map).toEqual([
        link(0, 1, 0, 2),
        link(0, 2, 1, 2),
        link(0, 3, 2, 2),
        link(0, 4, 3, 2),
        link(0, 9, 3, 1),
        link(0, 10, 2, 1),
        link(0, 11, 1, 1),
        link(0, 12, 0, 1),
      ]);
      expect(landing(map, 0, 1)).toEqual([0, 2]);
      expect(landing(map, 0, 12)).toEqual([0, 1]);
      // Channel k = (k, 13-k) still stays together on LC leg k.
      for (let k = 1; k <= 4; k++) {
        expect(landing(map, 0, k)[0]).toBe(k - 1);
        expect(landing(map, 0, 13 - k)[0]).toBe(k - 1);
      }
    });

    it('polarity C: MPO pairs flipped (1↔2, 3↔4, 9↔10, 11↔12), i.e. LC legs 1↔2 and 3↔4 trade channels', () => {
      const map = mapOf(8, 'MPO-8', 'LC-duplex', 'C');
      expect(landing(map, 0, 1)).toEqual([1, 1]);
      expect(landing(map, 0, 2)).toEqual([0, 1]);
      expect(landing(map, 0, 12)).toEqual([1, 2]);
      expect(landing(map, 0, 11)).toEqual([0, 2]);
      expect(landing(map, 0, 3)).toEqual([3, 1]);
      expect(landing(map, 0, 4)).toEqual([2, 1]);
      expect(landing(map, 0, 9)).toEqual([2, 2]);
      expect(landing(map, 0, 10)).toEqual([3, 2]);
    });

    it('the duplex legs are never permuted themselves: polarity lives on the MPO side', () => {
      // Under every polarity each LC leg carries exactly one outer-in channel (k, 13-k).
      for (const polarity of POLARITIES) {
        const map = mapOf(8, 'MPO-8', 'LC-duplex', polarity);
        for (let leg = 0; leg < 4; leg++) {
          const positions = map.filter((l) => l.b.leg === leg).map((l) => l.a.pos).sort((x, y) => x - y);
          expect(positions[0]! + positions[1]!).toBe(13);
        }
      }
    });
  });

  describe('12F MPO-12 → 6×LC-duplex', () => {
    it('pairs (1,12), (2,11), …, (6,7) onto legs 1..6', () => {
      const map = mapOf(12, 'MPO-12', 'LC-duplex', 'A');
      for (let k = 1; k <= 6; k++) {
        expect(landing(map, 0, k)).toEqual([k - 1, 1]);
        expect(landing(map, 0, 13 - k)).toEqual([k - 1, 2]);
      }
    });
  });

  describe('duplex → multi (small side on A) mirrors multi → duplex', () => {
    it('8F LC-duplex → MPO-8 polarity B is the MPO-8 → LC-duplex map with a and b swapped', () => {
      const forward = mapOf(8, 'MPO-8', 'LC-duplex', 'B');
      const reverse = mapOf(8, 'LC-duplex', 'MPO-8', 'B');
      const key = (l: StrandLink): string => `${l.a.leg}:${l.a.pos}>${l.b.leg}:${l.b.pos}`;
      const mirrored = forward.map((l) => ({ a: l.b, b: l.a })).map(key).sort();
      expect(reverse.map(key).sort()).toEqual(mirrored);
      // LC leg 1 Tx (pos 1) goes to MPO position 12 under polarity B.
      expect(landing(reverse, 0, 1)).toEqual([0, 12]);
      expect(landing(reverse, 0, 2)).toEqual([0, 1]);
    });
  });

  describe('simplex legs', () => {
    it('8F MPO-8 → 8×LC-simplex: channel k lands on simplex legs 2k-1 (Tx) and 2k (Rx)', () => {
      const map = mapOf(8, 'MPO-8', 'LC-simplex', 'A');
      expect(landing(map, 0, 1)).toEqual([0, 1]);
      expect(landing(map, 0, 12)).toEqual([1, 1]);
      expect(landing(map, 0, 2)).toEqual([2, 1]);
      expect(landing(map, 0, 11)).toEqual([3, 1]);
      expect(landing(map, 0, 4)).toEqual([6, 1]);
      expect(landing(map, 0, 9)).toEqual([7, 1]);
    });
  });

  describe('duplex-to-duplex cords are always A-to-B', () => {
    it.each(POLARITIES)('2F LC-duplex ↔ LC-duplex polarity %s is (1↔2), (2↔1)', (polarity) => {
      expect(mapOf(2, 'LC-duplex', 'LC-duplex', polarity)).toEqual([link(0, 1, 0, 2), link(0, 2, 0, 1)]);
    });

    it('2F SN-duplex ↔ CS-duplex crosses over too', () => {
      expect(mapOf(2, 'SN-duplex', 'CS-duplex', 'A')).toEqual([link(0, 1, 0, 2), link(0, 2, 0, 1)]);
    });

    it('2F LC-simplex ↔ LC-simplex swaps the two legs of the channel', () => {
      expect(mapOf(2, 'LC-simplex', 'LC-simplex', 'A')).toEqual([link(0, 1, 1, 1), link(1, 1, 0, 1)]);
    });
  });

  describe('multi ↔ multi', () => {
    it('polarity A is straight: 12F MPO-12 ↔ MPO-12 is p ↔ p', () => {
      const map = mapOf(12, 'MPO-12', 'MPO-12', 'A');
      for (let p = 1; p <= 12; p++) expect(landing(map, 0, p)).toEqual([0, p]);
    });

    it('polarity B reverses within the leg: 12F MPO-12 ↔ MPO-12 is p ↔ 13-p', () => {
      const map = mapOf(12, 'MPO-12', 'MPO-12', 'B');
      for (let p = 1; p <= 12; p++) expect(landing(map, 0, p)).toEqual([0, 13 - p]);
    });

    it('polarity C flips pairs: 12F MPO-12 ↔ MPO-12 is 2n-1 ↔ 2n', () => {
      const map = mapOf(12, 'MPO-12', 'MPO-12', 'C');
      for (let n = 1; n <= 6; n++) {
        expect(landing(map, 0, 2 * n - 1)).toEqual([0, 2 * n]);
        expect(landing(map, 0, 2 * n)).toEqual([0, 2 * n - 1]);
      }
    });

    it('8F MPO-8 ↔ MPO-8: B reverses over the 12-position body (1↔12, 4↔9) and C flips 1↔2, 9↔10', () => {
      const b = mapOf(8, 'MPO-8', 'MPO-8', 'B');
      expect(landing(b, 0, 1)).toEqual([0, 12]);
      expect(landing(b, 0, 4)).toEqual([0, 9]);
      expect(landing(b, 0, 9)).toEqual([0, 4]);
      const c = mapOf(8, 'MPO-8', 'MPO-8', 'C');
      expect(landing(c, 0, 1)).toEqual([0, 2]);
      expect(landing(c, 0, 9)).toEqual([0, 10]);
      expect(landing(c, 0, 12)).toEqual([0, 11]);
    });

    it('144F 12×MPO-12 ↔ 12×MPO-12 polarity B: leg n ↔ leg n with p ↔ 13-p', () => {
      const map = mapOf(144, 'MPO-12', 'MPO-12', 'B');
      expect(map).toHaveLength(144);
      for (const l of map) {
        expect(l.b.leg).toBe(l.a.leg);
        expect(l.b.pos).toBe(13 - l.a.pos);
      }
    });

    it('144F polarity A: leg n ↔ leg n with p ↔ p', () => {
      for (const l of mapOf(144, 'MPO-12', 'MPO-12', 'A')) expect(l.b).toEqual(l.a);
    });

    it('24F MPO-24 → 2×MPO-12 fills the legs sequentially: 1-12 to leg A, 13-24 to leg B', () => {
      const a = mapOf(24, 'MPO-24', 'MPO-12', 'A');
      for (let p = 1; p <= 12; p++) {
        expect(landing(a, 0, p)).toEqual([0, p]);
        expect(landing(a, 0, 12 + p)).toEqual([1, p]);
      }
      const b = mapOf(24, 'MPO-24', 'MPO-12', 'B');
      for (let p = 1; p <= 12; p++) {
        expect(landing(b, 0, p)).toEqual([0, 13 - p]);
        expect(landing(b, 0, 12 + p)).toEqual([1, 13 - p]);
      }
    });

    it('16F MMC-16 → 2×MPO-8 fills each MPO-8 leg\'s used positions 1-4, 9-12 in order', () => {
      const a = mapOf(16, 'MMC-16', 'MPO-8', 'A');
      const used = [1, 2, 3, 4, 9, 10, 11, 12];
      used.forEach((pos, i) => {
        expect(landing(a, 0, i + 1)).toEqual([0, pos]);
        expect(landing(a, 0, i + 9)).toEqual([1, pos]);
      });
      const b = mapOf(16, 'MMC-16', 'MPO-8', 'B');
      expect(landing(b, 0, 1)).toEqual([0, 12]);
      expect(landing(b, 0, 8)).toEqual([0, 1]);
      expect(landing(b, 0, 9)).toEqual([1, 12]);
    });
  });

  it('returns fresh slot objects, not the sides\' arrays', () => {
    const s = sides(8, 'MPO-8', 'LC-duplex');
    const map = deriveStrandMap(8, s.sideA, s.sideB, 'B');
    map[0]!.a.pos = 99;
    expect(s.sideA.legs[0]!.positions).toEqual([1, 2, 3, 4, 9, 10, 11, 12]);
    expect(deriveStrandMap(8, s.sideA, s.sideB, 'B')[0]!.a.pos).toBe(1);
  });

  it('throws when a side does not carry fiberCount fibers', () => {
    const s = sides(8, 'MPO-8', 'LC-duplex');
    expect(() => deriveStrandMap(12, s.sideA, s.sideB, 'A')).toThrow(/12 fibers.*8 on A and 8 on B/);
  });
});

describe('isBijection', () => {
  const s = sides(8, 'MPO-8', 'LC-duplex');
  const good = deriveStrandMap(8, s.sideA, s.sideB, 'B');

  it('accepts the derived map', () => {
    expect(isBijection(good, s.sideA, s.sideB)).toEqual({ ok: true, problems: [] });
  });

  it('a custom map missing a fiber names the unwired (leg, pos) on both sides', () => {
    const missing = good.filter((l) => !(l.a.pos === 12));
    const r = isBijection(missing, s.sideA, s.sideB);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['Side A leg A position 12 is not wired', 'Side B leg 1 position 1 is not wired']);
  });

  it('a slot wired twice is reported with its count', () => {
    const doubled = [...good, link(0, 1, 0, 2)];
    const r = isBijection(doubled, s.sideA, s.sideB);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['Side A leg A position 1 is wired 2 times', 'Side B leg 1 position 2 is wired 2 times']);
  });

  it('a link onto a position the leg does not carry, or a leg that does not exist, is named', () => {
    const bad = [...good.slice(1), link(0, 5, 4, 1)];
    const r = isBijection(bad, s.sideA, s.sideB);
    expect(r.ok).toBe(false);
    expect(r.problems).toContain('Side A leg A has no position 5');
    expect(r.problems).toContain('Side B has no leg 5 (wired to position 1)');
    expect(r.problems).toContain('Side A leg A position 1 is not wired');
    expect(r.problems).toContain('Side B leg 1 position 2 is not wired');
  });

  it('an empty map lists every slot', () => {
    const r = isBijection([], s.sideA, s.sideB);
    expect(r.ok).toBe(false);
    expect(r.problems).toHaveLength(16);
  });
});
