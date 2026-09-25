/**
 * Generates the starter catalog JSON in /src/catalog.
 * Run with: npm run gen:catalog
 *
 * Generic names only (no vendor trademarks) per the v1 spec.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type {
  AccessoryDef,
  CableDef,
  FootprintDef,
  FootprintPort,
  PortType,
  RackDef,
  SymbolDef,
  SymbolPin,
  TransceiverDef,
  TrayDef,
} from '../src/model/types';

const OUT = path.resolve(import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname), '../src/catalog');
mkdirSync(OUT, { recursive: true });

// Schematic pin pitch in schematic units.
const PITCH = 10;
// Faceplate geometry in mm (19" rack unit = 482.6 wide, 44.45 tall).
const U_MM = 44.45;
const FACE_W = 482.6;

interface PortSpec {
  prefix: string;
  start: number;
  count: number;
  type: PortType;
  speeds: number[];
  group: string;
  side: 'L' | 'R';
  face?: 'front' | 'rear';
  /** Faceplate row from bottom, 0-based. */
  row?: number;
}

function ids(spec: PortSpec): string[] {
  return Array.from({ length: spec.count }, (_, i) => `${spec.prefix}${spec.start + i}`);
}

function buildDevice(opts: {
  id: string;
  name: string;
  kind: SymbolDef['kind'];
  refPrefix: string;
  heightU: number;
  depthMm: number;
  category: string;
  groups: { id: string; name: string; role?: 'uplink' | 'downlink' | 'mgmt' | 'data' | 'front' | 'rear' }[];
  ports: PortSpec[];
  expectedUplinks?: number;
}): { symbol: SymbolDef; footprint: FootprintDef } {
  const pins: SymbolPin[] = [];
  const fports: FootprintPort[] = [];
  const sideCount: Record<'L' | 'R', number> = { L: 0, R: 0 };

  for (const spec of opts.ports) {
    const portIds = ids(spec);
    const row = spec.row ?? 0;
    // Lay ports out left-to-right across the faceplate for this spec.
    const usable = FACE_W - 40;
    const step = usable / Math.max(spec.count, 1);
    portIds.forEach((portId, i) => {
      pins.push({
        portId,
        side: spec.side,
        offset: PITCH + sideCount[spec.side] * PITCH,
        type: spec.type,
        speedsGbps: spec.speeds,
        group: spec.group,
      });
      sideCount[spec.side]++;
      fports.push({
        id: portId,
        type: spec.type,
        speedsGbps: spec.speeds,
        pos: { x: 20 + step * i + step / 2, y: 8 + row * 18 },
        face: spec.face ?? 'front',
        group: spec.group,
      });
    });
  }

  const height = Math.max(sideCount.L, sideCount.R, 2) * PITCH + PITCH * 2;
  const symbol: SymbolDef = {
    id: `sym.${opts.id}`,
    name: opts.name,
    kind: opts.kind,
    refPrefix: opts.refPrefix,
    width: 200,
    height,
    pins,
    groups: opts.groups,
    defaultFootprintIds: [`fp.${opts.id}`],
    category: opts.category,
    ...(opts.expectedUplinks !== undefined ? { expectedUplinks: opts.expectedUplinks } : {}),
  };
  const footprint: FootprintDef = {
    id: `fp.${opts.id}`,
    model: opts.name,
    kind: opts.kind,
    heightU: opts.heightU,
    depthMm: opts.depthMm,
    widthMm: FACE_W,
    ports: fports,
    category: opts.category,
  };
  return { symbol, footprint };
}

const devices = [
  buildDevice({
    id: 'leaf-switch-48x25-8x100',
    name: 'ToR / leaf switch 48×25G + 8×100G',
    kind: 'switch',
    refPrefix: 'SW',
    heightU: 1,
    depthMm: 500,
    category: 'Switches',
    groups: [
      { id: 'downlinks', name: 'Downlinks', role: 'downlink' },
      { id: 'uplinks', name: 'Uplinks', role: 'uplink' },
      { id: 'mgmt', name: 'Management', role: 'mgmt' },
    ],
    ports: [
      { prefix: 'eth1/', start: 1, count: 48, type: 'SFP28', speeds: [10, 25], group: 'downlinks', side: 'L', row: 0 },
      { prefix: 'eth1/', start: 49, count: 8, type: 'QSFP28', speeds: [40, 100], group: 'uplinks', side: 'R', row: 1 },
      { prefix: 'mgmt', start: 0, count: 1, type: 'RJ45', speeds: [1], group: 'mgmt', side: 'R', row: 1 },
    ],
  }),
  buildDevice({
    id: 'spine-switch-32x400',
    name: 'Spine switch 32×400G',
    kind: 'switch',
    refPrefix: 'SW',
    heightU: 2,
    depthMm: 600,
    category: 'Switches',
    groups: [
      { id: 'fabric', name: 'Fabric', role: 'downlink' },
      { id: 'mgmt', name: 'Management', role: 'mgmt' },
    ],
    ports: [
      { prefix: 'eth1/', start: 1, count: 16, type: 'QSFP-DD', speeds: [100, 200, 400], group: 'fabric', side: 'L', row: 0 },
      { prefix: 'eth1/', start: 17, count: 16, type: 'QSFP-DD', speeds: [100, 200, 400], group: 'fabric', side: 'R', row: 1 },
      { prefix: 'mgmt', start: 0, count: 1, type: 'RJ45', speeds: [1], group: 'mgmt', side: 'R', row: 1 },
    ],
  }),
  buildDevice({
    id: 'mgmt-switch-48x1g-4x10',
    name: 'Management switch 48×1G + 4×10G',
    kind: 'switch',
    refPrefix: 'SW',
    heightU: 1,
    depthMm: 400,
    category: 'Switches',
    groups: [
      { id: 'access', name: 'Access', role: 'downlink' },
      { id: 'uplinks', name: 'Uplinks', role: 'uplink' },
    ],
    ports: [
      { prefix: 'ge', start: 1, count: 48, type: 'RJ45', speeds: [1], group: 'access', side: 'L', row: 0 },
      { prefix: 'xe', start: 1, count: 4, type: 'SFP+', speeds: [1, 10], group: 'uplinks', side: 'R', row: 0 },
    ],
  }),
  buildDevice({
    id: 'server-1u',
    name: '1U server',
    kind: 'server',
    refPrefix: 'SRV',
    heightU: 1,
    depthMm: 750,
    category: 'Servers',
    groups: [
      { id: 'data', name: 'Data', role: 'uplink' },
      { id: 'mgmt', name: 'BMC', role: 'mgmt' },
    ],
    ports: [
      { prefix: 'eth', start: 0, count: 2, type: 'SFP28', speeds: [10, 25], group: 'data', side: 'R', row: 0 },
      { prefix: 'bmc', start: 0, count: 1, type: 'RJ45', speeds: [1], group: 'mgmt', side: 'L', row: 0 },
    ],
    expectedUplinks: 2,
  }),
  buildDevice({
    id: 'server-2u',
    name: '2U server',
    kind: 'server',
    refPrefix: 'SRV',
    heightU: 2,
    depthMm: 800,
    category: 'Servers',
    groups: [
      { id: 'data', name: 'Data', role: 'uplink' },
      { id: 'mgmt', name: 'BMC', role: 'mgmt' },
    ],
    ports: [
      { prefix: 'eth', start: 0, count: 2, type: 'QSFP28', speeds: [40, 100], group: 'data', side: 'R', row: 1 },
      { prefix: 'eth', start: 2, count: 2, type: 'SFP28', speeds: [10, 25], group: 'data', side: 'R', row: 0 },
      { prefix: 'bmc', start: 0, count: 1, type: 'RJ45', speeds: [1], group: 'mgmt', side: 'L', row: 0 },
    ],
    expectedUplinks: 2,
  }),
  buildDevice({
    id: 'gpu-server-4u',
    name: 'GPU server 4U',
    kind: 'server',
    refPrefix: 'SRV',
    heightU: 4,
    depthMm: 900,
    category: 'Servers',
    groups: [
      { id: 'fabric', name: 'GPU fabric', role: 'uplink' },
      { id: 'data', name: 'Data', role: 'data' },
      { id: 'mgmt', name: 'BMC', role: 'mgmt' },
    ],
    ports: [
      { prefix: 'osfp', start: 0, count: 8, type: 'OSFP', speeds: [400, 800], group: 'fabric', side: 'R', row: 2 },
      { prefix: 'eth', start: 0, count: 2, type: 'QSFP28', speeds: [40, 100], group: 'data', side: 'R', row: 0 },
      { prefix: 'bmc', start: 0, count: 1, type: 'RJ45', speeds: [1], group: 'mgmt', side: 'L', row: 0 },
    ],
    expectedUplinks: 8,
  }),
  buildDevice({
    id: 'fiber-patch-panel-24lc',
    name: 'Fiber patch panel 24× LC duplex',
    kind: 'patch-panel',
    refPrefix: 'PP',
    heightU: 1,
    depthMm: 300,
    category: 'Patch panels',
    groups: [
      { id: 'front', name: 'Front', role: 'front' },
      { id: 'rear', name: 'Rear', role: 'rear' },
    ],
    ports: [
      { prefix: 'f', start: 1, count: 24, type: 'LC', speeds: [1, 10, 25, 100], group: 'front', side: 'L', row: 0, face: 'front' },
      { prefix: 'r', start: 1, count: 24, type: 'LC', speeds: [1, 10, 25, 100], group: 'rear', side: 'R', row: 0, face: 'rear' },
    ],
  }),
  buildDevice({
    id: 'mpo-patch-panel-12',
    name: 'MPO patch panel 12× MPO-12',
    kind: 'patch-panel',
    refPrefix: 'PP',
    heightU: 1,
    depthMm: 300,
    category: 'Patch panels',
    groups: [
      { id: 'front', name: 'Front', role: 'front' },
      { id: 'rear', name: 'Rear', role: 'rear' },
    ],
    ports: [
      { prefix: 'f', start: 1, count: 12, type: 'MPO-12', speeds: [40, 100, 400], group: 'front', side: 'L', row: 0, face: 'front' },
      { prefix: 'r', start: 1, count: 12, type: 'MPO-12', speeds: [40, 100, 400], group: 'rear', side: 'R', row: 0, face: 'rear' },
    ],
  }),
  buildDevice({
    id: 'blank-panel-1u',
    name: 'Blank panel 1U',
    kind: 'generic',
    refPrefix: 'BLK',
    heightU: 1,
    depthMm: 10,
    category: 'Panels',
    groups: [],
    ports: [],
  }),
];

const transceivers: TransceiverDef[] = [
  { id: 'xcvr.10g-sr', name: '10G-SR', formFactor: 'SFP+', speedGbps: 10, media: 'MMF', connector: 'LC', reachM: 300, lanes: 1 },
  { id: 'xcvr.10g-lr', name: '10G-LR', formFactor: 'SFP+', speedGbps: 10, media: 'SMF', connector: 'LC', reachM: 10000, lanes: 1 },
  { id: 'xcvr.25g-sr', name: '25G-SR', formFactor: 'SFP28', speedGbps: 25, media: 'MMF', connector: 'LC', reachM: 100, lanes: 1 },
  { id: 'xcvr.25g-lr', name: '25G-LR', formFactor: 'SFP28', speedGbps: 25, media: 'SMF', connector: 'LC', reachM: 10000, lanes: 1 },
  { id: 'xcvr.100g-sr4', name: '100G-SR4', formFactor: 'QSFP28', speedGbps: 100, media: 'MMF', connector: 'MPO-12', reachM: 100, lanes: 4 },
  { id: 'xcvr.100g-lr4', name: '100G-LR4', formFactor: 'QSFP28', speedGbps: 100, media: 'SMF', connector: 'LC', reachM: 10000, lanes: 4 },
  { id: 'xcvr.400g-dr4', name: '400G-DR4', formFactor: 'QSFP-DD', speedGbps: 400, media: 'SMF', connector: 'MPO-12', reachM: 500, lanes: 4 },
  { id: 'xcvr.400g-sr8', name: '400G-SR8', formFactor: 'QSFP-DD', speedGbps: 400, media: 'MMF', connector: 'MPO-16', reachM: 100, lanes: 8 },
  { id: 'xcvr.1g-t', name: '1G-T', formFactor: 'SFP', speedGbps: 1, media: 'Copper', connector: 'RJ45', reachM: 100, lanes: 1 },
];

/**
 * Fiber cables carry both the fiber definition (fiberCount / fiberType /
 * sides / polarity, from which src/model/cables derives legs, strand map and
 * names) AND the legacy fields the ERC / BOM code reads. The legacy fields
 * are hard-coded here rather than derived because this script is compiled
 * under tsconfig.node.json, which cannot see src/model/cables; the test
 * "keeps the catalog JSON and the derivation in lock-step" in
 * src/model/cables/resolve.test.ts asserts they agree (name, endA / endB,
 * colour, diameter, breakout fanout). Existing ids keep their legacy fields
 * verbatim so nothing else in the app changes.
 */
const OM4_JACKET = '#2dd4bf';
const OS2_JACKET = '#facc15';

const cables: CableDef[] = [
  // --- Existing fiber cables, now with their fiber definition ---
  { id: 'cbl.om4-duplex', name: 'OM4 duplex', media: 'OM4', mediaClass: 'fiber', endA: 'LC', endB: 'LC', color: OM4_JACKET, bendRadiusMm: 30, diameterMm: 2, fiberCount: 2, fiberType: 'OM4', sideA: { connector: 'LC-duplex' }, sideB: { connector: 'LC-duplex' }, polarity: 'A' },
  { id: 'cbl.os2-duplex', name: 'OS2 duplex', media: 'OS2', mediaClass: 'fiber', endA: 'LC', endB: 'LC', color: OS2_JACKET, bendRadiusMm: 30, diameterMm: 2, fiberCount: 2, fiberType: 'OS2', sideA: { connector: 'LC-duplex' }, sideB: { connector: 'LC-duplex' }, polarity: 'A' },
  { id: 'cbl.om4-mpo-trunk', name: 'OM4 MPO trunk', media: 'OM4', mediaClass: 'fiber', endA: 'MPO-12', endB: 'MPO-12', color: OM4_JACKET, bendRadiusMm: 40, diameterMm: 3.5, fiberCount: 12, fiberType: 'OM4', sideA: { connector: 'MPO-12' }, sideB: { connector: 'MPO-12' }, polarity: 'B' },
  { id: 'cbl.os2-mpo-trunk', name: 'OS2 MPO trunk', media: 'OS2', mediaClass: 'fiber', endA: 'MPO-12', endB: 'MPO-12', color: OS2_JACKET, bendRadiusMm: 40, diameterMm: 3.5, fiberCount: 12, fiberType: 'OS2', sideA: { connector: 'MPO-12' }, sideB: { connector: 'MPO-12' }, polarity: 'B' },
  // The 4-lane breakout: an MPO-12 body with 8 fibers used (MPO-8) into four LC-duplex legs.
  { id: 'cbl.mpo-breakout', name: 'MPO breakout', media: 'OM4', mediaClass: 'fiber', endA: 'MPO-12', endB: 'LC', color: OM4_JACKET, bendRadiusMm: 40, diameterMm: 3.5, breakout: { fanout: 4 }, fiberCount: 8, fiberType: 'OM4', sideA: { connector: 'MPO-8' }, sideB: { connector: 'LC-duplex' }, polarity: 'B' },

  // --- Seed rows from the fiber cable task table (names are the derived display names) ---
  { id: 'cbl.om4-8f-mpo8-4lc', name: '8F OM4 MPO-8 → 4×LC-duplex', media: 'OM4', mediaClass: 'fiber', endA: 'MPO-12', endB: 'LC', color: OM4_JACKET, bendRadiusMm: 30, diameterMm: 3, breakout: { fanout: 4 }, fiberCount: 8, fiberType: 'OM4', sideA: { connector: 'MPO-8' }, sideB: { connector: 'LC-duplex' }, polarity: 'B' },
  { id: 'cbl.om4-12f-mpo12-6lc', name: '12F OM4 MPO-12 → 6×LC-duplex', media: 'OM4', mediaClass: 'fiber', endA: 'MPO-12', endB: 'LC', color: OM4_JACKET, bendRadiusMm: 35, diameterMm: 3.5, breakout: { fanout: 6 }, fiberCount: 12, fiberType: 'OM4', sideA: { connector: 'MPO-12' }, sideB: { connector: 'LC-duplex' }, polarity: 'B' },
  { id: 'cbl.om4-24f-mpo24-12lc', name: '24F OM4 MPO-24 → 12×LC-duplex', media: 'OM4', mediaClass: 'fiber', endA: 'MPO-24', endB: 'LC', color: OM4_JACKET, bendRadiusMm: 50, diameterMm: 5, breakout: { fanout: 12 }, fiberCount: 24, fiberType: 'OM4', sideA: { connector: 'MPO-24' }, sideB: { connector: 'LC-duplex' }, polarity: 'B' },
  { id: 'cbl.om4-16f-mmc16-2mpo8', name: '16F OM4 MMC-16 → 2×MPO-8', media: 'OM4', mediaClass: 'fiber', endA: 'MMC-16', endB: 'MPO-12', color: OM4_JACKET, bendRadiusMm: 40, diameterMm: 4, breakout: { fanout: 2 }, fiberCount: 16, fiberType: 'OM4', sideA: { connector: 'MMC-16' }, sideB: { connector: 'MPO-8' }, polarity: 'B' },
  { id: 'cbl.os2-24f-mpo24-2mpo12', name: '24F OS2 MPO-24 → 2×MPO-12', media: 'OS2', mediaClass: 'fiber', endA: 'MPO-24', endB: 'MPO-12', color: OS2_JACKET, bendRadiusMm: 50, diameterMm: 5, breakout: { fanout: 2 }, fiberCount: 24, fiberType: 'OS2', sideA: { connector: 'MPO-24' }, sideB: { connector: 'MPO-12' }, polarity: 'B' },
  { id: 'cbl.om4-8f-mpo8-mpo8', name: '8F OM4 MPO-8 ↔ MPO-8', media: 'OM4', mediaClass: 'fiber', endA: 'MPO-12', endB: 'MPO-12', color: OM4_JACKET, bendRadiusMm: 30, diameterMm: 3, fiberCount: 8, fiberType: 'OM4', sideA: { connector: 'MPO-8' }, sideB: { connector: 'MPO-8' }, polarity: 'B' },
  { id: 'cbl.os2-144f-12mpo12', name: '144F OS2 12×MPO-12 ↔ 12×MPO-12', media: 'OS2', mediaClass: 'fiber', endA: 'MPO-12', endB: 'MPO-12', color: OS2_JACKET, bendRadiusMm: 120, diameterMm: 12, fiberCount: 144, fiberType: 'OS2', sideA: { connector: 'MPO-12' }, sideB: { connector: 'MPO-12' }, polarity: 'B' },

  // --- Copper, DAC and AOC: legacy fields only ---
  { id: 'cbl.dac-25g', name: 'DAC 25G', media: 'DAC', mediaClass: 'copper', endA: 'integrated', endB: 'integrated', color: '#1f2937', bendRadiusMm: 50, diameterMm: 5, integrated: { formFactor: 'SFP28', speedGbps: 25, reachM: 5 } },
  { id: 'cbl.dac-100g', name: 'DAC 100G', media: 'DAC', mediaClass: 'copper', endA: 'integrated', endB: 'integrated', color: '#1f2937', bendRadiusMm: 60, diameterMm: 7, integrated: { formFactor: 'QSFP28', speedGbps: 100, reachM: 3 } },
  { id: 'cbl.dac-400g', name: 'DAC 400G', media: 'DAC', mediaClass: 'copper', endA: 'integrated', endB: 'integrated', color: '#1f2937', bendRadiusMm: 70, diameterMm: 8, integrated: { formFactor: 'QSFP-DD', speedGbps: 400, reachM: 2.5 } },
  { id: 'cbl.aoc-100g', name: 'AOC 100G', media: 'AOC', mediaClass: 'fiber', endA: 'integrated', endB: 'integrated', color: '#fb923c', bendRadiusMm: 30, diameterMm: 3, integrated: { formFactor: 'QSFP28', speedGbps: 100, reachM: 30 } },
  { id: 'cbl.aoc-400g', name: 'AOC 400G', media: 'AOC', mediaClass: 'fiber', endA: 'integrated', endB: 'integrated', color: '#fb923c', bendRadiusMm: 30, diameterMm: 3.5, integrated: { formFactor: 'QSFP-DD', speedGbps: 400, reachM: 30 } },
  { id: 'cbl.cat6a', name: 'Cat6A patch', media: 'Cat6A', mediaClass: 'copper', endA: 'RJ45', endB: 'RJ45', color: '#3b82f6', bendRadiusMm: 25, diameterMm: 6 },
];

const racks: RackDef[] = [
  { id: 'rack.standard-42u', name: 'Standard rack 42U', heightU: 42, widthMm: 600, depthMm: 1070 },
  { id: 'rack.tall-48u', name: 'Tall rack 48U', heightU: 48, widthMm: 600, depthMm: 1070 },
  { id: 'rack.network-42u', name: 'Network rack 42U (800 wide)', heightU: 42, widthMm: 800, depthMm: 1070 },
  // Patch frames: free-standing patch-panel walls, a thin 120 mm slab with the
  // panels on both faces. A panel dropped on the floor gets its own 12U wall.
  { id: 'rack.patch-frame-12u', name: 'Patch panel wall 12U', heightU: 12, widthMm: 600, depthMm: 120, kind: 'patch-frame' },
  { id: 'rack.patch-frame-42u', name: 'Patch panel wall 42U', heightU: 42, widthMm: 600, depthMm: 120, kind: 'patch-frame' },
];

const trays: TrayDef[] = [
  { id: 'tray.fiber-runway-4', name: 'Fiber runway 4"', kind: 'fiber-runway', widthMm: 102, depthMm: 50, accepts: ['fiber'] },
  { id: 'tray.fiber-runway-6', name: 'Fiber runway 6"', kind: 'fiber-runway', widthMm: 152, depthMm: 50, accepts: ['fiber'] },
  { id: 'tray.fiber-runway-12', name: 'Fiber runway 12"', kind: 'fiber-runway', widthMm: 305, depthMm: 50, accepts: ['fiber'] },
  { id: 'tray.ladder-12', name: 'Ladder rack 12"', kind: 'ladder', widthMm: 305, depthMm: 40, accepts: ['copper'] },
  { id: 'tray.ladder-18', name: 'Ladder rack 18"', kind: 'ladder', widthMm: 457, depthMm: 40, accepts: ['copper'] },
  { id: 'tray.ladder-24', name: 'Ladder rack 24"', kind: 'ladder', widthMm: 610, depthMm: 40, accepts: ['copper'] },
  { id: 'tray.basket-200', name: 'Wire basket 200 mm', kind: 'basket', widthMm: 200, depthMm: 60, accepts: ['copper', 'fiber'] },
  { id: 'tray.basket-300', name: 'Wire basket 300 mm', kind: 'basket', widthMm: 300, depthMm: 60, accepts: ['copper', 'fiber'] },
];

const accessories: AccessoryDef[] = [
  { id: 'acc.vcm-6', name: 'Vertical cable manager 6"', type: 'vcm', widthMm: 152 },
  { id: 'acc.vcm-10', name: 'Vertical cable manager 10"', type: 'vcm', widthMm: 254 },
  { id: 'acc.vcm-12', name: 'Vertical cable manager 12"', type: 'vcm', widthMm: 305 },
  { id: 'acc.hcm-1u', name: 'Horizontal cable manager 1U', type: 'hcm', heightU: 1 },
  { id: 'acc.hcm-2u', name: 'Horizontal cable manager 2U', type: 'hcm', heightU: 2 },
  { id: 'acc.fiber-enclosure-1u', name: 'Fiber enclosure 1U', type: 'fiber-enclosure', heightU: 1 },
  { id: 'acc.fiber-enclosure-2u', name: 'Fiber enclosure 2U', type: 'fiber-enclosure', heightU: 2 },
  { id: 'acc.top-entry', name: 'Rack top entry (brush)', type: 'top-entry' },
];

/**
 * Fiber connector rows for src/model/cables. Mirrors `ConnectorDef` in
 * src/model/cables/connectors.ts; declared locally because tsconfig.node.json
 * is a composite project that lists only src/model/types.ts from src.
 */
interface ConnectorRow {
  id: string;
  name: string;
  family: 'small' | 'multi';
  vsff: boolean;
  positions: number;
  positionsUsed: number[];
  fibersUsed: number;
  genderOptions?: ('pinned' | 'unpinned')[];
  color: string;
  /** The name the ERC rules / transceivers / legacy CableDef ends use. */
  legacyConnector: string;
}

const range1 = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);
const MPO_GENDERS: ('pinned' | 'unpinned')[] = ['pinned', 'unpinned'];
// Boot colours are display defaults only (aqua on MPO-8/12 reflects their MMF use).
const LC_BOOT = '#d9c9a5';
const VSFF_DUPLEX_BOOT = '#9fd3c7';
const MPO12_BOOT = '#5cc8c1';
const MPO16_BOOT = '#7fb0ff';
const MMC_BOOT = '#c9a8ff';

const connectors: ConnectorRow[] = [
  { id: 'LC-simplex', name: 'LC simplex', family: 'small', vsff: false, positions: 1, positionsUsed: [1], fibersUsed: 1, color: LC_BOOT, legacyConnector: 'LC' },
  { id: 'LC-duplex', name: 'LC duplex', family: 'small', vsff: false, positions: 2, positionsUsed: [1, 2], fibersUsed: 2, color: LC_BOOT, legacyConnector: 'LC' },
  { id: 'SN-duplex', name: 'SN duplex', family: 'small', vsff: true, positions: 2, positionsUsed: [1, 2], fibersUsed: 2, color: VSFF_DUPLEX_BOOT, legacyConnector: 'SN' },
  { id: 'CS-duplex', name: 'CS duplex', family: 'small', vsff: true, positions: 2, positionsUsed: [1, 2], fibersUsed: 2, color: VSFF_DUPLEX_BOOT, legacyConnector: 'CS' },
  // MPO-8 is an MPO-12 body with the four centre positions unpopulated.
  { id: 'MPO-8', name: 'MPO-8', family: 'multi', vsff: false, positions: 12, positionsUsed: [1, 2, 3, 4, 9, 10, 11, 12], fibersUsed: 8, genderOptions: MPO_GENDERS, color: MPO12_BOOT, legacyConnector: 'MPO-12' },
  { id: 'MPO-12', name: 'MPO-12', family: 'multi', vsff: false, positions: 12, positionsUsed: range1(12), fibersUsed: 12, genderOptions: MPO_GENDERS, color: MPO12_BOOT, legacyConnector: 'MPO-12' },
  { id: 'MPO-16', name: 'MPO-16', family: 'multi', vsff: false, positions: 16, positionsUsed: range1(16), fibersUsed: 16, genderOptions: MPO_GENDERS, color: MPO16_BOOT, legacyConnector: 'MPO-16' },
  { id: 'MPO-24', name: 'MPO-24', family: 'multi', vsff: false, positions: 24, positionsUsed: range1(24), fibersUsed: 24, genderOptions: MPO_GENDERS, color: MPO16_BOOT, legacyConnector: 'MPO-24' },
  { id: 'MMC-16', name: 'MMC-16', family: 'multi', vsff: true, positions: 16, positionsUsed: range1(16), fibersUsed: 16, genderOptions: MPO_GENDERS, color: MMC_BOOT, legacyConnector: 'MMC-16' },
  { id: 'MMC-24', name: 'MMC-24', family: 'multi', vsff: true, positions: 24, positionsUsed: range1(24), fibersUsed: 24, genderOptions: MPO_GENDERS, color: MMC_BOOT, legacyConnector: 'MMC-24' },
];

const w = (file: string, data: unknown) =>
  writeFileSync(path.join(OUT, file), JSON.stringify(data, null, 2) + '\n');

w('symbols.json', devices.map((d) => d.symbol));
w('footprints.json', devices.map((d) => d.footprint));
w('transceivers.json', transceivers);
w('cables.json', cables);
w('racks.json', racks);
w('trays.json', trays);
w('accessories.json', accessories);
w('connectors.json', connectors);

console.log(
  `catalog written: ${devices.length} devices, ${transceivers.length} optics, ${cables.length} cables, ${racks.length} racks, ${trays.length} trays, ${accessories.length} accessories, ${connectors.length} connectors`,
);
