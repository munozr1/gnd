/**
 * Cable instance commands: connecting a cable definition to ports leg by
 * leg. Every factory returns a `Command` for the 'schematic' history (a cable
 * is logical topology; its links are plan links). Mutators throw on invalid
 * input — an incompatible port, an occupied one — which `execute` reports
 * through `ui.lastError`.
 */
import { catalogIndex } from '@/catalog';
import {
  autoFillCableSide,
  plugCableLeg,
  removeCable,
  requireCable,
  syncCableLinks,
  unplugCableLeg,
  type CableSide,
  type PortRef,
} from '@/model/cables/instances';
import { createCable as createCableInstance } from '@/model/factories';
import type { Id, Project, Vec2 } from '@/model/types';
import { command, type Command } from '@/store/commands';
import { asArray, plural, resultCommand, type ResultCommand } from './base';

const EDITOR = 'schematic';

/** 'CBL1', 'CBL2', …: one past the highest existing CBL<n> label. */
export function nextCableLabel(project: Project): string {
  let max = 0;
  for (const c of project.cables) {
    const m = /^CBL(\d+)$/.exec(c.label);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `CBL${max + 1}`;
}

export interface CreateCableOptions {
  label?: string;
  /** Ports for side A's legs, in leg order (validated like `plugLeg`). */
  plugsA?: readonly PortRef[];
}

/** Install a cable of definition `defId` with unassigned legs (optionally plugging side A); `result` is the cable id. */
export function createCable(defId: string, opts: CreateCableOptions = {}): ResultCommand<Id> {
  return resultCommand('Connect cable', EDITOR, (d) => {
    const def = catalogIndex(d).cable(defId);
    if (!def) throw new Error(`Unknown cable: ${defId}`);
    const cable = createCableInstance(def, opts.label?.trim() || nextCableLabel(d));
    d.cables.push(cable);
    (opts.plugsA ?? []).forEach((ref, leg) => plugCableLeg(d, cable.id, 'A', leg, ref));
    syncCableLinks(d, cable.id);
    return cable.id;
  });
}

export function plugLeg(cableId: Id, side: CableSide, leg: number, ref: PortRef): Command {
  return command(`Plug leg ${side}${leg + 1}`, EDITOR, (d) => plugCableLeg(d, cableId, side, leg, ref));
}

export function unplugLeg(cableId: Id, side: CableSide, leg: number): Command {
  return command(`Unplug leg ${side}${leg + 1}`, EDITOR, (d) => unplugCableLeg(d, cableId, side, leg));
}

/** Plug the remaining legs of `side` into consecutive compatible free ports from `first`; `result` counts the legs plugged. */
export function autoFillSide(cableId: Id, side: CableSide, first: PortRef): ResultCommand<number> {
  return resultCommand(`Auto-fill side ${side}`, EDITOR, (d) => autoFillCableSide(d, cableId, side, first));
}

/** Remove a cable and the links it owns. */
export function deleteCable(cableId: Id): Command {
  return command('Delete cable', EDITOR, (d) => removeCable(d, cableId));
}

export function deleteCables(ids: Id | readonly Id[]): Command {
  const list = asArray(ids);
  return command(`Delete ${plural(list.length, 'cable')}`, EDITOR, (d) => {
    for (const id of list) if (d.cables.some((c) => c.id === id)) removeCable(d, id);
  });
}

export function setCableLabel(cableId: Id, label: string): Command {
  return command('Set cable label', EDITOR, (d) => {
    const trimmed = label.trim();
    if (!trimmed) throw new Error('Cable label cannot be empty');
    requireCable(d, cableId).label = trimmed;
  });
}

/** Set (or clear, with undefined / a non-positive number) the installed length in metres. */
export function setCableLength(cableId: Id, lengthM: number | undefined): Command {
  return command('Set cable length', EDITOR, (d) => {
    const c = requireCable(d, cableId);
    if (lengthM === undefined || !(lengthM > 0)) delete c.lengthM;
    else c.lengthM = lengthM;
  });
}

/** Place a side's furcation point on the floor plan; steps of one drag coalesce per cable + side. */
export function setFurcation(cableId: Id, side: CableSide, pos: Vec2, pinned = true, dragId?: string): Command {
  return command(
    'Move furcation',
    EDITOR,
    (d) => {
      const c = requireCable(d, cableId);
      c.furcation = { ...(c.furcation ?? {}), [side]: { pos: { x: pos.x, y: pos.y }, pinned } };
    },
    `cable.furcation:${dragId ?? `${cableId}:${side}`}`,
  );
}
