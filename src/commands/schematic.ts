/**
 * Schematic commands: one undoable factory per verb, wrapping the pure model
 * mutators in `@/model/schematic`. Every factory returns a `Command` for the
 * 'schematic' history; run it with `store.getState().execute(cmd)`.
 *
 * Factories that create things return a `ResultCommand` whose `result` (ids,
 * counts) is filled in once executed. Mutators throw on invalid input, which
 * `execute` reports through `ui.lastError`.
 */
import { catalogIndex } from '@/catalog';
import * as sch from '@/model/schematic';
import type {
  AddComponentOptions,
  AnnotateOptions,
  BreakoutPlan,
  BulkAssignOptions,
  DeleteSheetResult,
  DuplicateSheetResult,
  FabricPlan,
  RefChange,
} from '@/model/schematic';
import type { Id, LinkEnd, SelectionItem, Vec2 } from '@/model/types';
import { command, type Command } from '@/store/commands';
import { asArray, dragKey, plural, resultCommand, type ResultCommand } from './base';
import { buildCustomDevice, type CustomDeviceForm } from './customDevice';

const EDITOR = 'schematic';

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

/** Place a symbol on a sheet; `result` is the new component id. */
export function addComponent(symbolId: string, sheetId: Id, pos: Vec2, opts: AddComponentOptions = {}): ResultCommand<Id> {
  return resultCommand('Add component', EDITOR, (d) => sch.addComponent(d, symbolId, sheetId, pos, opts).id);
}

/**
 * Translate components (and the wires between them). Pass the same `dragId`
 * for every step of one drag so it collapses into one undo entry; without it
 * consecutive nudges of the same selection coalesce.
 */
export function moveComponents(ids: readonly Id[], delta: Vec2, dragId?: string): Command {
  return command(
    `Move ${plural(ids.length, 'component')}`,
    EDITOR,
    (d) => sch.moveComponents(d, ids, delta),
    dragKey('sch.move', ids, dragId),
  );
}

export function rotateComponents(ids: Id | readonly Id[], steps = 1): Command {
  const list = asArray(ids);
  return command(`Rotate ${plural(list.length, 'component')}`, EDITOR, (d) => {
    for (const id of list) sch.rotateComponent(d, id, steps);
  });
}

export function mirrorComponents(ids: Id | readonly Id[]): Command {
  const list = asArray(ids);
  return command(`Mirror ${plural(list.length, 'component')}`, EDITOR, (d) => {
    for (const id of list) sch.mirrorComponent(d, id);
  });
}

export interface DeleteSelectionResult {
  componentIds: Id[];
  linkIds: Id[];
  sheetIds: Id[];
}

/**
 * Delete the components, links and (non-root) sheets in a selection; other
 * kinds are ignored. Links touching a deleted component go with it.
 */
export function deleteSelection(items: readonly SelectionItem[]): ResultCommand<DeleteSelectionResult> {
  const componentIds = items.filter((i) => i.kind === 'component').map((i) => i.id);
  const linkIds = items.filter((i) => i.kind === 'link').map((i) => i.id);
  const sheetIds = items.filter((i) => i.kind === 'sheet').map((i) => i.id);
  const n = componentIds.length + linkIds.length + sheetIds.length;
  return resultCommand(`Delete ${plural(n, 'item')}`, EDITOR, (d) => {
    const out: DeleteSelectionResult = { componentIds: [], linkIds: [], sheetIds: [] };
    for (const id of sheetIds) {
      if (!d.sheets.some((s) => s.id === id)) continue;
      const r = sch.deleteSheet(d, id);
      out.sheetIds.push(...r.sheetIds);
      out.componentIds.push(...r.componentIds);
      out.linkIds.push(...r.linkIds);
    }
    const remaining = componentIds.filter((id) => !out.componentIds.includes(id));
    if (remaining.length) {
      const r = sch.deleteComponents(d, remaining);
      out.componentIds.push(...r.componentIds);
      out.linkIds.push(...r.linkIds);
    }
    const links = linkIds.filter((id) => !out.linkIds.includes(id) && d.links.some((l) => l.id === id));
    if (links.length) {
      sch.deleteLinks(d, links);
      out.linkIds.push(...links);
    }
    return out;
  });
}

export function deleteComponents(ids: Id | readonly Id[]): ResultCommand<sch.DeleteResult> {
  const list = asArray(ids);
  return resultCommand(`Delete ${plural(list.length, 'component')}`, EDITOR, (d) => sch.deleteComponents(d, list));
}

export function setComponentValue(id: Id, value: string | undefined): Command {
  return command('Set value', EDITOR, (d) => sch.setComponentValue(d, id, value));
}

export function setComponentRef(id: Id, ref: string): Command {
  return command(`Rename to ${ref.trim()}`, EDITOR, (d) => sch.setComponentRef(d, id, ref));
}

/** Assign (or clear, with null) the physical model of one or more components; `result` counts the changed ones. */
export function setFootprint(ids: Id | readonly Id[], footprintDefId: string | null): ResultCommand<number> {
  const list = asArray(ids);
  return resultCommand(footprintDefId === null ? 'Clear model' : 'Assign model', EDITOR, (d) => {
    if (footprintDefId !== null && !catalogIndex(d).footprint(footprintDefId)) {
      throw new Error(`Unknown footprint: ${footprintDefId}`);
    }
    return sch.assignFootprint(d, list, footprintDefId);
  });
}

export function setOptic(componentId: Id, portId: string, opticId: string | null): Command {
  return command(opticId === null ? 'Remove optic' : 'Assign optic', EDITOR, (d) => {
    if (opticId !== null && !catalogIndex(d).transceiver(opticId)) throw new Error(`Unknown transceiver: ${opticId}`);
    sch.assignOptic(d, componentId, portId, opticId);
  });
}

/** Footprint / optics by ref glob; `result` is the number of matched components. */
export function bulkAssign(opts: BulkAssignOptions): ResultCommand<number> {
  return resultCommand(`Bulk assign ${opts.refGlob}`, EDITOR, (d) => sch.bulkAssign(d, opts));
}

/** `result` is the new expanded state. */
export function toggleExpandedPins(id: Id): ResultCommand<boolean> {
  return resultCommand('Toggle unused pins', EDITOR, (d) => sch.toggleExpandedPins(d, id));
}

/** Number reference designators; `result` lists the refs that changed. */
export function annotate(opts: AnnotateOptions = {}): ResultCommand<RefChange[]> {
  return resultCommand(opts.scope === 'all' ? 'Re-annotate' : 'Annotate', EDITOR, (d) => sch.annotate(d, opts));
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** Connect two ports; `cableDefId` undefined derives the cable from the optics. `result` is the link id. */
export function addLink(a: LinkEnd, b: LinkEnd, cableDefId?: string | null): ResultCommand<Id> {
  return resultCommand('Add link', EDITOR, (d) => sch.addLink(d, a, b, cableDefId));
}

export function deleteLinks(ids: Id | readonly Id[]): Command {
  const list = asArray(ids);
  return command(`Delete ${plural(list.length, 'link')}`, EDITOR, (d) => sch.deleteLinks(d, list));
}

export function setLinkLabel(id: Id, label: string | undefined): Command {
  return command('Set link label', EDITOR, (d) => sch.setLinkLabel(d, id, label));
}

export function setLinkCable(id: Id, cableDefId: string | null): Command {
  return command('Change cable', EDITOR, (d) => {
    if (cableDefId !== null && !catalogIndex(d).cable(cableDefId)) throw new Error(`Unknown cable: ${cableDefId}`);
    sch.setLinkCable(d, id, cableDefId);
  });
}

/** Replace a wire's elbow points. Steps of one drag coalesce (per link, or per `dragId` when given). */
export function setLinkWirePoints(id: Id, points: readonly Vec2[], dragId?: string): Command {
  return command('Reshape wire', EDITOR, (d) => sch.setLinkWirePoints(d, id, points), dragKey('sch.wire', [id], dragId));
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

/** Create a child sheet with its symbol at `pos` on the parent; `result` is the sheet id. */
export function createSheet(parentId: Id, name: string, pos: Vec2): ResultCommand<Id> {
  return resultCommand('Add sheet', EDITOR, (d) => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('Sheet name cannot be empty');
    return sch.createChildSheet(d, parentId, trimmed, pos).id;
  });
}

export function duplicateSheet(sheetId: Id, newName: string): ResultCommand<DuplicateSheetResult> {
  return resultCommand('Duplicate sheet', EDITOR, (d) => {
    const trimmed = newName.trim();
    if (!trimmed) throw new Error('Sheet name cannot be empty');
    return sch.duplicateSheet(d, sheetId, trimmed);
  });
}

export function deleteSheet(sheetId: Id): ResultCommand<DeleteSheetResult> {
  return resultCommand('Delete sheet', EDITOR, (d) => sch.deleteSheet(d, sheetId));
}

export function renameSheet(sheetId: Id, name: string): Command {
  return command('Rename sheet', EDITOR, (d) => sch.renameSheet(d, sheetId, name));
}

export function moveSheetSymbol(sheetId: Id, pos: Vec2, dragId?: string): Command {
  return command('Move sheet', EDITOR, (d) => sch.moveSheetSymbol(d, sheetId, pos), dragKey('sch.sheet', [sheetId], dragId));
}

// ---------------------------------------------------------------------------
// Bulk tools
// ---------------------------------------------------------------------------

/** Apply a fabric plan from `planFabric`; `result` is the new link ids. */
export function applyFabric(plan: FabricPlan): ResultCommand<Id[]> {
  return resultCommand(`Fabric connect (${plural(plan.links.length, 'link')})`, EDITOR, (d) => sch.applyFabric(d, plan));
}

/** Apply a breakout plan from `planBreakout` (throws when the plan is not ok); `result` is the lane link ids. */
export function applyBreakout(plan: BreakoutPlan): ResultCommand<Id[]> {
  return resultCommand(`Breakout (${plural(plan.links.length, 'lane')})`, EDITOR, (d) => sch.applyBreakout(d, plan));
}

export interface CustomDeviceIds {
  symbolId: string;
  footprintId: string;
}

/** Add a user-defined device (symbol + footprint) to the project's custom catalog. */
export function addCustomSymbolAndFootprint(form: CustomDeviceForm): ResultCommand<CustomDeviceIds> {
  return resultCommand(`Add custom device ${form.name.trim()}`, EDITOR, (d) => {
    const { symbol, footprint } = buildCustomDevice(form, d);
    d.customCatalog.symbols.push(symbol);
    d.customCatalog.footprints.push(footprint);
    return { symbolId: symbol.id, footprintId: footprint.id };
  });
}
