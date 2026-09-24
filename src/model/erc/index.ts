/**
 * ERC: electrical rule checks over the logical (schematic) design.
 *
 * `runErc(project)` runs every rule, applies the project's per-rule severity
 * overrides and returns the issues sorted error -> warning -> info, then by
 * message. Pure; safe to call from a debounced selector.
 */
import { indexProject, type ProjectIndex } from '@/model/query';
import type { Issue, Project, Severity } from '@/model/types';
import type { Rule } from './rule';
import { connectorMismatchRule } from './rules/connector-mismatch';
import { formFactorMismatchRule } from './rules/form-factor-mismatch';
import { mediaMismatchRule } from './rules/media-mismatch';
import { missingOpticRule } from './rules/missing-optic';
import { portReuseRule } from './rules/port-reuse';
import { singleHomedServerRule } from './rules/single-homed-server';
import { speedMismatchRule } from './rules/speed-mismatch';
import { unassignedModelRule } from './rules/unassigned-model';
import { unconnectedUplinksRule } from './rules/unconnected-uplinks';

export type { Rule } from './rule';
export { componentTarget, ercIssue, hashKey, issueId, linkTarget, targetKey } from './rule';
export {
  connectorMismatchRule,
  formFactorMismatchRule,
  mediaMismatchRule,
  missingOpticRule,
  portReuseRule,
  singleHomedServerRule,
  speedMismatchRule,
  unassignedModelRule,
  unconnectedUplinksRule,
};

/** All ERC rules, in the order the spec lists them. */
export const ercRules: readonly Rule[] = [
  portReuseRule,
  formFactorMismatchRule,
  speedMismatchRule,
  mediaMismatchRule,
  connectorMismatchRule,
  missingOpticRule,
  unassignedModelRule,
  singleHomedServerRule,
  unconnectedUplinksRule,
];

export const ercRuleById: ReadonlyMap<string, Rule> = new Map(ercRules.map((r) => [r.id, r]));

/** Severity a rule runs at in this project: the override in settings, else the rule default. */
export function ercSeverity(project: Project, rule: Rule): Severity {
  return project.settings.ercSeverities[rule.id] ?? rule.defaultSeverity;
}

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2, ignore: 3 };

/** Sort order for the issues drawer: severity first, then message, then id for stability. */
export function compareIssues(a: Issue, b: Issue): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Run every ERC rule. Rules set to 'ignore' are skipped; other overrides restamp the severity. */
export function runErc(project: Project, idx: ProjectIndex = indexProject(project)): Issue[] {
  const out: Issue[] = [];
  for (const rule of ercRules) {
    const severity = ercSeverity(project, rule);
    if (severity === 'ignore') continue;
    for (const issue of rule.check(project, idx)) {
      out.push(issue.severity === severity ? issue : { ...issue, severity });
    }
  }
  return out.sort(compareIssues);
}
