/**
 * Performance fixture: 50 racks in 5 rows of 10, 20 devices per rack (a
 * leaf, a management switch, an LC patch panel and 2U servers), 4 spines,
 * ~5,000 links and routes on ~40% of them.
 *
 * Link budget per rack with the defaults: 34 server data links (dual-homed
 * 25G), 17 BMC links (Cat6A), a 17-node 100G AOC ring, one management
 * uplink, 13 leaf → patch-panel links, plus the leaf's fabric uplinks. The
 * remainder up to `linksTarget` is filled deterministically with cross-rack
 * links between neighbouring racks (patch-panel trunks, Cat6A between
 * management switches, leaf-to-leaf peer links) drawn from the free ports.
 * `linksTarget` is a cap: no link is added past it (the fabric mesh is
 * always built in full).
 */
import { rackCenter } from '../routing/positions';
import { annotate } from '../schematic/annotate';
import type { Component, Id, Project, Rack } from '../types';
import {
  CABLE,
  LADDER_ELEVATION_MM,
  LEAF_DOWNLINKS,
  LEAF_UPLINKS,
  MGMT_ACCESS_PORTS,
  MGMT_UPLINKS,
  PANEL_PORTS,
  RACK_DEF,
  RACK_GAP_MM,
  RUNWAY_ELEVATION_MM,
  SCH_COLUMN_W,
  SCH_MARGIN,
  SPINE_PORTS,
  SYM,
  TRAY_DEF,
  XCVR,
  addBackboneTray,
  addDevice,
  addRackRow,
  addRowTray,
  addSheet,
  connect,
  finishProject,
  fitRack,
  leafDownlink,
  leafUplink,
  meshFabric,
  mgmtAccess,
  mgmtUplink,
  panelFront,
  panelRear,
  place,
  rackDef,
  routeShare,
  sheetSlot,
  startProject,
  syncLayout,
  type TrayNetwork,
  type TrayNetworks,
} from './shared';

export interface LargeOptions {
  /** Racks in total (default 50), laid out `racksPerRow` per row. */
  racks?: number;
  /** Devices per rack: leaf, management switch, patch panel, then servers (default 20). */
  devicesPerRack?: number;
  /** Cap on the number of links (default 5000). */
  linksTarget?: number;
  /** Spine switches, placed in the first racks (default 4). */
  spines?: number;
  /** Racks per row (default 10). */
  racksPerRow?: number;
  /** Share of links that get a hand route (default 0.4). */
  routedFraction?: number;
}

const RACK_HEIGHT_U = 42;
/** Row pitch: rack depth 1070 plus a walkway, on the 600 mm grid. */
const ROW_PITCH_MM = 2400;
const MARGIN_MM = 1200;
const RACK_PITCH_MM = 600 + RACK_GAP_MM;
/** Row trays sit either side of the rack centreline. */
const TRAY_OFFSET_MM = 250;

const SCH_SERVER_Y0 = SCH_MARGIN + 560;

interface Pools {
  sfp28: string[];
  qsfp28: string[];
  rj45: string[];
  sfpPlus: string[];
  lcRear: string[];
}

interface RackUnit {
  rack: Rack;
  row: number;
  col: number;
  leaf: Component;
  mgmt: Component | null;
  panel: Component | null;
  spine: Component | null;
  servers: Component[];
  serverU: 1 | 2;
  pools: Pools;
}

type PoolKey = keyof Pools;

/** Cross-rack fill classes, in the order they are drawn from each rack pair. */
const FILL: readonly { pool: PoolKey; cable: string; optic?: string }[] = [
  { pool: 'lcRear', cable: CABLE.om4Duplex },
  { pool: 'rj45', cable: CABLE.cat6a },
  { pool: 'sfp28', cable: CABLE.om4Duplex, optic: XCVR.sr25 },
  { pool: 'qsfp28', cable: CABLE.om4Trunk, optic: XCVR.sr4_100 },
  { pool: 'sfpPlus', cable: CABLE.om4Duplex, optic: XCVR.sr10 },
];

const poolOwner = (u: RackUnit, pool: PoolKey): Component | null =>
  pool === 'rj45' || pool === 'sfpPlus' ? u.mgmt : pool === 'lcRear' ? u.panel : u.leaf;

const range = (from: number, to: number, f: (n: number) => string): string[] =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => f(from + i));

const rowLabel = (r: number): string => {
  const letter = String.fromCharCode(65 + (r % 26));
  return r < 26 ? letter : `${letter}${Math.floor(r / 26)}`;
};

const ceilToGrid = (mm: number, grid: number): number => Math.ceil(mm / grid) * grid;

export function buildLargeProject(opts: LargeOptions = {}): Project {
  const rackCount = Math.max(1, Math.floor(opts.racks ?? 50));
  const devicesPerRack = Math.max(1, Math.floor(opts.devicesPerRack ?? 20));
  const linksTarget = Math.max(0, Math.floor(opts.linksTarget ?? 5000));
  const spineCount = Math.max(0, Math.floor(opts.spines ?? 4));
  const racksPerRow = Math.max(1, Math.floor(opts.racksPerRow ?? 10));
  const routedFraction = Math.min(1, Math.max(0, opts.routedFraction ?? 0.4));

  const ctx = startProject('Large site');
  const rows = Math.ceil(rackCount / racksPerRow);
  const cols = Math.min(rackCount, racksPerRow);

  // -- Physical: rows of standard racks, a fiber runway and a copper ladder per row, backbones at the ends.
  const roomW = ceilToGrid(MARGIN_MM + cols * RACK_PITCH_MM - RACK_GAP_MM + MARGIN_MM, 600);
  const roomH = ceilToGrid(MARGIN_MM + (rows - 1) * ROW_PITCH_MM + rackDef(RACK_DEF.standard).depthMm + MARGIN_MM, 600);
  ctx.project.room = {
    outline: [
      { x: 0, y: 0 },
      { x: roomW, y: 0 },
      { x: roomW, y: roomH },
      { x: 0, y: roomH },
    ],
    gridMm: 600,
    ceilingMm: 3200,
    raisedFloorMm: 300,
  };

  const rackByIndex: Rack[] = [];
  const fiber: TrayNetwork = { byRack: new Map(), backbone: null };
  const copper: TrayNetwork = { byRack: new Map(), backbone: null };
  const trayX0 = MARGIN_MM / 2;
  const trayX1 = roomW - MARGIN_MM / 2;
  const runwayYs: number[] = [];
  const ladderYs: number[] = [];
  for (let r = 0; r < rows; r++) {
    const label = rowLabel(r);
    const inRow = Math.min(racksPerRow, rackCount - r * racksPerRow);
    const racks = addRackRow(ctx, {
      origin: { x: MARGIN_MM, y: MARGIN_MM + r * ROW_PITCH_MM },
      gapMm: RACK_GAP_MM,
      row: label,
      racks: Array.from({ length: inRow }, (_, c) => ({ name: `${label}${String(c + 1).padStart(2, '0')}`, defId: RACK_DEF.standard })),
    });
    for (const rack of racks) {
      fitRack(ctx, rack);
      rackByIndex.push(rack);
    }
    const centreY = rackCenter(racks[0]!).y;
    const runwayY = centreY - TRAY_OFFSET_MM;
    const ladderY = centreY + TRAY_OFFSET_MM;
    const runway = addRowTray(ctx, {
      defId: TRAY_DEF.runway6,
      name: `Runway ${label}`,
      y: runwayY,
      x0: trayX0,
      x1: trayX1,
      elevationMm: RUNWAY_ELEVATION_MM,
      racks,
    });
    const ladder = addRowTray(ctx, {
      defId: TRAY_DEF.ladder12,
      name: `Ladder ${label}`,
      y: ladderY,
      x0: trayX0,
      x1: trayX1,
      elevationMm: LADDER_ELEVATION_MM,
      racks,
    });
    for (const rack of racks) {
      fiber.byRack.set(rack.id, { trayId: runway.id, y: runwayY });
      copper.byRack.set(rack.id, { trayId: ladder.id, y: ladderY });
    }
    runwayYs.push(runwayY);
    ladderYs.push(ladderY);
  }
  if (rows > 1) {
    const fiberBackbone = addBackboneTray(ctx, {
      defId: TRAY_DEF.runway12,
      name: 'Runway backbone',
      x: trayX0,
      y0: runwayYs[0]!,
      y1: runwayYs[runwayYs.length - 1]!,
      elevationMm: RUNWAY_ELEVATION_MM,
      junctionYs: runwayYs,
    });
    const copperBackbone = addBackboneTray(ctx, {
      defId: TRAY_DEF.ladder18,
      name: 'Ladder backbone',
      x: trayX1,
      y0: ladderYs[0]!,
      y1: ladderYs[ladderYs.length - 1]!,
      elevationMm: LADDER_ELEVATION_MM,
      junctionYs: ladderYs,
    });
    fiber.backbone = { trayId: fiberBackbone.id, x: trayX0 };
    copper.backbone = { trayId: copperBackbone.id, x: trayX1 };
  }

  // -- Schematic: a 'Spine' sheet and one sheet per row, one column per rack.
  const spineSheet = addSheet(ctx, 'Spine', sheetSlot(0));
  const rowSheets = Array.from({ length: rows }, (_, r) => addSheet(ctx, `Row ${rowLabel(r)}`, sheetSlot(r + 1)));
  const spines = Array.from({ length: spineCount }, (_, j) =>
    addDevice(ctx, SYM.spine, spineSheet.id, { x: SCH_MARGIN + j * 320, y: SCH_MARGIN }, 'spine'),
  );

  const units: RackUnit[] = [];
  for (let i = 0; i < rackCount; i++) {
    const rack = rackByIndex[i]!;
    const row = Math.floor(i / racksPerRow);
    const col = i % racksPerRow;
    const sheetId = rowSheets[row]!.id;
    const x = SCH_MARGIN + col * SCH_COLUMN_W;
    const spine = i < spineCount ? spines[i]! : null;
    const hasMgmt = devicesPerRack >= 2;
    const hasPanel = devicesPerRack >= 3;
    const leaf = addDevice(ctx, SYM.leaf, sheetId, { x, y: SCH_MARGIN }, 'leaf');
    const mgmt = hasMgmt ? addDevice(ctx, SYM.mgmt, sheetId, { x: x + 340, y: SCH_MARGIN }, 'mgmt') : null;
    const panel = hasPanel ? addDevice(ctx, SYM.lcPanel, sheetId, { x: x + 340, y: SCH_MARGIN + 240 }, 'patch') : null;
    const wanted = devicesPerRack - 1 - (mgmt ? 1 : 0) - (panel ? 1 : 0);
    const freeU = RACK_HEIGHT_U - 1 - (mgmt ? 1 : 0) - (panel ? 1 : 0) - (spine ? 2 : 0);
    const serverU: 1 | 2 = wanted * 2 <= freeU ? 2 : 1;
    const serverCount = Math.min(wanted, Math.floor(freeU / serverU));
    const servers = Array.from({ length: serverCount }, (_, s) =>
      addDevice(
        ctx,
        serverU === 2 ? SYM.server2u : SYM.server1u,
        sheetId,
        { x: x + 60, y: SCH_SERVER_Y0 + s * (serverU === 2 ? 80 : 60) },
        'server',
      ),
    );
    units.push({
      rack,
      row,
      col,
      leaf,
      mgmt,
      panel,
      spine,
      servers,
      serverU,
      pools: { sfp28: [], qsfp28: [], rj45: [], sfpPlus: [], lcRear: [] },
    });
  }

  // -- Fabric: pods of at most 32 leafs, each fully meshed to its share of the spines.
  const leafs = units.map((u) => u.leaf);
  const pods = Math.max(1, Math.ceil(leafs.length / SPINE_PORTS));
  const spinesPerPod = spineCount === 0 ? 0 : Math.max(1, Math.floor(spineCount / pods));
  const uplinksUsed = new Map<Id, number>();
  for (let p = 0; p < pods; p++) {
    const podLeafs = leafs.slice(p * SPINE_PORTS, (p + 1) * SPINE_PORTS);
    const podSpines =
      spineCount === 0
        ? []
        : spineCount >= pods
          ? spines.slice(p * spinesPerPod, (p + 1) * spinesPerPod)
          : [spines[p % spineCount]!];
    meshFabric(ctx, podLeafs, podSpines, `FAB${p + 1}-`);
    for (const leaf of podLeafs) uplinksUsed.set(leaf.id, Math.min(LEAF_UPLINKS, podSpines.length));
  }

  // -- In-rack links and the free-port pools.
  const canLink = (): boolean => ctx.project.links.length < linksTarget;
  for (const u of units) {
    let d = 1;
    const nextDownlink = (): string | null => (d <= LEAF_DOWNLINKS ? leafDownlink(d++) : null);
    const dataPorts: readonly string[] = u.serverU === 2 ? ['eth2', 'eth3'] : ['eth0', 'eth1'];
    u.servers.forEach((srv, s) => {
      for (const port of dataPorts) {
        const dl = canLink() ? nextDownlink() : null;
        if (dl) connect(ctx, { c: srv, port, optic: XCVR.sr25 }, { c: u.leaf, port: dl, optic: XCVR.sr25 }, CABLE.om4Duplex);
      }
      if (u.mgmt && s < MGMT_ACCESS_PORTS && canLink()) {
        connect(ctx, { c: srv, port: 'bmc0' }, { c: u.mgmt, port: mgmtAccess(s + 1) }, CABLE.cat6a);
      }
    });
    if (u.serverU === 2 && u.servers.length >= 2) {
      u.servers.forEach((srv, s) => {
        const next = u.servers[(s + 1) % u.servers.length]!;
        if (canLink()) connect(ctx, { c: srv, port: 'eth0' }, { c: next, port: 'eth1' }, CABLE.aoc100, `RING-${srv.ref}`);
      });
    }
    let mgmtUplinksUsed = 0;
    if (u.mgmt && canLink()) {
      const dl = nextDownlink();
      if (dl) {
        connect(ctx, { c: u.mgmt, port: mgmtUplink(1), optic: XCVR.sr10 }, { c: u.leaf, port: dl, optic: XCVR.sr10 }, CABLE.om4Duplex);
        mgmtUplinksUsed = 1;
      }
    }
    if (u.panel) {
      for (let f = 1; f <= PANEL_PORTS && canLink(); f++) {
        const dl = nextDownlink();
        if (!dl) break;
        connect(ctx, { c: u.leaf, port: dl, optic: XCVR.sr25 }, { c: u.panel, port: panelFront(f) }, CABLE.om4Duplex);
      }
    }
    u.pools.sfp28 = range(d, LEAF_DOWNLINKS, leafDownlink);
    u.pools.qsfp28 = range((uplinksUsed.get(u.leaf.id) ?? 0) + 1, LEAF_UPLINKS, leafUplink);
    u.pools.rj45 = u.mgmt ? range(Math.min(u.servers.length, MGMT_ACCESS_PORTS) + 1, MGMT_ACCESS_PORTS, mgmtAccess) : [];
    u.pools.sfpPlus = u.mgmt ? range(mgmtUplinksUsed + 1, MGMT_UPLINKS, mgmtUplink) : [];
    u.pools.lcRear = u.panel ? range(1, PANEL_PORTS, panelRear) : [];
  }

  // -- Cross-rack fill up to the target: neighbouring racks along the row, then down the column.
  const pairs: [RackUnit, RackUnit][] = [];
  const at = (row: number, col: number): RackUnit | undefined =>
    col < racksPerRow ? units[row * racksPerRow + col] : undefined;
  for (const u of units) {
    const right = at(u.row, u.col + 1);
    if (right) pairs.push([u, right]);
  }
  for (const u of units) {
    const below = at(u.row + 1, u.col);
    if (below) pairs.push([u, below]);
  }
  let progress = true;
  while (canLink() && progress) {
    progress = false;
    for (const [u, v] of pairs) {
      for (const f of FILL) {
        if (!canLink()) break;
        const cu = poolOwner(u, f.pool);
        const cv = poolOwner(v, f.pool);
        const pu = u.pools[f.pool];
        const pv = v.pools[f.pool];
        if (!cu || !cv || pu.length === 0 || pv.length === 0) continue;
        connect(ctx, { c: cu, port: pu.shift()!, optic: f.optic }, { c: cv, port: pv.shift()!, optic: f.optic }, f.cable);
        progress = true;
      }
    }
  }

  annotate(ctx.project, { scope: 'unannotated' });

  // Placements: switches at the top, spine below them, servers bottom-up.
  for (const u of units) {
    let top = RACK_HEIGHT_U;
    place(ctx, u.leaf, u.rack, top--);
    if (u.mgmt) place(ctx, u.mgmt, u.rack, top--);
    if (u.panel) place(ctx, u.panel, u.rack, top--);
    if (u.spine) {
      place(ctx, u.spine, u.rack, top - 1);
      top -= 2;
    }
    u.servers.forEach((srv, s) => place(ctx, srv, u.rack, 1 + s * u.serverU));
  }

  syncLayout(ctx);

  const nets: TrayNetworks = { fiber, copper };
  routeShare(ctx, routedFraction, nets);

  return finishProject(ctx);
}
