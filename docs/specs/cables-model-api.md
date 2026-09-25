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
