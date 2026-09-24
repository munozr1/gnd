/**
 * Adversarial ERC tests: a clean design that must not raise false positives,
 * bad designs that must not slip through, severity overrides / ignore, and
 * issue-id stability across runs, re-annotation and reordering.
 */
import { describe, expect, it } from 'vitest';
import { createProject } from '@/model/factories';
import { ProjectIndex } from '@/model/query';
import type { Issue, Project } from '@/model/types';
import {
  GPU_SERVER,
  LC_PANEL,
  LEAF,
  MGMT_SWITCH,
  MPO_PANEL,
  SERVER_1U,
  SERVER_2U,
  SPINE,
  addComponent,
  check,
  connect,
  end,
  errors,
  hasTarget,
} from './fixtures';
import { ercRuleById, ercRules, runErc } from './index';
import { connectorMismatchRule } from './rules/connector-mismatch';
import { formFactorMismatchRule } from './rules/form-factor-mismatch';
import { mediaMismatchRule } from './rules/media-mismatch';
import { missingOpticRule } from './rules/missing-optic';
import { portReuseRule } from './rules/port-reuse';
import { speedMismatchRule } from './rules/speed-mismatch';

/** runErc over a mutable test project (bypasses the identity-memoised index). */
const run = (p: Project): Issue[] => runErc(p, new ProjectIndex(p));

const byRule = (issues: Issue[], rule: string): Issue[] => issues.filter((i) => i.rule === rule);

/**
 * A realistic, fully valid design exercising every "exception" the spec
 * grants: DAC/AOC links without optics, breakout lanes (direct and through
 * an MPO panel), LC patch panels in the path, backward-compatible cages
 * (SFP+ and SFP in SFP28, QSFP28 in QSFP-DD), copper optics on Cat6A and
 * fixed RJ45 management ports. Every server is dual-homed.
 */
function buildCleanDesign(): Project {
  const p = createProject('clean', '2026-01-01T00:00:00.000Z');
  const leaf = addComponent(p, LEAF, 'SW1', {
    optics: {
      'eth1/3': 'xcvr.25g-sr',
      'eth1/4': 'xcvr.25g-lr',
      'eth1/5': 'xcvr.10g-sr',
      'eth1/6': 'xcvr.1g-t',
      'eth1/49': 'xcvr.100g-sr4',
      'eth1/50': 'xcvr.100g-sr4',
      'eth1/51': 'xcvr.100g-sr4',
    },
  });
  const spine = addComponent(p, SPINE, 'SW2', { optics: { 'eth1/1': 'xcvr.100g-sr4' } });
  const mgmt = addComponent(p, MGMT_SWITCH, 'SW3', { optics: { xe1: 'xcvr.10g-sr' } });
  const lcPanel = addComponent(p, LC_PANEL, 'PP1');
  const mpoPanel = addComponent(p, MPO_PANEL, 'PP2');
  const srv1 = addComponent(p, SERVER_1U, 'SRV1');
  const breakoutServers = [2, 3, 4, 5].map((i) =>
    addComponent(p, SERVER_1U, `SRV${i}`, { optics: { eth0: 'xcvr.25g-sr', eth1: 'xcvr.25g-sr' } }),
  );
  const srv6 = addComponent(p, SERVER_1U, 'SRV6', { optics: { eth0: 'xcvr.25g-sr', eth1: 'xcvr.25g-lr' } });

  // DAC pair, no optics anywhere.
  connect(p, end(leaf, 'eth1/1'), end(srv1, 'eth0'), 'cbl.dac-25g');
  connect(p, end(srv1, 'eth1'), end(leaf, 'eth1/2'), 'cbl.dac-25g');

  // 100G-SR4 broken out straight to four servers.
  breakoutServers.forEach((s, lane) => connect(p, end(leaf, 'eth1/49', lane), end(s, 'eth0'), 'cbl.mpo-breakout'));

  // 100G-SR4 -> MPO panel -> breakout on the panel rear -> LC panel -> servers.
  connect(p, end(leaf, 'eth1/50'), end(mpoPanel, 'f1'), 'cbl.om4-mpo-trunk');
  breakoutServers.forEach((s, lane) => {
    const rear = `r${lane + 1}`;
    // Alternate draw direction to make sure orientation never matters.
    if (lane % 2 === 0) connect(p, end(mpoPanel, 'r1', lane), end(lcPanel, rear), 'cbl.mpo-breakout');
    else connect(p, end(lcPanel, rear), end(mpoPanel, 'r1', lane), 'cbl.mpo-breakout');
    connect(p, end(lcPanel, `f${lane + 1}`), end(s, 'eth1'), 'cbl.om4-duplex');
  });

  // 25G through an LC panel, and a 25G-LR pair over OS2.
  connect(p, end(leaf, 'eth1/3'), end(lcPanel, 'f5'), 'cbl.om4-duplex');
  connect(p, end(lcPanel, 'r5'), end(srv6, 'eth0'), 'cbl.om4-duplex');
  connect(p, end(leaf, 'eth1/4'), end(srv6, 'eth1'), 'cbl.os2-duplex');

  // Uplinks: MPO trunk, AOC, DAC (QSFP28 into QSFP-DD cages).
  connect(p, end(leaf, 'eth1/51'), end(spine, 'eth1/1'), 'cbl.om4-mpo-trunk');
  connect(p, end(leaf, 'eth1/52'), end(spine, 'eth1/2'), 'cbl.aoc-100g');
  connect(p, end(spine, 'eth1/3'), end(leaf, 'eth1/53'), 'cbl.dac-100g');

  // 10G SFP+ in an SFP28 cage, a 1G-T copper optic on Cat6A, RJ45 management.
  connect(p, end(leaf, 'eth1/5'), end(mgmt, 'xe1'), 'cbl.om4-duplex');
  connect(p, end(leaf, 'eth1/6'), end(mgmt, 'ge1'), 'cbl.cat6a');
  connect(p, end(leaf, 'mgmt0'), end(mgmt, 'ge2'), 'cbl.cat6a');
  [srv1, ...breakoutServers, srv6].forEach((s, i) => connect(p, end(s, 'bmc0'), end(mgmt, `ge${i + 3}`), 'cbl.cat6a'));
  return p;
}

/** A design that trips every rule at least once. */
function buildBadDesign(): Project {
  const p = createProject('bad', '2026-01-01T00:00:00.000Z');
  const leaf = addComponent(p, LEAF, 'SW1', {
    optics: { 'eth1/1': 'xcvr.100g-sr4', 'eth1/2': 'xcvr.25g-sr', 'eth1/3': 'xcvr.25g-lr', 'eth1/49': 'xcvr.100g-lr4' },
  });
  const spine = addComponent(p, SPINE, 'SW2', { optics: { 'eth1/1': 'xcvr.100g-sr4' } });
  const orphan = addComponent(p, LEAF, 'SW3', { footprintDefId: null });
  const s1 = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-lr', eth1: 'xcvr.10g-sr' } });
  const s2 = addComponent(p, SERVER_1U, 'SRV2', { optics: { eth0: 'xcvr.25g-sr' } });
  connect(p, end(leaf, 'eth1/2'), end(s1, 'eth0'), 'cbl.om4-duplex'); // MMF vs SMF, SMF on OM4
  connect(p, end(leaf, 'eth1/2'), end(s2, 'eth0'), 'cbl.om4-duplex'); // port reuse
  connect(p, end(leaf, 'eth1/3'), end(s1, 'eth1'), 'cbl.dac-25g'); // optics on a DAC, speeds differ
  connect(p, end(leaf, 'eth1/49'), end(spine, 'eth1/1'), 'cbl.om4-duplex'); // LC cable on MPO optic
  connect(p, end(leaf, 'eth1/50'), end(spine, 'eth1/2'), 'cbl.om4-mpo-trunk'); // missing optic
  connect(p, end(orphan, 'eth1/49'), end(spine, 'eth1/3'), 'cbl.om4-mpo-trunk');
  return p;
}

describe('no false positives on a valid design', () => {
  it('a full design using every spec exception is ERC clean apart from free-uplink infos', () => {
    const p = buildCleanDesign();
    const issues = run(p);
    expect(errors(issues)).toEqual([]);
    expect(issues.filter((i) => i.severity === 'warning')).toEqual([]);
    expect(new Set(issues.map((i) => i.rule))).toEqual(new Set(['unconnected-uplinks']));
  });

  it('a clean design keeps the same issue ids run after run', () => {
    const p = buildCleanDesign();
    expect(run(p).map((i) => i.id)).toEqual(run(p).map((i) => i.id));
  });

  it('DAC / AOC links raise nothing at all when no optics are assigned', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1');
    const spine = addComponent(p, SPINE, 'SW2');
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(leaf, 'eth1/1'), end(srv, 'eth0'), 'cbl.dac-25g');
    connect(p, end(leaf, 'eth1/2'), end(srv, 'eth1'), 'cbl.dac-25g');
    for (let i = 49; i <= 56; i++) {
      connect(p, end(leaf, `eth1/${i}`), end(spine, `eth1/${i - 48}`), i % 2 ? 'cbl.aoc-100g' : 'cbl.dac-100g');
    }
    for (let i = 9; i <= 32; i++) connect(p, end(spine, `eth1/${i}`), end(addComponent(p, LEAF, `SW${i}`), 'eth1/49'), 'cbl.dac-100g');
    const issues = run(p);
    // Extra leaves each have one uplink used, which is an info; nothing else.
    expect(issues.filter((i) => i.rule !== 'unconnected-uplinks')).toEqual([]);
  });

  it('a 400G DAC between two spine QSFP-DD ports is clean', () => {
    const p = createProject();
    const a = addComponent(p, SPINE, 'SW1');
    const b = addComponent(p, SPINE, 'SW2');
    connect(p, end(a, 'eth1/1'), end(b, 'eth1/1'), 'cbl.dac-400g');
    connect(p, end(a, 'eth1/2'), end(b, 'eth1/2'), 'cbl.aoc-400g');
    expect(run(p)).toEqual([]);
  });

  it('breakout lanes: four servers on one 100G-SR4 have no port-reuse, speed or connector issues', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/49': 'xcvr.100g-sr4' } });
    const servers = [1, 2, 3, 4].map((i) => addComponent(p, SERVER_1U, `SRV${i}`, { optics: { eth0: 'xcvr.25g-sr' } }));
    servers.forEach((s, lane) => connect(p, end(leaf, 'eth1/49', lane), end(s, 'eth0'), 'cbl.mpo-breakout'));
    const issues = run(p);
    expect(errors(issues)).toEqual([]);
    expect(byRule(issues, 'missing-optic')).toEqual([]);
    // Servers are single-homed here by construction; nothing else may fire.
    expect(new Set(issues.map((i) => i.rule))).toEqual(new Set(['single-homed-server', 'unconnected-uplinks']));
  });

  it('a spine 400G-DR4 broken out to 100G optics is speed-clean', () => {
    const p = createProject();
    const spine = addComponent(p, SPINE, 'SW1', { optics: { 'eth1/1': 'xcvr.400g-dr4' } });
    const leaves = [1, 2, 3, 4].map((i) => addComponent(p, LEAF, `SW${i + 1}`, { optics: { 'eth1/49': 'xcvr.100g-lr4' } }));
    leaves.forEach((l, lane) => connect(p, end(spine, 'eth1/1', lane), end(l, 'eth1/49')));
    expect(check(speedMismatchRule, p)).toEqual([]);
    expect(check(mediaMismatchRule, p)).toEqual([]);
  });

  it('patch panels with LC and MPO ports carry links without optics and never warn', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.25g-sr', 'eth1/49': 'xcvr.100g-sr4' } });
    const lc = addComponent(p, LC_PANEL, 'PP1');
    const mpo = addComponent(p, MPO_PANEL, 'PP2');
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-sr', eth1: 'xcvr.25g-sr' } });
    connect(p, end(leaf, 'eth1/1'), end(lc, 'f1'), 'cbl.om4-duplex');
    connect(p, end(lc, 'r1'), end(srv, 'eth0'), 'cbl.om4-duplex');
    connect(p, end(leaf, 'eth1/49'), end(mpo, 'f1'), 'cbl.om4-mpo-trunk');
    connect(p, end(mpo, 'r1', 0), end(lc, 'r2'), 'cbl.mpo-breakout');
    connect(p, end(lc, 'f2'), end(srv, 'eth1'), 'cbl.om4-duplex');
    const issues = run(p);
    expect(issues.filter((i) => i.rule !== 'unconnected-uplinks')).toEqual([]);
  });

  it('a breakout cable on a whole-port link matches whichever way the link was drawn', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/49': 'xcvr.100g-sr4', 'eth1/50': 'xcvr.100g-sr4' } });
    const s1 = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-sr' } });
    const s2 = addComponent(p, SERVER_1U, 'SRV2', { optics: { eth0: 'xcvr.25g-sr' } });
    connect(p, end(leaf, 'eth1/49'), end(s1, 'eth0'), 'cbl.mpo-breakout');
    connect(p, end(s2, 'eth0'), end(leaf, 'eth1/50'), 'cbl.mpo-breakout');
    expect(check(connectorMismatchRule, p)).toEqual([]);
  });

  it('a breakout cable with the LC leg on a patch panel and the trunk on a fixed MPO port is fine both ways', () => {
    const p = createProject();
    const mpo = addComponent(p, MPO_PANEL, 'PP1');
    const lc = addComponent(p, LC_PANEL, 'PP2');
    connect(p, end(mpo, 'r1', 0), end(lc, 'r1'), 'cbl.mpo-breakout');
    connect(p, end(lc, 'r2'), end(mpo, 'r1', 1), 'cbl.mpo-breakout');
    connect(p, end(lc, 'r3'), end(mpo, 'r2'), 'cbl.mpo-breakout');
    expect(run(p)).toEqual([]);
  });

  it('backward-compatible cages are accepted for optics and integrated cables alike', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.1g-t', 'eth1/2': 'xcvr.10g-sr' } });
    const spine = addComponent(p, SPINE, 'SW2', { optics: { 'eth1/1': 'xcvr.100g-sr4' } });
    const mgmt = addComponent(p, MGMT_SWITCH, 'SW3', { optics: { xe1: 'xcvr.10g-sr' } });
    connect(p, end(leaf, 'eth1/49'), end(spine, 'eth1/2'), 'cbl.dac-100g');
    connect(p, end(leaf, 'eth1/2'), end(mgmt, 'xe1'), 'cbl.om4-duplex');
    connect(p, end(leaf, 'eth1/1'), end(mgmt, 'ge1'), 'cbl.cat6a');
    expect(check(formFactorMismatchRule, p)).toEqual([]);
    expect(errors(run(p))).toEqual([]);
  });

  it('RJ45-only links (Cat6A between fixed ports) raise nothing', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1');
    const mgmt = addComponent(p, MGMT_SWITCH, 'SW2');
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(leaf, 'mgmt0'), end(mgmt, 'ge1'), 'cbl.cat6a');
    connect(p, end(srv, 'bmc0'), end(mgmt, 'ge2'), 'cbl.cat6a');
    connect(p, end(srv, 'eth0'), end(leaf, 'eth1/1'), 'cbl.dac-25g');
    connect(p, end(srv, 'eth1'), end(leaf, 'eth1/2'), 'cbl.dac-25g');
    expect(run(p)).toEqual([]);
  });
});

describe('no false negatives', () => {
  it('a QSFP28 optic in an SFP28 server port is an error even on a DAC link', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1');
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.100g-sr4' } });
    connect(p, end(leaf, 'eth1/1'), end(srv, 'eth0'), 'cbl.dac-25g');
    const issues = run(p);
    const ff = byRule(issues, 'form-factor-mismatch');
    expect(ff).toHaveLength(1);
    expect(ff[0]!.severity).toBe('error');
    expect(hasTarget(ff[0]!, 'component', srv.id, 'eth0')).toBe(true);
  });

  it('a QSFP-DD optic or 400G DAC in a QSFP28 leaf cage is an error; an SFP28 DAC in a QSFP28 cage too', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/49': 'xcvr.400g-dr4' } });
    const spine = addComponent(p, SPINE, 'SW2');
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(leaf, 'eth1/50'), end(spine, 'eth1/1'), 'cbl.dac-400g');
    connect(p, end(leaf, 'eth1/51'), end(srv, 'eth0'), 'cbl.dac-25g');
    const messages = check(formFactorMismatchRule, p).map((i) => i.message);
    expect(messages).toEqual([
      'SW1:eth1/49: 400G-DR4 (QSFP-DD) does not fit QSFP28 port',
      'SW1:eth1/50: DAC 400G (QSFP-DD) does not fit QSFP28 port',
      'SW1:eth1/51: DAC 25G (SFP28) does not fit QSFP28 port',
    ]);
  });

  it('an optic assigned to a fixed LC / MPO / RJ45 port is a form-factor error', () => {
    const p = createProject();
    addComponent(p, LC_PANEL, 'PP1', { optics: { f1: 'xcvr.25g-sr' } });
    addComponent(p, MPO_PANEL, 'PP2', { optics: { f1: 'xcvr.100g-sr4' } });
    addComponent(p, SERVER_1U, 'SRV1', { optics: { bmc0: 'xcvr.1g-t' } });
    const messages = check(formFactorMismatchRule, p).map((i) => i.message);
    expect(messages).toEqual([
      'PP1:f1: 25G-SR (SFP28) does not fit LC port',
      'PP2:f1: 100G-SR4 (QSFP28) does not fit MPO-12 port',
      'SRV1:bmc0: 1G-T (SFP) does not fit RJ45 port',
    ]);
  });

  it('MMF facing SMF is an error with no cable, over OM4, over OS2 and across a breakout lane', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', {
      optics: { 'eth1/1': 'xcvr.25g-sr', 'eth1/2': 'xcvr.25g-sr', 'eth1/3': 'xcvr.25g-lr', 'eth1/49': 'xcvr.100g-sr4' },
    });
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-lr', eth1: 'xcvr.25g-lr' } });
    const srv2 = addComponent(p, SERVER_1U, 'SRV2', { optics: { eth0: 'xcvr.25g-sr', eth1: 'xcvr.25g-lr' } });
    const bare = connect(p, end(leaf, 'eth1/1'), end(srv, 'eth0'));
    const om4 = connect(p, end(leaf, 'eth1/2'), end(srv, 'eth1'), 'cbl.om4-duplex');
    const os2 = connect(p, end(leaf, 'eth1/3'), end(srv2, 'eth0'), 'cbl.os2-duplex');
    const lane = connect(p, end(leaf, 'eth1/49', 0), end(srv2, 'eth1'), 'cbl.mpo-breakout');

    const issues = check(mediaMismatchRule, p);
    for (const l of [bare, om4, os2, lane]) {
      expect(issues.some((i) => hasTarget(i, 'link', l.id) && i.message.endsWith('optic media differ'))).toBe(true);
    }
    // The cable rule adds one issue for the optic that disagrees with the cable.
    expect(issues.filter((i) => hasTarget(i, 'link', om4.id))).toHaveLength(2);
    expect(issues.filter((i) => hasTarget(i, 'link', os2.id))).toHaveLength(2);
    expect(issues.filter((i) => hasTarget(i, 'link', lane.id))).toHaveLength(2);
    expect(issues.filter((i) => hasTarget(i, 'link', bare.id))).toHaveLength(1);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('a copper optic facing a fibre optic, and an SMF optic on an MPO breakout, are media errors', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.1g-t', 'eth1/49': 'xcvr.100g-lr4' } });
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-sr' } });
    const lc = addComponent(p, LC_PANEL, 'PP1');
    connect(p, end(leaf, 'eth1/1'), end(srv, 'eth0'));
    connect(p, end(leaf, 'eth1/49', 0), end(lc, 'f1'), 'cbl.mpo-breakout');
    const messages = check(mediaMismatchRule, p).map((i) => i.message);
    expect(messages).toContain('SW1:eth1/1 (1G-T, Copper) — SRV1:eth0 (25G-SR, MMF): optic media differ');
    // Optic-vs-cable issues are per link end, so the label carries the lane like the
    // connector and speed messages do (the spec leaves message text open).
    expect(messages).toContain('SW1:eth1/49.0: 100G-LR4 (SMF) on MPO breakout cable (needs MMF)');
    expect(messages).toHaveLength(2);
  });

  it('an optic assigned on either end of an AOC is an error', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/49': 'xcvr.100g-sr4' } });
    const spine = addComponent(p, SPINE, 'SW2', { optics: { 'eth1/1': 'xcvr.100g-sr4' } });
    connect(p, end(leaf, 'eth1/49'), end(spine, 'eth1/1'), 'cbl.aoc-100g');
    const issues = check(mediaMismatchRule, p);
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => i.message.includes('AOC 100G'))).toBe(true);
  });

  it('a 100G-LR4 (LC) on an MPO trunk to a 100G-SR4 trips media and connector', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/49': 'xcvr.100g-lr4' } });
    const spine = addComponent(p, SPINE, 'SW2', { optics: { 'eth1/1': 'xcvr.100g-sr4' } });
    connect(p, end(leaf, 'eth1/49'), end(spine, 'eth1/1'), 'cbl.om4-mpo-trunk');
    const issues = run(p);
    expect(byRule(issues, 'media-mismatch').map((i) => i.message)).toEqual([
      'SW1:eth1/49 (100G-LR4, SMF) — SW2:eth1/1 (100G-SR4, MMF): optic media differ',
      'SW1:eth1/49: 100G-LR4 (SMF) on OM4 MPO trunk cable (needs MMF)',
    ]);
    expect(byRule(issues, 'connector-mismatch').map((i) => i.message)).toEqual([
      'SW1:eth1/49: OM4 MPO trunk MPO-12 end on 100G-LR4 (LC)',
    ]);
    expect(byRule(issues, 'speed-mismatch')).toEqual([]);
  });

  it('an LC duplex on a breakout lane (no breakout cable) is a connector error', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/49': 'xcvr.100g-sr4' } });
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-sr' } });
    connect(p, end(leaf, 'eth1/49', 0), end(srv, 'eth0'), 'cbl.om4-duplex');
    const issues = check(connectorMismatchRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe('SW1:eth1/49.0: OM4 duplex LC end on 100G-SR4 (MPO-12)');
  });

  it('an MPO trunk between LC optics is flagged at both ends; a breakout between two MPO optics at the leg end', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.25g-sr', 'eth1/49': 'xcvr.100g-sr4' } });
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-sr' } });
    const spine = addComponent(p, SPINE, 'SW2', { optics: { 'eth1/1': 'xcvr.100g-sr4' } });
    connect(p, end(leaf, 'eth1/1'), end(srv, 'eth0'), 'cbl.om4-mpo-trunk');
    connect(p, end(spine, 'eth1/1'), end(leaf, 'eth1/49'), 'cbl.mpo-breakout');
    const issues = check(connectorMismatchRule, p);
    expect(issues).toHaveLength(3);
    expect(issues.filter((i) => i.message.includes('OM4 MPO trunk MPO-12 end on 25G-SR (LC)'))).toHaveLength(2);
    expect(issues.filter((i) => i.message.includes('MPO breakout LC end on 100G-SR4 (MPO-12)'))).toHaveLength(1);
  });

  it('a 400G-SR8 (MPO-16) on an MPO-12 trunk is a connector error', () => {
    const p = createProject();
    const a = addComponent(p, SPINE, 'SW1', { optics: { 'eth1/1': 'xcvr.400g-sr8' } });
    const b = addComponent(p, SPINE, 'SW2', { optics: { 'eth1/1': 'xcvr.400g-sr8' } });
    connect(p, end(a, 'eth1/1'), end(b, 'eth1/1'), 'cbl.om4-mpo-trunk');
    expect(check(connectorMismatchRule, p)).toHaveLength(2);
  });

  it('speed: 10G vs 25G, whole 100G vs 25G, and a 400G-DR4 lane vs 25G are errors', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.10g-sr', 'eth1/49': 'xcvr.100g-sr4' } });
    const spine = addComponent(p, SPINE, 'SW2', { optics: { 'eth1/1': 'xcvr.400g-dr4' } });
    const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-sr', eth1: 'xcvr.25g-sr' } });
    const srv2 = addComponent(p, SERVER_1U, 'SRV2', { optics: { eth0: 'xcvr.25g-sr' } });
    connect(p, end(leaf, 'eth1/1'), end(srv, 'eth0'), 'cbl.om4-duplex');
    connect(p, end(leaf, 'eth1/49'), end(srv, 'eth1'), 'cbl.om4-mpo-trunk');
    connect(p, end(spine, 'eth1/1', 3), end(srv2, 'eth0'), 'cbl.mpo-breakout');
    const messages = check(speedMismatchRule, p).map((i) => i.message);
    expect(messages).toEqual([
      'SW1:eth1/1 (10G) — SRV1:eth0 (25G): speeds differ',
      'SW1:eth1/49 (100G) — SRV1:eth1 (25G): speeds differ',
      'SW2:eth1/1.3 (100G) — SRV2:eth0 (25G): speeds differ',
    ]);
  });

  it('speed: a DAC 100G end against an assigned 25G optic differs', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1');
    const srv = addComponent(p, SERVER_2U, 'SRV1', { optics: { eth2: 'xcvr.25g-sr' } });
    connect(p, end(leaf, 'eth1/49'), end(srv, 'eth2'), 'cbl.dac-100g');
    const issues = run(p);
    expect(byRule(issues, 'speed-mismatch')).toHaveLength(1);
    expect(byRule(issues, 'media-mismatch')).toHaveLength(1);
    expect(byRule(issues, 'form-factor-mismatch')).toHaveLength(1);
  });

  it('port reuse: a port shared by a DAC and a fibre link, a lane used twice, a whole port plus a lane', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/49': 'xcvr.100g-sr4', 'eth1/50': 'xcvr.100g-sr4' } });
    const s1 = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth1: 'xcvr.25g-sr' } });
    const s2 = addComponent(p, SERVER_1U, 'SRV2', { optics: { eth0: 'xcvr.25g-sr', eth1: 'xcvr.25g-sr' } });
    const spine = addComponent(p, SPINE, 'SW2', { optics: { 'eth1/1': 'xcvr.100g-sr4' } });
    connect(p, end(leaf, 'eth1/1'), end(s1, 'eth0'), 'cbl.dac-25g');
    connect(p, end(leaf, 'eth1/1'), end(s1, 'eth1'), 'cbl.om4-duplex');
    connect(p, end(leaf, 'eth1/49', 1), end(s2, 'eth0'), 'cbl.mpo-breakout');
    connect(p, end(s2, 'eth1'), end(leaf, 'eth1/49', 1), 'cbl.mpo-breakout');
    connect(p, end(leaf, 'eth1/50'), end(spine, 'eth1/1'), 'cbl.om4-mpo-trunk');
    connect(p, end(leaf, 'eth1/50', 0), end(s2, 'eth1'), 'cbl.mpo-breakout');
    const messages = check(portReuseRule, p).map((i) => i.message);
    expect(messages).toContain('SW1:eth1/1 is on 2 links');
    expect(messages).toContain('SW1:eth1/49.1 is on 2 links');
    expect(messages).toContain('SW1:eth1/50 is used both as a whole port and as breakout lanes');
    expect(messages).toContain('SRV2:eth1 is on 2 links');
    expect(messages).toHaveLength(4);
  });

  it('port reuse: a link with both ends on the same port is reported once, against that one link', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1');
    const link = connect(p, end(leaf, 'eth1/1'), end(leaf, 'eth1/1'));
    const issues = check(portReuseRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.targets).toEqual([{ kind: 'component', id: leaf.id, portId: 'eth1/1' }, { kind: 'link', id: link.id }]);
    expect(issues[0]!.message).not.toContain('2 links');
  });

  it('missing optic: one bare end of a fibre link warns once even when the port is on several links', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1');
    const s1 = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-sr' } });
    const s2 = addComponent(p, SERVER_1U, 'SRV2', { optics: { eth0: 'xcvr.25g-sr' } });
    connect(p, end(leaf, 'eth1/1'), end(s1, 'eth0'), 'cbl.om4-duplex');
    connect(p, end(leaf, 'eth1/1'), end(s2, 'eth0'), 'cbl.om4-duplex');
    const issues = check(missingOpticRule, p);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe('SW1:eth1/1: no optic on SFP28 port');
  });

  it('missing optic: an SFP28 cage on a Cat6A link still needs its copper optic', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1');
    const mgmt = addComponent(p, MGMT_SWITCH, 'SW2');
    connect(p, end(leaf, 'eth1/1'), end(mgmt, 'ge1'), 'cbl.cat6a');
    const issues = check(missingOpticRule, p);
    expect(issues).toHaveLength(1);
    expect(hasTarget(issues[0]!, 'component', leaf.id, 'eth1/1')).toBe(true);
  });

  it('missing optic: a DAC link with an unknown cable id is not treated as integrated', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1');
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(leaf, 'eth1/1'), end(srv, 'eth0'), 'cbl.dac-nope');
    expect(check(missingOpticRule, p)).toHaveLength(2);
  });

  it('single-homed: a GPU server with data links but no fabric links has no uplinks', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1');
    const gpu = addComponent(p, GPU_SERVER, 'SRV1');
    connect(p, end(leaf, 'eth1/49'), end(gpu, 'eth0'), 'cbl.dac-100g');
    connect(p, end(leaf, 'eth1/50'), end(gpu, 'eth1'), 'cbl.dac-100g');
    const issues = byRule(run(p), 'single-homed-server');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toBe('SRV1 has no uplinks connected (expects 8)');
  });
});

describe('severity overrides and ignore', () => {
  it("setting every rule to 'ignore' silences a design full of problems", () => {
    const p = buildBadDesign();
    expect(run(p).length).toBeGreaterThan(5);
    for (const r of ercRules) p.settings.ercSeverities[r.id] = 'ignore';
    expect(run(p)).toEqual([]);
  });

  it('an override restamps severity without changing ids or messages, and never mutates the rule', () => {
    const p = buildBadDesign();
    const before = run(p);
    p.settings.ercSeverities['port-reuse'] = 'info';
    p.settings.ercSeverities['missing-optic'] = 'error';
    p.settings.ercSeverities['media-mismatch'] = 'warning';
    const after = run(p);

    expect(ercRuleById.get('port-reuse')!.defaultSeverity).toBe('error');
    expect(ercRuleById.get('missing-optic')!.defaultSeverity).toBe('warning');
    expect(new Set(after.map((i) => i.id))).toEqual(new Set(before.map((i) => i.id)));
    const byId = new Map(before.map((i) => [i.id, i]));
    for (const i of after) {
      const prev = byId.get(i.id)!;
      expect(i.message).toBe(prev.message);
      expect(i.targets).toEqual(prev.targets);
      const expected = { 'port-reuse': 'info', 'missing-optic': 'error', 'media-mismatch': 'warning' }[i.rule] ?? prev.severity;
      expect(i.severity).toBe(expected);
    }
    // Overridden rules sort by their effective severity.
    const ranks = after.map((i) => ({ error: 0, warning: 1, info: 2, ignore: 3 })[i.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    // The overridden port-reuse issue now sits in the trailing info block. Order
    // within one severity is by message (the spec leaves it open), so it need not be last.
    const firstInfo = after.findIndex((i) => i.severity === 'info');
    expect(firstInfo).toBeGreaterThan(0);
    expect(after.slice(firstInfo).map((i) => i.rule)).toContain('port-reuse');
  });

  it('runErc does not mutate the issue objects a rule returned', () => {
    const p = buildBadDesign();
    const idx = new ProjectIndex(p);
    p.settings.ercSeverities['port-reuse'] = 'warning';
    const raw = portReuseRule.check(p, idx);
    expect(raw.every((i) => i.severity === 'error')).toBe(true);
    runErc(p, idx);
    expect(raw.every((i) => i.severity === 'error')).toBe(true);
  });

  it("'ignore' on one rule leaves the others untouched", () => {
    const p = buildBadDesign();
    const before = run(p);
    p.settings.ercSeverities['port-reuse'] = 'ignore';
    const after = run(p);
    expect(byRule(after, 'port-reuse')).toEqual([]);
    expect(after).toEqual(before.filter((i) => i.rule !== 'port-reuse'));
  });

  it('an override for an unknown rule id is harmless', () => {
    const p = buildBadDesign();
    const before = run(p);
    p.settings.ercSeverities['no-such-rule'] = 'ignore';
    expect(run(p)).toEqual(before);
  });
});

describe('issue id stability', () => {
  it('ids are unique within a run and identical across runs on a bad design', () => {
    const p = buildBadDesign();
    const a = run(p);
    const b = run(p);
    expect(a.map((i) => i.id)).toEqual(b.map((i) => i.id));
    expect(new Set(a.map((i) => i.id)).size).toBe(a.length);
    expect(new Set(a.map((i) => i.rule))).toEqual(new Set(ercRules.map((r) => r.id)));
    for (const i of a) expect(i.id.startsWith(`erc.${i.rule}.`)).toBe(true);
  });

  it('ids survive re-annotation (refs change, messages change, ids do not)', () => {
    const p = buildBadDesign();
    const before = run(p);
    p.components.forEach((c, i) => (c.ref = `X${i}`));
    const after = run(p);
    expect(new Set(after.map((i) => i.id))).toEqual(new Set(before.map((i) => i.id)));
    expect(after.map((i) => i.message)).not.toEqual(before.map((i) => i.message));
  });

  it('ids survive reordering of links and components', () => {
    const p = buildBadDesign();
    const before = new Set(run(p).map((i) => i.id));
    p.links.reverse();
    p.components.reverse();
    expect(new Set(run(p).map((i) => i.id))).toEqual(before);
  });

  it('ids do not depend on which way round a link was drawn for symmetric problems', () => {
    const make = (flip: boolean) => {
      const p = createProject();
      const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/1': 'xcvr.25g-sr' } });
      const srv = addComponent(p, SERVER_1U, 'SRV1', { optics: { eth0: 'xcvr.25g-lr' } });
      return { p, leaf, srv, flip };
    };
    const x = make(false);
    const y = make(true);
    // Same component/link ids in both projects so the hashes are comparable.
    y.leaf.id = x.leaf.id;
    y.srv.id = x.srv.id;
    const lx = connect(x.p, end(x.leaf, 'eth1/1'), end(x.srv, 'eth0'), 'cbl.om4-duplex');
    const ly = connect(y.p, end(y.srv, 'eth0'), end(y.leaf, 'eth1/1'), 'cbl.om4-duplex');
    ly.id = lx.id;
    expect(new Set(run(y.p).map((i) => i.id))).toEqual(new Set(run(x.p).map((i) => i.id)));
  });

  it('touching an unrelated link keeps existing ids', () => {
    const p = buildBadDesign();
    const before = run(p).map((i) => i.id);
    const extraLeaf = addComponent(p, LEAF, 'SW9');
    const extraSpine = addComponent(p, SPINE, 'SW10');
    connect(p, end(extraLeaf, 'eth1/49'), end(extraSpine, 'eth1/4'), 'cbl.aoc-100g');
    const after = run(p).map((i) => i.id);
    for (const id of before) expect(after).toContain(id);
  });

  it('a port-reuse issue keeps its id while its lane conflicts are unchanged', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1');
    const s1 = addComponent(p, SERVER_1U, 'SRV1');
    const s2 = addComponent(p, SERVER_1U, 'SRV2');
    connect(p, end(leaf, 'eth1/49', 0), end(s1, 'eth0'));
    connect(p, end(leaf, 'eth1/49', 0), end(s2, 'eth0'));
    const before = check(portReuseRule, p)[0]!.id;
    leaf.optics['eth1/49'] = 'xcvr.100g-sr4';
    s1.optics.eth0 = 'xcvr.25g-sr';
    expect(check(portReuseRule, p)[0]!.id).toBe(before);
  });
});

describe('robustness', () => {
  it('dangling component ids, unknown cables and unknown symbols do not crash', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1');
    connect(p, end(leaf, 'eth1/1'), { componentId: 'ghost', portId: 'eth0' }, 'cbl.nope');
    connect(p, { componentId: 'ghost', portId: 'eth0' }, { componentId: 'ghost2', portId: 'eth0' });
    p.components.push({ ...leaf, id: 'weird', ref: 'W1', symbolDefId: 'sym.nope', footprintDefId: 'fp.nope', optics: {} });
    const issues = run(p);
    expect(issues.some((i) => i.rule === 'unassigned-model' && hasTarget(i, 'component', 'weird'))).toBe(true);
    expect(issues.some((i) => i.rule === 'missing-optic' && hasTarget(i, 'component', leaf.id, 'eth1/1'))).toBe(true);
  });

  it('a link on a port the symbol does not have is silently skipped by the port rules', () => {
    const p = createProject();
    const leaf = addComponent(p, LEAF, 'SW1', { optics: { 'eth1/99': 'xcvr.25g-sr' } });
    const srv = addComponent(p, SERVER_1U, 'SRV1');
    connect(p, end(leaf, 'eth1/99'), end(srv, 'eth0'), 'cbl.om4-duplex');
    expect(() => run(p)).not.toThrow();
  });
});
