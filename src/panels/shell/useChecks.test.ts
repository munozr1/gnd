import { beforeEach, describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { createComponent, createProject, ROOT_SHEET_ID } from '@/model/factories';
import { emptyHistory, initialUi, useStore } from '@/store';
import { runChecks } from './useChecks';

const leaf = builtinCatalog.symbols.find((s) => s.id === 'sym.leaf-switch-48x25-8x100')!;

beforeEach(() => {
  const project = createProject('Checks', '2026-01-01T00:00:00.000Z');
  const sw1 = createComponent(leaf, { sheetId: ROOT_SHEET_ID, pos: { x: 0, y: 0 }, ref: 'SW1' });
  sw1.footprintDefId = null; // createComponent's `??` fallback would otherwise assign the default model
  project.components.push(sw1);
  useStore.setState({ project, history: emptyHistory(), ui: initialUi() });
});

describe('runChecks', () => {
  it('writes ERC and DRC results into ui.issues', async () => {
    const results = await runChecks();
    const { issues } = useStore.getState().ui;
    for (const domain of ['erc', 'drc'] as const) {
      const r = results[domain];
      expect(r).not.toBeNull();
      expect(issues[domain]).toBe(r);
      expect(r!.every((i) => i.domain === domain)).toBe(true);
    }
    // An unassigned model is an ERC warning by spec; an unplaced component is a DRC error.
    expect(results.erc!.some((i) => i.rule === 'unassigned-model')).toBe(true);
    expect(results.drc!.some((i) => i.rule === 'unplaced-component' && i.targets[0]?.id === useStore.getState().project.components[0]!.id)).toBe(true);
  });

  it('only touches the requested domains', async () => {
    useStore.getState().setIssues('drc', [{ id: 'x', rule: 'r', severity: 'info', message: 'm', targets: [], domain: 'drc' }]);
    await runChecks(['erc']);
    expect(useStore.getState().ui.issues.drc).toHaveLength(1);
  });
});
