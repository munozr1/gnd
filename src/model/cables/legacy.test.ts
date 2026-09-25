import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import type { CableDef } from '@/model/types';
import { migrateLegacyCableDef, migrateLegacyCableDefs } from './legacy';
import { isFiberCableDef, resolveCable } from './resolve';

/** A pre-configurable-cables definition: only the legacy fields. */
function legacy(over: Partial<CableDef> = {}): CableDef {
  return {
    id: 'cbl.legacy',
    name: 'Legacy',
    media: 'OM4',
    mediaClass: 'fiber',
    endA: 'LC',
    endB: 'LC',
    color: '#2dd4bf',
    bendRadiusMm: 30,
    diameterMm: 2,
    ...over,
  };
}

/** A built-in cable with its fiber fields stripped, as an old project would hold it. */
function strippedBuiltin(id: string): CableDef {
  const def = builtinCatalog.cables.find((c) => c.id === id);
  if (!def) throw new Error(`no builtin cable ${id}`);
  const { fiberCount, fiberType, sideA, sideB, polarity, strandMap, breakoutLengthM, ...rest } = def;
  void fiberCount, fiberType, sideA, sideB, polarity, strandMap, breakoutLengthM;
  return rest;
}

const fiberFields = (d: CableDef) => ({
  fiberCount: d.fiberCount,
  fiberType: d.fiberType,
  sideA: d.sideA,
  sideB: d.sideB,
  polarity: d.polarity,
});

describe('migrateLegacyCableDef', () => {
  it('LC ↔ LC becomes a 2F LC-duplex cord with polarity A (the A-to-B cord)', () => {
    expect(fiberFields(migrateLegacyCableDef(legacy()))).toEqual({
      fiberCount: 2,
      fiberType: 'OM4',
      sideA: { connector: 'LC-duplex' },
      sideB: { connector: 'LC-duplex' },
      polarity: 'A',
    });
  });

  it('MPO-12 ↔ MPO-12 becomes 12F MPO-12 both sides, polarity B', () => {
    expect(fiberFields(migrateLegacyCableDef(legacy({ endA: 'MPO-12', endB: 'MPO-12', media: 'OS2' })))).toEqual({
      fiberCount: 12,
      fiberType: 'OS2',
      sideA: { connector: 'MPO-12' },
      sideB: { connector: 'MPO-12' },
      polarity: 'B',
    });
  });

  it('MPO-12 → LC with fanout 4 becomes 8F MPO-8 → LC-duplex; fanout 6 becomes 12F MPO-12 → LC-duplex', () => {
    expect(fiberFields(migrateLegacyCableDef(legacy({ endA: 'MPO-12', endB: 'LC', breakout: { fanout: 4 } })))).toEqual({
      fiberCount: 8,
      fiberType: 'OM4',
      sideA: { connector: 'MPO-8' },
      sideB: { connector: 'LC-duplex' },
      polarity: 'B',
    });
    expect(fiberFields(migrateLegacyCableDef(legacy({ endA: 'MPO-12', endB: 'LC', breakout: { fanout: 6 } })))).toMatchObject({
      fiberCount: 12,
      sideA: { connector: 'MPO-12' },
      sideB: { connector: 'LC-duplex' },
    });
  });

  it('MPO-12 → LC without a fanout is one full MPO-12 leg fanned into six LC-duplex', () => {
    expect(fiberFields(migrateLegacyCableDef(legacy({ endA: 'MPO-12', endB: 'LC' })))).toMatchObject({
      fiberCount: 12,
      sideA: { connector: 'MPO-12' },
      sideB: { connector: 'LC-duplex' },
      polarity: 'B',
    });
  });

  it('keeps the trunk on the side it was written: LC → MPO-12 fanout 4 is LC-duplex → MPO-8', () => {
    expect(fiberFields(migrateLegacyCableDef(legacy({ endA: 'LC', endB: 'MPO-12', breakout: { fanout: 4 } })))).toMatchObject({
      fiberCount: 8,
      sideA: { connector: 'LC-duplex' },
      sideB: { connector: 'MPO-8' },
    });
  });

  it('MPO-16 ↔ MPO-16 is 16F MPO-16; MPO-24 → MPO-12 fanout 2 is 24F MPO-24 → MPO-12; MMC-24 is 24F', () => {
    expect(fiberFields(migrateLegacyCableDef(legacy({ endA: 'MPO-16', endB: 'MPO-16' })))).toMatchObject({ fiberCount: 16, sideA: { connector: 'MPO-16' }, sideB: { connector: 'MPO-16' }, polarity: 'B' });
    expect(fiberFields(migrateLegacyCableDef(legacy({ endA: 'MPO-24', endB: 'MPO-12', breakout: { fanout: 2 } })))).toMatchObject({ fiberCount: 24, sideA: { connector: 'MPO-24' }, sideB: { connector: 'MPO-12' } });
    expect(fiberFields(migrateLegacyCableDef(legacy({ endA: 'MMC-24', endB: 'mmc-24' })))).toMatchObject({ fiberCount: 24, sideA: { connector: 'MMC-24' }, sideB: { connector: 'MMC-24' } });
  });

  it('takes the fiber type from the media, OM4 for unknown fiber media, OS2 for SMF', () => {
    expect(migrateLegacyCableDef(legacy({ media: 'om3' })).fiberType).toBe('OM3');
    expect(migrateLegacyCableDef(legacy({ media: 'OM5' })).fiberType).toBe('OM5');
    expect(migrateLegacyCableDef(legacy({ media: 'SMF' })).fiberType).toBe('OS2');
    expect(migrateLegacyCableDef(legacy({ media: 'MMF' })).fiberType).toBe('OM4');
    expect(migrateLegacyCableDef(legacy({ media: 'fiber' })).fiberType).toBe('OM4');
  });

  it('leaves every legacy field exactly as it was, and never sets a strand map or breakout length', () => {
    const before = legacy({ endA: 'MPO-12', endB: 'LC', breakout: { fanout: 4 }, name: 'MPO breakout', diameterMm: 3.5, bendRadiusMm: 40 });
    const after = migrateLegacyCableDef(before);
    const { fiberCount, fiberType, sideA, sideB, polarity, ...legacyPart } = after;
    void fiberCount, fiberType, sideA, sideB, polarity;
    expect(legacyPart).toEqual(before);
    expect(after.strandMap).toBeUndefined();
    expect(after.breakoutLengthM).toBeUndefined();
    expect(before.fiberCount).toBeUndefined();
  });

  it('resolves to the same legacy fields it started from', () => {
    for (const id of ['cbl.om4-duplex', 'cbl.os2-duplex', 'cbl.om4-mpo-trunk', 'cbl.os2-mpo-trunk', 'cbl.mpo-breakout']) {
      const stripped = strippedBuiltin(id);
      const migrated = migrateLegacyCableDef(stripped);
      expect(isFiberCableDef(migrated)).toBe(true);
      const r = resolveCable(migrated);
      if ('error' in r) throw new Error(r.error);
      expect(r.legacy).toEqual({
        media: stripped.media,
        mediaClass: 'fiber',
        endA: stripped.endA,
        endB: stripped.endB,
        color: stripped.color,
        diameterMm: stripped.diameterMm,
        breakout: stripped.breakout,
      });
      // The upgrade lands on the same fiber definition the catalog now ships.
      expect(fiberFields(migrated)).toEqual(fiberFields(builtinCatalog.cables.find((c) => c.id === id)!));
    }
  });

  it('returns copper, DAC, AOC and integrated-ended cables unchanged (same reference)', () => {
    for (const id of ['cbl.cat6a', 'cbl.dac-25g', 'cbl.dac-100g', 'cbl.aoc-100g', 'cbl.aoc-400g']) {
      const def = builtinCatalog.cables.find((c) => c.id === id)!;
      expect(migrateLegacyCableDef(def)).toBe(def);
    }
    const integratedFiber = legacy({ media: 'fiber', endA: 'integrated', endB: 'integrated' });
    expect(migrateLegacyCableDef(integratedFiber)).toBe(integratedFiber);
    const copperLc = legacy({ mediaClass: 'copper', media: 'Cat6A', endA: 'RJ45', endB: 'RJ45' });
    expect(migrateLegacyCableDef(copperLc)).toBe(copperLc);
  });

  it('returns a definition it cannot map onto the connector catalog unchanged', () => {
    const sc = legacy({ endA: 'SC', endB: 'SC' });
    expect(migrateLegacyCableDef(sc)).toBe(sc);
    const rj = legacy({ endA: 'LC', endB: 'RJ45' });
    expect(migrateLegacyCableDef(rj)).toBe(rj);
    // 5 × 2 = 10 fibers fit neither MPO-12 nor MPO-8.
    const odd = legacy({ endA: 'MPO-12', endB: 'LC', breakout: { fanout: 5 } });
    expect(migrateLegacyCableDef(odd)).toBe(odd);
  });

  it('is idempotent: a definition with fiber fields comes back as the same reference', () => {
    const once = migrateLegacyCableDef(legacy({ endA: 'MPO-12', endB: 'LC', breakout: { fanout: 4 } }));
    expect(migrateLegacyCableDef(once)).toBe(once);
    for (const def of builtinCatalog.cables) expect(migrateLegacyCableDef(def)).toBe(def);
  });
});

describe('migrateLegacyCableDefs', () => {
  it('returns the same array when nothing changed', () => {
    expect(migrateLegacyCableDefs(builtinCatalog.cables)).toBe(builtinCatalog.cables);
  });

  it('upgrades only the legacy fiber definitions, keeping the others by reference', () => {
    const dac = builtinCatalog.cables.find((c) => c.id === 'cbl.dac-25g')!;
    const old = legacy({ id: 'cbl.custom-1', endA: 'MPO-12', endB: 'MPO-12' });
    const out = migrateLegacyCableDefs([dac, old]);
    expect(out).not.toBe([dac, old]);
    expect(out[0]).toBe(dac);
    expect(out[1]).not.toBe(old);
    expect(out[1]!.fiberCount).toBe(12);
    expect(out[1]!.id).toBe('cbl.custom-1');
  });
});
