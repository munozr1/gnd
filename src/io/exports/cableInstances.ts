/**
 * Shared readers for installed cables (`Project.cables`) in the lists: the
 * cables in a stable order, what each leg carries and where it lands, a
 * one-line summary per side and the length. A cable owns its links, so the
 * plain-link readers (`plainLinks`) skip those and the cable appears once,
 * as one row plus one sub-row per leg.
 */
import { resolveCable, sideChannels, type ResolvedCable } from '@/model/cables';
import { indexProject, type ProjectIndex } from '@/model/query';
import type { Cable, CableDef, Project } from '@/model/types';
import { endLabel, lengthInfo, naturalCompare, portInfo, type EndInfo } from './common';

export type CableSide = 'A' | 'B';

export interface CableLegInfo {
  side: CableSide;
  /** 0-based leg index (as in `CablePlug.leg`). */
  leg: number;
  /** 'A', 'B', … for multi-fiber legs, '1', '2', … for small ones. */
  label: string;
  /** Connector catalog id, e.g. 'LC-duplex'. */
  connector: string;
  /** 'PP1:f1'; '' while the leg is unassigned. */
  port: string;
  end: EndInfo | null;
  /** Fiber positions (1-based) of the leg's connector that the cable uses. */
  positions: number[];
  /** 1-based indices of the cable's channels this leg carries (a channel is one Tx/Rx pair). */
  channels: number[];
}

export interface CableSideInfo {
  side: CableSide;
  connector: string;
  legs: CableLegInfo[];
  /** 'MPO-8 → SW1:eth1/50', '4×LC-duplex → PP1:f1–f4 (1 unassigned)'. */
  summary: string;
  /** 'SW1:eth1/50', 'PP1:f1–f4'; 'unassigned' when nothing is plugged. */
  ports: string;
  /** The same without device refs ('eth1/50', 'f1–f4'); '' when nothing is plugged. */
  portLabels: string;
  /** Location of the first plugged leg: the rack / U / ref the side lands in. */
  first: EndInfo | null;
}

export interface CableLengthInfo {
  lengthM: number | null;
  /** 'declared' (Cable.lengthM), 'routed' (jacket route), 'estimated' (unrouted), '' (an end is unplaced). */
  basis: 'declared' | 'routed' | 'estimated' | '';
}

export interface InstalledCable {
  cable: Cable;
  def: CableDef | undefined;
  /** Undefined when the definition is missing or does not resolve (the rows then fall back to its name / id). */
  resolved: ResolvedCable | undefined;
  /** '8F OM4 MPO-8 → 4×LC-duplex' (`cableDisplayName`), else the definition's name, else its id. */
  name: string;
  fiberCount: number | null;
  channels: number | null;
  kind: 'straight' | 'trunk' | '';
  sideA: CableSideInfo;
  sideB: CableSideInfo;
  legs: CableLegInfo[];
  length: CableLengthInfo;
}

/** '1-4, 9-12' — sorted numbers with runs collapsed to ASCII ranges (easy to parse back). */
export function compactNumbers(values: readonly number[]): string {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    parts.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return parts.join(', ');
}

const PORT_NUMBER = /^(.*?)(\d+)$/;

/**
 * 'PP1:f1–f4, PP1:f7, SW1:eth1/49' — port labels in leg order, consecutive
 * ports on one device collapsed to a range ('f1–f4' means f1, f2, f3, f4).
 * `withRef: false` drops the device refs ('f1–f4, f7') for a column that
 * already names the device.
 */
export function compactPorts(ends: readonly Pick<EndInfo, 'ref' | 'portLabel'>[], opts: { withRef?: boolean } = {}): string {
  const label = (e: Pick<EndInfo, 'ref' | 'portLabel'>): string => (opts.withRef === false ? e.portLabel : endLabel(e));
  const parts: string[] = [];
  for (let i = 0; i < ends.length; ) {
    const first = ends[i]!;
    const m = PORT_NUMBER.exec(first.portLabel);
    let j = i;
    if (m) {
      let n = Number(m[2]);
      while (j + 1 < ends.length) {
        const next = ends[j + 1]!;
        const nm = PORT_NUMBER.exec(next.portLabel);
        if (!nm || next.ref !== first.ref || nm[1] !== m[1] || Number(nm[2]) !== n + 1) break;
        n++;
        j++;
      }
    }
    parts.push(j > i ? `${label(first)}–${ends[j]!.portLabel}` : label(first));
    i = j + 1;
  }
  return parts.join(', ');
}

/** The channel numbers (1-based) each leg of each side carries, following the strand map like `deriveCableLinks`. */
function legChannels(resolved: ResolvedCable): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const push = (side: CableSide, leg: number, channel: number): void => {
    const key = `${side}${leg}`;
    const list = out.get(key);
    if (!list) out.set(key, [channel]);
    else if (!list.includes(channel)) list.push(channel);
  };
  const aToB = new Map<string, { leg: number; pos: number }>();
  for (const link of resolved.strandMap) aToB.set(`${link.a.leg}:${link.a.pos}`, link.b);
  sideChannels(resolved.sideA).forEach((ch, i) => {
    const channel = i + 1;
    push('A', ch.leg, channel);
    for (const slot of ch.slots) {
      const b = aToB.get(`${slot.leg}:${slot.pos}`);
      if (b) push('B', b.leg, channel);
    }
  });
  return out;
}

function sideInfo(side: CableSide, connector: string, legs: CableLegInfo[]): CableSideInfo {
  const plugged = legs.filter((l) => l.end !== null);
  const unassigned = legs.length - plugged.length;
  const ports = plugged.length === 0 ? 'unassigned' : compactPorts(plugged.map((l) => l.end!));
  const legsLabel = legs.length === 1 ? connector : `${legs.length}×${connector}`;
  const suffix = plugged.length > 0 && unassigned > 0 ? ` (${unassigned} unassigned)` : '';
  return {
    side,
    connector,
    legs,
    summary: `${legsLabel} → ${ports}${suffix}`,
    ports,
    portLabels: compactPorts(
      plugged.map((l) => l.end!),
      { withRef: false },
    ),
    first: plugged[0]?.end ?? null,
  };
}

/** Declared length first, else the jacket route's standard length, else the unrouted estimate. */
export function cableLength(project: Project, cable: Cable): CableLengthInfo {
  if (cable.lengthM !== undefined && Number.isFinite(cable.lengthM)) return { lengthM: cable.lengthM, basis: 'declared' };
  const len = lengthInfo(project, cable.id);
  return { lengthM: len.standardM, basis: len.basis };
}

export function installedCable(project: Project, cable: Cable, idx: ProjectIndex = indexProject(project)): InstalledCable {
  const def = idx.catalog.cable(cable.cableDefId);
  const r = def ? resolveCable(def) : undefined;
  const resolved = r && !('error' in r) ? r : undefined;
  const channels = resolved ? legChannels(resolved) : new Map<string, number[]>();
  const legs: CableLegInfo[] = [];
  for (const side of ['A', 'B'] as const) {
    const resolvedSide = resolved ? (side === 'A' ? resolved.sideA : resolved.sideB) : undefined;
    const plugs = cable.plugs.filter((p) => p.side === side).sort((x, y) => x.leg - y.leg);
    for (const plug of plugs) {
      const leg = resolvedSide?.legs[plug.leg];
      const end = plug.componentId !== null && plug.portId !== null ? portInfo(project, { componentId: plug.componentId, portId: plug.portId }, idx, def) : null;
      legs.push({
        side,
        leg: plug.leg,
        label: leg?.label ?? String(plug.leg + 1),
        connector: resolvedSide?.connector ?? '',
        port: end ? endLabel(end) : '',
        end,
        positions: leg ? [...leg.positions] : [],
        channels: channels.get(`${side}${plug.leg}`) ?? [],
      });
    }
  }
  return {
    cable,
    def,
    resolved,
    name: resolved?.displayName ?? def?.name ?? cable.cableDefId,
    fiberCount: resolved?.fiberCount ?? null,
    channels: resolved?.channels ?? null,
    kind: resolved?.kind ?? '',
    sideA: sideInfo('A', resolved?.sideA.connector ?? '', legs.filter((l) => l.side === 'A')),
    sideB: sideInfo('B', resolved?.sideB.connector ?? '', legs.filter((l) => l.side === 'B')),
    legs,
    length: cableLength(project, cable),
  };
}

/** Every installed cable, by label (natural order) then id. */
export function installedCables(project: Project, idx: ProjectIndex = indexProject(project)): InstalledCable[] {
  return [...project.cables]
    .sort((x, y) => naturalCompare(x.label, y.label) || naturalCompare(x.id, y.id))
    .map((c) => installedCable(project, c, idx));
}
