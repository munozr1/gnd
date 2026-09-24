/**
 * The command layer: typed, undoable factories wrapping every model mutator,
 * so the editors share one vocabulary.
 *
 *   import { schematic, layout } from '@/commands';
 *   store.getState().execute(schematic.moveComponents(ids, delta, dragId));
 *   const cmd = layout.addRack(def, pos);
 *   if (store.getState().execute(cmd)) select({ kind: 'rack', id: cmd.result! });
 *
 * Flat re-exports exist too (`import { placeComponent } from '@/commands'`).
 */
export * as schematic from './schematic';
export * as layout from './layout';
export * from './schematic';
export * from './layout';
export * from './base';
export {
  buildCustomDevice,
  validateCustomDevice,
  slugify,
  DEFAULT_REF_PREFIX,
  DEVICE_KINDS,
  type CustomDevice,
  type CustomDeviceForm,
  type CustomPortSpec,
  type PortRole,
} from './customDevice';
export {
  checkUFit,
  isURangeFree,
  occupiedRanges,
  heightUOf,
  nextRackName,
  racksInOrder,
  isPatchFrame,
  defaultFrameDefId,
  frameNameFor,
  nextFreeFloorPos,
  uLabel,
  type PlacementTarget,
  type URange,
} from './placement';
export {
  planPlaceByRule,
  matchRacks,
  matchCandidates,
  type PlaceByRulePlan,
  type PlaceMode,
  type PlaceRule,
  type PlaceSkip,
  type PlaceSkipReason,
  type PlannedPlacement,
  type RackFilter,
} from './placeByRule';
