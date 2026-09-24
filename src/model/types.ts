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

export interface RackDef {
  id: string;
  name: string;
  heightU: number;
  widthMm: number;
  depthMm: number;
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
  linkId: Id;
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
  | { kind: 'sheet'; id: Id };

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
  | { kind: 'accessory'; id: Id };

export type EditorId = 'schematic' | 'layout' | 'viewer3d';
