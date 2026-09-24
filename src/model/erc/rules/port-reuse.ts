import type { Issue, IssueTarget, Link, LinkEnd } from '@/model/types';
import { componentTarget, ercIssue, linkTarget, targetKey, type Rule } from '../rule';
import { endsOf, portOfEnd } from '../helpers';

interface Entry {
  link: Link;
  end: LinkEnd;
}

function uniqueLinkTargets(entries: readonly Entry[]): IssueTarget[] {
  const seen = new Set<string>();
  const out: IssueTarget[] = [];
  for (const e of entries) {
    if (seen.has(e.link.id)) continue;
    seen.add(e.link.id);
    out.push(linkTarget(e.link.id));
  }
  return out;
}

/** Message for a port / lane that `links` distinct links land on (one link means both of its ends do). */
const onLinks = (label: string, links: number): string =>
  links === 1 ? `${label} is on both ends of the same link` : `${label} is on ${links} links`;

/**
 * A port or breakout lane appears on more than one link end. A whole-port
 * link (no lane) occupies every lane, so it also conflicts with any lane link
 * on the same port; distinct lanes of one port do not conflict. A link with
 * both ends on the same port (a self-loop) is reported once, against that
 * one link.
 */
export const portReuseRule: Rule = {
  id: 'port-reuse',
  name: 'Port reuse',
  defaultSeverity: 'error',
  check(project, idx) {
    const byPort = new Map<string, Entry[]>();
    for (const link of project.links) {
      for (const end of endsOf(link)) {
        const key = `${end.componentId}/${end.portId}`;
        const arr = byPort.get(key);
        if (arr) arr.push({ link, end });
        else byPort.set(key, [{ link, end }]);
      }
    }

    const issues: Issue[] = [];
    for (const entries of byPort.values()) {
      if (entries.length < 2) continue;
      const port = portOfEnd(entries[0]!.end);
      const portTarget = componentTarget(port.componentId, port.portId);
      const label = idx.endLabel(port);
      const whole = entries.filter((e) => e.end.lane === undefined);
      const laned = entries.filter((e) => e.end.lane !== undefined);

      if (whole.length > 1) {
        const links = uniqueLinkTargets(whole);
        issues.push(
          ercIssue(portReuseRule, onLinks(label, links.length), [portTarget, ...links], [
            targetKey(portTarget),
            ...links.map(targetKey).sort(),
          ]),
        );
      }

      if (whole.length >= 1 && laned.length >= 1) {
        const links = uniqueLinkTargets(entries);
        issues.push(
          ercIssue(
            portReuseRule,
            `${label} is used both as a whole port and as breakout lanes`,
            [portTarget, ...links],
            [targetKey(portTarget), 'whole-vs-lane', ...links.map(targetKey).sort()],
          ),
        );
      }

      const byLane = new Map<number, Entry[]>();
      for (const e of laned) {
        const lane = e.end.lane!;
        const arr = byLane.get(lane);
        if (arr) arr.push(e);
        else byLane.set(lane, [e]);
      }
      for (const [lane, group] of [...byLane.entries()].sort((x, y) => x[0] - y[0])) {
        if (group.length < 2) continue;
        const links = uniqueLinkTargets(group);
        issues.push(
          ercIssue(
            portReuseRule,
            onLinks(idx.endLabel({ ...port, lane }), links.length),
            [portTarget, ...links],
            [targetKey(portTarget), `lane:${lane}`, ...links.map(targetKey).sort()],
          ),
        );
      }
    }
    return issues;
  },
};
