import { describe, expect, it } from 'vitest';
import { createProject } from '@/model/factories';
import { indexProject } from '@/model/query';
import { LEAF, SERVER_1U, addComponent, buildSpineLeafMesh, connect, end, errors } from './fixtures';
import { compareIssues, ercRuleById, ercRules, ercSeverity, runErc } from './index';

describe('ercRules', () => {
  it('has the nine spec rules then the four cable rules, with unique kebab-case ids', () => {
    expect(ercRules.map((r) => r.id)).toEqual([
      'port-reuse',
      'form-factor-mismatch',
      'speed-mismatch',
      'media-mismatch',
      'connector-mismatch',
      'missing-optic',
      'unassigned-model',
      'single-homed-server',
      'unconnected-uplinks',
      'cable-def-invalid',
      'cable-connector-mismatch',
      'cable-leg-unassigned',
      'cable-unused-fibers',
    ]);
    for (const r of ercRules) {
      expect(r.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      expect(r.name.length).toBeGreaterThan(0);
      expect(ercRuleById.get(r.id)).toBe(r);
    }
  });

  it('defaults match the spec table', () => {
    const sev = Object.fromEntries(ercRules.map((r) => [r.id, r.defaultSeverity]));
    expect(sev).toEqual({
      'port-reuse': 'error',
      'form-factor-mismatch': 'error',
      'speed-mismatch': 'error',
      'media-mismatch': 'error',
      'connector-mismatch': 'error',
      'missing-optic': 'warning',
      'unassigned-model': 'warning',
      'single-homed-server': 'warning',
      'unconnected-uplinks': 'info',
      'cable-def-invalid': 'error',
      'cable-connector-mismatch': 'error',
      'cable-leg-unassigned': 'warning',
      'cable-unused-fibers': 'info',
    });
  });
});

describe('runErc', () => {
  it('a clean 2-spine x 8-leaf mesh with 100G-SR4 both ends over OM4 MPO trunks has no errors', () => {
    const project = buildSpineLeafMesh();
    expect(project.links).toHaveLength(64);
    const issues = runErc(project);
    expect(errors(issues)).toEqual([]);
    expect(issues.every((i) => i.severity === 'warning' || i.severity === 'info')).toBe(true);
    // Every uplink and spine port is used, all models are assigned: nothing to report at all.
    expect(issues).toEqual([]);
  });

  it('returns nothing for an empty project', () => {
    expect(runErc(createProject())).toEqual([]);
  });

  it('sorts error -> warning -> info, then by message', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1', { footprintDefId: null, optics: { 'eth1/1': 'xcvr.25g-sr' } });
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-lr' } });
    connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'), 'cbl.om4-duplex');
    connect(p, end(sw, 'eth1/49'), end(srv, 'eth1'), 'cbl.om4-duplex');

    const issues = runErc(p);
    const ranks = issues.map((i) => ({ error: 0, warning: 1, info: 2, ignore: 3 })[i.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    for (let i = 1; i < issues.length; i++) {
      const a = issues[i - 1]!;
      const b = issues[i]!;
      expect(compareIssues(a, b)).toBeLessThanOrEqual(0);
      if (a.severity === b.severity) expect(a.message <= b.message).toBe(true);
    }
    expect(issues.some((i) => i.rule === 'media-mismatch' && i.severity === 'error')).toBe(true);
    expect(issues.some((i) => i.rule === 'unassigned-model' && i.severity === 'warning')).toBe(true);
    expect(issues.some((i) => i.rule === 'unconnected-uplinks' && i.severity === 'info')).toBe(true);
  });

  it('applies severity overrides from project settings', () => {
    const p = createProject();
    addComponent(p, LEAF, 'SW1', { footprintDefId: null });
    p.settings.ercSeverities['unassigned-model'] = 'error';
    const issues = runErc(p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.rule).toBe('unassigned-model');
    expect(issues[0]!.severity).toBe('error');
    expect(ercSeverity(p, ercRuleById.get('unassigned-model')!)).toBe('error');
    expect(ercSeverity(p, ercRuleById.get('port-reuse')!)).toBe('error');
  });

  it("drops issues of rules set to 'ignore'", () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1');
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'), 'cbl.om4-duplex');
    p.settings.ercSeverities['missing-optic'] = 'ignore';
    p.settings.ercSeverities['single-homed-server'] = 'ignore';
    expect(runErc(p)).toEqual([]);
  });

  it('accepts a caller-supplied index and returns fresh issue objects', () => {
    const p = createProject();
    const sw = addComponent(p, LEAF, 'SW1');
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(sw, 'eth1/1'), end(srv, 'eth0'), 'cbl.om4-duplex');
    const idx = indexProject(p);
    const a = runErc(p, idx);
    const b = runErc(p, idx);
    expect(a).toEqual(b);
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
  });
});
