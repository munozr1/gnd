/**
 * Pure helpers shared by the cable ERC / DRC rules
 * (src/model/erc/rules/cable-*, src/model/drc/rules/cable-*): what is wrong
 * with an installed cable's definition, every leg with its plug, what a port
 * offers a leg, how many fibers are in service and how far the jacket
 * reaches. No React / Konva / Three.
 */
import { isPluggableCage, type ProjectIndex } from '../query';
import { routedLengthM } from '../routing/length';
import type { Cable, CablePlug, Component, Id, IssueTarget, Project } from '../types';
import type { PortConnectorView } from './connectors';
import type { Leg } from './deriveSides';
import { deriveCableLinks, type CableSide } from './instances';
import { resolveCable, validateCableDef, type ResolvedCable } from './resolve';

export const cableTarget = (id: Id): IssueTarget => ({ kind: 'cable', id });

/**
 * Everything wrong with the definition an installed cable references, as
 * user-facing messages: the definition is missing from the catalog, or
 * `validateCableDef` finds a problem (a fiber count that does not split
 * evenly, an unknown connector, a custom strand map that is not a
 * bijection, …). Empty when the definition is sound.
 */
export function cableDefProblems(idx: ProjectIndex, cable: Cable): string[] {
  const def = idx.catalog.cable(cable.cableDefId);
  if (!def) return [`Cable definition "${cable.cableDefId}" is not in the catalog.`];
  return validateCableDef(def);
}

/**
 * The resolved definition of an installed cable, or undefined when it is
 * missing or does not resolve (the cable-def-invalid rule reports those; the
 * other rules skip the cable because its legs are unknown).
 */
export function resolveCableWith(idx: ProjectIndex, cable: Cable): ResolvedCable | undefined {
  const def = idx.catalog.cable(cable.cableDefId);
  if (!def) return undefined;
  const r = resolveCable(def);
  return 'error' in r ? undefined : r;
}

/** 'side B leg 3' on a side that fans out, 'side A' on a side with a single leg. */
export function legName(legsOnSide: number, side: CableSide, leg: Leg): string {
  return legsOnSide === 1 ? `side ${side}` : `side ${side} leg ${leg.label}`;
}

export interface CableLegView {
  side: CableSide;
  leg: Leg;
  /** Connector id of the side ('LC-duplex', 'MPO-8', …). */
  connector: string;
  /** The stored plug; undefined when the instance predates a leg of its definition. */
  plug: CablePlug | undefined;
  /** See `legName`. */
  name: string;
}

/** Every leg of both sides, side A first, in leg order, each with its plug. */
export function cableLegViews(resolved: ResolvedCable, cable: Cable): CableLegView[] {
  const out: CableLegView[] = [];
  for (const side of ['A', 'B'] as const) {
    const sideDef = side === 'A' ? resolved.sideA : resolved.sideB;
    for (const leg of sideDef.legs) {
      out.push({
        side,
        leg,
        connector: sideDef.connector,
        plug: cable.plugs.find((p) => p.side === side && p.leg === leg.index),
        name: legName(sideDef.legs.length, side, leg),
      });
    }
  }
  return out;
}

export interface PortOffer {
  component: Component;
  /** The port as `portAcceptsConnector` sees it. */
  view: PortConnectorView;
  /** 'MPO-12 port', 'LC port', 'empty QSFP28 cage', '100G DAC DAC/AOC port' — for messages. */
  describe: string;
}

/**
 * What a port offers a cable leg, in the connector catalog's terms: the
 * port's type (the footprint's when a model is assigned, else the schematic
 * pin's) and, for a pluggable cage, its optic's connector and lane count.
 * Undefined when the component or the port does not exist.
 */
export function portOfferAt(idx: ProjectIndex, componentId: Id, portId: string): PortOffer | undefined {
  const c = idx.component(componentId);
  if (!c) return undefined;
  const type = idx.portOf(c, portId)?.type ?? idx.pinOf(c, portId)?.type;
  if (!type) return undefined;
  const optic = idx.catalog.transceiver(c.optics[portId]);
  if (optic) {
    const integrated = optic.connector.trim().toLowerCase() === 'integrated';
    return {
      component: c,
      view: { type, opticConnector: optic.connector, opticLanes: optic.lanes },
      describe: integrated ? `${optic.name} DAC/AOC port` : `${optic.connector} port`,
    };
  }
  return { component: c, view: { type }, describe: isPluggableCage(type) ? `empty ${type} cage` : `${type} port` };
}

/**
 * Fibers of the definition that are in service: two per channel (Tx + Rx)
 * that reaches a plugged port at both ends through the strand map and within
 * the ports' lane capacity — exactly the channels `deriveCableLinks` turns
 * into links.
 */
export function usedFiberCount(project: Project, cable: Cable): number {
  return 2 * deriveCableLinks(project, cable).length;
}

export interface CableReach {
  /** Jacket length, m: the routed jacket's geometric length, else the declared `Cable.lengthM`. */
  jacketM: number;
  routed: boolean;
  /** The definition's breakout length once per side that fans out into several legs. */
  breakoutM: number;
  totalM: number;
}

/**
 * How far an installed cable can reach: its jacket (the routed jacket's
 * geometric length when the cable has a route, else its declared length)
 * plus the breakout length on every fanned side. Null when the cable has
 * neither a route nor a declared length.
 */
export function cableReach(project: Project, cable: Cable, resolved: ResolvedCable): CableReach | null {
  const routed = routedLengthM(project, cable.id);
  const jacketM = routed ? routed.rawM : cable.lengthM;
  if (jacketM === undefined || !(jacketM >= 0)) return null;
  const fanned = [resolved.sideA, resolved.sideB].filter((s) => s.legs.length > 1).length;
  const breakoutM = resolved.breakoutLengthM * fanned;
  return { jacketM, routed: routed !== null, breakoutM, totalM: jacketM + breakoutM };
}
