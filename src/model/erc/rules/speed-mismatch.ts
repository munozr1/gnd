import type { Issue, LinkEnd, TransceiverDef } from '@/model/types';
import { componentTarget, ercIssue, linkTarget, type Rule } from '../rule';
import { formatGbps } from '../helpers';

/** Speed a link end runs at: the transceiver speed, or one lane of it on a breakout end. */
export function endSpeedGbps(xcvr: TransceiverDef, end: LinkEnd): number {
  if (end.lane === undefined) return xcvr.speedGbps;
  return xcvr.speedGbps / Math.max(1, xcvr.lanes);
}

/**
 * The effective transceivers (assigned optic or integrated DAC/AOC) at the
 * two ends of a link run at different speeds. A breakout end contributes one
 * lane's worth of its parent speed, so 100G-SR4 lane -> 25G-SR is fine.
 */
export const speedMismatchRule: Rule = {
  id: 'speed-mismatch',
  name: 'Speed mismatch',
  defaultSeverity: 'error',
  check(project, idx) {
    const issues: Issue[] = [];
    for (const link of project.links) {
      const ta = idx.transceiverAt(link, link.a);
      const tb = idx.transceiverAt(link, link.b);
      if (!ta || !tb) continue;
      const sa = endSpeedGbps(ta, link.a);
      const sb = endSpeedGbps(tb, link.b);
      if (sa === sb) continue;
      issues.push(
        ercIssue(
          speedMismatchRule,
          `${idx.endLabel(link.a)} (${formatGbps(sa)}) — ${idx.endLabel(link.b)} (${formatGbps(sb)}): speeds differ`,
          [
            linkTarget(link.id),
            componentTarget(link.a.componentId, link.a.portId),
            componentTarget(link.b.componentId, link.b.portId),
          ],
        ),
      );
    }
    return issues;
  },
};
