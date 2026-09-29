/**
 * The cable connecting flow, shared by the schematic canvas (pin clicks),
 * the floating CablingHud and the Cable inspector. State lives in
 * `ui.schematic.cabling` (the leg being assigned next); every model change
 * goes through the cable commands so it is undoable.
 *
 *   startCabling(defId)      install a cable and begin at side A leg 1
 *   plugCurrent(port)        plug the current leg, advance to the next unassigned one
 *   autoFillCurrent(port)    fill the current side from that port (Shift+click)
 *   finishCabling()          stop; unassigned legs stay (a warning, never a delete)
 */
import * as commands from '@/commands';
import { isFiberCableDef, nextUnassignedLeg, plugCompatible, resolveCable, resolveCableOf, unassignedLegs, type CableSide, type PortRef, type ResolvedCable } from '@/model/cables';
import { indexProject } from '@/model/query';
import { componentLayout } from '@/model/schematic';
import type { Cable, CableDef, Id, Project } from '@/model/types';
import { execute } from '@/panels/schematic/common';
import { store, type CablingState } from '@/store';
import { toast } from '@/ui/Toast';

const setCabling = (cabling: CablingState | null): void => store.getState().patchSchematic({ cabling });

export const cableById = (project: Project, id: Id): Cable | undefined => indexProject(project).cable(id);

/** Fiber cable definitions a cable can be connected from (those that resolve), for pickers. */
export function connectableCableDefs(project: Project): { def: CableDef; resolved: ResolvedCable }[] {
  const out: { def: CableDef; resolved: ResolvedCable }[] = [];
  for (const def of indexProject(project).catalog.catalog.cables) {
    if (!isFiberCableDef(def)) continue;
    const resolved = resolveCable(def);
    if (!('error' in resolved)) out.push({ def, resolved });
  }
  return out;
}

/** Install a cable of `defId` and start assigning its legs; returns the cable id or null when the command failed. */
export function startCabling(defId: string, opts: { label?: string } = {}): Id | null {
  const s = store.getState();
  if (s.ui.activeTab !== 'schematic') s.setActiveTab('schematic');
  s.patchSchematic({ tool: 'select', placing: null });
  const cmd = commands.createCable(defId, opts);
  if (!execute(cmd) || !cmd.result) return null;
  const cableId = cmd.result;
  s.select({ kind: 'cable', id: cableId });
  setCabling({ cableId, side: 'A', leg: 0 });
  return cableId;
}

/** Continue an existing cable at a given leg (inspector / HUD row click). */
export function resumeCabling(cableId: Id, side: CableSide, leg: number): void {
  const s = store.getState();
  if (s.ui.activeTab !== 'schematic') s.setActiveTab('schematic');
  s.patchSchematic({ tool: 'select', placing: null });
  setCabling({ cableId, side, leg });
}

/** Move on to the next unassigned leg (A legs first, then B), or finish when every leg is plugged. */
function advance(cableId: Id): void {
  const cable = cableById(store.getState().project, cableId);
  const next = cable ? nextUnassignedLeg(cable) : null;
  if (!cable) return setCabling(null);
  if (!next) {
    toast.ok(`Cable ${cable.label} connected`);
    return setCabling(null);
  }
  setCabling({ cableId, side: next.side, leg: next.leg });
}

/** Plug the current leg into `port`. The command reports an incompatible port through `ui.lastError` (toasted). */
export function plugCurrent(port: PortRef): boolean {
  const cabling = store.getState().ui.schematic.cabling;
  if (!cabling) return false;
  if (!execute(commands.plugLeg(cabling.cableId, cabling.side, cabling.leg, port))) return false;
  advance(cabling.cableId);
  return true;
}

/** Auto-fill the current side from `port` (Shift+click), then advance. */
export function autoFillCurrent(port: PortRef): boolean {
  const cabling = store.getState().ui.schematic.cabling;
  if (!cabling) return false;
  const cmd = commands.autoFillSide(cabling.cableId, cabling.side, port);
  if (!execute(cmd)) return false;
  const n = cmd.result ?? 0;
  const remaining = unassignedLegs(cableById(store.getState().project, cabling.cableId)!, cabling.side).length;
  toast(remaining > 0 ? `${n} legs auto-filled · ${remaining} left on side ${cabling.side}` : `${n} legs auto-filled on side ${cabling.side}`, { tone: remaining > 0 ? 'warning' : 'ok' });
  advance(cabling.cableId);
  return true;
}

export function unplugAt(cableId: Id, side: CableSide, leg: number): boolean {
  return execute(commands.unplugLeg(cableId, side, leg));
}

/** End the flow. Legs still unassigned are reported (a warning); the cable is never deleted here. */
export function finishCabling(): void {
  const s = store.getState();
  const cabling = s.ui.schematic.cabling;
  if (!cabling) return;
  const cable = cableById(s.project, cabling.cableId);
  setCabling(null);
  if (!cable) return;
  const n = cable.plugs.filter((p) => p.componentId === null).length;
  if (n > 0) toast.warning(`${n} ${n === 1 ? 'leg' : 'legs'} unassigned`);
  s.select({ kind: 'cable', id: cable.id });
}

/** 'Cable CBL1: plug side B leg 2 of 4 · Shift+click auto-fill · Enter finish'. */
export function cablingStatus(project: Project, cabling: CablingState): string {
  const cable = cableById(project, cabling.cableId);
  if (!cable) return '';
  const legs = cable.plugs.filter((p) => p.side === cabling.side).length;
  return `Cable ${cable.label}: plug side ${cabling.side} leg ${cabling.leg + 1} of ${legs} · Shift+click auto-fill · Enter finish`;
}

/**
 * Pins on `sheetId` that cannot take the current leg, keyed 'componentId/
 * portId' for the renderer's dim hook. Empty when there is nothing to dim.
 */
export function dimmedPinsFor(project: Project, cabling: CablingState, sheetId: Id): Set<string> {
  const out = new Set<string>();
  const cable = cableById(project, cabling.cableId);
  if (!cable) return out;
  const idx = indexProject(project);
  for (const c of idx.componentsBySheet.get(sheetId) ?? []) {
    const layout = componentLayout(project, c.id);
    if (!layout) continue;
    for (const pin of layout.pins.values()) {
      if (!plugCompatible(project, cable, cabling.side, cabling.leg, { componentId: c.id, portId: pin.portId }).ok) out.add(`${c.id}/${pin.portId}`);
    }
  }
  return out;
}

/** Per-leg rows for the HUD / inspector: label, plugged port name ('—' when unassigned). */
export interface LegRow {
  side: CableSide;
  leg: number;
  label: string;
  connector: string;
  port: string | null;
  portRef: PortRef | null;
}

export function legRows(project: Project, cable: Cable): LegRow[] {
  const idx = indexProject(project);
  const resolved = resolveCableOf(project, cable);
  const rows: LegRow[] = [];
  for (const side of ['A', 'B'] as const) {
    const sideDef = resolved ? (side === 'A' ? resolved.sideA : resolved.sideB) : undefined;
    for (const plug of cable.plugs.filter((p) => p.side === side).sort((x, y) => x.leg - y.leg)) {
      const legDef = sideDef?.legs[plug.leg];
      const c = plug.componentId ? idx.component(plug.componentId) : undefined;
      rows.push({
        side,
        leg: plug.leg,
        label: legDef?.label ?? String(plug.leg + 1),
        connector: sideDef?.connector ?? '?',
        port: c && plug.portId ? `${c.ref}:${plug.portId}` : null,
        portRef: plug.componentId && plug.portId ? { componentId: plug.componentId, portId: plug.portId } : null,
      });
    }
  }
  return rows;
}
