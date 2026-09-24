# Feature spec — Fiber plant: patch panels, trunks, cassettes and tracing

_Status: proposed, reviewed (rev 3) · Branch: `feature/fiber-plant-patch-panels` · Extends the master spec (`docs/Datacenter Topology Builder — Design Spec.md`) and the current codebase (`docs/HANDOFF.md`). Everything here is additive to the existing model and tests, with three explicitly called-out behavioural changes (§3.1 100G-LR4 lanes, §9.2 annotate treating foreign-prefix refs as manual, §9.3 route ownership refactor in F6)._

_Rev 2 incorporated a three-lens review (implementer cold-read, fiber-optics domain, codebase integration); rev 3 resolved the consistency findings of a second two-lens pass. Every number and path in §2, §3.4 and §11 (criteria 1, 2, 2b, 2c, 4, 7, 17 and the polarity-suspect rule) was recomputed independently from §3 alone by all reviewers and matches._

---

## 0. Summary

Today a `Link` is a straight logical connection between two device ports (optionally between breakout **lanes**). Real fiber plants are not point-to-point: a device's 4-channel MPO port goes down an **8-fiber trunk** into a **patch panel**, a **cassette** breaks the trunk out into 4 **LC ports**, four **2-fiber jumpers** cross-connect to other panels, and cassettes there **aggregate** channels from many sources back into one MPO trunk into the far device.

This feature adds that **physical fiber layer** ("the plant") next to the existing logical layer ("the plan"):

| Layer | Question it answers | Where it lives today | What this feature adds |
| --- | --- | --- | --- |
| **Plan** (logical) | "Which lane talks to which lane?" | `Project.links` (`LinkEnd.lane`) — the schematic | Lane-to-lane links on both ends; 1-based display of channels/lanes in the new fiber UI |
| **Plant** (physical) | "Which cable is plugged into which port, and how are the fibers wired inside?" | — | `FiberCable`s with declared fiber counts and pinouts, patch panels with internal **fiber maps**, **patch frames** beside racks |
| **Proof** | "Does the plant actually realise the plan?" | — | The **tracer**: walks fibers from a device lane through cables and cassettes to the far device and compares with the plan; reports dead ends, wrong destinations and flipped Tx/Rx |
| **Automation** | "Who draws 240 cables?" | `planFabric` (plan only) | The **fiber fabric generator**: bricks × spines × mapping rule → panels, frames, trunks, cassettes, jumpers **and** plan links, verified by tracing, applied as one undo step |
| **3D** | "What does it look like?" | racks/devices/cables | Patch frames next to their rack, panels, trunk and jumper tubes, highlighted trace paths |

The worked example throughout is the diagram in the request: bricks **B1–B4**, brick panels **PP-B1–PP-B4**, spine panels **PP-S1–PP-S4**, spines **S1–S4**. Brick `b` channel `k` lands on spine `k` lane `b`.

**Increments.** F1–F5 (§10) deliver the model, tracer, generator, UI and 3D for MPO-12 / LC plants. F6 (routing plant cables through trays) and F8 (MPO-16 / 8-lane parts) are separate increments with their own acceptance tests; nothing in F1–F5 depends on them.

---

## 1. Glossary (use these words in code, UI and tests)

| Term | Meaning |
| --- | --- |
| **Brick** | A named group of devices (e.g. 10 leaf switches or servers in one rack) that shares one patch panel. Not a new entity: the generator takes an ordered list of device ids per brick; a sheet or a ref glob is the usual source. |
| **Spine** | A device on the far side that aggregates one channel from every brick. |
| **Port** | A physical receptacle on a device or panel (`FootprintPort`). Unchanged. |
| **Fiber position** | A 1-based index of a fiber inside a connector: LC duplex has positions 1–2, MPO-12 has 1–12, MPO-16 has 1–16. **At a panel port, `pos` is the position on the plug mated to that port, counted with the key/latch up as seen by the person inserting it.** Consequently a duplex LC adapter crosses 1↔2 between its two faces, a key-up/key-down MPO adapter is straight (`p ↔ p`), and a key-up/key-up MPO adapter mirrors (`p ↔ N + 1 − p` for an N-position connector: `13 − p` on MPO-12, `17 − p` on MPO-16). |
| **Lane / channel** | One duplex signal path through a port: a Tx fiber and an Rx fiber. **Model**: `LinkEnd.lane` is 0-based (existing). **New fiber UI and prose**: 1-based — "channel 3" is `lane: 2`; `laneLabel(2)` renders `ch 3`. Existing strings (`ProjectIndex.endLabel` → `SW1:eth1/49.0`, ERC/DRC messages, exports) keep their 0-based suffix; only `formatPath`, the Fiber plant view, the trace dialog and `fiber-*` DRC messages use `laneLabel`. The words are synonyms; the request uses *channel* on the brick side and *lane* on the spine side. |
| **Fiber layout** | Which positions of a device port carry which lane's Tx and Rx. Comes from the optic (`TransceiverDef.fiberLayoutId`), else from the port type default for fixed ports on **device** footprints. `layoutOf(idx, portRef)` returns `null` for any port on a `patch-panel` footprint regardless of port type, so panel ports are never terminals, never "parallel ports", never plant-link ends and never `traceAll` starts. |
| **Trunk** | A multi-fiber cable, usually MPO on both ends: 8F carries 4 channels, 12F carries 6, 144F = 12 MPO legs. |
| **Jumper** | A 2-fiber LC duplex patch cord: 1 channel. |
| **Leg** | One connector on one end of a cable. A simple cable has one leg per end; a 144F trunk has 12 legs per end. |
| **Pinout** | The cable's fixed fiber-to-fiber wiring between its A legs and B legs (e.g. MPO Method B flips position `i ↔ 13 − i`). |
| **Cassette** | A passive module with MPO port(s) on the rear and LC ports on the front and a fixed **fiber map** between them. Breakout and aggregation are the same cassette read in opposite directions. |
| **Patch panel** | A `Component` (kind `patch-panel`) whose footprint contains cassettes; its `fiberMap` is the union of its cassettes' maps. |
| **Patch frame** | A **free-standing** `Rack` with `kind: 'patch-frame'`: a patch panel's own rack, placed anywhere on the floor like any rack (drag a panel from the Unplaced bin onto the floor, or press "Own frame"); patch panels are placed in it like any device. Rendered as a **wall**: full 19" width (600 mm), 120 mm thick; 12U by default, 42U available. A frame may *optionally* be docked to a device rack (`attachedTo`), in which case it keeps its position relative to that rack when the rack moves — this is only a convenience the generator uses to put a brick's panel beside the brick's rack; nothing requires a parent rack. **Implemented ahead of this spec on the feature branch** (`placeInNewFrame`, floor drop, "Own frame"). |
| **Terminal / transit** | A port is a **terminal** iff its component's footprint `kind !== 'patch-panel'` and the port has a fiber layout. Ports on `patch-panel` footprints are **transit**: a walk passes through the footprint's `fiberMap`. |
| **Trace** | Walking one fiber (or one lane = two fibers) from a device terminal through every cable and cassette until it reaches another terminal or dies. |
| **Plan link** | An existing `Link` between two device lanes. A **plant link** is a plan link with `cableDefId === null` whose ends have fiber layouts (§6.3); the plant must realise it. |

---

## 2. The worked example (the diagram)

Follow brick **B2**, port **P1**, **channel 3** (`lane: 2` in the model):

1. **Trunk out.** B2:P1 is a 4-lane parallel-optics port (100G-SR4 / 400G-DR4 class). One 8-fiber MPO trunk `T-B2` runs from B2:P1 to the rear MPO port `r1` of panel `PP-B2`.
2. **Breakout.** The cassette behind `r1` splits the 8 fibers into 4 LC duplex front ports `f1..f4`, one channel each. Channel 3 lands on `PP-B2:f3`.
3. **Cross-connect.** Jumper `J-B2-3` runs from `PP-B2:f3` to `PP-S3:f2`.
4. **Aggregate.** At `PP-S3` the same cassette type works in reverse: front ports `f1..f4` (one channel from each of B1..B4) combine into rear MPO `r1`. Brick 2's channel is on `f2`.
5. **Trunk in.** Trunk `T-S3` carries `PP-S3:r1` into `S3:P1`; brick 2 occupies lane 2 (`lane: 1`).

**Mapping rule:** brick `b`, channel `k` → spine `k`, lane `b`. Every brick fans out to every spine; every spine port collects one channel from every brick.

**Expected trace** (acceptance criterion 1): `traceLane(B2, 'P1', lane 2)` returns `status: 'ok'`, `plan: 'matches'`, `far = { S3, 'P1', lane 1 }`, and `formatPath` renders exactly

```
T-B2 → PP-B2 r1⇒f3 → J-B2-3 → PP-S3 f2⇒r1 → T-S3 → S3:P1 ch 2
```

(six hops: the start terminal is never part of `hops`/`path`; the first hop is the cable leaving the start port, the last is the far device terminal — §6.2).

**Scale:** with 10 devices per brick and 4 bricks, each device having one 4-channel port: 40 brick trunks, 160 jumpers, 40 spine trunks, 4 brick panels with 10 cassettes each, 4 spine panels with 10 cassettes each (spine `k` port `d` aggregates channel `k` of device `d` of every brick). Nobody draws that by hand — §7 generates it.

---

## 3. Fiber conventions (normative)

These formulas are what the tracer, the generator, the catalog defs and the tests all rely on. They follow TIA-568 Method B for MPO trunks and modules and A-to-B for duplex cords, **and they are consistent both for cassette-to-cassette fabrics and for breakout to duplex optics** (§3.4). Other schemes (Method A, Method C, Type-A/AF modules) are expressible through the same `pinout` / `map` data (§3.5); only Method B parts ship.

### 3.1 Positions and roles at device ports (`FiberLayoutDef`)

| Layout id | Connector | Lanes | Lane `k` (1-based) Tx position | Rx position |
| --- | --- | --- | --- | --- |
| `fl.duplex-lc` | LC | 1 | 1 | 2 |
| `fl.parallel4-mpo12` | MPO-12 | 4 | `k` | `13 − k` |
| `fl.parallel8-mpo16` | MPO-16 | 8 | `k` | `17 − k` |

MPO-12 positions 5–8 are unused by 4-lane optics. A device port's layout is `transceiver.fiberLayoutId` when an optic is assigned, else the default for a **fixed** port type (`LC → fl.duplex-lc`, `MPO-12 → fl.parallel4-mpo12`). Cage ports (`SFP`, `SFP+`, `SFP28`, `QSFP+`, `QSFP28`, `QSFP56`, `QSFP-DD`, `OSFP`) have **no** layout until an optic is assigned.

Catalog correction shipped with this feature: `100G-SR4`, `400G-DR4` → `fl.parallel4-mpo12`; `400G-SR8` → `fl.parallel8-mpo16`; `10G-SR/LR`, `25G-SR/LR`, `100G-LR4`, `1G-T` (n/a, copper) → `fl.duplex-lc` where optical. **Behavioural change:** `100G-LR4` is WDM on one duplex pair, so its `lanes` becomes 1 and it can no longer be broken out — `breakoutFanout` precedence becomes (1) the optic's `fiberLayoutId → layout.lanes` (even when 1), (2) `cable.breakout.fanout`, (3) `optic.lanes > 1`, (4) `DEFAULT_FANOUT`; `planBreakout` returns a new error code `'source-not-parallel'` when the resolved fanout is < 2. Existing projects that broke out LR4 will now raise ERC `lane-out-of-range` (§9.4) and `speed-mismatch` will compute 100 G per lane for LR4 ends (correct). `migrations.ts` does not rewrite them; the handoff decision log records it. Existing breakout tests (SR8 → 8, no optic → 4, cable fanout wins over a 4-lane optic) keep passing.

### 3.2 Cable pinouts (`FiberCableDef.pinout`)

A pinout is a list of `{ a: { leg, pos }, b: { leg, pos } }` pairs, one per fiber. Built-ins:

| Def id | Fibers | Legs A / B | Pinout | Polarity tag |
| --- | --- | --- | --- | --- |
| `fcbl.lc-duplex-om4`, `fcbl.lc-duplex-os2` | 2 | 1 LC / 1 LC | `(1↔2), (2↔1)` — crossed | `A-B` |
| `fcbl.mpo12-8f-om4-b`, `…-os2-b` | 8 | 1 MPO-12 / 1 MPO-12 | `i ↔ 13 − i` for `i ∈ {1,2,3,4,9,10,11,12}` | `B` |
| `fcbl.mpo12-12f-om4-b`, `…-os2-b` | 12 | 1 MPO-12 / 1 MPO-12 | `i ↔ 13 − i`, `i ∈ 1..12` | `B` |
| `fcbl.mpo12-144f-os2-b` | 144 | 12 MPO-12 / 12 MPO-12 | leg `n` ↔ leg `n`, `i ↔ 13 − i` | `B` |
| `fcbl.mpo16-16f-om4-b` (F8 increment; cage-to-cage only until then) | 16 | 1 MPO-16 / 1 MPO-16 | `i ↔ 17 − i` | `B` |
| `fcbl.lc-duplex-straight` (test fixture, hidden from the library UI) | 2 | 1 LC / 1 LC | `(1↔1), (2↔2)` | `A-A` |

**Channels are derived, never stored:** `channelsOf(def) = pinout.length / 2`. A 144F trunk is 72 channels; the UI shows `144F · 72 ch · 12 legs`.

**`polarity` is a label** for the library UI, BOM and the `fiber-polarity` suspect heuristic (§6.3) only. The tracer uses `pinout` / `map` exclusively (test: a def tagged `'B'` with a straight pinout traces as straight).

### 3.3 Cassette fiber maps (`CassetteDef.map`, relative port ids `r1`, `f1..fN`)

Invariant (normative, checked by `validateFiberCatalog` for cassettes with `polarity: 'B'` and an LC front only): with rear connector size `N` (12 or 16), every mapped rear position `p ≤ N/2` maps to `f<j>:2` and every mapped `p > N/2` maps to `f<j>:1` such that positions `p` and `N + 1 − p` share one front port `j`. Because parallel layouts put Tx at `k` and Rx at `N + 1 − k`, the Rx-side rear position lands on LC position 1 (`fl.duplex-lc.tx`) and the Tx-side one on position 2, so an A-B jumper from a cassette front port to a duplex optic delivers Tx to Rx. Passthrough and `custom` cassettes are exempt.

| Cassette id | Rear / front | Map |
| --- | --- | --- |
| `cas.mpo12-8f-4lc-b` | 1 × MPO-12 / 4 × LC | `p ∈ 1..4`: `r1:p ↔ f<p>:2`; `p ∈ 9..12`: `r1:p ↔ f<13−p>:1`; positions 5–8 unconnected |
| `cas.mpo12-12f-6lc-b` | 1 × MPO-12 / 6 × LC | `p ∈ 1..6`: `r1:p ↔ f<p>:2`; `p ∈ 7..12`: `r1:p ↔ f<13−p>:1` |
| `cas.mpo12-2x8f-8lc-b` | 2 × MPO-12 / 8 × LC | `r1` uses the 8F map onto `f1..f4`; `r2` the same map onto `f5..f8` (`r2:p ↔ f<4+p>:2` for `p ≤ 4`, `r2:p ↔ f<4+13−p>:1` for `p ≥ 9`) |
| `cas.mpo12-passthrough-kukd` | 1 × MPO-12 / 1 × MPO-12 | `r1:p ↔ f1:p` (key-up/key-down adapter) |
| `cas.mpo12-passthrough-kuku` | 1 × MPO-12 / 1 × MPO-12 | `r1:p ↔ f1:<13−p>` (key-up/key-up adapter) |
| `cas.mpo16-16f-8lc-b` (F8) | 1 × MPO-16 / 8 × LC | `p ∈ 1..8`: `r1:p ↔ f<p>:2`; `p ∈ 9..16`: `r1:p ↔ f<17−p>:1` |

### 3.4 Why polarity works out (the tracer's proof)

**Fabric (cassette at both ends):** brick lane `k`: Tx at `k` → Method-B trunk flips to `13 − k` → brick cassette maps `13 − k` to `f<k>:1` → A-B jumper crosses to the spine panel's `f<m>:2` → spine cassette maps `f<m>:2` to `r1:m` → Method-B trunk flips to `13 − m` → spine layout: position `13 − m` is **Rx** of lane `m`. The Rx fiber mirrors (`13 − k → k → f<k>:2 → f<m>:1 → r1:<13−m> → m` = Tx of lane `m`). Three crossings (flip, cross, flip) → correct. Substituting a straight (A-A) jumper, or a Method-A (`i ↔ i`) trunk at **one** end, gives two crossings → Tx arrives on Tx → `polarity-flipped`. (A Method-A trunk at *both* ends gives one crossing → correct; the spec makes no claim otherwise.)

**Breakout to duplex optics (one cassette):** SR4 lane `k` Tx at `k` → Method-B trunk → `13 − k` → cassette → `f<k>:1` → A-B jumper → far position 2 = `fl.duplex-lc` **Rx**. Correct, which is why the cassette map above pairs Rx-side rear positions with LC position 1.

**Static adapter panels:** a duplex LC adapter (`fp.fiber-patch-panel-24lc`) crosses 1↔2 between faces, so two A-B cords through it keep polarity; a key-up/key-down MPO adapter (`fp.mpo-patch-panel-12`) is straight, so two Method-B trunks through it **do** report `polarity-flipped` — that is correct physics (use one Method-A trunk or a key-up/key-up adapter), and a test asserts it.

### 3.5 Expressing other schemes (data only, no code changes)

| Part | `pinout` / `map` |
| --- | --- |
| Type-A (straight) MPO trunk | `i ↔ i` |
| Type-C (pair-flipped) trunk | `2n−1 ↔ 2n`, `2n ↔ 2n−1` |
| Type-A breakout module | `r1:(2n−1) ↔ f<n>:1`, `r1:(2n) ↔ f<n>:2` — pairs Tx1 with Tx2 on a parallel optic, so the tracer reports `split-pair`, which is correct |

---

## 4. Data model (additions to `src/model/types.ts`)

All new fields are optional or default to empty so existing JSON loads; `createProject()` and `migrations.ts` fill them (§9.2).

```ts
// ---------- Fiber plant: catalog ----------
export type FiberPosition = number;            // 1-based within a connector
export type FiberRole = 'tx' | 'rx';
export type FiberConnector = 'LC' | 'MPO-12' | 'MPO-16';   // cable-leg / layout connectors; PortType is NOT extended in F1–F5 (see F8)
export type FiberMedia = 'OM3' | 'OM4' | 'OM5' | 'OS2';

/** Which positions of a device port carry each lane's Tx / Rx. */
export interface FiberLayoutDef {
  id: string; name: string; connector: FiberConnector; lanes: number;
  tx: FiberPosition[]; rx: FiberPosition[];   // index = lane (0-based); both length === lanes
}

export interface CableLegDef { connector: FiberConnector; fibersUsed: number; label?: string }
export interface LegPos { leg: number; pos: FiberPosition }   // leg is 0-based

export interface FiberCableDef {
  id: string; name: string; media: FiberMedia; color: string; diameterMm: number; bendRadiusMm: number;
  fiberCount: number;
  legsA: CableLegDef[]; legsB: CableLegDef[];
  /** One entry per fiber. Validated: unique (leg,pos) on each side, within leg connector size; fiberCount === pinout.length. */
  pinout: { a: LegPos; b: LegPos }[];
  /** Informational tag only (library, BOM, polarity-suspect heuristic); the tracer never reads it. */
  polarity: 'A' | 'B' | 'C' | 'A-B' | 'A-A' | 'custom';
  /** Stock lengths offered in the UI, metres. */
  lengthsM?: number[];
  category?: string;
  /** Hidden from the library UI (test fixtures). */
  hidden?: boolean;
}

/** Passive internal wiring between a footprint's own ports (undirected). */
export interface FiberMapEntry { a: { portId: string; pos: FiberPosition }; b: { portId: string; pos: FiberPosition } }

export interface CassetteDef {
  id: string; name: string; media: FiberMedia | 'any';
  rear: { connector: FiberConnector; count: number };    // ports r1..rN
  front: { connector: FiberConnector; count: number };   // ports f1..fM
  map: FiberMapEntry[];                                   // relative ids r1/f1…
  polarity: 'A' | 'AF' | 'B' | 'passthrough' | 'custom';  // informational
}

export interface PanelChassisDef { id: string; name: string; heightU: number; slots: number; depthMm: number }

// FootprintDef gains (panels only):
//   fiberMap?: FiberMapEntry[];                            // absolute port ids of this footprint
//   cassettes?: { slot: number; cassetteDefId: string }[]; // provenance for the inspector / panel builder
// TransceiverDef gains: fiberLayoutId?: string
// RackDef gains: kind?: 'rack' | 'patch-frame'
// Catalog gains: fiberLayouts, fiberCables, cassettes, chassis (all required arrays; builtinCatalog imports the new JSON).
// Project.customCatalog gains: fiberCables: FiberCableDef[]; cassettes: CassetteDef[]

// ---------- Fiber plant: project ----------
export type PortRef = { componentId: Id; portId: string };
export interface CableEnd { legs: (PortRef | null)[] }  // index = leg; null = unplugged

export interface FiberCable {
  id: Id; defId: string; label: string;
  a: CableEnd; b: CableEnd;
  /** Declared length in metres when known; else derived from a route (F6) or unknown. */
  lengthM?: number;
  /** Generator provenance; lets "Regenerate" replace only what it made. */
  generatedBy?: Id;
}

// Component gains: generatedBy?: Id      (panels made by the generator; `value` stays the human role, e.g. 'patch-panel')
// Rack gains (kind + attachedTo already on the branch):
//   kind?: 'rack' | 'patch-frame';        // undefined means 'rack' — readers use `rack.kind ?? 'rack'`, writers never store the default
//   attachedTo?: { rackId: Id; side: Side };   // OPTIONAL docking of a frame to a device rack; absent = free-standing (the default)
//   generatedBy?: Id;
// Project gains: fiberCables: FiberCable[]
// Route gains: owner?: 'link' | 'cable'   // default 'link'; when 'cable', Route.linkId holds the FiberCable id (F6, §9.3)
// ProjectSettings gains:
//   fiber: { defaultBrickTrunkDefId; defaultSpineTrunkDefId; defaultJumperDefId; defaultCassetteDefId; defaultChassisDefId: string; verifyOnChange: boolean }
// SelectionItem gains: { kind: 'fiber-cable'; id: Id } | { kind: 'fiber-lane'; componentId: Id; portId: string; lane: number }
// IssueTarget gains: { kind: 'fiber-cable'; id: Id }
// Viewer3dUi gains: showFiberPlant: boolean (default true)
```

**Invariants** (enforced by mutators in `src/model/fiber/mutations.ts`, checked by DRC):
- A `PortRef` is occupied by at most one cable leg across all `fiberCables` (one plug per port). `plugLeg` throws on an occupied port.
- A `PortRef` always names an existing component and port. `deleteComponents` (schematic mutations) and F8 `remove-component` set every leg referencing a deleted component to `null` in the same mutation; cables survive unplugged. `FiberIndex` treats a leg whose component or port is missing (imported data) as unplugged and DRC `fiber-invalid-plug` (Error) reports it. `duplicateSheet` never clones fiber cables.
- A leg's `connector` must equal the port's connector: fixed `LC`/`MPO-12` ports by `type`; cage ports by the assigned optic's layout connector. `plugLeg` throws otherwise. Removing an optic from a plugged cage is allowed; the port then traces as `no-optic` and `fiber-connector-mismatch` fires.
- `pinout` positions are unique per side and ≤ the leg connector's size; `fiberCount === pinout.length`; `FiberLayoutDef.tx/rx` are disjoint and within the connector size. `validateFiberCatalog(catalog): string[]` checks all of this and is asserted empty for `builtinCatalog`.
- Panel `fiberMap` entries reference existing ports and are unique per `(portId, pos)`.
- Patch frames are ordinary free-standing racks (`kind: 'patch-frame'`): created by `placeInNewFrame(componentId, pos?)` (a device becomes its own rack, placed at U1), by placing a patch-frame def from the Library, or by the generator; moved, rotated, renamed and deleted like any rack (deleting one unplaces its panels). A frame **may** be docked with `attachedTo` (`dockFrame(frameId, parentId, side)` / `undockFrame`); a docked frame is positioned by `attachFramePosition` and follows its parent through `moveRacks` / `rotateRack` / `renameRack`; deleting the parent deletes its docked frames, unplaces the panels in them **and unplugs every cable leg on those panels' ports** (`onRackDeletedFrames`). Dragging a docked frame on the floor undocks it.

**Plan ↔ plant relation:** a plan link is a **plant link** iff `link.cableDefId === null` and each end's port has a fiber layout. It is *realised* when `traceLane` from end A returns `status: 'ok'` with `far` equal to end B (`isRealisedByPlant(project, linkId)`, memoised on the `FiberIndex`). Plant links keep `cableDefId: null` (the physical path is several cables); ERC `connector-mismatch` / `media-mismatch` already skip links without a cable; the fiber rules in §6.4 take over. Links with a direct `cableDefId` are point-to-point cables and are **never traced** — this keeps every existing project's ERC/DRC output unchanged.

---

## 5. Catalog additions (`scripts/gen-catalog.ts` → `src/catalog/*.json`)

New files: `fiberLayouts.json`, `fiberCables.json`, `cassettes.json`, `chassis.json`. `resolveCatalog` merges `customCatalog.fiberCables` and `customCatalog.cassettes` (override by id) and returns builtin `fiberLayouts` / `chassis`; `CatalogIndex` gains `fiberLayout(id)`, `fiberCable(id)`, `cassette(id)`, `chassis(id)`. **The emptiness short-circuit in `catalogIndex()` must include the two new arrays**, or a project with only custom cassettes silently uses the builtin index.

- Fiber layouts: the three in §3.1.
- Cables: the rows in §3.2 (OM4 aqua `#2dd4bf`, OS2 yellow `#facc15`; jumpers `diameterMm 2`, 8F/12F trunks `3.5`, 144F `12`). `lengthsM` = `[1,2,3,5,7,10,15,20,30]` for jumpers, `[5,10,15,20,30,50,75,100]` for trunks. `fcbl.lc-duplex-straight` has `hidden: true`.
- Cassettes: the five MPO-12 entries in §3.3 (the MPO-16 one ships with F8).
- Chassis: `chs.1u-4` (1U, 4 slots, 300 mm), `chs.2u-8` (2U, 8 slots), `chs.4u-12` (4U, 12 slots).
- Patch frames (`racks.json`, already shipped): `rack.patch-frame-12u` (12U, 600 × 120 — a wall; the default for "Own frame" / floor drop) and `rack.patch-frame-42u` (42U, 600 × 120), both `kind: 'patch-frame'`. `createRack` copies `def.kind`. They are listed in the layout Library like any rack (with a "frame" badge) and can be placed freely.
- Generated panel footprints are **not** shipped; the panel builder (§7.4) produces them into `project.customCatalog.footprints` with ids `fp.panel.<hash>`.
- The two existing static panels gain a `fiberMap` so they trace: `fp.fiber-patch-panel-24lc`: `f<i>:1 ↔ r<i>:2`, `f<i>:2 ↔ r<i>:1` for `i ∈ 1..24` (a duplex adapter is a 1↔2 crossover, §1); `fp.mpo-patch-panel-12`: `f<i>:p ↔ r<i>:p` for `i ∈ 1..12`, `p ∈ 1..12` (key-up/key-down adapters).
- Transceivers: add `fiberLayoutId` per §3.1 and set `100G-LR4.lanes = 1`.

`gen-catalog.ts` imports **types only** from `src/model/types.ts` (it is compiled under `tsconfig.node.json`, whose `include` is fixed — HANDOFF decision 25). Validation lives in `src/model/fiber/plant.ts` (`validateFiberCatalog`) and is exercised by `src/model/fiber/catalog.test.ts` against `builtinCatalog`.

**Port naming for generated panel footprints** (normative, the tests depend on it): cassette in **local** slot `s'` (1-based within the chassis) contributes rear ports `r<(s'−1)·R + i>` (`i ∈ 1..R`) and front ports `f<(s'−1)·F + j>` (`j ∈ 1..F`) where `R`/`F` are the cassette's rear/front counts; `fiberMap` is the cassette map rebased onto those ids. A 1-slot 8F cassette panel therefore has `r1` and `f1..f4`, so "front port 3" is `f3`. Faceplate `pos` values lay ports out left-to-right in id order (rear row for `r*`, front row for `f*`); `face` is `'rear'` for `r*`, `'front'` for `f*`.

---

## 6. The tracer (`src/model/fiber/trace.ts`) — core of the feature

### 6.1 Graph

Nodes are `(componentId, portId, pos)`. Edges come from three sources, all undirected and looked up through a `FiberIndex` (`src/model/fiber/plant.ts`, memoised per project identity like `indexProject`):

1. **Cable pinout:** `(cable.a.legs[l], pos)` ↔ `(cable.b.legs[l'], pos')` for each pinout entry whose legs are plugged.
2. **Panel fiber map:** for a component whose footprint has `fiberMap`, `(c, a.portId, a.pos)` ↔ `(c, b.portId, b.pos)`.
3. **Device layout (terminals):** for a device port with a layout, `(c, port, layout.tx[lane])` is the Tx terminal of `lane`, `(c, port, layout.rx[lane])` the Rx terminal.

Each node has at most one cable edge and at most one panel edge, so a walk is deterministic: arrive by one edge, leave by the other.

**Node classification on arrival** (normative): if the component's footprint `kind === 'patch-panel'` (transit) → the position must have a `fiberMap` entry, else fault `dead-end` / `unmapped-position` (or `no-panel-map` when the footprint has no map at all); else if the port has a fiber layout (terminal) → the position must be a lane's Tx or Rx, else fault `not-a-terminal`; else fault `dead-end` / `no-layout` (a cage without an optic, or a fixed port on a non-panel footprint without a layout).

### 6.2 API

```ts
export type FiberRef = { componentId: Id; portId: string; pos: FiberPosition };
export type LaneRef  = { componentId: Id; portId: string; lane: number };   // 0-based lane

export type Hop =
  | { kind: 'cable'; cableId: Id; from: LegPos; to: LegPos }                                   // through a cable
  | { kind: 'panel'; componentId: Id; from: { portId: string; pos: FiberPosition }; to: { portId: string; pos: FiberPosition } }
  | { kind: 'device'; componentId: Id; portId: string; lane: number; role: FiberRole };       // the far terminal

export type FiberFault =
  | { code: 'no-optic';       at: PortRef }      // start port has no fiber layout
  | { code: 'unplugged';      at: PortRef }      // start port has no cable
  | { code: 'dead-end';       at: FiberRef; reason: 'unmapped-position' | 'no-panel-map' | 'no-layout' | 'leg-unplugged' | 'port-unplugged'; cableId?: Id }
      // at = last reachable (port, pos). leg-unplugged: walked into a cable whose far leg is null (cableId set).
      // port-unplugged: arrived at a transit port via the panel map and nothing is plugged there (cableId unset).
  | { code: 'loop';           at: FiberRef }
  | { code: 'not-a-terminal'; at: FiberRef };

/** `hops` never contains the start terminal: the first hop is the cable leaving the start port, the last is the far `device` terminal. */
export interface FiberTrace { start: FiberRef; hops: Hop[]; end?: Hop & { kind: 'device' }; fault?: FiberFault; lengthM: number | null }

export type ChannelStatus = 'ok' | 'polarity-flipped' | 'split-pair' | 'dead-end' | 'unplugged' | 'no-optic' | 'loop';
/** 'unrealised' = a plan link exists but the plant does not deliver it (status ≠ ok). */
export type PlanStatus = 'matches' | 'wrong-destination' | 'unplanned' | 'unrealised' | 'n/a';

export interface ChannelTrace {
  start: LaneRef;
  tx: FiberTrace; rx: FiberTrace;
  /**
   * Channel-level hop list: the Tx hops with cable/panel hops merged with the Rx walk by key
   * `cable:<cableId>` / `panel:<componentId>:<from.portId>:<to.portId>`; merged hops keep the Tx fiber's
   * positions; the terminal `device` hop is the Tx fiber's `end` (role 'rx' when the channel is ok, 'tx' when polarity-flipped).
   */
  path: Hop[];
  status: ChannelStatus;
  far?: LaneRef;                        // when both fibers reach the same far lane
  plan: PlanStatus; planLinkId?: Id; expected?: LaneRef;
  /** Suspect cable for polarity-flipped (§6.3), else undefined. */
  suspectCableId?: Id;
  lengthM: number | null;               // sum of cable lengths when all are declared
}

export function traceFiber(project: Project, start: FiberRef): FiberTrace;
export function traceLane(project: Project, start: LaneRef): ChannelTrace;
/** Device lanes reachable through a transit port or a cable (for UI entry points on panel ports / cables). */
export function lanesThrough(project: Project, at: PortRef | { cableId: Id }): LaneRef[];
/** Every plant link and every plugged device lane, deduplicated (§6.3). */
export function traceAll(project: Project): { channels: ChannelTrace[]; summary: Record<ChannelStatus | PlanStatus, number> };
export function isRealisedByPlant(project: Project, linkId: Id): boolean;
export function formatPath(project: Project, trace: ChannelTrace): string;   // 'T-B2 → PP-B2 r1⇒f3 → J-B2-3 → PP-S3 f2⇒r1 → T-S3 → S3:P1 ch 2'
```

`formatPath` renders `path` as `<cable label> → <panel ref> <from.portId>⇒<to.portId> → … → <ref>:<portId> <laneLabel>`, no kind prefixes.

`lanesThrough`: for each position of the port (or each plugged A-leg position of the cable), walk alternately cable edge → panel edge → … starting with the cable edge (the panel edge when the port has no plug) until a terminal is reached; return the distinct `(component, port, lane)` in natural order. The UI runs `traceLane` for each (a trunk highlights its 4 channels). Transit ports are never `traceLane` starts.

### 6.3 Rules

- `status` is `ok` iff Tx and Rx both end at terminals on the **same** far `(component, port, lane)` and the roles are swapped (Tx ends at the far lane's **Rx**, Rx at its **Tx**).
- `polarity-flipped`: both fibers reach the same far lane but Tx ends on Tx (and Rx on Rx). **Suspect selection** (deterministic and direction-independent by construction): the cables on `path` whose def `polarity` is `'A-A'`, `'A'` or `'custom'`; if none, the cables whose def `polarity` differs from the majority on the path; if none, every cable on the path. Among the candidates take the one whose `label` sorts first by `compareNatural` (ties: lower cable id). `suspectCableId` is set and the DRC target is that cable; the message lists every cable on the path in order and names the suspect.
- `split-pair`: the two fibers reach different far lanes/ports/devices.
- Faults propagate: every `dead-end` reason and `not-a-terminal` map to status `dead-end`; `unplugged`, `no-optic`, `loop` map to themselves. If either fiber faults, `status` comes from the fault; when both fault, the Tx fault decides. Both `FiberTrace`s keep their own `fault`.
- `traceLane` on a port without a layout (a transit port, or a cage without an optic) returns `no-optic`; the UI reaches device lanes from panel ports and cables through `lanesThrough`.
- `plan`: the plan link on the start lane is the **first** link in `project.links` order with that end. `matches` when `far` equals the link's other end; `wrong-destination` when it differs (`expected` set); `unplanned` when a physical path exists (`status ok`) but no plan link; `unrealised` when there is a link but `status ≠ ok`; `n/a` when neither.
- A device port without a layout is `no-optic` immediately (cage with no optic); a plugged cage without an optic contributes one channel `{ lane: 0 }` with status `no-optic` so it is visible in `traceAll`. `no-optic` produces no DRC issue (ERC `missing-optic` already covers it).
- A plan lane whose port is unplugged is `unplugged` at the start port — this is how "plan lane with no cable" surfaces.
- **Scope of `traceAll`:** it visits (a) both ends of every plant link and (b) every device lane whose port has a plugged cable, in `(component ref, port id, lane)` natural order (`compareNatural` moves to `src/model/text.ts` and is re-exported unchanged from `@/commands/base` and `@/io/exports/common`). **Dedupe key** of a channel = its plan link id when the start lane has one; else, when `far` is reached, the unordered pair `{start, far}` serialised with the natural-order-smaller `LaneRef` first; else the start lane itself. **The first trace in natural order wins** and is the `ChannelTrace` kept in `channels` (so for a plant link the lower-sorting end's direction is the one DRC sees); a faulted plant link and an unplanned physical path each count once. `summary` counts each channel once per key.
- Performance: `FiberIndex` build is `O(cables + panel map entries)`; a trace is `O(hops)`. `traceAll` on the 4 × 10 fabric (160 lanes) must run in < 50 ms in node.

### 6.4 DRC rules (`src/model/drc/rules/fiber-*.ts`, all pure, added to `drcRules`)

Every fiber finding sets its issue key to the start lane key `${componentId}/${portId}/${lane}` (plus the rule id), so two findings on the same cable from different lanes get distinct ids. Rules iterate `traceAll(project).channels` (plant links and plugged lanes only — never links with a direct `cableDefId`); each rule also exports its pure per-channel helper (`fiberUnpluggedFinding(project, channel)`, …) so a single direction can be unit-tested.

| Rule id | Default | Fires when | Target |
| --- | --- | --- | --- |
| `fiber-dead-end` | Error | `dead-end` with reason `unmapped-position` / `no-panel-map` / `no-layout`, `loop`, or `not-a-terminal` | `{ kind: 'component', id: fault.at.componentId, portId: fault.at.portId }` (device or panel port where it died) |
| `fiber-unplugged` | Warning | `unplugged` at the start of a plant link's lane (target: the start component + `portId`); `dead-end` / `leg-unplugged` (target: the `fiber-cable`); `dead-end` / `port-unplugged` (target: the panel component + `portId`) | as listed |
| `fiber-polarity` | Error | `polarity-flipped` | `suspectCableId` |
| `fiber-split-pair` | Error | Tx and Rx diverge | the first hop after which the Tx and Rx walks are on different `(componentId, portId)`: a cable hop → that `fiber-cable`; a panel hop → that component + the Tx `from.portId` |
| `fiber-wrong-destination` | Error | `plan === 'wrong-destination'`; message names expected vs actual (`S3:P1 ch 2` vs `S4:P1 ch 2`) | the plan link |
| `fiber-unplanned-path` | Warning | `plan === 'unplanned'` | the natural-order-first end's component + port |
| `fiber-port-double-plug` | Error | Two legs on one `PortRef` (imported data) | the cables |
| `fiber-invalid-plug` | Error | A leg references a missing component/port | the cable |
| `fiber-connector-mismatch` | Error | Leg connector ≠ port connector, or a leg plugged into a cage with no optic | the cable |
| `fiber-media-mismatch` | Error | Along one traced channel, the media of every cable def and cassette def (ignoring `'any'`) is not all multimode (OM3/OM4/OM5) with MMF optics at both ends, or all OS2 with SMF optics | the first offending cable or panel |
| `fiber-reach` | Error | `ChannelTrace.lengthM` (all lengths declared) > min reach of the two optics | the plan link when `planLinkId` is set, else the start component + port |
| `fiber-cassette-orphan` | Info | A cassette front/rear port with nothing plugged (capacity report) | the panel + `portId` |

**Existing rules and consumers must skip plant links** (they are realised by plant cables, not by a `Route` on the link): DRC `unrouted-link` and `reach-exceeded` skip every plant link (`isPlantLink(idx, link)` exported from `trace.ts`); the ratsnest and counters skip **realised** plant links via `isRealisedByPlant`: `floorLinks` (`src/editors/layout/physicalScene.ts`), `buildPhysicalScene.cables` airwires (viewer3d), the elevation airwires, `countUnrouted` (status bar shows `Unrouted: N / M (K via plant)` where `N` = links lacking a route excluding realised plant links, `M` = all links, `K` = realised plant links; the suffix is omitted when `K = 0`), `cableScheduleRows` / `cableLabelsCsv` (emit the plant path string in the Cable column instead of "Unassigned"), the BOM `cablesSection` (excluded; the new fiber-cable section counts them). Regression: `runDrc(buildPodProject())` still yields exactly 60 `unrouted-link` warnings and nothing else (`src/model/demo/pod.test.ts` stays green).

---

## 7. The fiber fabric generator (`src/model/fiber/generator.ts`)

### 7.1 Inputs

```ts
export interface FiberFabricSpec {
  bricks: { name: string; deviceIds: Id[]; ports: string[] }[];   // ordered devices; the parallel ports to use on each (e.g. ['P1'] or ['eth1/49'])
  spines: { name: string; deviceId: Id; ports?: string[] }[];       // spine ports in order; default: the device's free parallel ports in natural order
                                                                    // (free = no plan link (`isPortFree`) AND not plugged)
  mapping: 'brick-channel-to-spine-lane';                            // extensible enum; see 7.2
  parts: {
    brick: { trunkDefId: string; cassetteDefId: string };
    spine: { trunkDefId: string; cassetteDefId: string };
    jumperDefId: string; chassisDefId: string;
  };
  panels: {
    brick: { mode: 'patch-frame' | 'in-rack'; rackIdByBrick?: Record<string, Id>; frameSide?: Side; dock?: boolean };
    spine: { mode: 'patch-frame' | 'in-rack' | 'shared-frame'; rackIdBySpine?: Record<string, Id>; frameSide?: Side; dock?: boolean };
  };
  labels?: { brickTrunk?: string; spineTrunk?: string; jumper?: string; brickPanel?: string; spinePanel?: string; frame?: string };
  createPlanLinks: boolean;                                          // also create the lane-to-lane Links (default true)
  lengths?: { trunkM?: number; jumperM?: number };                   // declared lengths for reach checks (optional)
}

export interface GeneratorError {
  code: 'brick-port-not-parallel' | 'brick-lane-count' | 'spine-ports-exhausted' | 'spine-lane-count' | 'port-plugged' | 'port-linked'
      | 'unknown-def' | 'part-mismatch' | 'no-rack' | 'ref-collision';   // 'no-rack' only for mode 'in-rack' with no resolvable rack
  message: string; brick?: string; spine?: string; componentId?: Id; portId?: string;
}
```

Any `GeneratorError` makes `planFiberFabric` return empty `frames/panels/cables/links` with `errors` populated (like `planBreakout`).

**Rack resolution.** For `mode: 'patch-frame'` (the default) the panel gets its own free-standing frame (`rack.patch-frame-42u` when the brick needs more than 12U of panels, else `-12u`): positioned beside the reference rack — `rackIdByBrick[name]` / `rackIdBySpine[name]`, else the rack of the brick's (spine's) first *placed* device — on `frameSide` (default right) via `attachFramePosition`, and docked to it only when `dock: true`; when no reference rack exists the frame goes to `nextFreeFloorPos` and generation still succeeds. For `mode: 'in-rack'` the same resolution must yield a rack, else `GeneratorError { code: 'no-rack' }`. `'shared-frame'` puts every spine panel in one frame placed beside `rackIdBySpine['*']` or at `nextFreeFloorPos`. Panels in a frame or rack are placed bottom-up from the first free U (`firstFreeSlot` semantics of `placeDevice`), face `'front'`; a second chassis for the same brick stacks directly above the first.

**Helper pickers** for the UI (pure): `bricksFromSheets(project, sheetIds)`, `bricksFromRefGlob(project, glob)`, `parallelPortsOf(idx, component)` (ports whose optic/type layout has > 1 lane — a cage without an optic is not a parallel port), `spinesFromSelection(...)`.

**Label defaults** (`{-device}` is inserted only when the brick has more than one device; `{-port}` only when `bricks[].ports.length > 1` on brick templates / when the spine uses more than one port on spine templates — so the 1-device example reads exactly like the diagram). `{brick}` / `{spine}` are `bricks[].name` / `spines[].name`; `{ch}`, `{device}`, `{port}` are 1-based; `{port}` is the brick port index `p` on brick templates and the spine port index `q` on spine templates.

| Object | Template | 1-device example | 10-device example |
| --- | --- | --- | --- |
| Brick trunk | `T-{brick}{-device}{-port}` | `T-B2` | `T-B2-7` |
| Jumper | `J-{brick}{-device}{-port}-{ch}` | `J-B2-3` | `J-B2-7-3` |
| Spine trunk | `T-{spine}{-port}` | `T-S3` | `T-S3-7` |
| Brick / spine panel ref | `PP-{brick}` / `PP-{spine}` (+ `-2`, `-3` for the 2nd, 3rd chassis) | `PP-B2` | `PP-B2`, `PP-B2-2` |
| Patch frame | `PF-{rack}` (parent rack name) | `PF-A02` | |

### 7.2 Mapping rule `brick-channel-to-spine-lane`

For brick index `b` (1-based), device index `d` (1-based within the brick), port index `p` (1-based within `ports`), channel `k` (1-based, `1..lanes`), with `R = cassette.rear.count` (the generator requires `R = 1`, see constraints), `F = cassette.front.count`, `S = chassis.slots`:

- **Global slot** `s = (d − 1)·|ports| + p`; **panel index** `n = ⌈s / S⌉`; **local slot** `s' = ((s − 1) mod S) + 1`. The brick panel is `PP-<brick>` for `n = 1`, `PP-<brick>-<n>` otherwise. All port ids below use the local slot within that panel.
- **Brick panel:** the trunk from `device_d:port_p` plugs into rear port `r<(s'−1)·R + 1>`; channel `k` appears on front port `f<(s'−1)·F + k>`.
- **Spine:** spine `k`, spine port index `q = s` (same slot arithmetic → `n_q`, `q'`), lane `b` (0-based `b − 1`). Spine panel `PP-S<k>[-n_q]`: rear `r<(q'−1)·R + 1>` trunk to `spine_k:ports[q−1]`; brick `b`'s channel is on front port `f<(q'−1)·F + b>`.
- **Jumper:** `PP-B<b>[-n]:f<(s'−1)·F + k>` ↔ `PP-S<k>[-n_q]:f<(q'−1)·F + b>`.
- **Plan link** (when `createPlanLinks`): `{ device_d, port_p, lane k−1 } ↔ { spine_k, ports[q−1], lane b−1 }`, `cableDefId: null`, `sch.wirePoints: []`.

Worked check: `b = 2, d = 7, p = 1, k = 3`, `|ports| = 1`, `F = 4`, `S = 12` → `s = 7`, `n = 1`, `s' = 7` → trunk `T-B2-7` into `PP-B2:r7`, channel on `f27`; spine 3, `q = 7`, lane 2 (`lane: 1`); `PP-S3:f26`, rear `r7`, trunk `T-S3-7` to `S3:P7`; jumper `J-B2-7-3` = `PP-B2:f27 ↔ PP-S3:f26`.

**Constraints** validated before generation (each a `GeneratorError`): every brick device port must be a parallel port whose layout has `lanes === |spines|` (`brick-port-not-parallel` / `brick-lane-count`; 4 spines ↔ 4-lane ports; 8 spines need 8-lane parts, F8); spines must expose at least `Σ_d |ports|` free parallel ports with `lanes ≥ |bricks|` (`spine-ports-exhausted` / `spine-lane-count`); no target port may already be plugged (`port-plugged`) or linked (`port-linked`); every def id must resolve (`unknown-def`); parts must fit together (`part-mismatch`): `cassette.rear.count === 1`, `cassette.front.count ≥ lanes`, `trunkDef.legsA[0].connector === the device layout's connector` and `trunkDef.legsB[0].connector === cassette.rear.connector` (the trunk's A leg plugs into the device, its B leg into the panel rear), `jumperDef` leg connectors `=== cassette.front.connector`, and cassette/trunk media consistent with the optics; generated refs must be free (`ref-collision`).

### 7.3 Outputs and application

`planFiberFabric(project, spec): FiberFabricPlan` — pure; returns
`{ id: Id; frames: Rack[]; panels: { component: Component; footprint: FootprintDef; symbol: SymbolDef; placement: Placement }[]; cables: FiberCable[]; links: Link[]; counts: { trunks; jumpers; panels; cassettes; links }; errors: GeneratorError[]; verification: ReturnType<typeof traceAll> }`
where `verification` is computed by tracing a **scratch copy** of the project with the plan applied — the dialog shows "160/160 channels ok" before the user commits.

**Panel components** live on the schematic: a brick panel's `sch.sheetId` is the sheet of the brick's first device (a spine panel's: its spine's sheet); position `{ x: max device x on that sheet + 320, y: first device y + index × 120 }` (index among panels added to that sheet by this plan), `rotation: 0`, `optics: {}`, `value: 'patch-panel'`, `generatedBy: plan.id`, `footprintDefId` = the built footprint id, `ref` per the label table. Symbols use `refPrefix: 'PP'` so a user-added panel still numbers `PP1`.

`applyFiberFabric(draft, plan)` — **order is normative** because `catalogIndex(draft)` caches on the `customCatalog` proxy for the whole Immer recipe: (1) push custom symbols/footprints into `draft.customCatalog` **first**; (2) frames into `racks`; (3) panel components + placements via `placeDevice` (U-fit is checked against the real chassis height); (4) cables into `fiberCables`; (5) links; (6) `syncState` entries for the new components and links so F8 shows nothing pending. Wrapped as **one** `layout`-history command (`commands.applyFiberFabric`) even though it creates schematic objects: Undo from the Layout tab reverts everything; the Schematic tab's history is untouched (documented in the handoff; do not split it). All generated objects carry `generatedBy: plan.id` so a later "Regenerate" can replace only its own output.

**Counts for the request's scale** (4 bricks × 10 devices × 1 port × 4 channels, 4 spines): 40 brick trunks, 160 jumpers, 40 spine trunks (`counts.trunks = 80`), 8 panels (each 10 cassettes → a 4U/12-slot chassis), 80 cassettes, 160 plan links; `traceAll` → 160 `ok`, 0 faults.

### 7.4 Panel builder (`src/model/fiber/panelBuilder.ts`)

`buildPanelFootprint({ chassisDefId, slots: (cassetteDefId | null)[], name })` → `{ footprint: FootprintDef (kind 'patch-panel', heightU from chassis, ports + fiberMap per §5 naming, cassettes provenance), symbol: SymbolDef (refPrefix 'PP'; pins `r*` on the left, `f*` on the right; groups 'rear' / 'front') }`. Deterministic id `fp.panel.<hash of chassis + slots>` / `sym.panel.<hash>` so identical panels share defs. Used by the generator and by the Panel builder dialog through `commands.addPanelFootprint`.

---

## 8. UI

### 8.1 Library (`src/panels/library`, `src/panels/layout/LibraryPanel.tsx`)
- Schematic Library gains a **Fiber plant** category: chassis (opens the Panel builder), cassettes (info rows); the two static panels stay under Patch panels.
- Layout Library gains **Fiber cables** (trunks / jumpers by def, `144F · 72 ch · 12 legs` summaries; `hidden` defs omitted). Patch frames are already in the rack list (badge "frame") and place freely; the Unplaced bin already offers **Own frame** per device and accepts a drop **on the floor plan** (→ `placeInNewFrame`). A frame's inspector gains an optional "Dock to rack" (rack + side → `dockFrame`) / "Undock".

### 8.2 Dialogs (`registerDialog`)
- `panel-builder`: chassis Select, one cassette Select per slot, name, preview of the generated port list and fiber map table → `addPanelFootprint`, then places the component like any library symbol (`ui.schematic.placing`).
- `fiber-fabric`: bricks (pick sheets / ref glob / selection → editable ordered lists), spines, ports per device (from `parallelPortsOf`), parts (defaults from `settings.fiber`), panel placement mode, labels; live preview of counts and errors; **Verify** shows the `traceAll` summary of the scratch project; **Apply** → `applyFiberFabric`. Must let a user generate the 4 × 10 fabric in under 2 minutes.
- `fiber-trace`: a header row for the start lane (`B2:P1 ch 3`), then one row per hop in `path` (six for the example), each clickable (cross-probe), status/plan badges, the `formatPath` string (copyable).

### 8.3 Fiber plant view (`src/panels/fiber/FiberPlantView.tsx`)
Registered **twice** with one component: `fiber-plant.schematic` (editor `schematic`, right dock, order 30) and `fiber-plant.layout` (editor `layout`, order 30). The request's diagram, rendered as SVG (no Konva needed; a few hundred nodes):
- Five columns — **Bricks · Brick patch · Jumpers · Spine patch · Spines** — derived from the plant: a "brick" here is any device with trunks into a panel whose jumpers leave to other panels; devices, panels and spines are boxes with `ref` and `P1 · 4 ch`-style port summaries; trunks are thick lines (`fiberCount`F, `channels` ch), jumpers thin curves.
- SVG elements carry `data-fiber-id`: `cable:<cableId>`, `port:<componentId>:<portId>`, `device:<componentId>`; highlighted ones also carry `data-highlight="1"`.
- Hover or click a device lane (or any cable / panel port → `lanesThrough`) runs `traceLane` and highlights the whole path in coral (`#e0713f`), dims the rest; the status/plan badge appears; double-click opens `fiber-trace`.
- Filters: by brick/spine, show only faults; a summary strip (`160 channels · 160 ok · 0 faults`) reading the latest `traceAll` (memoised on project identity, recomputed on change when `settings.fiber.verifyOnChange`).
- Cross-probe: selection here writes `ui.selection` (`fiber-cable` / `fiber-lane` / `component`); selection from elsewhere highlights here.
- Export button → `fiber-plant-svg`.

### 8.4 Inspectors
- **Cable inspector** (layout Inspector, `fiber-cable` selection → `CableInspector`): def, label, media, `fiberCount / channels / legs`, length (Select from `lengthsM` or free), both ends as leg tables (`leg 0 → PP-B2:r1`, Unplug / Plug into… picker of free compatible ports), "Trace from A / from B" (`lanesThrough`).
- **Panel inspector** (component of kind `patch-panel` with `fiberMap`): cassette table (slot, def, rear port, front ports), per-port "plugged: T-B2 leg 0", fiber map table (expandable), "Rebuild with different cassettes…" (panel builder prefilled).
- **Device port lanes** (schematic Inspector, per-port optic table; `fiber-lane` selection opens the device inspector with that row expanded): each parallel port row expands to `ch 1..N` with the plan link and the plant status dot (green ok / red fault / grey none); a **Trace** button per lane.
- **Rack inspector**: for a `patch-frame` rack shows only its parent and a Side selector; for a device rack an "Add patch frame" button.

### 8.5 Tools and shortcuts
- Schematic: right-click a pin → **Trace fiber path** (parallel ports show a lane submenu). Keyboard **T** with a pin hovered/selected does the same.
- Layout: right-click a panel port in elevation → Trace (`lanesThrough`); **Plug cable** tool: click a cable end glyph then a free port, or pick a cable def then click port A and port B to create + plug in one command (`addFiberCable`).
- Status bar (layout): `Fiber: 160 ch · 0 faults` next to `Unrouted`.

### 8.6 Layout & elevation (`src/editors/layout/**`)
- Patch frames render with a dashed outline and the caption `<name> · patch frame · N panels` (already implemented). Free-standing frames drag, rotate and delete like racks. A **docked** frame follows its parent: the rack drag preview applies `attachFramePosition` to docked frames so they follow live, rotating the parent rotates the frame, and dragging the frame itself undocks it.
- Elevation shows a frame as a full-width (600 mm) column with a dashed outline and no roof/plinth ("slim" refers to its 300 mm depth); panels are placed in it via the same drag/drop and `placeComponent`.
- Trunks and jumpers in elevation: trunk = short thick line from the device port to the panel rear port (same/adjacent column); jumpers leave the panel front port as thin stubs with the far panel name (like external airwires). In the floor plan, jumpers between frames draw as thin airwires (cable colour) until routed (F6).

### 8.7 3D (`src/editors/viewer3d/geometry.ts` → `buildPhysicalScene(project, opts?: { highlight?: Set<Id> })`)
- Patch frames: `rack.kind === 'patch-frame'` → a **patch panel wall** (implemented): a thin slab the frame's full width and height (frames are 120 mm deep, so `portWorldPos` lands exactly on the two faces), a plinth and a top cap, **no posts, no doors**; each panel placed in it draws as a faceplate proud of the wall on the front **and** rear face with its adapters; every connected port gets a short pigtail stub in the cable colour pointing away from its face, so fibers visibly arrive from both sides (`[fiber in] wall [fiber in]`). Label `PF-<ref>` above.
- Panels: device boxes (existing path) with a generated faceplate: LC front ports in green rows, MPO rear ports as wider dark rectangles; a port is lit when `!idx.isPortFree(...) || idx.isPortPlugged(portRef)`.
- **Trunks**: tubes from the device port to the panel rear port: exit the device per the port face, run across to the rack's manager column (reuse `autoInRackPath` side choice), vertically to the panel's U, across to the port — thick (`diameterMm` from the def, min 3 mm), cable colour.
- **Jumpers**: thin tubes (2 mm) from front port to front port; when a cable route exists (F6) follow `routePath3d`; else a straight dashed line at panel height.
- Output gains `fiberCables: CablePart[]` (id = cable id, `routed` = has a cable route, `highlighted: boolean` from `opts.highlight`). The viewer derives `highlight` from `ui.selection`: a `fiber-cable` → that id; a `fiber-lane` → every cable on its `ChannelTrace.path`. Highlighted tubes render coral and slightly thicker. Selecting a tube selects the `fiber-cable`; **F** frames it. Layer toggle `ui.viewer3d.showFiberPlant`.

### 8.8 Exports (`exportRegistry`, group **Lists** unless noted)
- `fiber-schedule-csv`: one row per cable: label, def, media, fibers, channels, legs, A plugs (`PP-B2:r1`), B plugs, length, generatedBy.
- `fiber-trace-report-csv`: one row per `traceAll` channel: A lane, B lane, status, plan status, path string, length.
- `cassette-map-csv`: per panel: slot, cassette, rear port/pos ↔ front port/pos.
- `fiber-plant-svg` (group **Sheets**): the Fiber plant view as an SVG with a title block.
- The BOM gains sections: patch frames, panels by chassis, cassettes by def, fiber cables by def × standard length (and excludes realised plant links from the old cables section).

---

## 9. Integration notes (read before coding)

### 9.1 Where things go
```
src/model/text.ts               compareNatural (moved from commands/base; re-exported there and from io/exports/common unchanged)
src/model/fiber/
  index.ts          re-exports
  positions.ts      layoutOf(idx, portRef) → FiberLayoutDef | null (null for every port on a 'patch-panel' footprint, regardless of type/optic;
                    the §3.1 fixed-type default applies to device footprints only), laneTerminals(idx, portRef) → { tx, rx }[] | null, laneLabel(lane)
  fixtures.ts       handWiredFabric(): the 4 × 1 example built by hand through F1 APIs only (buildPanelFootprint, addFiberCable, plugLeg,
                    createComponent with refs B1..B4 / S1..S4 / PP-B1..PP-S4, labels per §7.1) — F2's test bed; F3 proves fixture1 equals it
  plant.ts          FiberIndex (memoised): plugsByPort, cableById, panelMapByComponent; isPortPlugged; free-port queries; validateFiberCatalog; invariants
  trace.ts          traceFiber / traceLane / lanesThrough / traceAll / isRealisedByPlant / formatPath
  generator.ts      planFiberFabric / applyFiberFabric / mapping rules / pickers
  panelBuilder.ts   buildPanelFootprint
  mutations.ts      addFiberCable, plugLeg, unplugLeg, deleteFiberCable, setCableLength, dockFrame, undockFrame, attachFramePosition,
                    onRackMovedFrames, onRackDeletedFrames (docked frames only), unplugComponent (used by deleteComponents / F8)
                    (placeInNewFrame / defaultFrameDefId / frameNameFor / nextFreeFloorPos already exist in src/commands)
src/model/drc/rules/fiber-*.ts
src/model/erc/rules/lane-out-of-range.ts
src/commands/fiber.ts
src/panels/fiber/   FiberPlantView.tsx, FiberFabricDialog.tsx, PanelBuilderDialog.tsx, FiberTraceDialog.tsx, CableInspector.tsx, PanelInspector.tsx,
                    plantLayout.ts (pure column layout for the SVG), index.ts (registers; App.tsx imports it once)
src/io/exports/fiber*.ts
src/model/demo/fiberFabric.ts   buildFiberFabricProject(opts) + fiberFabricSpecFor(project, opts) — the canonical fixture + 'Fiber fabric' template
```

**`attachFramePosition(project, parent, side)`** (normative; used when placing a frame beside a rack and, continuously, for docked frames): the frame's footprint touches the parent's `side` edge, offset outward by the fitted vertical manager's width on that side when one exists (`managerFor(project, parent.id, side)`), front faces flush. At rotation 0: `left → { x: parent.pos.x − vcmW − frame.widthMm, y: parent.pos.y + parent.depthMm − frame.depthMm }`, `right → { x: parent.pos.x + parent.widthMm + vcmW, y: same }`; for other rotations rotate that offset about the parent's centre by `parent.rotationDeg` and copy `rotationDeg`. Recomputed by `onRackMovedFrames`, `rotateRack`, and `addAccessory` / `removeAccessory` for a vcm.

**The canonical fixture** (`buildFiberFabricProject(opts: { bricks?: number (4); devicesPerBrick?: number (10); generate?: boolean (true) })`) makes the request's example literal:
- A custom device `sym.fiber-demo-device` / `fp.fiber-demo-device` (1U, kind `switch`, `refPrefix: 'DEV'`, ports `P1..P12` of type `QSFP28`) in `customCatalog`; **both** brick devices and spines use it with `xcvr.100g-sr4` assigned on every used port, so every lane is 25 G on both sides and ERC has no errors.
- Refs set explicitly via `createComponent({ ref })`: with `devicesPerBrick: 1` the brick devices are `B1..B4` and the spines `S1..S4`; with more devices, `B1-1..B1-10`. Brick `b` uses port `P1`; spine `k` uses `P1..P<devicesPerBrick>`. (`annotate` never renames these — §9.2.)
- Physical: one 42U rack per brick (`A01..A04`) with a patch frame on the right, one rack per spine (`S01..S04`) with its frame; devices placed bottom-up from U 1 in brick/spine order (`B1-1` at U 1 … `B1-10` at U 10; spines at U 1), face `'front'`; panels at U 1 of their frame (a second chassis directly above). Sheets `Bricks` and `Spines`.
- With `generate: false` it returns this **base project only**; `fiberFabricSpecFor(project, opts): FiberFabricSpec` returns the exact spec the template applies (ports `['P1']`, default parts `fcbl.mpo12-8f-om4-b`, `fcbl.lc-duplex-om4`, `cas.mpo12-8f-4lc-b`, `chs.4u-12`, frames on the right). With `generate: true` (the template) it applies `planFiberFabric(base, spec)`, so the fixture is also the generator's own regression test.

### 9.2 Existing code to change (each item is owned by the WP in brackets)
- [F1] `ProjectIndex` (`src/model/query.ts`): add `fiberCableById`, `plugAt(portRef)`, `isPortPlugged(portRef)`; `isPortFree` stays about plan links.
- [F1] `src/catalog/index.ts`: merge/short-circuit per §5; `Catalog` gains the four arrays.
- [F1] `src/io/persistence/migrations.ts`: `fiberCables: optionalArray`, `customCatalog.fiberCables/cassettes: optionalArray`, **deep-merge** `settings.fiber = { ...defaultSettings().fiber, ...(raw.settings?.fiber ?? {}) }` (the existing merge is shallow); `Route.owner` left undefined = `'link'`; `Rack.kind` left undefined = `'rack'`. `setProjectSettings` accepts `{ fiber: Partial<…> }` and merges.
- [F1] `src/model/schematic/annotate.ts`: a ref is **manual** and never renumbered, in either scope, unless `parseRef(ref)?.prefix === refPrefixOf(project, component)` — i.e. only refs of the form `<symbol refPrefix><n>` are managed. `PP-B2` and `B1-1` (no match) and `B2` on a `DEV`-prefixed symbol (foreign prefix) are manual; `DEV3` is not (today `scope: 'all'` would rename `PP-B2 → PP1` and `B2 → DEV1`). Behavioural change for user-typed refs with a foreign prefix; record it in the handoff. Test: `PP-B2` and `B2` survive `annotate({ scope: 'all' })`.
- [F1] `src/model/schematic/mutations.ts` `deleteComponents` and `src/model/sync/apply.ts` `remove-component`: call `unplugComponent(draft, id)`.
- [F1] `src/model/schematic/breakout.ts`: `breakoutFanout` precedence + `'source-not-parallel'` per §3.1.
- [F1] `src/model/factories.ts` `createRack` copies `def.kind`; `createProject` fills `fiberCables: []`, `customCatalog.fiberCables/cassettes: []`, `settings.fiber`.
- [F1] `src/store/selection.ts`: `selectionKey` → `fiber-lane:${componentId}:${portId}:${lane}`, `fiber-cable:${id}`; `selectionItemExists` → `fiber-cable` via `fiberCableById`, `fiber-lane` → component and port exist. `src/store/index.ts` `revealSelection` default editor: `fiber-cable` → layout, `fiber-lane` → schematic.
- [F1] **Docked-frame ripple** (free-standing frames need none of this — they are ordinary racks): `commands.moveRacks` also moves docked frames whose parent is in the set (and undocks a docked frame that is moved on its own); `rotateRack` / `renameRack(parent → PF-<new>)` / `deleteRacks` (expand with `racks.filter(r => r.attachedTo && set.has(r.attachedTo.rackId))`, then `onRackDeletedFrames`) cascade; `onRackMovedFrames` calls `routing.onRackMoved` per frame; `matchRacks` (place-by-rule) excludes frames unless `filter.includeFrames`; `addRackArray` never creates frames; DRC `clearance` treats a docked frame overlapping its own parent's vcm strip as fine (they are positioned outside it).
- [F1] `src/commands/base.ts` and `src/io/exports/common.ts`: re-export `compareNatural` from `@/model/text` (one-line change each).
- [F2] `src/model/drc/rules/unrouted-link.ts`, `reach-exceeded.ts`: skip plant links via `isPlantLink`.
- [F4] `src/editors/layout/FloorView.tsx`: frames selectable, not draggable; drag preview moves attached frames. `src/editors/layout/physicalScene.ts` `floorLinks`, viewer3d airwires, elevation airwires: skip realised plant links via `isRealisedByPlant`. `src/editors/layout/elevation/*`: frame column styling. `src/editors/viewer3d/*`: §8.7; highlight/frame/name handle the two new selection kinds.
- [F5] `src/panels/layout/inspector/RackInspector.tsx` (frame controls), `LayoutInspector.tsx` (`fiber-cable` → `CableInspector`, `fiber-lane` → device inspector), `src/panels/shell/IssuesDrawer.tsx` (`selectionForTarget` / `targetLabels` for `fiber-cable`), `src/panels/shell/StatusBar.tsx` (`countUnrouted` per §6.4; fiber summary), `src/io/exports/bom.ts` (racks section excludes `kind === 'patch-frame'`; new patch-frames / panels / cassettes / fiber-cable sections; exclude realised plant links from `cablesSection`), `src/io/exports/cableSchedule.ts` / `cableLabels.ts` (plant path column), new `fiber*.ts` exports (§8.8), `src/App.tsx` (`import '@/panels/fiber'`).

### 9.3 Routing plant cables (F6 — keep the seam, do not start in F1–F5)
`Route.linkId` stays required and always equals the `Project.routes` key; for a cable route it holds the **cable id** and `Route.owner === 'cable'`. Add `resolveRouteEnds(idx, route): { a: PortRef; b: PortRef; cableDef?: FiberCableDef | CableDef; owner } | null` in `src/model/routing/owner.ts` and refactor every consumer that does `idx.link(route.linkId)` to use it: `path3d.ts` (`routePath3d`, `routeEndFloorPos`, `bundles`), `fill.ts` (`cablesInTray`, `routesUsingManager`, `cableDiameterMm`), `waypoints.ts` (`onEndpointMoved`), DRC `missing-manager`, `wrong-face`, `tray-media`, `bend-radius`, `missing-waterfall`, `commands/layout.ts` (`cloneRoute` copies `owner`; `setRoute` compares the key), `IssuesDrawer.selectionForTarget` (route → `fiber-cable` when owner is cable), `WaypointInspector` / `RouteInspector` (accept a cable id). The route tool accepts a selected `fiber-cable` (ends = the two plugged legs' `portWorldPos`). `routedLengthM` for a cable → `FiberCable.lengthM` when declared, else the routed length.

### 9.4 Plan links for lanes on both ends
`Link` already allows `lane` on both ends; ERC `port-reuse` handles lanes; `speed-mismatch` compares lane speeds when either end has a lane. Add ERC `lane-out-of-range` (Warning: `lane ≥ layout.lanes`, or a lane on a port whose layout has 1 lane; skipped when the port has no layout).

### 9.5 Non-goals (this feature)
Insertion-loss budgets, splice trays, multi-row MPO-24/32, AOC/DAC inside the plant, live discovery, MPO connector **gender** (pinned/unpinned) and **polish** (APC/UPC) — BOM lines are by def and length only. Keep the `pinout` / `fiberMap` model generic so a later increment can attach a dB cost per mated pair and optional `gender` / `polish` on `CableLegDef` / `FootprintPort` with a `fiber-mate-mismatch` rule.

---

## 10. Work packages (ownership for parallel agents)

| WP | Owns | Depends on | Deliverables |
| --- | --- | --- | --- |
| **F1 Model + catalog** | `src/model/types.ts` (additive), `scripts/gen-catalog.ts` + new JSON, `src/catalog/index.ts`, `src/model/query.ts` (additive), `src/model/text.ts` (+ the two re-export lines), `src/model/fiber/{positions,plant,mutations,panelBuilder}.ts`, `migrations.ts`, `factories.ts`, the §9.2 [F1] items | — | Types in §4, catalog in §5, `FiberIndex`, invariants, `validateFiberCatalog`, `buildPanelFootprint`, frame attach/move/delete cascade, annotate/breakout/selection changes, tests |
| **F2 Tracer + rules** | `src/model/fiber/trace.ts`, `src/model/fiber/fixtures.ts`, `src/model/drc/rules/fiber-*.ts`, ERC `lane-out-of-range`, `unrouted-link` / `reach-exceeded` skips | F1 | §6 in full; criteria 1–5 (incl. 2b/2c) asserted on `handWiredFabric()`; pod DRC regression unchanged |
| **F3 Generator + commands + demo** | `src/model/fiber/generator.ts`, `src/commands/fiber.ts`, `src/model/demo/fiberFabric.ts`, template registration | F1, F2 | §7; criteria 1–5 re-asserted on `fixture1` (path-for-path identical to `handWiredFabric()`), 7, 8, 11; one-undo-step apply; F8 shows nothing after apply; 'Fiber fabric' template |
| **F4 Layout + 3D** | `src/editors/layout/**` (frames, panels, trunk/jumper drawing, airwire skips), `src/editors/viewer3d/**` | F1 (F3 for the fixture) | §8.6–8.7; e2e: frame beside rack in 3D, tubes present, selecting a lane highlights the path |
| **F5 Panels + dialogs + exports** | `src/panels/fiber/**`, library additions, inspector hooks, `IssuesDrawer` / `StatusBar` changes, `src/io/exports/fiber*.ts`, BOM sections, `App.tsx` import | F1–F3 | §8.1–8.5, §8.8; e2e: generate 4 × 10 via the dialog in < 2 min, trace B2 P1 ch3 in the UI |
| **F6 Cable routing** | `src/model/routing/**` (`owner.ts`, the §9.3 refactor), route tool acceptance of cables, inspectors for cable routes | F1, F4 | §9.3; every existing routing test unchanged |
| **F7 Acceptance + docs** | `e2e/fiber.spec.ts`, `docs/HANDOFF.md` §12, user doc `docs/fiber-plant.md` | F1–F5 | §11 end-to-end; handoff update incl. the LR4 note and the `PortType` decision |
| **F8 MPO-16 / 8-lane** | `PortType` gains `'MPO-16'` and the `Record<PortType, …>` sites (`commands/customDevice.ts`, `editors/layout/elevation/constants.ts`, `io/exports/rackElevationSvg.ts`) plus `isPluggableCage`, `FIXED_CONNECTOR`, `assignment.ts`, `gen-catalog.ts`; `cas.mpo16-16f-8lc-b`; generator 8-spine support | F1–F3 | Criterion 17 |

Every WP: `npm run check` green; new tests next to code; no edits outside the owned paths without saying so.

---

## 11. Acceptance criteria and tests

Model-level (Vitest, `src/model/fiber/*.test.ts`). Criteria 1–5 are first proven by F2 on `handWiredFabric()` (§9.1), then re-asserted by F3 on `fixture1 = buildFiberFabricProject({ bricks: 4, devicesPerBrick: 1 })`, which must be path-for-path identical (same `formatPath`, same `traceAll` summary). `base10 = buildFiberFabricProject({ bricks: 4, devicesPerBrick: 10, generate: false })`, `spec10 = fiberFabricSpecFor(base10, { bricks: 4, devicesPerBrick: 10 })`.

1. **The request's test case.** On `fixture1`, `traceLane(B2, 'P1', lane 2)` (channel 3) returns `status 'ok'`, `plan 'matches'`, `far = { S3, 'P1', lane 1 }`, and `formatPath` equals `T-B2 → PP-B2 r1⇒f3 → J-B2-3 → PP-S3 f2⇒r1 → T-S3 → S3:P1 ch 2`. `path` is exactly `[cable T-B2, panel PP-B2 (r1→f3), cable J-B2-3, panel PP-S3 (f2→r1), cable T-S3, device S3:P1 lane 1]` — six hops, no start terminal.
2. **Fiber-level polarity.** Same lane: `tx.end.role === 'rx'` and `rx.end.role === 'tx'` on `S3:P1 lane 1`. The Tx walk's positions are `3 → 10 → f3:1 → f2:2 → r1:2 → 11` (start pos 3; after the trunk 10; cassette to `f3` pos 1; jumper crosses to pos 2 at `PP-S3:f2`; spine cassette to `r1` pos 2; trunk to 11 = Rx of lane 2). The Rx walk is `10 → 3 → f3:2 → f2:1 → r1:11 → 2` (2 = Tx of lane 2).
   **2b. Breakout to duplex.** A device with `xcvr.100g-sr4` → `fcbl.mpo12-8f-om4-b` → a 1-cassette `cas.mpo12-8f-4lc-b` panel → `fcbl.lc-duplex-om4` from `f3` → an SFP28 port with `xcvr.25g-sr`: `traceLane(device, port, lane 2)` is `ok`, Tx ends on the far port's position 2.
   **2c. Adapter panels.** Two `fcbl.lc-duplex-om4` cords through `fp.fiber-patch-panel-24lc` (device LC → `f3`, `r3` → device LC) trace `ok`; replacing one with `fcbl.lc-duplex-straight` gives `polarity-flipped` with that cord as the suspect from either direction. Two `fcbl.mpo12-8f-om4-b` trunks through `fp.mpo-patch-panel-12` give `polarity-flipped` (correct physics, §3.4); the suspect is the trunk whose label sorts first, from either direction.
3. **Polarity fault.** On `fixture1`, replace `J-B2-3`'s def with `fcbl.lc-duplex-straight` → `traceLane` status `polarity-flipped`, `suspectCableId = J-B2-3`; DRC `fiber-polarity` has exactly one `fiber-cable` target, `J-B2-3`, regardless of which direction `traceAll` traced; exactly one channel in `traceAll` is affected.
4. **Dead end.** On `fixture1`, unplug `J-B2-3` at the `PP-S3` end (`b.legs[0] = null`) → `traceLane(B2, 'P1', 2)`: status `dead-end`, fault `reason: 'leg-unplugged'`, `at = PP-B2:f3` (pos 1 for the Tx walk, pos 2 for Rx), `cableId = J-B2-3`; plan `unrealised`. `traceLane(S3, 'P1', 1)`: `dead-end` with `reason: 'port-unplugged'`, `at = PP-S3:f2` (pos 1 for Tx, pos 2 for Rx), no `cableId`. `traceAll` reports exactly one `dead-end` channel (the `B2` side, which sorts first), so `runDrc` emits exactly one `fiber-unplugged` warning, targeting `J-B2-3`, with issue key `B2/P1/2`. Applying the exported rule helper `fiberUnpluggedFinding(project, traceLane(S3,'P1',1))` directly targets `PP-S3` port `f2` and yields a different issue id (key `S3/P1/1`).
5. **Wrong destination.** Swap the B ends of `J-B2-3` and `J-B2-4` → both lanes `ok` physically but `plan 'wrong-destination'` with `expected` set; DRC `fiber-wrong-destination` names `S3:P1 ch 2` vs `S4:P1 ch 2`.
6. **Derived channels and catalog validity.** `channelsOf(fcbl.mpo12-8f-om4-b) === 4`, `channelsOf(fcbl.lc-duplex-om4) === 1`, `channelsOf(fcbl.mpo12-144f-os2-b) === 72`; `validateFiberCatalog(builtinCatalog)` is empty; a def with `fiberCount ≠ pinout.length` or a cassette breaking the §3.3 invariant is reported.
7. **Generator scale.** `planFiberFabric(base10, spec10)` → `counts = { trunks: 80, jumpers: 160, panels: 8, cassettes: 80, links: 160 }`, `errors` empty, `verification.summary.ok === 160`, zero faults; every spine port aggregates exactly one channel from each brick (lane `b − 1` on spine `k` port `P<d>` traces back to brick `b` device `d`); labels follow §7.1 (`T-B2-7`, `J-B2-7-3`, `T-S3-7`); the worked check in §7.2 holds (`PP-B2:f27 ↔ PP-S3:f26`).
8. **One undo step.** `store.execute(commands.applyFiberFabric(plan))` on `base10`: `canUndo('layout')` true, one `undo` removes all frames/panels/cables/links and custom defs; `computeSyncPlan` is empty right after apply; panel U ranges equal the chassis height (`chs.4u-12` → 4U).
9. **Invariants.** `plugLeg` into an occupied port throws; connector mismatch throws; on `fixture1` (frames generated with `dock: true`) `deleteRacks(A02)` removes the docked `PF-A02`, unplaces `PP-B2` and unplugs `T-B2` leg B and the four jumpers' A legs — `traceLane(B2,'P1',2)` becomes `dead-end` / `leg-unplugged` with `cableId = T-B2`; with `dock: false` the frame survives and only `A02`'s devices are unplaced; deleting a free-standing frame directly unplaces its panels and unplugs their ports; `deleteComponents([PP-B2])` has the same tracing effect; `annotate({ scope: 'all' })` leaves `PP-B2` and `B2` untouched.
10. **Persistence.** JSON round trip preserves `fiberCables`, frames and custom panel footprints; a pre-feature JSON loads with `fiberCables: []` and default `settings.fiber`; a JSON with a partial `settings.fiber` gets the missing defaults.
11. **Performance.** `traceAll` on the generated 4 × 10 project < 50 ms; `planFiberFabric(base10, spec10)` < 500 ms (node, generous bounds in the test).
12. **Regression.** `runDrc(buildPodProject())` still yields exactly 60 `unrouted-link` warnings and no other rule; all existing breakout/annotate/routing tests pass.

UI-level (Playwright, `e2e/fiber.spec.ts`, using `File ▸ New from template ▸ Fiber fabric` and `window.__dcStore`):

13. The Fiber plant panel shows 5 columns; hovering B2's channel 3 highlights exactly nine elements — `data-fiber-id` = `cable:<T-B2>`, `port:<PP-B2>:r1`, `port:<PP-B2>:f3`, `cable:<J-B2-3>`, `port:<PP-S3>:f2`, `port:<PP-S3>:r1`, `cable:<T-S3>`, `device:<B2>`, `device:<S3>` — and nothing else carries `data-highlight`.
14. Fabric dialog: on a fresh project the test first creates 8 racks, places 4 brick sheets × 10 devices + 4 spines with `placeByRule`, assigns `xcvr.100g-sr4` on the used ports, then opens the dialog, picks the sheets, applies → counts of criterion 7 in under 2 minutes of scripted interaction; status bar reads `Unrouted: 0 / 160 (160 via plant)` and `Fiber: 160 ch · 0 faults`.
15. In 3D, a patch frame mesh exists beside each brick rack and each spine rack (no doors on frames); trunk and jumper tubes are present; selecting the lane from the schematic inspector turns exactly its path's tubes coral.
16. Right-click B2:P1 pin → Trace fiber path → channel 3 → the trace dialog shows the header `B2:P1 ch 3`, six hop rows and the path string from criterion 1; each hop click cross-probes.
17. (F8) 8-spine fabric: 8 bricks × 1 device with `xcvr.400g-sr8`, `fcbl.mpo16-16f-om4-b`, `cas.mpo16-16f-8lc-b` → 64 links, all `ok`; `traceLane(B3, 'P1', lane 4)` ends on `S5:P1 lane 2`.
18. Exports: `fiber-schedule-csv` has 240 data rows for the 4 × 10 fabric; `fiber-trace-report-csv` has 160 rows, all `ok`; the BOM has no "Unassigned cable" row for the fixture.

---

## 12. Open questions (defaults chosen so work can start)

| Question | Default in this spec |
| --- | --- |
| Are bricks a first-class entity (named groups) or derived from sheets/selection? | Derived (ordered device lists); revisit if users need persistent group names beyond the panel refs. |
| Panel port naming for multi-cassette panels: continuous (`f5..f8`) or slot-prefixed (`c2.f1`)? | Continuous, so single-cassette panels read `f1..f4` exactly as in the request. |
| Should the plan link be created automatically by the generator? | Yes (`createPlanLinks: true`); the plant is what proves it. |
| Real vendor polarity variants (Method A trunks + A cassettes, Method C)? | Expressible via `pinout`/`map` data (§3.5); only Method B parts ship. |
| Where do spine panels live — one frame per spine rack or a shared MDA frame? | Per spine rack by default; `'shared-frame'` supported by the spec input. |
| Must a patch panel's frame be attached to a device rack? | **No.** Frames are free-standing racks; docking is optional (`dock: true` in the generator, "Dock to rack" in the inspector). Decided 2026-09-24 after the user hit the rack requirement. |
| Extend `PortType` with `MPO-16` now? | No — F8 increment; F1–F5 keep `PortType` unchanged and use MPO-16 only as a cable-leg / layout connector on cage ports. |

---

## Appendix A — Mini reference for implementers

- 1-based everywhere fibers are concerned (`pos`, cassette `r1/f1`, channel labels); 0-based for `LinkEnd.lane`, `LegPos.leg` and array indices. `laneLabel(lane) = 'ch ' + (lane + 1)`.
- Method B MPO flip: `pos' = (connectorSize + 1) − pos` (`13 − pos` for MPO-12, `17 − pos` for MPO-16).
- Duplex A-B cord: `1 ↔ 2`. Duplex LC adapter (static panel): `1 ↔ 2` between faces.
- Breakout cassette (`cas.mpo12-8f-4lc-b`): `r1:p ↔ f<p>:2` for `p ≤ 4`; `r1:p ↔ f<13−p>:1` for `p ≥ 9`.
- Parallel-4 device layout: lane `k` (1-based) Tx `k`, Rx `13 − k`. Duplex layout: Tx 1, Rx 2.
- A channel is `ok` iff both fibers reach the same far lane with roles swapped.
- `hops` / `path` start with the cable leaving the start port and end with the far `device` hop.
- Everything generated carries `generatedBy: plan.id`.
- Plant link = `cableDefId === null` + both ends have layouts; only plant links and plugged lanes are traced, so existing projects are untouched.
