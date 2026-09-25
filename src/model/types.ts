/**
 * Core data model for Datacenter EDA.
 *
 * Mirrors KiCad's split: a LOGICAL layer (components + links, owned by the
 * schematic) and a PHYSICAL layer (placements + routes, owned by the layout).
 * Both key on `Component.id` / `Link.id`; that is how Update Layout (F8) and
 * back-annotation stay in sync across re-annotation.
 *
 * This module must stay free of React / Konva / Three imports.
 */

export type Id = string;
export type Vec2 = { x: number; y: number };
/** Millimetres. In 3D, y is up. */
export type Vec3 = { x: number; y: number; z: number };

export type Rotation = 0 | 90 | 180 | 270;
export type Face = 'front' | 'rear';
export type Side = 'left' | 'right';

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export type PortType =
  | 'SFP'
  | 'SFP+'
  | 'SFP28'
  | 'QSFP+'
  | 'QSFP28'
  | 'QSFP56'
  | 'QSFP-DD'
  | 'OSFP'
  | 'RJ45'
  | 'LC'
  | 'MPO-12';

export type Media = 'MMF' | 'SMF' | 'DAC' | 'AOC' | 'Copper';

export type DeviceKind = 'switch' | 'server' | 'patch-panel' | 'router' | 'firewall' | 'generic';

export type PinSide = 'L' | 'R' | 'T' | 'B';

/** A pin on a schematic symbol. `portId` matches `FootprintDef.ports[].id`. */
export interface SymbolPin {
  portId: string;
  side: PinSide;
  /** Grid offset along the side, in schematic units (from top for L/R, from left for T/B). */
  offset: number;
  type: PortType;
  speedsGbps: number[];
  /** Optional port-group id (e.g. 'uplinks', 'downlinks'). */
  group?: string;
}

export interface PortGroup {
  id: string;
  name: string;
  /** Expected role of the group; drives ERC 'unconnected uplinks' etc. */
  role?: 'uplink' | 'downlink' | 'mgmt' | 'data' | 'front' | 'rear';
}

/** Schematic look of a device. */
export interface SymbolDef {
  id: string;
  name: string;
  kind: DeviceKind;
  /** Reference designator prefix used by annotation, e.g. 'SW', 'SRV', 'PP'. */
  refPrefix: string;
  /** Schematic units. */
  width: number;
  height: number;
  pins: SymbolPin[];
  groups?: PortGroup[];
  /** Physical models compatible with this symbol. */
  defaultFootprintIds: string[];
  category?: string;
  /** Number of uplinks a device of this symbol is expected to have (ERC single-homed). */
  expectedUplinks?: number;
}

export interface FootprintPort {
  id: string;
  type: PortType;
  speedsGbps: number[];
  /** Position on the faceplate in mm, origin at bottom-left of the device front. */
  pos: Vec2;
  face: Face;
  group?: string;
}

/** Physical device model. */
export interface FootprintDef {
  id: string;
  model: string;
  vendor?: string;
  kind: DeviceKind;
  heightU: number;
  depthMm: number;
  /** Width in mm; defaults to 19" (482.6 mm) when omitted. */
  widthMm?: number;
  ports: FootprintPort[];
  /** Optional GLB path; else an extruded box with a generated faceplate texture. */
  model3d?: string;
  category?: string;
}

export interface TransceiverDef {
  id: string;
  name: string;
  formFactor: PortType;
  speedGbps: number;
  media: Media;
  /** Connector on the cable side, e.g. 'LC', 'MPO-12', 'MPO-16', 'RJ45', 'integrated'. */
  connector: string;
  reachM: number;
  lanes: number;
}

export type FiberType = 'OS2' | 'OM3' | 'OM4' | 'OM5';

/**
 * Fiber polarity method: 'A' straight, 'B' reversed within each multi-fiber
 * connector, 'C' pair-flipped. See src/model/cables/strandMap.ts for the
 * exact rule, including how a duplex cord is always A-to-B.
 */
export type CablePolarity = 'A' | 'B' | 'C';

/**
 * One end of a fiber cable as STORED: the connector catalog id (src/catalog/
 * connectors.json) plus optional per-leg label / colour overrides by leg
 * index. The legs themselves are DERIVED from fiberCount and the connector's
 * fibers-per-leg (`deriveSides`), never stored.
 */
export interface CableSideDef {
  connector: string;
  legLabels?: string[];
  legColors?: string[];
}

/** One fiber of a cable: the (leg, position) it lands on at each end. Legs are 0-based, positions 1-based. */
export interface StrandLink {
  a: { leg: number; pos: number };
  b: { leg: number; pos: number };
}

/**
 * A cable type. Fiber cables carry the `fiberCount` / `fiberType` / `sideA` /
 * `sideB` / `polarity` fields, from which legs, kind (straight vs trunk),
 * channels and the strand map are derived on demand by src/model/cables.
 *
 * The legacy fields `media`, `mediaClass`, `endA`, `endB`, `color`,
 * `diameterMm` and `breakout` STAY POPULATED in the old vocabulary ('OM4',
 * 'LC', 'MPO-12', fanout) because the ERC connector / media rules, BOM and
 * exports read them; for a fiber cable they are regenerated from the fiber
 * fields by `legacyFieldsFor` and the catalog keeps them in lock-step.
 * Copper, DAC and AOC cables have only the legacy fields.
 */
export interface CableDef {
  id: string;
  name: string;
  /** 'OM4' | 'OS2' | 'DAC' | 'AOC' | 'Cat6A' | ... */
  media: string;
  /** Physical class used for tray-compatibility rules. */
  mediaClass: 'fiber' | 'copper';
  endA: string;
  endB: string;
  /** CSS colour. */
  color: string;
  bendRadiusMm: number;
  /** Outer diameter in mm, used for tray / manager fill calculations. */
  diameterMm: number;
  breakout?: { fanout: number };
  /** For DAC/AOC: the virtual transceiver that fills both cages. */
  integrated?: { formFactor: PortType; speedGbps: number; reachM: number };

  // --- Fiber cable definition (see src/model/cables) ---
  /** Number of fibers (strands) in the cable: 2, 8, 12, 16, 24, 32, 48, 72, 96, 144 or custom (even). */
  fiberCount?: number;
  fiberType?: FiberType;
  sideA?: CableSideDef;
  sideB?: CableSideDef;
  /** Defaults to 'B' when either side is a multi-fiber connector, else 'A'. */
  polarity?: CablePolarity;
  /** Present ONLY when the user customised it; otherwise derived from the sides + polarity. */
  strandMap?: StrandLink[];
  /** Jacket-to-legs breakout length for a trunk; default 0.5 m. */
  breakoutLengthM?: number;
}

export type TrayKind = 'fiber-runway' | 'ladder' | 'basket';

export interface TrayDef {
  id: string;
  name: string;
  kind: TrayKind;
  widthMm: number;
  depthMm: number;
  /** Which cable classes may ride this tray kind. */
  accepts: ('fiber' | 'copper')[];
}

/** A 'patch-frame' is a free-standing frame that holds patch panels (its own rack, placed anywhere on the floor). */
export type RackKind = 'rack' | 'patch-frame';

export interface RackDef {
  id: string;
  name: string;
  heightU: number;
  widthMm: number;
  depthMm: number;
  /** undefined = 'rack'. */
  kind?: RackKind;
}

export interface AccessoryDef {
  id: string;
  name: string;
  type: RackAccessoryType;
  widthMm?: number;
  heightU?: number;
}

export interface Catalog {
  symbols: SymbolDef[];
  footprints: FootprintDef[];
  transceivers: TransceiverDef[];
  cables: CableDef[];
  racks: RackDef[];
  trays: TrayDef[];
  accessories: AccessoryDef[];
}

// ---------------------------------------------------------------------------
// Logical (schematic)
// ---------------------------------------------------------------------------

export interface Component {
  id: Id;
  /** Reference designator, e.g. 'SW1', 'SRV12'. Auto-annotated. */
  ref: string;
  symbolDefId: string;
  /** Assigned physical model, or null when unassigned. */
  footprintDefId: string | null;
  /** Role label, e.g. 'leaf-a'. */
  value?: string;
  /** portId -> TransceiverDef.id */
  optics: Record<string, string>;
  sch: { pos: Vec2; rotation: Rotation; mirrored?: boolean; sheetId: Id };
  /** Pins the user has expanded from the '+N unused' stub. */
  expandedPins?: boolean;
}

export interface LinkEnd {
  componentId: Id;
  portId: string;
  /** Breakout lane index (0-based) when this end is one lane of a breakout port. */
  lane?: number;
}

/** The "net": always exactly two endpoints. */
export interface Link {
  id: Id;
  a: LinkEnd;
  b: LinkEnd;
  cableDefId: string | null;
  label?: string;
  /** Schematic wire geometry only (intermediate elbow points, excluding pin ends). */
  sch: { wirePoints: Vec2[] };
  /** Set when a `Cable` instance realises this link (one link per channel plugged at both ends); see src/model/cables/instances.ts. */
  cableId?: Id;
}

// ---------------------------------------------------------------------------
// Cable instances (see src/model/cables/instances.ts)
// ---------------------------------------------------------------------------

/**
 * One leg of one end of an installed cable and the port it is plugged into.
 * A cable always carries one entry per leg per side; `componentId` /
 * `portId` are null while the leg is unassigned (allowed: a sketch).
 */
export interface CablePlug {
  side: 'A' | 'B';
  /** Leg index on that side, 0-based (see `deriveSides`). */
  leg: number;
  componentId: Id | null;
  portId: string | null;
}

/**
 * An installed cable: an instance of a `CableDef`. The cable OWNS its links:
 * every channel whose fibers are plugged at both ends is realised as a plan
 * `Link` carrying `link.cableId`, so ERC / DRC / F8 / exports keep working on
 * links while renderers group them by cable to draw the jacket and fan-out.
 */
export interface Cable {
  id: Id;
  label: string;
  cableDefId: string;
  plugs: CablePlug[];
  lengthM?: number;
  /** Furcation (breakout) point per side on the floor plan, mm; pinned once the user drags it. */
  furcation?: Partial<Record<'A' | 'B', { pos: Vec2; pinned: boolean }>>;
}

/** Hierarchical sheets: 'Root', 'Spine', 'Pod A'. */
export interface Sheet {
  id: Id;
  name: string;
  parentId: Id | null;
  /** Position/size of the sheet symbol on the parent sheet. */
  sch?: { pos: Vec2; width: number; height: number };
}

// ---------------------------------------------------------------------------
// Physical (layout)
// ---------------------------------------------------------------------------

export interface Room {
  /** Polygon in mm, floor plan. */
  outline: Vec2[];
  gridMm: number;
  ceilingMm: number;
  raisedFloorMm: number;
}

export interface Rack {
  id: Id;
  name: string;
  /** Floor position in mm (top-left of the rack footprint at rotation 0). */
  pos: Vec2;
  rotationDeg: Rotation;
  heightU: number;
  widthMm: number;
  depthMm: number;
  /** Row label for place-by-rule ('A', 'B'). */
  row?: string;
  /** undefined = 'rack'. Readers use `rack.kind ?? 'rack'`; writers never store the default. */
  kind?: RackKind;
  /**
   * Optional docking of a patch frame to a device rack: the frame then keeps
   * its position relative to that rack when the rack moves. Free-standing
   * frames (the default) simply have no `attachedTo`.
   */
  attachedTo?: { rackId: Id; side: Side };
}

/** A component placed in a rack. */
export interface Placement {
  componentId: Id;
  /** null = unplaced (shows in 'Unplaced' bin). */
  rackId: Id | null;
  /** Bottom U of the device (1-based). */
  uPosition: number | null;
  /** Which rack face the device's front points to. */
  face: Face;
}

export type RoutingLayer = 'overhead' | 'underfloor' | 'in-rack';

export type TrayFittingType = 'elbow' | 'tee' | 'cross' | 'reducer' | 'waterfall';

export interface TrayFitting {
  at: Vec2;
  type: TrayFittingType;
  /** For waterfalls: the rack the cable drops into. */
  rackId?: Id;
}

export interface Tray {
  id: Id;
  kind: TrayKind;
  layer: RoutingLayer;
  /** Centreline in the floor plan, mm. */
  points: Vec2[];
  widthMm: number;
  depthMm: number;
  /** Bottom of tray above finished floor, mm (negative for underfloor). */
  elevationMm: number;
  fittings: TrayFitting[];
  name?: string;
}

export type RackAccessoryType = 'vcm' | 'hcm' | 'fiber-enclosure' | 'top-entry';

export interface RackAccessory {
  id: Id;
  rackId: Id;
  type: RackAccessoryType;
  /** For vcm and top-entry. */
  side?: Side | 'center';
  face?: Face;
  uPosition?: number;
  heightU?: number;
  widthMm?: number;
}

export interface Waypoint {
  id: Id;
  /** Floor-plan position in mm. */
  pos: Vec2;
  pinned: boolean;
  /** Anchored waypoints move with their rack by offset (in-rack dressing). */
  anchor?: { rackId: Id; offset: Vec2 };
  /** Optional service loop (coil of slack) in metres at this waypoint. */
  serviceLoopM?: number;
}

/** Auto-generated in-rack path, overridable by pinning. */
export interface InRackPath {
  /** Which vertical manager the cable uses. */
  side: Side;
  /** Top-entry accessory id, or null when the rack has none yet. */
  entry: Id | null;
  /** true once the user overrides the auto choice. */
  pinned: boolean;
}

export interface RouteSegment {
  layer: RoutingLayer;
  /** Tray this segment rides, when on overhead/underfloor. */
  trayId?: Id | null;
  points: Waypoint[];
}

export interface Route {
  /** The `Project.routes` key: the link id, or the cable id when `owner === 'cable'` (the route is then the cable's jacket). */
  linkId: Id;
  /** Who the route belongs to; undefined means 'link'. See src/model/routing/owner.ts. */
  owner?: 'link' | 'cable';
  aRack: InRackPath;
  bRack: InRackPath;
  /**
   * Hand-routed path between the two racks. A layer change between
   * consecutive segments is a drop (the via equivalent).
   */
  segments: RouteSegment[];
  /** Set when F8 re-attached an end; cleared when the user edits the route. */
  needsReview?: boolean;
}

export interface Keepout {
  id: Id;
  name: string;
  outline: Vec2[];
  kind: 'aisle' | 'wall' | 'custom';
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

export type Severity = 'error' | 'warning' | 'info' | 'ignore';

export type IssueTarget =
  | { kind: 'component'; id: Id; portId?: string }
  | { kind: 'link'; id: Id }
  | { kind: 'rack'; id: Id }
  | { kind: 'route'; id: Id }
  | { kind: 'tray'; id: Id }
  | { kind: 'sheet'; id: Id }
  | { kind: 'cable'; id: Id };

export interface Issue {
  id: string;
  rule: string;
  severity: Severity;
  message: string;
  targets: IssueTarget[];
  /** 'erc' | 'drc' */
  domain: 'erc' | 'drc';
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface ProjectSettings {
  /** Per-rule severity overrides. */
  ercSeverities: Record<string, Severity>;
  drcSeverities: Record<string, Severity>;
  /** Waypoints are pinned by default when a route is finished. */
  pinWaypointsByDefault: boolean;
  /** Tray fill warning threshold, fraction of cross-section. */
  trayFillWarn: number;
  /** Vertical manager fill warning threshold. */
  managerFillWarn: number;
  /** Route copper and fiber on opposite managers when both exist. */
  separateCopperFiber: boolean;
  /** Fractional slack added to routed lengths (0.1 = 10%). */
  slackFraction: number;
  /** Extra length per end, metres. */
  slackPerEndM: number;
}

/**
 * The layout's copy of the logical model as of the last applied Update Layout
 * (F8). Diffing the live schematic against this yields the change list, and
 * a non-empty diff means "Out of sync". Keyed by Component.id / Link.id.
 */
export interface SyncState {
  components: Record<Id, { ref: string; footprintDefId: string | null }>;
  links: Record<Id, { a: LinkEnd; b: LinkEnd }>;
}

export interface Project {
  id: Id;
  name: string;
  version: 1;
  rev: string;
  createdAt: string;
  updatedAt: string;

  // logical
  sheets: Sheet[];
  components: Component[];
  links: Link[];
  /** Installed cable instances; each owns the links it realises (`Link.cableId`). */
  cables: Cable[];

  // physical
  room: Room;
  racks: Rack[];
  placements: Placement[];
  accessories: RackAccessory[];
  trays: Tray[];
  routes: Record<Id, Route>;
  keepouts: Keepout[];
  syncState: SyncState;
  /** Layout -> schematic proposals awaiting acceptance. */
  backAnnotations: BackAnnotation[];

  customCatalog: {
    symbols: SymbolDef[];
    footprints: FootprintDef[];
    transceivers: TransceiverDef[];
    cables: CableDef[];
  };

  settings: ProjectSettings;
}

// ---------------------------------------------------------------------------
// Sync (Update Layout from Schematic)
// ---------------------------------------------------------------------------

export type SyncChange =
  | { kind: 'add-component'; componentId: Id; ref: string }
  | { kind: 'remove-component'; componentId: Id; ref: string; orphanedRouteIds: Id[] }
  | {
      kind: 'footprint-changed';
      componentId: Id;
      ref: string;
      from: string | null;
      to: string | null;
      fits: boolean;
    }
  | { kind: 'add-link'; linkId: Id; label: string }
  | { kind: 'remove-link'; linkId: Id; label: string; hadRoute: boolean }
  | { kind: 'link-endpoint-changed'; linkId: Id; label: string }
  | { kind: 'ref-renamed'; componentId: Id; from: string; to: string };

export interface SyncPlan {
  changes: SyncChange[];
}

/** Proposed layout -> schematic change awaiting user acceptance. */
export type BackAnnotation =
  | { id: Id; kind: 'port-swap'; linkId: Id; end: 'a' | 'b'; fromPortId: string; toPortId: string }
  | { id: Id; kind: 'ref-rename'; componentId: Id; from: string; to: string }
  | { id: Id; kind: 'footprint-change'; componentId: Id; from: string | null; to: string | null };

// ---------------------------------------------------------------------------
// Cross-editor selection
// ---------------------------------------------------------------------------

export type SelectionItem =
  | { kind: 'component'; id: Id }
  | { kind: 'link'; id: Id }
  | { kind: 'rack'; id: Id }
  | { kind: 'tray'; id: Id }
  | { kind: 'waypoint'; routeId: Id; segmentIndex: number; waypointId: Id }
  | { kind: 'sheet'; id: Id }
  | { kind: 'keepout'; id: Id }
  | { kind: 'accessory'; id: Id }
  | { kind: 'cable'; id: Id };

export type EditorId = 'schematic' | 'layout' | 'viewer3d';
