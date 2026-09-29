# Task: Add configurable fiber cables and trunks (breakout cables)

_Verbatim task from the product owner (2026-09-25). Implemented in seven increments on `feature/fiber-plant-patch-panels`; see `docs/specs/fiber-plant-patch-panels.md` §4 for how these names map onto the fiber-plant spec (`CableDef` fiber fields ≙ `FiberCableDef`, `strandMap` ≙ `pinout`, `Cable.plugs` ≙ `CableEnd.legs`)._

## Goal
Let the user define any fiber cable by (1) its fiber count and (2) the connector type on each end.
When the two ends use different connector sizes (e.g. MPO on one side, LC on the other), the cable
is a TRUNK: one multi-fiber connector fans out into multiple smaller connectors ("legs").
The app must automatically work out how many legs each side has, how fibers map between them,
and render the fan-out everywhere the cable appears.

## Terminology (use these names in code)
- Fiber / strand: one glass fiber. Every cable has a `fiberCount`.
- Connector: a plug on the end of a cable. Each connector type holds a fixed number of fibers.
- Leg: one connector on one end of a cable. A cable end can have 1 or many legs.
- Straight cable: both ends have the same number of legs (MPO↔MPO, LC↔LC, 144F 12×MPO↔12×MPO).
- Trunk (breakout): ends have different leg counts because one side uses a multi-fiber connector and
  the other uses smaller connectors (MPO→4×LC, MMC→2×MPO). Industry also calls this a
  "breakout", "fanout", or "harness" cable. Show "Trunk (breakout)" in the UI.
- Furcation point: where the single jacket splits into legs. Has a breakout length (default 0.5 m).
- Channel: one transmit + one receive fiber pair (2 fibers). Derived, never typed in.

## Connector catalog (seed data, JSON in /src/catalog/connectors.json)
| id          | family      | fiber positions | typical fibers used |
|-------------|-------------|-----------------|---------------------|
| LC-simplex  | small       | 1               | 1                   |
| LC-duplex   | small       | 2               | 2                   |
| SN-duplex   | small (VSFF)| 2               | 2                   |
| CS-duplex   | small (VSFF)| 2               | 2                   |
| MPO-8       | multi       | 12 (body)       | 8 (pos 1-4, 9-12)   |
| MPO-12      | multi       | 12              | 12                  |
| MPO-16      | multi       | 16              | 16                  |
| MPO-24      | multi       | 24              | 24                  |
| MMC-16      | multi (VSFF)| 16              | 16                  |
| MMC-24      | multi (VSFF)| 24              | 24                  |
Each entry also has: `positionsUsed: number[]` default pattern, `gender` options (pinned/unpinned for
MPO/MMC), and a display color for the boot.

## Data model
```ts
interface CableDef {
  id: string;
  name: string;                     // auto-generated, editable, e.g. "8F OM4 MPO-8 → 4×LC-duplex"
  fiberCount: number;               // REQUIRED. 2, 8, 12, 16, 24, 32, 48, 72, 96, 144, or custom
  fiberType: 'OS2' | 'OM3' | 'OM4' | 'OM5';
  sideA: CableSide;
  sideB: CableSide;
  kind: 'straight' | 'trunk';       // DERIVED: trunk when sideA.legs.length !== sideB.legs.length
  polarity: 'A' | 'B' | 'C';        // default B for multi-fiber, A-to-B for duplex
  strandMap: StrandLink[];          // DERIVED from sides + polarity (see below); user can override
  breakoutLengthM: number;          // trunk only, default 0.5
  diameterMm: number;               // derived from fiberCount (lookup table), editable
}

interface CableSide {
  connector: string;                // connector catalog id
  legs: Leg[];                      // DERIVED from fiberCount / fibers per connector
}

interface Leg { index: number; label: string; positions: number[]; color?: string }
// label defaults: "1", "2", ... for small legs; "A", "B" ... for multi-fiber legs

interface StrandLink { a: { leg: number; pos: number }; b: { leg: number; pos: number } }

interface Cable {                   // installed instance
  id: string; label: string; cableDefId: string;
  plugs: { side: 'A' | 'B'; leg: number; componentId: string | null; portId: string | null }[];
  lengthM?: number;
}
```

## Deriving legs (pure function: deriveSides(fiberCount, connA, connB))
1. fibersPerLeg = connector's typical fibers used (LC-duplex = 2, MPO-8 = 8, MPO-12 = 12, ...).
2. legs = fiberCount / fibersPerLeg. If not a whole number → validation error, block save,
   with a message like "16 fibers can't be split evenly into MPO-12 legs (12 each). Use MPO-16 or MPO-8."
3. Exception: MPO-8 is an MPO-12 body using positions 1-4 and 9-12. Model that via `positionsUsed`.
4. kind = sideA.legs.length === sideB.legs.length ? 'straight' : 'trunk'.
5. channels = fiberCount / 2 (show in UI; not stored).

Required results (put these in unit tests):
| fiberCount | Side A    | Side B     | A legs | B legs | kind     | channels |
|------------|-----------|------------|--------|--------|----------|----------|
| 8          | MPO-8     | LC-duplex  | 1      | 4      | trunk    | 4        |
| 12         | MPO-12    | LC-duplex  | 1      | 6      | trunk    | 6        |
| 24         | MPO-24    | LC-duplex  | 1      | 12     | trunk    | 12       |
| 16         | MMC-16    | MPO-8      | 1      | 2      | trunk    | 8        |
| 24         | MPO-24    | MPO-12     | 1      | 2      | trunk    | 12       |
| 8          | MPO-8     | MPO-8      | 1      | 1      | straight | 4        |
| 144        | MPO-12    | MPO-12     | 12     | 12     | straight | 72       |
| 2          | LC-duplex | LC-duplex  | 1      | 1      | straight | 1        |
| 16         | MPO-12    | LC-duplex  | error (16 not divisible by 12) |

## Deriving the strand map (pure function: deriveStrandMap(def))
- Number fibers 1..fiberCount along the cable.
- Walk each side's legs in order, filling each leg's `positionsUsed` in order, so fiber n lands on
  (leg, position) on side A and on side B.
- For multi-fiber → duplex, pair fibers per channel as outer-in within each multi-fiber leg:
  channel k of an 8F MPO = positions (k, 13-k) → (1,12), (2,11), (3,10), (4,9), landing on LC leg k,
  positions 1 and 2.
- Apply polarity: A = straight, B = reversed within each multi-fiber leg (pos p ↔ N+1-p),
  C = pair-flipped. For duplex legs, A-to-B swaps positions 1 and 2.
- The strand map must be a bijection over used fibers; assert this in tests.

## Cable Builder UI (dialog, opened from the library "New cable" button)
1. Fiber count: dropdown (2, 8, 12, 16, 24, 32, 48, 72, 96, 144) + custom number input.
2. Fiber type: OS2 / OM3 / OM4 / OM5 (sets default jacket color: OS2 yellow, OM3/OM4 aqua, OM5 lime).
3. Side A connector, Side B connector: dropdowns from the connector catalog.
4. Live preview (SVG) that updates as fields change: side A legs on the left, jacket in the
   middle, side B legs on the right, with a furcation glyph on any side that has more than one leg.
   Label each leg and show its fiber positions on hover.
5. Summary line: "8F OM4 · Trunk (breakout) · MPO-8 → 4×LC-duplex · 4 channels".
6. Advanced (collapsed): polarity, breakout length, diameter, leg labels/colors, and a strand map
   table the user can edit (edits mark the map as "custom" and it stops auto-deriving).
7. Save adds the definition to the project's custom catalog. Seed the built-in catalog with the
   test table rows above.

## Connecting a cable
- User picks a cable definition, then clicks the port for side A (or each side-A leg in turn, if
  side A has several legs).
- Then assigns side B legs: click ports one at a time, OR "auto-fill" = pick the first port and the
  legs fill consecutive compatible ports (e.g. LC legs 1-4 → panel ports F1-F4).
- A leg only plugs into a port whose connector type matches. Incompatible ports dim while assigning.
- Unassigned legs are allowed (warning, not error) so users can sketch.

## Rendering
Schematic:
- The cable draws as one thick wire from side A, with a fan glyph at the furcation, splitting into
  N thin wires to side B's ports. Wire badge: "8F · 4ch".
- Clicking any leg selects the whole cable; hovering a leg highlights its fibers' path.
Layout (2D):
- Ratsnest: one airwire from side A's port to the furcation point, then one short airwire per
  leg to its port. Place the furcation point by default at breakoutLengthM from the side B ports.
- When routed, the jacket follows waypoints like any cable (pinning rules unchanged); legs run
  from the furcation to their ports and are auto-dressed.
- The furcation point is a draggable, pinnable node.
3D:
- Jacket = tube with diameter from `diameterMm`, color by fiber type.
- Furcation = short cylinder "boot" where the tube splits; legs = thin tubes to each port with a
  small connector shape at each end (MPO rectangular, LC small square pair).

## Validation (add to ERC/DRC)
- Error: fiberCount can't be split evenly into a side's connector.
- Error: a leg is plugged into a port with a different connector type.
- Error: strand map isn't a bijection (custom maps only).
- Warning: a leg is unassigned.
- Warning: routed jacket length + breakout length is shorter than the straight-line distance to a leg's port.
- Info: unused fibers (e.g. user chose 12F but only 8 positions are wired end-to-end).

## Exports
- Cable schedule: one row per cable plus one sub-row per leg (leg label, port, fibers carried).
- BOM: group by full definition (fiber count, type, side A, side B, length), e.g.
  "8F OM4 MPO-8→4×LC 5 m × 24".
- Labels: one per leg end plus one per jacket end.

## Constraints
- All derivation logic lives in /src/model/cables as pure functions with no React/Konva/Three imports.
- Existing cables in saved projects must keep working: migrate old cable types to CableDef with
  derived sides (bump project version, add a migrator).
- Don't store derived values (kind, legs, channels) as source of truth; recompute from fiberCount
  + connectors, except a user-customized strand map.

## Acceptance criteria
- [ ] Every row of the derivation test table passes, including the error case.
- [ ] In the Cable Builder, choosing 8F, MPO-8 → LC-duplex shows 1 MPO leg, 4 LC legs, "Trunk (breakout)", 4 channels.
- [ ] Changing side B to MPO-8 immediately switches the preview to a straight cable with no furcation.
- [ ] Connecting that trunk from a switch port to a patch panel with auto-fill lands legs 1-4 on F1-F4.
- [ ] Schematic, layout, and 3D all show the fan-out at the furcation point.
- [ ] Moving the patch panel keeps the pinned jacket route and re-dresses only the legs.
- [ ] Trying to plug an LC leg into an MPO port is refused with a clear message.
- [ ] Undo/redo covers creating a definition, connecting, and reassigning legs.

Work in small commits: (1) connector catalog + deriveSides + tests, (2) deriveStrandMap + tests,
(3) Cable Builder dialog, (4) connecting flow, (5) rendering in schematic/layout/3D, (6) validation,
(7) exports + migration.

## Implementation notes (added by the implementing agent, 2026-09-25)

- A `Cable` instance **owns links**: plugging both ends of a channel's fibers creates a plan `Link` with `link.cableId` (lane = channel index − 1 on multi-lane ports, no lane on duplex ports). ERC/DRC/F8/exports keep working on links; renderers group links by `cableId` to draw the jacket + fan-out. Routing a trunk routes the cable (jacket) — `Route.owner: 'cable'`; legs are auto-dressed from the furcation point.
- Legacy fields on `CableDef` (`endA/endB/media/mediaClass/color/diameterMm/breakout`) stay populated in the old vocabulary and are regenerated from the fiber fields (`legacyFieldsFor`), so the existing ERC connector/media rules and BOM keep their behaviour.
