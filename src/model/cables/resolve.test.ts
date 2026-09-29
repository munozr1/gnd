import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import type { CableDef } from '@/model/types';
import { deriveSides } from './deriveSides';
import {
  cableDisplayName,
  cableSummary,
  DEFAULT_BREAKOUT_LENGTH_M,
  defaultJacketColor,
  defaultPolarity,
  diameterForFiberCount,
  fiberTypeFromMedia,
  isFiberCableDef,
  legacyFieldsFor,
  resolveCable,
  validateCableDef,
  type CableSpec,
  type ResolvedCable,
} from './resolve';
import { deriveStrandMap } from './strandMap';

function fiberDef(over: Partial<CableDef> & Pick<CableDef, 'fiberCount' | 'sideA' | 'sideB'>): CableDef {
  return {
    id: 'cbl.test',
    name: 'test',
    media: 'OM4',
    mediaClass: 'fiber',
    endA: 'MPO-12',
    endB: 'LC',
    color: '#2dd4bf',
    bendRadiusMm: 40,
    diameterMm: 3,
    fiberType: 'OM4',
    ...over,
  };
}

function ok(r: ResolvedCable | { error: string }): ResolvedCable {
  if ('error' in r) throw new Error(r.error);
  return r;
}

function spec(fiberCount: number, fiberType: CableSpec['fiberType'], a: string, b: string): CableSpec {
  const s = deriveSides(fiberCount, a, b);
  if (!s.ok) throw new Error(s.error);
  return { fiberCount, fiberType, sideA: s.sideA, sideB: s.sideB, kind: s.kind };
}

const builtin = (id: string): CableDef => {
  const def = builtinCatalog.cables.find((c) => c.id === id);
  if (!def) throw new Error(`no builtin cable ${id}`);
  return def;
};

describe('resolveCable', () => {
  it('resolves the built-in MPO breakout as an 8F OM4 MPO-8 → 4×LC-duplex trunk', () => {
    const r = ok(resolveCable(builtin('cbl.mpo-breakout')));
    expect(r.fiberCount).toBe(8);
    expect(r.fiberType).toBe('OM4');
    expect(r.kind).toBe('trunk');
    expect(r.channels).toBe(4);
    expect(r.sideA.legs).toHaveLength(1);
    expect(r.sideB.legs).toHaveLength(4);
    expect(r.polarity).toBe('B');
    expect(r.strandMapCustom).toBe(false);
    expect(r.strandMap).toEqual(deriveStrandMap(8, r.sideA, r.sideB, 'B'));
    expect(r.breakoutLengthM).toBe(DEFAULT_BREAKOUT_LENGTH_M);
    expect(r.displayName).toBe('8F OM4 MPO-8 → 4×LC-duplex');
    expect(r.summary).toBe('8F OM4 · Trunk (breakout) · MPO-8 → 4×LC-duplex · 4 channels');
    expect(r.legacy).toEqual({
      media: 'OM4',
      mediaClass: 'fiber',
      endA: 'MPO-12',
      endB: 'LC',
      color: '#2dd4bf',
      diameterMm: 3.5,
      breakout: { fanout: 4 },
    });
  });

  it('keeps the catalog JSON and the derivation in lock-step: legacy fields of every built-in fiber cable regenerate identically', () => {
    const fiber = builtinCatalog.cables.filter(isFiberCableDef);
    expect(fiber.length).toBeGreaterThanOrEqual(12);
    for (const def of fiber) {
      const r = resolveCable(def);
      expect('error' in r ? `${def.id}: ${r.error}` : def.id).toBe(def.id);
      const stored = { media: def.media, mediaClass: def.mediaClass, endA: def.endA, endB: def.endB, color: def.color, diameterMm: def.diameterMm, breakout: def.breakout };
      expect({ id: def.id, ...legacyFieldsFor(ok(r)) }).toEqual({ id: def.id, ...stored });
    }
  });

  it('names the seed rows from the task table', () => {
    const names = Object.fromEntries(
      builtinCatalog.cables.filter(isFiberCableDef).map((d) => [d.id, ok(resolveCable(d)).displayName] as const),
    );
    expect(names).toMatchObject({
      'cbl.om4-duplex': '2F OM4 LC-duplex ↔ LC-duplex',
      'cbl.os2-duplex': '2F OS2 LC-duplex ↔ LC-duplex',
      'cbl.om4-mpo-trunk': '12F OM4 MPO-12 ↔ MPO-12',
      'cbl.os2-mpo-trunk': '12F OS2 MPO-12 ↔ MPO-12',
      'cbl.mpo-breakout': '8F OM4 MPO-8 → 4×LC-duplex',
      'cbl.om4-8f-mpo8-4lc': '8F OM4 MPO-8 → 4×LC-duplex',
      'cbl.om4-12f-mpo12-6lc': '12F OM4 MPO-12 → 6×LC-duplex',
      'cbl.om4-24f-mpo24-12lc': '24F OM4 MPO-24 → 12×LC-duplex',
      'cbl.om4-16f-mmc16-2mpo8': '16F OM4 MMC-16 → 2×MPO-8',
      'cbl.os2-24f-mpo24-2mpo12': '24F OS2 MPO-24 → 2×MPO-12',
      'cbl.om4-8f-mpo8-mpo8': '8F OM4 MPO-8 ↔ MPO-8',
      'cbl.os2-144f-12mpo12': '144F OS2 12×MPO-12 ↔ 12×MPO-12',
    });
    // The new seed rows are named by the derivation itself.
    for (const id of Object.keys(names).filter((k) => /^cbl\.(om4|os2)-\d+f-/.test(k))) {
      expect(builtin(id).name).toBe(names[id]);
    }
  });

  it('every built-in fiber cable has a bijective strand map', () => {
    for (const def of builtinCatalog.cables.filter(isFiberCableDef)) {
      const r = ok(resolveCable(def));
      expect(r.strandMap).toHaveLength(r.fiberCount);
      expect(validateCableDef(def)).toEqual([]);
    }
  });

  it('is memoised by definition identity', () => {
    const def = builtin('cbl.om4-duplex');
    expect(resolveCable(def)).toBe(resolveCable(def));
    expect(resolveCable({ ...def })).not.toBe(resolveCable(def));
    expect(resolveCable({ ...def })).toEqual(resolveCable(def));
  });

  it('errors for a definition without fiber fields, an unknown connector or a bad split', () => {
    expect(resolveCable(builtin('cbl.cat6a'))).toEqual({ error: '"Cat6A patch" has no fiber definition (fiberCount, sideA and sideB are required).' });
    expect(resolveCable(builtin('cbl.dac-25g'))).toMatchObject({ error: expect.stringContaining('no fiber definition') });
    expect(resolveCable(fiberDef({ fiberCount: 8, sideA: { connector: 'MPO-9' }, sideB: { connector: 'LC-duplex' } }))).toEqual({ error: 'Unknown connector "MPO-9".' });
    expect(resolveCable(fiberDef({ fiberCount: 16, sideA: { connector: 'MPO-12' }, sideB: { connector: 'LC-duplex' } }))).toEqual({
      error: "16 fibers can't be split evenly into MPO-12 legs (12 each). Use MPO-16 or MPO-8.",
    });
  });

  it('falls back to the media for the fiber type and to the sides for the polarity', () => {
    const om4 = ok(resolveCable(fiberDef({ fiberCount: 2, fiberType: undefined, media: 'om3', sideA: { connector: 'LC-duplex' }, sideB: { connector: 'LC-duplex' } })));
    expect(om4.fiberType).toBe('OM3');
    expect(om4.polarity).toBe('A');
    const unknown = ok(resolveCable(fiberDef({ fiberCount: 12, fiberType: undefined, media: 'fiber', sideA: { connector: 'MPO-12' }, sideB: { connector: 'MPO-12' } })));
    expect(unknown.fiberType).toBe('OM4');
    expect(unknown.polarity).toBe('B');
    expect(ok(resolveCable(fiberDef({ fiberCount: 12, polarity: 'C', sideA: { connector: 'MPO-12' }, sideB: { connector: 'MPO-12' } }))).polarity).toBe('C');
  });

  it('passes a custom strand map through untouched and flags it as custom', () => {
    const custom = [{ a: { leg: 0, pos: 1 }, b: { leg: 0, pos: 1 } }];
    const r = ok(resolveCable(fiberDef({ fiberCount: 2, strandMap: custom, sideA: { connector: 'LC-duplex' }, sideB: { connector: 'LC-duplex' } })));
    expect(r.strandMap).toBe(custom);
    expect(r.strandMapCustom).toBe(true);
  });

  it('applies leg label and colour overrides from the stored sides', () => {
    const r = ok(
      resolveCable(
        fiberDef({
          fiberCount: 8,
          sideA: { connector: 'MPO-8', legLabels: ['Trunk'] },
          sideB: { connector: 'LC-duplex', legLabels: ['', 'two'], legColors: ['#111'] },
        }),
      ),
    );
    expect(r.sideA.legs[0]!.label).toBe('Trunk');
    expect(r.sideB.legs.map((l) => l.label)).toEqual(['1', 'two', '3', '4']);
    expect(r.sideB.legs[0]!.color).toBe('#111');
  });

  it('defaults the breakout length to 0.5 m on a trunk and 0 on a straight cable, honouring an explicit value', () => {
    expect(ok(resolveCable(fiberDef({ fiberCount: 8, sideA: { connector: 'MPO-8' }, sideB: { connector: 'LC-duplex' } }))).breakoutLengthM).toBe(0.5);
    expect(ok(resolveCable(fiberDef({ fiberCount: 8, sideA: { connector: 'MPO-8' }, sideB: { connector: 'MPO-8' } }))).breakoutLengthM).toBe(0);
    expect(ok(resolveCable(fiberDef({ fiberCount: 8, breakoutLengthM: 1.2, sideA: { connector: 'MPO-8' }, sideB: { connector: 'LC-duplex' } }))).breakoutLengthM).toBe(1.2);
  });

  it('fills colour and diameter from the fiber type / count when the definition leaves them empty', () => {
    const r = ok(resolveCable(fiberDef({ fiberCount: 24, fiberType: 'OS2', color: '', diameterMm: 0, sideA: { connector: 'MPO-24' }, sideB: { connector: 'LC-duplex' } })));
    expect(r.color).toBe('#facc15');
    expect(r.diameterMm).toBe(5);
    expect(r.legacy.color).toBe('#facc15');
    expect(r.legacy.diameterMm).toBe(5);
    expect(r.legacy.breakout).toEqual({ fanout: 12 });
  });
});

describe('isFiberCableDef', () => {
  it('needs fiberCount and both sides', () => {
    expect(isFiberCableDef(builtin('cbl.om4-duplex'))).toBe(true);
    expect(isFiberCableDef(builtin('cbl.cat6a'))).toBe(false);
    expect(isFiberCableDef({ ...builtin('cbl.om4-duplex'), sideB: undefined })).toBe(false);
    expect(isFiberCableDef({ ...builtin('cbl.om4-duplex'), fiberCount: undefined })).toBe(false);
  });
});

describe('naming', () => {
  it('cableDisplayName: trunk with →, straight with ↔, N× for several legs', () => {
    expect(cableDisplayName(spec(8, 'OM4', 'MPO-8', 'LC-duplex'))).toBe('8F OM4 MPO-8 → 4×LC-duplex');
    expect(cableDisplayName(spec(12, 'OM4', 'MPO-12', 'MPO-12'))).toBe('12F OM4 MPO-12 ↔ MPO-12');
    expect(cableDisplayName(spec(144, 'OS2', 'MPO-12', 'MPO-12'))).toBe('144F OS2 12×MPO-12 ↔ 12×MPO-12');
    expect(cableDisplayName(spec(16, 'OM5', 'MMC-16', 'MPO-8'))).toBe('16F OM5 MMC-16 → 2×MPO-8');
  });

  it('cableSummary: kind and channel count, singular for one channel', () => {
    expect(cableSummary(spec(8, 'OM4', 'MPO-8', 'LC-duplex'))).toBe('8F OM4 · Trunk (breakout) · MPO-8 → 4×LC-duplex · 4 channels');
    expect(cableSummary(spec(12, 'OM4', 'MPO-12', 'MPO-12'))).toBe('12F OM4 · Straight · MPO-12 ↔ MPO-12 · 6 channels');
    expect(cableSummary(spec(2, 'OS2', 'LC-duplex', 'LC-duplex'))).toBe('2F OS2 · Straight · LC-duplex ↔ LC-duplex · 1 channel');
  });
});

describe('lookups', () => {
  it('diameterForFiberCount: the stock table', () => {
    const table: [number, number][] = [[2, 2], [8, 3], [12, 3.5], [16, 4], [24, 5], [32, 6], [48, 7.5], [72, 9], [96, 10.5], [144, 12]];
    for (const [n, mm] of table) expect(diameterForFiberCount(n)).toBe(mm);
  });

  it('diameterForFiberCount: interpolates between stock sizes rounded up to 0.5 mm, extrapolates beyond', () => {
    expect(diameterForFiberCount(4)).toBe(2.5);
    expect(diameterForFiberCount(36)).toBe(6.5);
    expect(diameterForFiberCount(288)).toBe(16.5);
    expect(diameterForFiberCount(1)).toBe(2);
    expect(diameterForFiberCount(0)).toBe(2);
    expect(diameterForFiberCount(Number.NaN)).toBe(2);
  });

  it('defaultJacketColor: OS2 yellow, OM3 / OM4 aqua, OM5 lime', () => {
    expect(defaultJacketColor('OS2')).toBe('#facc15');
    expect(defaultJacketColor('OM3')).toBe('#2dd4bf');
    expect(defaultJacketColor('OM4')).toBe('#2dd4bf');
    expect(defaultJacketColor('OM5')).toBe('#a3e635');
  });

  it('fiberTypeFromMedia', () => {
    expect(fiberTypeFromMedia('OM4')).toBe('OM4');
    expect(fiberTypeFromMedia(' os2 ')).toBe('OS2');
    expect(fiberTypeFromMedia('OM5')).toBe('OM5');
    expect(fiberTypeFromMedia('SMF')).toBe('OS2');
    expect(fiberTypeFromMedia('OS1')).toBe('OS2');
    expect(fiberTypeFromMedia('MMF')).toBe('OM4');
    expect(fiberTypeFromMedia('OM2')).toBe('OM4');
    expect(fiberTypeFromMedia('DAC')).toBeUndefined();
    expect(fiberTypeFromMedia('Cat6A')).toBeUndefined();
    expect(fiberTypeFromMedia(undefined)).toBeUndefined();
  });

  it('defaultPolarity: B with any multi-fiber connector, else A', () => {
    expect(defaultPolarity('LC-duplex', 'LC-duplex')).toBe('A');
    expect(defaultPolarity('MPO-8', 'LC-duplex')).toBe('B');
    expect(defaultPolarity('LC-duplex', 'MMC-16')).toBe('B');
    expect(defaultPolarity('MPO-12', 'MPO-12')).toBe('B');
  });
});

describe('legacyFieldsFor', () => {
  it('maps connectors to legacy names and a trunk to breakout.fanout = the larger leg count', () => {
    expect(legacyFieldsFor({ ...spec(8, 'OM4', 'MPO-8', 'LC-duplex'), color: '#2dd4bf', diameterMm: 3 })).toEqual({
      media: 'OM4',
      mediaClass: 'fiber',
      endA: 'MPO-12',
      endB: 'LC',
      color: '#2dd4bf',
      diameterMm: 3,
      breakout: { fanout: 4 },
    });
    expect(legacyFieldsFor({ ...spec(16, 'OM4', 'MMC-16', 'MPO-8'), color: '#2dd4bf', diameterMm: 4 })).toMatchObject({ endA: 'MMC-16', endB: 'MPO-12', breakout: { fanout: 2 } });
  });

  it('leaves breakout undefined on a straight cable, even a multi-leg one', () => {
    expect(legacyFieldsFor({ ...spec(144, 'OS2', 'MPO-12', 'MPO-12'), color: '#facc15', diameterMm: 12 })).toEqual({
      media: 'OS2',
      mediaClass: 'fiber',
      endA: 'MPO-12',
      endB: 'MPO-12',
      color: '#facc15',
      diameterMm: 12,
      breakout: undefined,
    });
  });
});

describe('validateCableDef', () => {
  it('is empty for a sound definition', () => {
    expect(validateCableDef(fiberDef({ fiberCount: 8, sideA: { connector: 'MPO-8' }, sideB: { connector: 'LC-duplex' } }))).toEqual([]);
  });

  it('reports missing fiber fields', () => {
    expect(validateCableDef(builtin('cbl.cat6a'))).toEqual(['Fiber count is required.', 'Side A connector is required.', 'Side B connector is required.']);
    expect(validateCableDef(fiberDef({ fiberCount: 8, sideA: { connector: '' }, sideB: { connector: 'LC-duplex' } }))).toEqual(['Side A connector is required.']);
  });

  it('reports an unknown connector and a fiber count that does not split', () => {
    expect(validateCableDef(fiberDef({ fiberCount: 8, sideA: { connector: 'MPO-8' }, sideB: { connector: 'LC' } }))).toEqual(['Unknown connector "LC".']);
    expect(validateCableDef(fiberDef({ fiberCount: 16, sideA: { connector: 'MPO-12' }, sideB: { connector: 'LC-duplex' } }))).toEqual([
      "16 fibers can't be split evenly into MPO-12 legs (12 each). Use MPO-16 or MPO-8.",
    ]);
  });

  it('reports a custom strand map that is not a bijection, naming the slots', () => {
    const problems = validateCableDef(
      fiberDef({ fiberCount: 2, strandMap: [{ a: { leg: 0, pos: 1 }, b: { leg: 0, pos: 2 } }], sideA: { connector: 'LC-duplex' }, sideB: { connector: 'LC-duplex' } }),
    );
    expect(problems).toEqual(['Custom strand map: Side A leg 1 position 2 is not wired.', 'Custom strand map: Side B leg 1 position 1 is not wired.']);
  });

  it('reports a negative breakout length and an invalid polarity', () => {
    const def = fiberDef({ fiberCount: 8, breakoutLengthM: -1, polarity: 'D' as never, sideA: { connector: 'MPO-8' }, sideB: { connector: 'LC-duplex' } });
    expect(validateCableDef(def)).toEqual(['Breakout length must be 0 m or more.', 'Polarity must be A, B or C, got "D".']);
    expect(validateCableDef({ ...def, breakoutLengthM: 0, polarity: 'A' })).toEqual([]);
  });
});
