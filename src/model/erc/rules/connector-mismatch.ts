import { portKey, type ProjectIndex } from '@/model/query';
import type { CableDef, Component, Issue, Link, LinkEnd, PortType } from '@/model/types';
import { componentTarget, ercIssue, linkTarget, type Rule } from '../rule';
import { assignedOptic, isIntegratedCable, normalizeConnector, portTypeOf } from '../helpers';

/** Ports that are a fixed connector rather than a pluggable cage. */
const FIXED_CONNECTOR: Partial<Record<PortType, string>> = {
  RJ45: 'RJ45',
  LC: 'LC',
  'MPO-12': 'MPO-12',
};

/**
 * What the cable must plug into at a port: the optic's connector, or the
 * fixed port connector. `describe` is the human phrase for messages.
 */
export function expectedConnectorAt(
  idx: ProjectIndex,
  c: Component,
  portId: string,
): { connector: string; describe: string } | undefined {
  const optic = assignedOptic(idx, c, portId);
  if (optic) return { connector: optic.connector, describe: `${optic.name} (${optic.connector})` };
  const type = portTypeOf(idx, c, portId);
  const fixed = type ? FIXED_CONNECTOR[type] : undefined;
  if (type && fixed) return { connector: fixed, describe: `${type} port` };
  return undefined;
}

function expectedAtEnd(idx: ProjectIndex, end: LinkEnd): ReturnType<typeof expectedConnectorAt> {
  const c = idx.component(end.componentId);
  return c ? expectedConnectorAt(idx, c, end.portId) : undefined;
}

const isTrunkConnector = (connector: string): boolean => normalizeConnector(connector).startsWith('MPO');

/** A DAC / AOC end is an integrated transceiver and has no connector to match. */
const isIntegratedEnd = (connector: string): boolean => normalizeConnector(connector) === 'INTEGRATED';

/** Whether a cable end connector is acceptable where `expected` (if anything) is required. */
const fits = (cableEnd: string, expected: string | undefined): boolean =>
  expected === undefined || isIntegratedEnd(cableEnd) || normalizeConnector(cableEnd) === normalizeConnector(expected);

/**
 * Cable end connectors for [a, b]. A cable has no direction of its own: which
 * of its two ends lands where is decided by what they plug into, never by the
 * way the link was drawn. A symmetric cable is returned as is; an asymmetric
 * one (an MPO-12 -> LC breakout, say) is oriented:
 *
 * - a breakout's MPO trunk end belongs to the parent (lane) end of the link
 *   and its fanout leg to the other end;
 * - otherwise the orientation that fits the connectors `expected` at [a, b]
 *   with the fewest mismatches wins, and a tie is broken by port key, so the
 *   result (and the issue ids) is the same whichever way round the link is.
 */
export function cableEndsFor(
  cable: CableDef,
  link: Link,
  expected: readonly [string | undefined, string | undefined] = [undefined, undefined],
): [string, string] {
  const asDrawn: [string, string] = [cable.endA, cable.endB];
  if (normalizeConnector(cable.endA) === normalizeConnector(cable.endB)) return asDrawn;

  const aIsLane = link.a.lane !== undefined;
  const bIsLane = link.b.lane !== undefined;
  if (cable.breakout && aIsLane !== bIsLane) {
    const trunkIsA = isTrunkConnector(cable.endA);
    const trunkIsB = isTrunkConnector(cable.endB);
    if (trunkIsA !== trunkIsB) {
      const trunk = trunkIsA ? cable.endA : cable.endB;
      const leg = trunkIsA ? cable.endB : cable.endA;
      return aIsLane ? [trunk, leg] : [leg, trunk];
    }
  }

  const flipped: [string, string] = [cable.endB, cable.endA];
  const misfits = (ends: [string, string]): number =>
    (fits(ends[0], expected[0]) ? 0 : 1) + (fits(ends[1], expected[1]) ? 0 : 1);
  const delta = misfits(asDrawn) - misfits(flipped);
  if (delta !== 0) return delta < 0 ? asDrawn : flipped;
  return portKey(link.a) <= portKey(link.b) ? asDrawn : flipped;
}

/**
 * A cable end's connector does not match what is at that end of the link:
 * the assigned optic's connector, or the fixed connector of an RJ45 / LC /
 * MPO port. DAC / AOC ends are integrated and have nothing to match.
 */
export const connectorMismatchRule: Rule = {
  id: 'connector-mismatch',
  name: 'Connector mismatch',
  defaultSeverity: 'error',
  check(project, idx) {
    const issues: Issue[] = [];
    for (const link of project.links) {
      const cable = idx.cableOf(link);
      if (!cable || isIntegratedCable(cable)) continue;
      const ends = [link.a, link.b] as const;
      const expected = [expectedAtEnd(idx, link.a), expectedAtEnd(idx, link.b)] as const;
      const cableEnds = cableEndsFor(cable, link, [expected[0]?.connector, expected[1]?.connector]);
      for (const i of [0, 1] as const) {
        const end = ends[i];
        const exp = expected[i];
        const cableEnd = cableEnds[i];
        if (!exp || fits(cableEnd, exp.connector)) continue;
        issues.push(
          ercIssue(connectorMismatchRule, `${idx.endLabel(end)}: ${cable.name} ${cableEnd} end on ${exp.describe}`, [
            componentTarget(end.componentId, end.portId),
            linkTarget(link.id),
          ]),
        );
      }
    }
    return issues;
  },
};
