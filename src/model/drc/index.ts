/**
 * DRC: physical-layout checks. Each rule is a pure function of the project;
 * `runDrc` applies the project's severity overrides and stamps issue ids.
 */
import type { Issue, Project } from '../types';
import type { DrcRule } from './rule';
import { bendRadius } from './rules/bend-radius';
import { clearance } from './rules/clearance';
import { managerOverfill } from './rules/manager-overfill';
import { missingManager } from './rules/missing-manager';
import { missingWaterfall } from './rules/missing-waterfall';
import { outOfSync } from './rules/out-of-sync';
import { reachExceeded } from './rules/reach-exceeded';
import { trayClearance } from './rules/tray-clearance';
import { trayMedia } from './rules/tray-media';
import { trayOverfill } from './rules/tray-overfill';
import { uCollision } from './rules/u-collision';
import { unplacedComponent } from './rules/unplaced-component';
import { unroutedLink } from './rules/unrouted-link';
import { wrongFace } from './rules/wrong-face';

export type { DrcFinding, DrcRule } from './rule';
export { defineRule } from './rule';

export const drcRules: readonly DrcRule[] = [
  uCollision,
  unplacedComponent,
  unroutedLink,
  reachExceeded,
  trayOverfill,
  bendRadius,
  clearance,
  wrongFace,
  outOfSync,
  trayMedia,
  missingManager,
  managerOverfill,
  missingWaterfall,
  trayClearance,
];

export const drcRuleById = (id: string): DrcRule | undefined => drcRules.find((r) => r.id === id);

/** Effective severity of a rule for a project (settings override the default). */
export function drcSeverity(project: Project, rule: DrcRule): Issue['severity'] {
  return project.settings.drcSeverities[rule.id] ?? rule.defaultSeverity;
}

/** Run every DRC rule; rules set to 'ignore' are skipped. */
export function runDrc(project: Project, rules: readonly DrcRule[] = drcRules): Issue[] {
  const issues: Issue[] = [];
  for (const rule of rules) {
    const severity = drcSeverity(project, rule);
    if (severity === 'ignore') continue;
    rule.check(project).forEach((f, i) => {
      issues.push({
        id: `${rule.id}:${f.key ?? i}`,
        rule: rule.id,
        severity,
        message: f.message,
        targets: f.targets,
        domain: 'drc',
      });
    });
  }
  return issues;
}
