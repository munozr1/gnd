/**
 * "Demo pod": the acceptance-criteria fabric (2 spines × 8 leafs, full mesh)
 * with dual-homed 1U servers, placed in one row of racks under a fiber
 * runway, synced (F8) and about a quarter routed so the layout shows both
 * routed cables and airwires. ERC has no errors; DRC only warns (unrouted).
 */
import { defaultRoom } from '../factories';
import { rackCenter } from '../routing/positions';
import { annotate } from '../schematic/annotate';
import type { Component, Project } from '../types';
import {
  CABLE,
  LEAF_DOWNLINKS,
  RACK_DEF,
  RACK_GAP_MM,
  RUNWAY_ELEVATION_MM,
  SCH_COLUMN_W,
  SCH_MARGIN,
  SYM,
  TRAY_DEF,
  XCVR,
  addDevice,
  addRackRow,
  addRowTray,
  addSheet,
  connect,
  finishProject,
  fitRack,
  leafDownlink,
  meshFabric,
  place,
  rackDef,
  routeShare,
  sheetSlot,
  startProject,
  syncLayout,
  type DemoContext,
  type TrayNetworks,
} from './shared';

export interface PodOptions {
  /** Spine switches (default 2). */
  spines?: number;
  /** Leaf switches, paired A/B (default 8). */
  leafs?: number;
  /** Servers per leaf pair, each dual-homed to both leafs of the pair (default 8). */
  serversPerLeaf?: number;
}

/** Leafs take the top two U of their rack; servers fill from U1. */
const LEAF_A_U = 42;
const LEAF_B_U = 41;
const SPINE_U = 41;
const MAX_SERVERS_PER_PAIR = LEAF_B_U - 1;
/** Share of links that get a hand route. */
const ROUTED_FRACTION = 0.25;

const SCH_ROW_Y = SCH_MARGIN;
/** y of the first server under a leaf pair (a collapsed leaf is ~140 tall). */
const SCH_SERVER_Y0 = SCH_MARGIN + 240;
const SCH_SERVER_PITCH = 60;

interface LeafPair {
  a: Component;
  /** Same as `a` for an unpaired trailing leaf. */
  b: Component;
  servers: Component[];
}

/** eth0/eth1 -> a leaf downlink, 25G-SR at both ends over OM4 duplex. */
function connectServer(ctx: DemoContext, srv: Component, port: 'eth0' | 'eth1', leaf: Component, leafPort: string): void {
  connect(ctx, { c: srv, port, optic: XCVR.sr25 }, { c: leaf, port: leafPort, optic: XCVR.sr25 }, CABLE.om4Duplex);
}

export function buildPodProject(opts: PodOptions = {}): Project {
  const spineCount = Math.max(1, Math.floor(opts.spines ?? 2));
  const leafCount = Math.max(1, Math.floor(opts.leafs ?? 8));
  const serversPerLeaf = Math.max(0, Math.floor(opts.serversPerLeaf ?? 8));
  if (serversPerLeaf > MAX_SERVERS_PER_PAIR) {
    throw new RangeError(`demo pod: at most ${MAX_SERVERS_PER_PAIR} servers fit under a leaf pair`);
  }

  const ctx = startProject('Demo pod');
  ctx.project.room = defaultRoom();

  // -- Schematic: 'Spine' sheet with the spines, 'Pod A' with leaf pairs and server columns.
  const spineSheet = addSheet(ctx, 'Spine', sheetSlot(0));
  const podSheet = addSheet(ctx, 'Pod A', sheetSlot(1));

  const spines = Array.from({ length: spineCount }, (_, j) =>
    addDevice(ctx, SYM.spine, spineSheet.id, { x: SCH_MARGIN + j * 320, y: SCH_ROW_Y }, 'spine'),
  );

  const pairs: LeafPair[] = [];
  for (let k = 0; k * 2 < leafCount; k++) {
    const x = SCH_MARGIN + k * SCH_COLUMN_W;
    const a = addDevice(ctx, SYM.leaf, podSheet.id, { x, y: SCH_ROW_Y }, 'leaf-a');
    const single = k * 2 + 1 >= leafCount;
    if (single && 2 * serversPerLeaf > LEAF_DOWNLINKS) {
      throw new RangeError('demo pod: an unpaired leaf cannot dual-home that many servers');
    }
    const b = single ? a : addDevice(ctx, SYM.leaf, podSheet.id, { x: x + 320, y: SCH_ROW_Y }, 'leaf-b');
    const servers = Array.from({ length: serversPerLeaf }, (_, s) =>
      addDevice(ctx, SYM.server1u, podSheet.id, { x: x + 60, y: SCH_SERVER_Y0 + s * SCH_SERVER_PITCH }, 'server'),
    );
    pairs.push({ a, b, servers });
  }
  const leafs = pairs.flatMap((p) => (p.a === p.b ? [p.a] : [p.a, p.b]));

  meshFabric(ctx, leafs, spines, 'FAB');

  const nextDownlink = new Map<string, number>();
  const downlink = (leaf: Component): string => {
    const n = (nextDownlink.get(leaf.id) ?? 0) + 1;
    nextDownlink.set(leaf.id, n);
    return leafDownlink(n);
  };
  for (const pair of pairs) {
    for (const srv of pair.servers) {
      connectServer(ctx, srv, 'eth0', pair.a, downlink(pair.a));
      connectServer(ctx, srv, 'eth1', pair.b, downlink(pair.b));
    }
  }

  // Refs were handed out sequentially; this only numbers anything left over.
  annotate(ctx.project, { scope: 'unannotated' });

  // -- Physical: one row, network racks for the spines then a standard rack per leaf pair.
  const rackName = (n: number): string => `A${String(n).padStart(2, '0')}`;
  const racks = addRackRow(ctx, {
    origin: { x: 1200, y: 3600 },
    gapMm: RACK_GAP_MM,
    row: 'A',
    racks: [
      ...spines.map((_, j) => ({ name: rackName(j + 1), defId: RACK_DEF.network })),
      ...pairs.map((_, k) => ({ name: rackName(spineCount + k + 1), defId: RACK_DEF.standard })),
    ],
  });
  for (const rack of racks) fitRack(ctx, rack);

  spines.forEach((spine, j) => place(ctx, spine, racks[j]!, SPINE_U));
  pairs.forEach((pair, k) => {
    const rack = racks[spineCount + k]!;
    place(ctx, pair.a, rack, LEAF_A_U);
    if (pair.b !== pair.a) place(ctx, pair.b, rack, LEAF_B_U);
    pair.servers.forEach((srv, s) => place(ctx, srv, rack, 1 + s));
  });

  const first = racks[0]!;
  const last = racks[racks.length - 1]!;
  const runwayY = rackCenter(first).y;
  const runway = addRowTray(ctx, {
    defId: TRAY_DEF.runway6,
    name: 'Runway A',
    y: runwayY,
    x0: first.pos.x - RACK_GAP_MM,
    x1: last.pos.x + rackDef(RACK_DEF.standard).widthMm + RACK_GAP_MM,
    elevationMm: RUNWAY_ELEVATION_MM,
    racks,
  });

  syncLayout(ctx);

  const nets: TrayNetworks = {
    fiber: { byRack: new Map(racks.map((r) => [r.id, { trayId: runway.id, y: runwayY }])), backbone: null },
  };
  routeShare(ctx, ROUTED_FRACTION, nets);

  return finishProject(ctx);
}
