/**
 * Rule shape shared by every DRC check. A rule is a pure function of the
 * project returning findings; `runDrc` stamps ids and the effective severity.
 */
import type { IssueTarget, Project, Severity } from '../types';

export interface DrcFinding {
  message: string;
  targets: IssueTarget[];
  /** Stable suffix for the issue id (defaults to the finding's index). */
  key?: string;
}

export interface DrcRule {
  /** Kebab-case id, also the key in `settings.drcSeverities`. */
  id: string;
  name: string;
  description: string;
  defaultSeverity: Severity;
  domain: 'drc';
  check: (project: Project) => DrcFinding[];
}

export const defineRule = (rule: Omit<DrcRule, 'domain'>): DrcRule => ({ ...rule, domain: 'drc' });
