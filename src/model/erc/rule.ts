/**
 * ERC rule contract and issue helpers.
 *
 * A rule is a pure function over a Project (plus its memoised index) that
 * returns Issues. Issue ids are stable hashes of the rule id and the target
 * keys, so the UI can keep selection / dismissal state across re-runs.
 */
import type { ProjectIndex } from '@/model/query';
import type { Id, Issue, IssueTarget, Project, Severity } from '@/model/types';

export interface Rule {
  /** Kebab-case id, e.g. 'port-reuse'. Also the key in `settings.ercSeverities`. */
  id: string;
  name: string;
  defaultSeverity: Severity;
  check(project: Project, idx: ProjectIndex): Issue[];
}

function fnv1a(s: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic 64-bit-ish hex digest of a string (two FNV-1a passes with different seeds). */
export function hashKey(s: string): string {
  const a = fnv1a(s, 0x811c9dc5).toString(16).padStart(8, '0');
  const b = fnv1a(s, 0x9747b28c).toString(16).padStart(8, '0');
  return a + b;
}

/** Canonical key of a target: 'component:<id>[:<portId>]', 'link:<id>', ... */
export function targetKey(t: IssueTarget): string {
  if (t.kind === 'component' && t.portId !== undefined) return `component:${t.id}:${t.portId}`;
  return `${t.kind}:${t.id}`;
}

/** Stable issue id from a rule id and an ordered list of key parts. */
export function issueId(ruleId: string, keys: readonly string[]): string {
  return `erc.${ruleId}.${hashKey([ruleId, ...keys].join('|'))}`;
}

/**
 * Build an ERC issue for `rule`. The id is derived from `keys` when given,
 * otherwise from the sorted target keys; pass explicit keys when the target
 * list may vary while the underlying problem is the same (e.g. a list of free
 * ports), or when several distinct issues share the same targets.
 */
export function ercIssue(rule: Rule, message: string, targets: IssueTarget[], keys?: readonly string[]): Issue {
  const k = keys ?? targets.map(targetKey).sort();
  return {
    id: issueId(rule.id, k),
    rule: rule.id,
    severity: rule.defaultSeverity,
    message,
    targets,
    domain: 'erc',
  };
}

export const componentTarget = (id: Id, portId?: string): IssueTarget =>
  portId === undefined ? { kind: 'component', id } : { kind: 'component', id, portId };

export const linkTarget = (id: Id): IssueTarget => ({ kind: 'link', id });
