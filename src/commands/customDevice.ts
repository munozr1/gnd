/**
 * Custom device form -> SymbolDef + FootprintDef. Pure: the command in
 * ./schematic.ts pushes the result into `project.customCatalog`.
 *
 * Symbol layout follows the built-in catalog: pins on the left/right edges at
 * PIN_PITCH spacing starting one pitch down, body 200 wide and tall enough for
 * the fuller side. Footprint ports are spread evenly across the faceplate.
 */
import { resolveCatalog } from '@/catalog';
import { U_MM, DEFAULT_DEVICE_WIDTH_MM } from '@/model/routing';
import { MIN_BODY_SIZE, PIN_PITCH } from '@/model/schematic';
import type {
  DeviceKind,
  Face,
  FootprintDef,
  FootprintPort,
  PinSide,
  PortGroup,
  PortType,
  Project,
  SymbolDef,
  SymbolPin,
} from '@/model/types';

export type PortRole = NonNullable<PortGroup['role']>;

export interface CustomPortSpec {
  id: string;
  type: PortType;
  /** Defaults per port type (25 for SFP28, 100 for QSFP28, ...). */
  speedsGbps?: number[];
  /** Faceplate the port is on; default 'front'. */
  face?: Face;
  /** Role drives the pin side (downlink/front left, uplink/rear/data right) and the port group. */
  role?: PortRole;
}

export interface CustomDeviceForm {
  name: string;
  kind: DeviceKind;
  heightU: number;
  /** Default 500 mm. */
  depthMm?: number;
  /** Default 19" (482.6 mm). */
  widthMm?: number;
  vendor?: string;
  /** Annotation prefix; defaults by kind (switch SW, server SRV, patch-panel PP, router RTR, firewall FW, generic U). */
  refPrefix?: string;
  category?: string;
  /** Expected uplinks for the ERC single-homed rule. */
  expectedUplinks?: number;
  ports: CustomPortSpec[];
}

export interface CustomDevice {
  symbol: SymbolDef;
  footprint: FootprintDef;
}

export const DEFAULT_REF_PREFIX: Record<DeviceKind, string> = {
  switch: 'SW',
  server: 'SRV',
  'patch-panel': 'PP',
  router: 'RTR',
  firewall: 'FW',
  generic: 'U',
};

const DEFAULT_SPEEDS: Record<PortType, number[]> = {
  SFP: [1],
  'SFP+': [1, 10],
  SFP28: [10, 25],
  'QSFP+': [40],
  QSFP28: [40, 100],
  QSFP56: [100, 200],
  'QSFP-DD': [100, 400],
  OSFP: [400, 800],
  RJ45: [1],
  LC: [10, 25, 100],
  'MPO-12': [40, 100, 400],
};

const GROUP_NAMES: Record<PortRole, string> = {
  uplink: 'Uplinks',
  downlink: 'Downlinks',
  mgmt: 'Management',
  data: 'Data',
  front: 'Front',
  rear: 'Rear',
};

export const DEVICE_KINDS: readonly DeviceKind[] = ['switch', 'server', 'patch-panel', 'router', 'firewall', 'generic'];

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Error message for an invalid form, or null when it can be built. */
export function validateCustomDevice(form: CustomDeviceForm): string | null {
  if (!form.name.trim()) return 'Device name cannot be empty';
  if (!DEVICE_KINDS.includes(form.kind)) return `Unknown device kind '${form.kind}'`;
  if (!Number.isInteger(form.heightU) || form.heightU < 1) return 'Height must be a whole number of U (1 or more)';
  if (form.depthMm !== undefined && !(form.depthMm > 0)) return 'Depth must be positive';
  if (form.widthMm !== undefined && !(form.widthMm > 0)) return 'Width must be positive';
  if (form.refPrefix !== undefined && !/^[A-Za-z]+$/.test(form.refPrefix)) return 'Ref prefix must be letters only';
  const seen = new Set<string>();
  for (const p of form.ports) {
    const id = p.id.trim();
    if (!id) return 'Every port needs an id';
    if (seen.has(id)) return `Port id '${id}' is listed twice`;
    seen.add(id);
    if (!(p.type in DEFAULT_SPEEDS)) return `Port '${id}' has unknown type '${p.type}'`;
    if (p.speedsGbps !== undefined && p.speedsGbps.some((s) => !(s > 0))) return `Port '${id}' has an invalid speed`;
  }
  return null;
}

type LR = Extract<PinSide, 'L' | 'R'>;

const sideForRole = (role: PortRole | undefined): LR | null => {
  switch (role) {
    case 'downlink':
    case 'front':
      return 'L';
    case 'uplink':
    case 'rear':
    case 'data':
      return 'R';
    default:
      return null;
  }
};

/**
 * Build the defs. Ids are `sym.custom.<slug>` / `fp.custom.<slug>`, suffixed
 * with -2, -3, ... when the project's catalog already has them. Throws on an
 * invalid form (see `validateCustomDevice`).
 */
export function buildCustomDevice(form: CustomDeviceForm, project?: Pick<Project, 'customCatalog'> | null): CustomDevice {
  const error = validateCustomDevice(form);
  if (error) throw new Error(error);
  const catalog = resolveCatalog(project);
  const name = form.name.trim();
  const slug = slugify(name) || 'device';
  const symbolId = uniqueId(`sym.custom.${slug}`, new Set(catalog.symbols.map((s) => s.id)));
  const footprintId = uniqueId(`fp.custom.${slug}`, new Set(catalog.footprints.map((f) => f.id)));
  const widthMm = form.widthMm ?? DEFAULT_DEVICE_WIDTH_MM;
  const depthMm = form.depthMm ?? 500;

  // Pins: role decides the side; roleless ports (and mgmt) go to the emptier side.
  const perSide: Record<LR, number> = { L: 0, R: 0 };
  const pins: SymbolPin[] = [];
  const roles = new Set<PortRole>();
  const undecided: SymbolPin[] = [];
  for (const p of form.ports) {
    const pin: SymbolPin = {
      portId: p.id.trim(),
      side: 'L',
      offset: 0,
      type: p.type,
      speedsGbps: [...(p.speedsGbps ?? DEFAULT_SPEEDS[p.type])],
      ...(p.role !== undefined ? { group: p.role } : {}),
    };
    if (p.role) roles.add(p.role);
    pins.push(pin);
    const side = sideForRole(p.role);
    if (side) {
      pin.side = side;
      perSide[side]++;
    } else {
      undecided.push(pin);
    }
  }
  for (const pin of undecided) {
    const side: LR = perSide.R < perSide.L ? 'R' : 'L';
    pin.side = side;
    perSide[side]++;
  }
  const offsets: Record<LR, number> = { L: 0, R: 0 };
  for (const pin of pins) {
    const side = pin.side as LR;
    offsets[side] += PIN_PITCH;
    pin.offset = offsets[side];
  }
  const height = Math.max(MIN_BODY_SIZE, Math.max(perSide.L, perSide.R) * PIN_PITCH + 2 * PIN_PITCH);

  const groups: PortGroup[] = [...roles].map((role) => ({ id: role, name: GROUP_NAMES[role], role }));

  const symbol: SymbolDef = {
    id: symbolId,
    name,
    kind: form.kind,
    refPrefix: form.refPrefix ?? DEFAULT_REF_PREFIX[form.kind],
    width: 200,
    height,
    pins,
    ...(groups.length ? { groups } : {}),
    defaultFootprintIds: [footprintId],
    category: form.category ?? 'Custom',
    ...(form.expectedUplinks !== undefined ? { expectedUplinks: form.expectedUplinks } : {}),
  };

  // Footprint ports: evenly spaced across each faceplate, one row per U centre.
  const byFace: Record<Face, CustomPortSpec[]> = { front: [], rear: [] };
  for (const p of form.ports) byFace[p.face ?? 'front'].push(p);
  const y = form.heightU === 1 ? 8 : (form.heightU * U_MM) / 2;
  const ports: FootprintPort[] = [];
  for (const face of ['front', 'rear'] as const) {
    const list = byFace[face];
    list.forEach((p, i) => {
      ports.push({
        id: p.id.trim(),
        type: p.type,
        speedsGbps: [...(p.speedsGbps ?? DEFAULT_SPEEDS[p.type])],
        pos: { x: round1((widthMm * (i + 1)) / (list.length + 1)), y },
        face,
        ...(p.role !== undefined ? { group: p.role } : {}),
      });
    });
  }

  const footprint: FootprintDef = {
    id: footprintId,
    model: name,
    ...(form.vendor !== undefined && form.vendor.trim() ? { vendor: form.vendor.trim() } : {}),
    kind: form.kind,
    heightU: form.heightU,
    depthMm,
    widthMm,
    ports,
    category: form.category ?? 'Custom',
  };

  return { symbol, footprint };
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
