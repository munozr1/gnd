# src/model/cables — API digest (increments 1–2)

```ts
// src/model/cables/connectors.ts  (all re-exported from src/model/cables/index.ts)
export type ConnectorFamily = 'small' | 'multi';
export type ConnectorGender = 'pinned' | 'unpinned';
export interface ConnectorDef { id: string; name: string; family: ConnectorFamily; vsff: boolean; positions: number; positionsUsed: number[]; fibersUsed: number; genderOptions?: ConnectorGender[]; color: string; legacyConnector: string }
export const connectorCatalog: readonly ConnectorDef[];   // 10 rows, table order: LC-simplex, LC-duplex, SN-duplex, CS-duplex, MPO-8, MPO-12, MPO-16, MPO-24, MMC-16, MMC-24
export function connectorById(id: string): ConnectorDef | undefined;
export function requireConnector(id: string): ConnectorDef;            // throws Error('Unknown connector "<id>"')
export const fibersPerLeg: (def: ConnectorDef) => number;              // = def.fibersUsed
export function legacyConnectorOf(id: string): string | undefined;     // 'LC' | 'MPO-12' | 'MPO-16' | 'MPO-24' | 'MMC-16' | 'MMC-24' | 'SN' | 'CS'
export function connectorsForLegacy(legacy: string): ConnectorDef[];   // case-insensitive; full-body connector first: 'LC' -> [LC-duplex, LC-simplex], 'MPO-12' -> [MPO-12, MPO-8]; unknown -> []
export interface PortConnectorView { type: PortType; opticConnector?: string; opticLanes?: number }
export function portAcceptsConnector(port: PortConnectorView, connectorId: string): boolean;

// src/model/cables/deriveSides.ts
export interface Leg { index: number; label: string; positions: number[]; color?: string }   // index 0-based, positions 1-based
export interface ResolvedSide { connector: string; legs: Leg[] }
export type CableKind = 'straight' | 'trunk';
export type DeriveSidesResult = { ok: true; sideA: ResolvedSide; sideB: ResolvedSide; kind: CableKind; channels: number } | { ok: false; error: string };
export interface DeriveSidesOptions { legLabelsA?: string[]; legLabelsB?: string[]; legColorsA?: string[]; legColorsB?: string[] }
export function deriveSides(fiberCount: number, connA: string, connB: string, opts?: DeriveSidesOptions): DeriveSidesResult;
export function defaultLegLabel(family: ConnectorFamily, index: number): string;              // '1','2',... | 'A'..'Z','AA','AB',...
export function connectorAlternatives(fiberCount: number, failed: ConnectorDef): ConnectorDef[]; // the "Use X or Y" hint: same family+vsff, then family, then any; fewest legs first

// src/model/types.ts (ADDITIVE)
export type FiberType = 'OS2' | 'OM3' | 'OM4' | 'OM5';
export type CablePolarity = 'A' | 'B' | 'C';
export interface CableSideDef { connector: string; legLabels?: string[]; legColors?: string[] }
export interface StrandLink { a: { leg: number; pos: number }; b: { leg: number; pos: number } }   // leg 0-based, pos 1-based
export interface CableDef { /* every existing field unchanged */ fiberCount?: number; fiberType?: FiberType; sideA?: CableSideDef; sideB?: CableSideDef; polarity?: CablePolarity; strandMap?: StrandLink[] /* only when user-customised */; breakoutLengthM?: number }

// src/model/cables/index.ts re-exports: connectors, deriveSides (increment 1, unchanged), strandMap, resolve, legacy

// src/model/cables/strandMap.ts
export function deriveStrandMap(fiberCount: number, sideA: ResolvedSide, sideB: ResolvedSide, polarity: CablePolarity): StrandLink[];  // throws when a side does not carry fiberCount slots; map[n-1].a is always A's nth sequential slot
export function isBijection(map: readonly StrandLink[], sideA: ResolvedSide, sideB: ResolvedSide): { ok: boolean; problems: string[] };  // problems e.g. 'Side A leg A position 12 is not wired', 'Side B leg 1 position 2 is wired 2 times', 'Side A leg A has no position 5', 'Side B has no leg 5 (wired to position 1)'
export function strandMapFiberCount(map: readonly StrandLink[]): number;

// src/model/cables/resolve.ts
export interface LegacyCableFields { media: string; mediaClass: 'fiber'; endA: string; endB: string; color: string; diameterMm: number; breakout?: { fanout: number } }
export interface CableSpec { fiberCount: number; fiberType: FiberType; sideA: ResolvedSide; sideB: ResolvedSide; kind: CableKind }
export interface ResolvedCable extends CableSpec { def: CableDef; channels: number; polarity: CablePolarity; strandMap: StrandLink[]; strandMapCustom: boolean; breakoutLengthM: number; diameterMm: number; color: string; displayName: string; summary: string; legacy: LegacyCableFields }
export const DEFAULT_BREAKOUT_LENGTH_M = 0.5;
export function isFiberCableDef(def: CableDef): boolean;                       // fiberCount + sideA.connector + sideB.connector present
export function fiberTypeFromMedia(media: string | undefined): FiberType | undefined;  // OS2/OM3/OM4/OM5 as written; SMF/OS* -> OS2; MMF/OM* -> OM4; else undefined
export function defaultPolarity(connA: string, connB: string): CablePolarity;  // 'B' when either connector is multi family, else 'A'
export function defaultJacketColor(fiberType: FiberType): string;              // OS2 '#facc15', OM3/OM4 '#2dd4bf', OM5 '#a3e635'
export function diameterForFiberCount(fiberCount: number): number;             // table 2→2.0 … 144→12.0; else linear interpolation (last-segment extrapolation above 144) rounded UP to 0.5 mm; <=2/NaN → 2.0
export function cableDisplayName(spec: CableSpec): string;                     // '8F OM4 MPO-8 → 4×LC-duplex' | '12F OM4 MPO-12 ↔ MPO-12' | '144F OS2 12×MPO-12 ↔ 12×MPO-12'
export function cableSummary(spec: CableSpec): string;                         // '8F OM4 · Trunk (breakout) · MPO-8 → 4×LC-duplex · 4 channels' ('… · Straight · …', '1 channel' singular)
export function legacyFieldsFor(spec: CableSpec & { color: string; diameterMm: number }): LegacyCableFields;  // endA/endB = legacyConnectorOf(connector); breakout = kind==='trunk' ? { fanout: max(legsA, legsB) } : undefined
export function validateCableDef(def: CableDef): string[];                     // missing fields; deriveSides error (unknown connector / uneven split); 'Custom strand map: <problem>.' per isBijection problem; 'Breakout length must be 0 m or more.'; 'Polarity must be A, B or C, got "D".'
export function resolveCable(def: CableDef): ResolvedCable | { error: string }; // WeakMap-memoised by def identity; error for non-fiber defs, unknown connector or uneven split; custom strandMap passed through as-is (strandMapCustom=true); fiberType falls back to media then 'OM4'; polarity to defaultPolarity; color '' → defaultJacketColor; diameterMm<=0 → diameterForFiberCount; breakoutLengthM default 0.5 (trunk) / 0 (straight)

// src/model/cables/legacy.ts
export function migrateLegacyCableDef(def: CableDef): CableDef;                // same reference when already fiber / copper / DAC / AOC / integrated ends / unmappable; otherwise {...def, fiberCount, fiberType, sideA:{connector}, sideB:{connector}, polarity} with legacy fields untouched; idempotent
export function migrateLegacyCableDefs(defs: readonly CableDef[]): CableDef[]; // same array reference when nothing changed
```

# Increment 4 — cable instances (connecting flow)

```ts
// src/model/types.ts (ADDITIVE)
export interface CablePlug { side: 'A' | 'B'; leg: number; componentId: Id | null; portId: string | null }   // one per leg per side, always present
export interface Cable { id: Id; label: string; cableDefId: string; plugs: CablePlug[]; lengthM?: number; furcation?: Partial<Record<'A' | 'B', { pos: Vec2; pinned: boolean }>> }
export interface Project { /* … */ cables: Cable[] }                       // createProject() → [], migrations default []
export interface Link { /* … */ cableId?: Id }                             // set on every link a cable owns
export type SelectionItem = /* … */ | { kind: 'cable'; id: Id };          // revealSelection → schematic
export type IssueTarget = /* … */ | { kind: 'cable'; id: Id };

// src/model/factories.ts
export function createCable(def: CableDef, label: string): Cable;          // unassigned plugs from resolveCable(def); throws 'Cannot connect …' when the def does not resolve

// src/model/query.ts (ProjectIndex, ADDITIVE)
export interface CablePlugRef { cableId: Id; side: 'A' | 'B'; leg: number }
idx.cable(id) / idx.cableById; idx.linksOfCable(cableId): Link[]; idx.plugAt({ componentId, portId }): CablePlugRef | undefined

// src/model/cables/instances.ts  (re-exported from '@/model/cables')
export type CableSide = 'A' | 'B'; export interface PortRef { componentId: Id; portId: string }
export function deriveCableLinks(project, cable): { a: LinkEnd; b: LinkEnd }[];   // one link per channel plugged at both ends; lane = channel index within a MULTI-fiber leg on a multi-lane port (optic.lanes, fixed MPO-12 = 6), none for a duplex leg; channels past the lane count make no link
export function syncCableLinks(draft, cableId): { added: Id[]; removed: Id[] };   // reconcile draft.links (creates with cableDefId + cableId, removes stale + routes, keeps others); throws 'Port SW1:eth1/49 is already used by …' on a collision with a non-cable link
export function plugCompatible(project, cable, side, leg, ref): { ok: true } | { ok: false; reason: string };  // 'LC-duplex leg 2 cannot plug into eth1/49 (MPO-12 port)' | '… (empty QSFP28 cage)' | 'PP1:f1 is already used by cable CBL1 (side B leg 1)' | 'PP1:f2 is already connected'
export function autoFillPorts(project, cable, side, first): PortRef[];     // remaining unassigned legs → consecutive compatible free ports in symbol order from `first` (skips occupied / incompatible, [] when `first` itself does not fit)
export function nextPortAfter(project, ref): PortRef | null;
export function sideChannels(side: ResolvedSide): { leg; index; slots: [Slot, Slot] }[];  // outer-in per multi leg, one per duplex leg
export function portLaneCapacity(idx, ref, connectorId): number;
export function unassignedLegs(cable, side): number[]; nextUnassignedLeg(cable): { side, leg } | null; plugOf(cable, side, leg); isPlugged(plug); resolveCableOf(project, cable): ResolvedCable | undefined; requireCable(project, id)
// draft mutators: plugCableLeg(draft, cableId, side, leg, ref) (validates, throws reason) · unplugCableLeg · autoFillCableSide(draft, cableId, side, first) → count · removeCable(draft, id) (links + routes) · unplugComponents(draft, componentIds) → changed cable ids (called by schematic deleteComponents and F8 remove-component)

// src/model/cables/geometry.ts
export function cableEnds(project, cable): { A: PortRef[]; B: PortRef[] };             // plugged legs in leg order
export function furcationDefaultFloorPos(project, cable, side): Vec2 | null;           // breakoutLengthM (→ mm) back from that side's port centroid towards the other side's centroid (clamped to the midpoint)
export function cableSchematicFan(project, cable, sheetId?): { aPins: { leg; pos; dir }[]; bPins; furcationA?: Vec2; furcationB?: Vec2 };  // FAN_OFFSET (40) units from a multi-leg side's pins towards the other side, at their mean y

// src/commands/cables.ts  (import { cables } from '@/commands' or flat)
createCable(defId, { label?, plugsA? }) → ResultCommand<Id> ('CBL<n>' labels) · plugLeg(cableId, side, leg, ref) · unplugLeg · autoFillSide(cableId, side, first) → ResultCommand<number> · deleteCable(id) · deleteCables(ids) · setCableLabel · setCableLength(id, m | undefined) · setFurcation(id, side, pos, pinned = true, dragId?)

// src/store: ui.schematic.cabling: { cableId; side; leg } | null (patchSchematic); cleared on replaceProject and when the cable disappears
// src/panels/cables/cabling.ts: startCabling(defId) → Id | null · resumeCabling(cableId, side, leg) · plugCurrent(ref) · autoFillCurrent(ref) · finishCabling() · cablingStatus · dimmedPinsFor(project, cabling, sheetId) → Set<'componentId/portId'> · legRows · connectableCableDefs
// The library's "Connect" button calls startCabling(def.id); the idle CablingHud (top-left of the schematic canvas) offers the same picker.
// The Cable inspector (src/panels/cables/CableInspector.tsx) is rendered by the schematic Inspector panel for a { kind: 'cable' } selection — no separate dock panel.
```


# Increment 3 — Cable Builder / cableDefs commands

```ts
// src/commands/cableDefs.ts (all re-exported from '@/commands')
export const CUSTOM_CABLE_ID_PREFIX = 'cbl.custom.';
export interface FiberCableDefInput extends Partial<Omit<CableDef, 'name' | 'fiberCount' | 'fiberType' | 'sideA' | 'sideB'>> { name: string; fiberCount: number; fiberType: FiberType; sideA: CableSideDef; sideB: CableSideDef }  // id/color/diameterMm/bendRadiusMm/polarity/breakoutLengthM/strandMap optional; legacy fields never needed
export type CableDefPatch = Partial<Omit<CableDef, 'id'>>;
export function defaultBendRadiusMm(diameterMm: number): number;            // max(30, round(10 × diameter)) — matches the catalog seeds
export function cableDefIdFor(name: string, taken?: Iterable<string>): string; // 'cbl.custom.<slugify(name)>' with '-2', '-3' … when taken
export function buildCableDef(input: FiberCableDefInput, takenIds?: Iterable<string>): CableDef; // pure: throws first problem (empty name / validateCableDef / resolve error); fills id, media/mediaClass/endA/endB/color/diameterMm/breakout via legacyFieldsFor, bendRadiusMm default; unset optionals stay absent
export function addCableDef(input: FiberCableDefInput): ResultCommand<string>; // editor 'schematic'; pushes to draft.customCatalog.cables; result = new id; throws on explicit id already custom
export function updateCableDef(id: string, patch: CableDefPatch): Command;    // custom def edited in place; a BUILT-IN id is copied into customCatalog as an override; re-validated + legacy regenerated; `strandMap: undefined` drops a custom map, `color: ''` returns to the fiber type's colour; throws for unknown / non-fiber defs
export function deleteCableDef(id: string): Command;                           // removes a custom def; throws when not custom, or when links still reference it (unless a built-in with the same id takes over)

// src/panels/cables/preview.ts (pure, no React; re-exported from '@/panels/cables')
export interface PreviewSpec { fiberCount: number; channels?: number; sideA: ResolvedSide; sideB: ResolvedSide; kind: CableKind; color?: string; diameterMm?: number }  // a ResolvedCable satisfies it
export interface PreviewLeg { index: number; x: number; y: number; label: string; positions: number[]; color: string; connector: string; family: ConnectorFamily; fibers: number }
export interface PreviewSide { legs: PreviewLeg[]; furcation?: { x: number; y: number }; origin: { x: number; y: number }; hiddenLegs: number }
export interface PreviewLayout { width: number; height: number; jacket: { x1: number; x2: number; y: number; thickness: number; color: string }; sides: Record<'A' | 'B', PreviewSide>; badge: { x: number; y: number; text: string } }
export const MAX_LEGS_DRAWN = 16; export const GLYPH_W = 24;
export function previewHeight(spec: Pick<PreviewSpec, 'sideA' | 'sideB'>): number;
export function previewLayout(spec: PreviewSpec, width: number, height: number): PreviewLayout;

// src/panels/cables/index.ts (import '@/panels/cables' registers at load; App.tsx does this once)
export const CABLE_BUILDER_DIALOG = 'cable-builder';   // registerDialog
export const CABLES_PANEL_ID = 'cables.library';       // registerPanel: schematic tab, left dock, title 'Fiber cables', order 30, collapsed by default
export { CableBuilderDialog, DEFAULT_FORM, FIBER_COUNTS, formToDef, type CableBuilderForm };  // formToDef(form, name, legCounts?) → FiberCableDefInput
export { CableLibrarySection, CablesDockPanel, fiberCableRows, type FiberCableRow };  // <CableLibrarySection variant="section" | "panel" />; fiberCableRows(project) → { def, summary, custom, error }[] (custom first)

// DOM hooks for tests: dialog role name 'Cable Builder'; data-testid cable-summary, cable-error (role=alert), cable-preview[data-kind], cable-jacket, cable-leg[data-side=A|B][data-leg][data-connector], cable-furcation[data-side], cable-leg-tip, cable-badge, cable-hidden-legs, cable-advanced, strand-map, strand-map-mode ('derived'|'custom'), strand-map-problems, cable-save, cables-library, rows [data-cable-def=<id>][data-custom]; aria-labels 'Fiber count', 'Custom fiber count', 'Fiber type', 'Jacket colour', 'Jacket colour hex', 'Side A connector', 'Side B connector', 'Cable name', 'Polarity', 'Breakout length', 'Outer diameter', 'Bend radius', 'Fiber N side A|B leg|position'.
```

# Increment 4 — Cable instances, commands, cable tool

```ts
types.ts (additive): interface CablePlug { side: 'A'|'B'; leg: number; componentId: Id|null; portId: string|null }; interface Cable { id; label; cableDefId; plugs: CablePlug[]; lengthM?; furcation?: Partial<Record<'A'|'B', { pos: Vec2; pinned: boolean }>> }; Project.cables: Cable[]; Link.cableId?: Id; SelectionItem/IssueTarget gain { kind: 'cable'; id }. factories: createCable(def: CableDef, label: string): Cable (throws 'Cannot connect …' when the def does not resolve); createProject() → cables: []. query.ts ProjectIndex: cable(id), cableById, linksOfCable(cableId): Link[], plugAt({componentId, portId}): CablePlugRef { cableId; side; leg } | undefined. '@/model/cables' (instances.ts): type CableSide = 'A'|'B'; interface PortRef { componentId; portId }; deriveCableLinks(project, cable): { a: LinkEnd; b: LinkEnd }[]; syncCableLinks(draft, cableId): { added: Id[]; removed: Id[] } (throws 'Port SW1:eth1/49 is already used by <link label>'); plugCompatible(project, cable, side, leg, ref): { ok: true } | { ok: false; reason } (reasons: '<connector> leg <label> cannot plug into <portId> (<X> port | empty <cage> cage)', '<ref>:<port> is already used by cable <label> (side B leg 1)', '<ref>:<port> is already connected'); autoFillPorts(project, cable, side, first): PortRef[]; nextPortAfter(project, ref): PortRef|null; sideChannels(side): { leg; index; slots }[]; portLaneCapacity(idx, ref, connectorId): number; unassignedLegs(cable, side): number[]; nextUnassignedLeg(cable): { side; leg }|null; plugOf, isPlugged, resolveCableOf(project, cable): ResolvedCable|undefined, requireCable, plainProject; draft mutators plugCableLeg(draft, cableId, side, leg, ref), unplugCableLeg(draft, cableId, side, leg), autoFillCableSide(draft, cableId, side, first): number, removeCable(draft, id), unplugComponents(draft, componentIds): Id[]. geometry.ts: cableEnds(project, cable): { A: PortRef[]; B: PortRef[] }; furcationDefaultFloorPos(project, cable, side): Vec2|null; cableSchematicFan(project, cable, sheetId?): { aPins: {leg,pos,dir}[]; bPins; furcationA?; furcationB? }; FAN_OFFSET = 40. '@/commands' (cables namespace + flat): createCable(defId, { label?, plugsA? }) → ResultCommand<Id>; plugLeg(cableId, side, leg, ref); unplugLeg(cableId, side, leg); autoFillSide(cableId, side, first) → ResultCommand<number>; deleteCable(id); deleteCables(ids); setCableLabel(id, label); setCableLength(id, m|undefined); setFurcation(id, side, pos, pinned = true, dragId?); nextCableLabel(project). store: ui.schematic.cabling: CablingState { cableId; side; leg } | null via patchSchematic; selection 'cable' supported; revealSelection('cable') → schematic. '@/panels/cables/cabling': startCabling(defId, { label? }) → Id|null; resumeCabling(cableId, side, leg); adoptPendingCabling(unknown) (accepts the library's { defId } hand-off); plugCurrent(ref); autoFillCurrent(ref); unplugAt(cableId, side, leg); finishCabling(); cablingStatus(project, cabling); dimmedPinsFor(project, cabling, sheetId): Set<'componentId/portId'>; legRows(project, cable); connectableCableDefs(project). drawing.ts: drawSymbols/drawDevice accept dimmedPins?: ReadonlySet<string>, pinKey(componentId, portId), COLORS.dim. Registration: src/panels/cables/registerConnecting.ts registers panel 'cables.inspector' (schematic, right, order 5) while a cable is selected; CablingHud is mounted by SchematicEditor inside its canvas host (data-testid 'cabling-hud' / 'cabling-hud-idle', combobox 'Connect cable').
```
