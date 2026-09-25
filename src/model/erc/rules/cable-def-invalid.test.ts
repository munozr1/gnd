import { describe, expect, it } from 'vitest';
import * as cables from '@/commands/cables';
import type { CableDef } from '@/model/types';
import { check } from '../fixtures';
import { cableDefInvalidRule } from './cable-def-invalid';
import { TRUNK_8F, builtinCableDef, run, trunkFixture, withCable, withCustomDef } from './cable-fixtures';

const customDef = (patch: Partial<CableDef>): CableDef => ({ ...builtinCableDef(TRUNK_8F), id: 'cbl.custom.x', name: 'custom', ...patch });

describe('cable-def-invalid', () => {
  it('flags a fiber count that does not split evenly, in the Cable Builder wording', () => {
    const f = trunkFixture();
    const p = withCable(
      withCustomDef(f.project, customDef({ fiberCount: 16, sideA: { connector: 'MPO-12' }, sideB: { connector: 'LC-duplex' } })),
      { id: 'c-bad', label: 'T-2', cableDefId: 'cbl.custom.x', plugs: [] },
    );
    const issues = check(cableDefInvalidRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      severity: 'error',
      rule: 'cable-def-invalid',
      message: "T-2: 16 fibers can't be split evenly into MPO-12 legs (12 each). Use MPO-16 or MPO-8.",
      targets: [{ kind: 'cable', id: 'c-bad' }],
    });
  });

  it('flags an unknown connector and a definition missing from the catalog', () => {
    const f = trunkFixture();
    const p = withCable(
      withCable(withCustomDef(f.project, customDef({ sideB: { connector: 'LC-quad' } })), { id: 'c-conn', label: 'T-2', cableDefId: 'cbl.custom.x', plugs: [] }),
      { id: 'c-gone', label: 'T-3', cableDefId: 'cbl.gone', plugs: [] },
    );
    const issues = check(cableDefInvalidRule, p);
    expect(issues.map((i) => i.message).sort()).toEqual(['T-2: Unknown connector "LC-quad".', 'T-3: Cable definition "cbl.gone" is not in the catalog.']);
  });

  it('flags a custom strand map that is not a bijection, one issue per problem', () => {
    const f = trunkFixture();
    const p = withCustomDef(f.project, customDef({ strandMap: [{ a: { leg: 0, pos: 1 }, b: { leg: 0, pos: 1 } }, { a: { leg: 0, pos: 1 }, b: { leg: 9, pos: 1 } }] }));
    // The definition still resolves (the map is passed through), so the cable can be installed normally.
    const create = cables.createCable('cbl.custom.x', { label: 'T-2' });
    const issues = check(cableDefInvalidRule, run(p, create));
    expect(issues.length).toBeGreaterThan(2);
    expect(issues.every((i) => i.message.startsWith('T-2: Custom strand map: ') && i.targets[0]?.id === create.result)).toBe(true);
    expect(issues.map((i) => i.message)).toContain('T-2: Custom strand map: Side A leg A position 1 is wired 2 times.');
    expect(issues.map((i) => i.message)).toContain('T-2: Custom strand map: Side B has no leg 10 (wired to position 1).');
    expect(new Set(issues.map((i) => i.id)).size).toBe(issues.length);
  });

  it('is clean for the built-in trunk and keeps issue ids when the cable is relabelled', () => {
    const f = trunkFixture();
    expect(check(cableDefInvalidRule, f.project)).toEqual([]);
    const bad = withCable(withCustomDef(f.project, customDef({ fiberCount: 10 })), { id: 'c-bad', label: 'T-2', cableDefId: 'cbl.custom.x', plugs: [] });
    const before = check(cableDefInvalidRule, bad);
    const after = check(cableDefInvalidRule, run(bad, cables.setCableLabel('c-bad', 'Renamed')));
    expect(after.map((i) => i.id)).toEqual(before.map((i) => i.id));
    expect(after[0]!.message).not.toBe(before[0]!.message);
  });
});
