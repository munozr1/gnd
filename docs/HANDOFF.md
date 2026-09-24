# Datacenter EDA — Handoff

_Last updated 2026-09-24. Companion to the master spec (`Datacenter Topology Builder — Design Spec.md`) and `CLAUDE.md`. The spec says **what** to build; this document says **where things are, what has been decided, what is left, and how to extend it**._

---

## 0. TL;DR

- **Green:** `npm run check` passes (tsc strict, 63 Vitest files / 665 tests, production build); all 12 browser tests pass. The app boots, autosaves to IndexedDB, restores on reload, and `File ▸ New from template ▸ Demo pod` loads a 2-spine × 8-leaf pod with 42 devices, 80 links, 6 racks and 20 routed cables. ERC on it: 8 info, 0 errors. DRC: 60 "unrouted" warnings, 0 errors. Cutsheet CSV import is delivered in §11.
- **Complete:** data model, catalog, pure logic for every spec table (schematic tools, F8 sync + back-annotation, 9 ERC rules, 15 DRC rules, routing/pathway math, cable lengths), Zustand command store with per-editor undo/redo, persistence + migrations, app shell, panel registry, the entire command (verb) layer, demo/perf project generators, layout-side panels (F8 dialog, place-by-rule, inspectors, proposals, library), the schematic Library panel + custom device form, and all exports.
- **Now usable:** schematic canvas/inspector/sheets, physical floor plan, rack elevations, Unplaced bin, and 3D viewer. Nine Playwright tests cover schematic editing plus Pod A rack/device movement, collision rejection, undo, 3D rendering, visibility, PNG capture and rack cross-probing. See §9–10 for delivered scope and remaining refinements.
- **Not built yet:** model-assignment table, fabric connector dialog, breakout dialog, and link-list panel. Advanced physical-editor requirements and Large site performance remain; the physical views are no longer placeholders.
- The remaining work is organised into **work packages WP-A … WP-H** (§5), each with directory ownership so several agents can work concurrently.

Start with §1 (read list), §2 (architecture), then pick a package from §5.

---

## 1. Read these first

| File | Why |
| --- | --- |
| The master spec | Source of truth for behaviour, keys, rules, acceptance criteria. |
| `CLAUDE.md` | Conventions, commands, directory rules (auto-loaded by Claude Code). |
| `src/model/types.ts` | The data model. §3 lists where it refines the spec. |
| `src/model/query.ts` | `ProjectIndex` / `indexProject` — how everything looks things up. |
| `src/store/README.md`, `src/store/index.ts` | Commands, undo/redo, the `ui` slice (selection, tools, viewport requests, dialogs). |
| `src/commands/index.ts` | Every undoable verb the editors should call. |
| `src/panels/registry.ts`, `src/panels/shell/Docks.tsx` | How panels/dialogs/toolbars plug into the shell. |
| `docs/phase1-api.md` | Exported names + signatures of every model/store/shell module (generated during the build; still accurate). |
| `src/model/demo/pod.ts` | The canonical fixture; shows the intended end-to-end flow in code (fabric → annotate → F8 → place → trays → routes). |

---

## 2. Architecture

### 2.1 Layers and data flow

```
catalog JSON ──▶ model/types + query ──▶ pure logic (schematic, sync, erc, drc, routing, demo)
                                              │
                    commands/* (undoable verbs) ◀──── editors/* & panels/* call these
                                              │
                          store (project + history + ui) ──▶ io/persistence (autosave, JSON)
                                              │                io/exports (CSV/SVG/HTML/PNG)
                          panels/registry ──▶ shell (App.tsx, Docks, MenuBar, StatusBar, IssuesDrawer)
```

- **Logical vs physical.** `Project.components/links/sheets` are owned by the schematic; `placements/racks/trays/accessories/routes/keepouts` by the layout. Both key on `Component.id` / `Link.id`. `Project.syncState` is the layout's copy of the netlist as of the last F8 apply; `computeSyncPlan(project)` diffs live vs `syncState`; `isOutOfSync` drives the Layout tab badge and the `out-of-sync` DRC error.
- **Commands.** `execute({ label, editor, mutate(draft), coalesceKey? })` runs the mutator through Immer `produceWithPatches`; undo/redo replay inverse patches. History is per editor (`schematic`, `layout`); `viewer3d` is read-only. Same-key commands within 500 ms coalesce (drags); an intervening undo/redo seals the chain. `execute` returns `false` and sets `ui.lastError` when the mutator throws.
- **Selection / cross-probing.** `ui.selection: SelectionItem[]` is global. `store.getState().revealSelection(items, editor?)` selects, switches tab, and sets `ui.<editor>.viewportRequest = { kind: 'items', items }`; the editor zooms and clears it via `requestViewport(editor, null)`. The issues drawer already uses this.
- **Checks.** `useLiveChecks()` in the shell re-runs `runErc` / `runDrc` 600 ms after any project change and writes `ui.issues`. Rules are pure `{ id, name, defaultSeverity, check(project, idx) }` objects; severities are overridable per project in `project.settings.ercSeverities/drcSeverities` (`'ignore'` drops).
- **Persistence.** `startAutosave(store)` writes `project:<id>` to IndexedDB (idb-keyval) 1 s after changes and maintains a `projects` index. JSON files carry `version`; `parseProject` runs `migrations.ts` and fills defaults for missing optional arrays.
- **Exports.** `src/io/exports/index.ts` holds `exportRegistry` (11 entries, grouped Lists / Sheets / 3D). The File ▸ Export menu is generated from it. "PDF" exports open a print-ready HTML page in a new tab (browser print-to-PDF); the 3D PNG calls `window.__dcCapture3D()` registered by the mounted 3D viewer.

### 2.2 Directory ownership map (for parallel work)

| Directory | Owner package | State |
| --- | --- | --- |
| `src/model/**` (all subdirs) | — | done, tested; extend only via §4 recipes |
| `src/store/**`, `src/io/persistence/**` | — | done |
| `src/commands/**` | — | done; add factories when you add verbs |
| `src/io/exports/**` | — | done; 3D PNG connected to viewer |
| `src/ui/**`, `src/panels/shell/**`, `src/App.tsx` | shell | done; small additive edits only |
| `src/panels/library/**` | — | done (schematic Library panel, `library` + `custom-device` dialogs) |
| `src/panels/layout/**` | — | panels plus searchable/draggable Unplaced bin |
| `src/panels/schematic/**` | **WP-B** | Inspector + Sheets panel registered; bulk dialogs and Links panel remain |
| `src/editors/schematic/**` | **WP-A** | working core canvas; `scene.ts` indexed geometry + `drawing.ts`; refinements in §9 |
| `src/editors/layout/**` (except `elevation/`) | **WP-C** | floor canvas, pan/zoom, rack moves, basic tray/room/keepout/route drawing; advanced route editing remains (§10) |
| `src/editors/layout/elevation/**` + `src/panels/layout/UnplacedBin.tsx` | **WP-D** | rack elevation, device moves/drop, fit validation, face controls and cross-probing; bundle refinement remains (§10) |
| `src/editors/viewer3d/**` | **WP-E** | instanced physical scene, cable tubes, orbit/presets, selection, PNG; detailed models/performance remain (§10) |
| `e2e/**` | **WP-F** | six schematic + three Pod A physical-view browser tests |

### 2.3 Key store `ui` fields (already defined — do not redefine)

```ts
ui.activeTab: 'schematic' | 'layout' | 'viewer3d'; ui.activeSheetId; ui.selection; ui.hovered
ui.schematic: { placing: string | null; tool: 'select'|'wire'|'label'|'breakout'|'move'; viewportRequest; assignFocus: Id | null }
ui.layout:    { view: 'floor'|'elevation'|'split'; activeLayer; visibleLayers; ratsnest: 'all'|'selection'|'none';
                elevationRackIds; elevationFace; elevationFollowsSelection; tool: 'select'|'route'|'room'|'keepout'|'tray'|'rack'|'measure';
                placing: {kind:'rack',defId}|{kind:'tray',defId,elevationMm}|{kind:'keepout'}|null; routingLinkId; viewportRequest; snapMm }
ui.viewer3d:  { showDoors, showOverhead, showUnderfloor, showCables, showAirwires, showRaisedFloor, walkMode, frameRequest }
ui.issues: { erc: Issue[]; drc: Issue[] }; ui.issuesDrawerOpen; ui.activeDialog; ui.dialogData; ui.lastError
setters: patchSchematic / patchLayout / patchViewer3d / requestViewport / revealSelection / select / setHovered / openDialog / closeDialog …
hooks: useProject, useProjectIndex, useSelection, useIsSelected, useSchematicUi, useLayoutUi, useViewer3dUi, useActiveSheetId …
```

Registered dialog ids so far: `library`, `custom-device`, `update-layout` (F8), `place-by-rule`, `project-picker`, `shortcuts`. The library panel sets `ui.schematic.placing` (via `startPlacing(symbolId)`) and expects the schematic canvas to show a ghost and place on click. The layout Library panel sets `ui.layout.placing` for racks/trays and `ui.layout.tool` for keep-outs/room; the floor view consumes them.

---

## 3. Decision log (where the code refines or departs from the spec)

**Data model**
1. `Route` unifies the spec's two definitions: `{ linkId, aRack: InRackPath, bRack: InRackPath, segments: RouteSegment[], needsReview? }` with `RouteSegment = { layer, trayId?, points: Waypoint[] }`. A layer change between consecutive non-empty segments is a drop (`dropsOf(route)`).
2. `Tray` is the extended spec form (`kind`, `elevationMm`, `fittings[]`). `Project` gained `accessories`, `keepouts`, `syncState`, `backAnnotations`, `settings`, `rev`, and `customCatalog` also holds transceivers/cables.
3. `SymbolDef.pins` carry `type` and `speedsGbps` (and `group`) so ERC works before a footprint is assigned; `refPrefix` lives on the symbol; `expectedUplinks` drives the single-homed rule.
4. Cables have `mediaClass: 'fiber'|'copper'` and `diameterMm` (tray/manager fill), and DAC/AOC carry `integrated: { formFactor, speedGbps, reachM }` — `ProjectIndex.transceiverAt()` returns a virtual optic for them.
5. `Issue.targets` are typed (`component`+`portId`, `link`, `rack`, `route`, `tray`, `sheet`) so the drawer can reveal them; ids are stable hashes of sorted target keys (independent of link a/b orientation).

**Catalog** (generated by `scripts/gen-catalog.ts`)
6. Port ids: leaf `eth1/1..48` (SFP28) + `eth1/49..56` (QSFP28) + `mgmt0`; spine `eth1/1..32` (QSFP-DD); mgmt switch `ge1..48` + `xe1..4`; servers `eth0,eth1[,eth2,eth3]` + `bmc0`; GPU `osfp0..7` + `eth0,eth1`; patch panels `f1..24` (front) / `r1..24` (rear). Ids are `sym.<slug>`, `fp.<slug>`, `xcvr.<name>`, `cbl.<name>`, `rack.<name>`, `tray.<name>`, `acc.<name>`.
7. Known catalog gap: 400G-SR8 uses MPO-16 but no MPO-16 trunk cable exists, so cabling it always trips `connector-mismatch`. Add `cbl.om4-mpo16-trunk` in the generator when needed.

**Schematic logic**
8. Collapse mode: a side with > 12 pins shows used pins plus the first unused ones up to 12, re-packed at `PIN_PITCH = 10`; hidden pins attach wires to the side's `+N unused` stub (`collapsedStubs()` / `symbolLayout()`).
9. `duplicateSheet` clones the subtree, components (fresh refs via `annotate({scope:'unannotated'})`) and internal links; links crossing out of the subtree are **dropped and reported** (`droppedCrossSheetLinks`) rather than cloned onto occupied spine ports.
10. `annotate` numbers per `refPrefix` across the whole project; `scope:'all'` renumbers in sheet-then-y-then-x order; `sheetId` scopes to the subtree.
11. `moveComponents` translates elbows when both link ends moved and clears them (auto re-route) otherwise; rotate/mirror clear attached elbows.

**Sync (F8)**
12. `applySyncPlan(draft, checkedChanges)` applies exactly the checked subset, is idempotent, skips stale changes (target exists again), re-checks footprint fit at apply time, and — by design — a `remove-component` also drops `syncState.links` for links on that component so an unchecked `remove-link` doesn't resurrect. Unchecked removals keep their rack slot.
13. Link a/b swapped is reported as `link-endpoint-changed` (ends compared positionally).
14. Back-annotation proposals persist in `project.backAnnotations`; `acceptBackAnnotation` updates schematic **and** `syncState`; port swap moves the optic with the cable when the target port is empty.

**ERC / DRC**
15. `single-homed-server` flags < 2 uplinks (not `< expectedUplinks`) — change in `rules/single-homed-server.ts` if you want the stricter reading. `unconnected-uplinks` covers switch/router/firewall.
16. `bend-radius` heuristic: a corner violates when the shorter adjacent segment is shorter than the cable's `bendRadiusMm`. `clearance`: any rack corner outside the room polygon, or a rack overlapping a keep-out. `tray-clearance`: tray `elevationMm` < rack top (heightU × 44.45 + 100) + 150 mm for racks its centreline crosses.
17. `missing-waterfall` fires only when a route's overhead segment actually rides a tray over that rack with no `waterfall` fitting for it.

**Routing / lengths**
18. Floor coordinates in mm; rack `pos` is the footprint's top-left at rotation 0; front face points +y. `portFloorPos` puts the port on the rack edge of its face, offset across the width by the faceplate x. Elevation = U × 44.45 + port y.
19. Same-rack routes are a single `in-rack` segment with one waypoint at the manager column. `unplaceComponent` keeps routes (they become unresolvable until re-placed); `deleteRacks` keeps routes but drops anchors/entry refs.
20. Length = 3D path (in-rack A + rise + tray + drop + in-rack B) × (1 + `slackFraction`) + 2 × `slackPerEndM`, ceil to `[1,2,3,5,7,10,15,20,30]` (above 30 m: 5 m steps). Unrouted = Manhattan + vertical estimate, `est: true`.
21. Waypoint rules per spec: pinned never move; unpinned neighbours of a moved endpoint re-square; anchored waypoints translate with their rack (pinned or not); `dragSegment` refuses when an endpoint is pinned. `dropsOf` ignores empty segments and agrees with `routePath3d`.

**Commands / placement**
22. `addRackArray.spacingMm` is the **gap** between footprints (0 = butted). `placeByRule` packs unplaced matches in natural ref order (`includePlaced` opt-in). `placeComponent` throws on U collision (surface as toast). `moveDevice` re-dresses routes on its links via `onEndpointMoved`. `acceptBackAnnotation/rejectBackAnnotation` target the **schematic** history.

**Store / shell**
23. Inactive editor tabs unmount (Radix Tabs); editors keep viewport in component state but must re-fit on mount, or keep it in `ui.<editor>` if persistence across tabs matters.
24. Menus are independent Radix DropdownMenus (no hover-to-switch). Deleting the open project is disabled in the picker.
25. `tsconfig.node.json` is a composite project (it must list `src/model/types.ts` for `scripts/gen-catalog.ts`); it emits declarations into `.tsbuild/` (gitignored) — never into `src/`.
26. Vitest prints a deprecation warning for `environmentMatchGlobs`; migrating to `test.projects` is a small cleanup.

---

## 4. Recipes — how to extend each layer

- **Add a catalog device/optic/cable/tray/accessory:** edit `scripts/gen-catalog.ts` (`buildDevice({...})` for paired symbol + footprint), `npm run gen:catalog`, run tests. Custom per-project devices go through `commands.addCustomSymbolAndFootprint` (form in `src/panels/library/CustomDeviceDialog.tsx`).
- **Add an ERC/DRC rule:** create `src/model/{erc,drc}/rules/<id>.ts` exporting a `Rule` (ERC: `ercIssue`, `componentTarget`, `linkTarget` from `erc/rule.ts`; DRC: `defineRule` from `drc/rule.ts` — copy a neighbouring rule file), add it to the `ercRules`/`drcRules` array in `index.ts`, write `<id>.test.ts` with positive and negative fixtures (`src/model/erc/fixtures.ts` has `addComponent/connect/check/buildSpineLeafMesh`). Severity overrides work automatically.
- **Add a verb:** write the pure mutator in `src/model/<area>/mutations.ts` (takes `draft`), add a factory in `src/commands/<area>.ts` returning `command(label, editor, mutate, coalesceKey?)` (or `resultCommand` when the caller needs an id back), test it in `src/commands/*.test.ts`.
- **Add a panel / dialog / toolbar:** create the component, `registerPanel({ id, editor, side, title, component, order })` / `registerDialog({ id, component })` / `registerToolbar({ id, editor, component })` at module load in your `index.ts`, and import that module once from `App.tsx` (see the two existing `import '@/panels/...'` lines). Dialogs read `ui.dialogData` and call `closeDialog()`; open them with `openDialog(id, data)`.
- **Add a keyboard shortcut:** `registerShortcut({ id, keys, editor, handler })` in a `useEffect` (returns the unregister fn). Shell-global keys live in `src/panels/shell/shellShortcuts.ts` (`SHELL_KEYS`). Help ▸ Shortcuts lists everything registered.
- **Add an export:** push an `ExportEntry { id, name, group, description, run(project, ctx) }` to `exportRegistry` in `src/io/exports/index.ts`; return `{ filename, blob, mode?: 'download'|'print' }`. The menu and `runExport` pick it up. Test the generator on `buildPodProject()`.
- **Add a demo template:** add to `demoTemplates` in `src/model/demo/index.ts`; it appears under File ▸ New from template.
- **Add a migration:** bump nothing until the JSON shape changes; then add a step in `src/io/persistence/migrations.ts` and update `Project.version`.
- **Add a `ui` field:** additively in `src/store/index.ts` (`initialUi()` + the interface + a setter), never in feature modules.

---

## 5. Remaining work packages

Each package lists what it owns, what exists to build on, deliverables, and how to prove it. Packages A–E are independent of each other (they meet only through the store, the command layer and the registry) and can run concurrently; F depends on A–E; G/H are polish. The keyboard table and behaviours come from the spec — re-read the named sections before starting.

### WP-A — Schematic editor canvas (Konva)
**Owns** `src/editors/schematic/**` (replace the placeholder body of `index.tsx`; keep `export function SchematicEditor`). **Spec:** Schematic editor (all), ERC "zoom to item", acceptance 1–2, 7, 9.
**Build on:** `viewport.ts` (pan/zoom math, `fitRect`, `wheelZoomFactor`), `spatial.ts` (rbush wrapper), `@/model/schematic` (`componentLayout`/`pinPositions`/`collapsedStubs`/`symbolBounds`, `fullWirePolyline`/`sheetWires`/`dragWireSegment`/`hitTestWire`/`wireMidpoint`, `crossSheetLinks`, `sheetPath`), `@/commands` (`addComponent, moveComponents, rotateComponents, mirrorComponents, deleteSelection, addLink, setLinkWirePoints, setLinkLabel, setLinkCable, toggleExpandedPins, moveSheetSymbol, …`), `@/model/schematic` `defaultCableFor`.
**Deliverables**
1. Stage filling its container (ResizeObserver), dotted 10-unit grid (major every 100), wheel zoom about cursor, middle/space-drag or right-drag pan; `zoomToFit` on mount/project load; honour `ui.schematic.viewportRequest` (`fit` / `rect` / `items` → union of item bounds) and clear it.
2. Render the active sheet: symbols (body rect; ref bold top-left; value/role + model inside; pins as 20-unit stubs with end dot and `eth1/49 QSFP28` label; group banks with a gap + group name; `+N unused` stub per side that expands on click; used pins in accent; optic name beside pins that have one), child sheets as sheet symbols (name, hierarchical pin list from `crossSheetLinks`, double-click enters, breadcrumb overlay `Root / Pod A` with click-to-navigate), links as orthogonal wires in cable colour with mid-wire label, breakout lanes fanning from the parent pin, cross-sheet links drawn to an off-sheet label `SW1:eth1/49 ▸ Spine`.
3. Selection: click / shift-click / rubber-band → `store.select`; selected glow; hover highlight; drag moves components with grid snap (one undo step via `coalesceKey`); wires follow.
4. Tools (register with `registerShortcut`, editor `'schematic'`): **A** → `openDialog('library')`; placing ghost when `ui.schematic.placing` is set, click places (`addComponent` → auto-annotated), Esc cancels; **W** wire tool (click pin → rubber orthogonal wire → click pin → `addLink` with `defaultCableFor` the ends' optics; invalid target red) plus click-drag from a pin; **L** label (inline input → `setLinkLabel`); **R / X** rotate / mirror; **M / G** pick-up-and-drop move; **Delete/Backspace**; **mod+a**; **Esc**; **mod+shift+f** → `openDialog('fabric')`. (mod+e, F8, alt+1/2/3 are shell-global — don't double-bind.)
5. Wire segment drag (`dragWireSegment` → `setLinkWirePoints`, coalesced). Context menus (component: Rotate / Mirror / Assign model… (`patchSchematic({assignFocus})` + `openDialog('assign-models')`) / Expand-collapse pins / Delete; wire: Label… / Change cable ▸ / Delete; sheet symbol: Enter / Rename / Duplicate / Delete).
6. Cross-probe: when the selection comes from elsewhere and lives on another sheet, switch `activeSheetId` and zoom. Status bar (`useStatusBar`) shows cursor coords + tool.
7. Performance: symbols on a cached layer invalidated on project change; wires on their own layer; rbush over wire segments for hit-testing. Must stay smooth on `Large site`.
**Prove it:** unit tests for pure helpers you add; `e2e/schematic.spec.ts` — load Demo pod via `window.__dcStore` or the menu, press **A**, place a symbol, draw a wire between two pins, assert a link exists and undo removes it.

### WP-B — Schematic panels & dialogs
**Owns** `src/panels/schematic/**` (create `index.ts` that registers everything; add `import '@/panels/schematic'` to `App.tsx`). **Spec:** Schematic editor → Symbols / fabric connector / Breakouts / Hierarchical sheets / Annotation and assignment.
**Build on:** existing helpers `filters.ts` (globs, search, `portsMissingOptic`, `sortLinks`), `fabricForm.ts` (`fabricCandidates`, `initialFabricSelection`, `defaultLeafPortIds/SpinePortIds`, `fabricOptics`, `fabricDefaultCable`), `portRange.ts` (`parsePortRange('eth1/49-eth1/56')`), `virtual.ts` (`useVirtualRows` for 5,000-row lists), `common.tsx` (`execute`, `CommitInput`, `Field`, `Section`, `NONE` sentinel for Radix Select); `@/model/schematic` (`planFabric`, `planBreakout`, `compatibleFootprints`, `compatibleOptics`, `bulkAssign`, `duplicateSheet`, `sheetPath`); `@/model/routing` `linkLengthM`; `@/commands`.
**Deliverables** (register ids in parentheses)
1. **Inspector** (right dock): component → ref (unique-validated), value/role, symbol, physical model Select (`compatibleFootprints`), per-port optic table (used ports by default, "all ports" toggle), rotate/mirror, sheet; link → label, cable Select, endpoints (click selects the component), lane; sheet → name; multi-select → count + bulk actions.
2. **Model assignment table** (`assign-models` dialog): all components with footprint Select + used-port optic chips; filter row (ref glob, kind, unassigned); bulk bar `refs [SRV*] → model [..], optic [..] on ports [eth0,eth1]` → `bulkAssign`; preselect `ui.schematic.assignFocus`.
3. **Fabric connector** (`fabric` dialog): leaf/spine multi-selects prefilled from selection, editable port ranges, optic + cable selects, label prefix, live `planFabric` preview (`16 links, 0 skipped`), Apply → `applyFabric`. Target: 2 × 8 mesh in well under 2 minutes.
4. **Breakout** (`breakout` dialog): QSFP-class source + up to `fanout` free SFP-class targets + cable → `planBreakout` → `applyBreakout`.
5. **Sheets panel** (left dock, below Library): tree, click sets `activeSheetId`, New child / Rename / Duplicate (toast with dropped cross-sheet count) / Delete.
6. **Links panel** (right dock "Links", the netlist view): virtualised table (label, A, B, cable, optics, length with `est.`), search, click → `revealSelection`.
7. **Schematic toolbar** (`registerToolbar`, editor `schematic`): Annotate (unannotated / all), Run ERC, Update Layout (F8), Fabric…, Breakout…, Assign models….
**Prove it:** jsdom tests for the assignment bulk bar and fabric dialog (`mount` from `@/ui/testing`); `e2e/fabric.spec.ts` — new project, add 2 spines + 8 leafs through the store, mod+shift+f, apply, assert 16 links and ERC has no errors.

### WP-C — Layout editor shell + floor plan + routing tool (Konva)
**Owns** `src/editors/layout/**` except `elevation/` (replace placeholder `index.tsx`; keep `export function LayoutEditor`; mount `<ElevationView/>` from `./elevation` for the Elevation/Split views — WP-D provides it; until then render a placeholder). **Spec:** Layout editor (all), Cable pathways → tray routing rules / waterfalls, acceptance 3–6.
**Build on:** `viewport.ts` (mm ↔ px, `PORT_DETAIL_SCALE`), `spatial.ts` (`SegmentIndex` over airwires/routes/trays), `batching.ts` (`batchStrokes` → one canvas path per stroke style), `constraints.ts` (`constrainPoint` ortho/45°/free, `nearestEntryPoint`, `nearestTray`, `trayAlongPolyline`, `hasWaterfallFor`, `nextLayer`); `@/model/routing` (`portFloorPos`, `rackCenter`, `rackFrontDir`, `rackEntryPoints`, `snapWaypoint`, `newRouteFromPoints`, `dropsOf`, `cableOffsetInTray`, `trayFill`, `anchorWaypointsInRacks`); `@/commands` layout verbs (`addRack, addRackArray, moveRacks, rotateRack, deleteRacks, setRoomOutline, addKeepout…, addTray, editTrayPoints, addTrayFitting, setRoute/finishRoute, unroute, insertWaypoint, deleteWaypoint, moveWaypoint, dragSegment, setPinned, pinAll, unpinAll, straighten, setServiceLoop`); `ui.layout.placing/tool/routingLinkId/snapMm` set by the existing layout Library panel.
**Deliverables**
1. `LayoutEditor`: top strip (Floor | Elevation | Split via `ui.layout.view`; layer buttons with active + visibility; ratsnest mode; snap size; Route (X); the registered `LayoutToolbar` already supplies F8 / Place by rule / Run DRC), content = FloorView / ElevationView / SplitPane; status bar `Unrouted: N / M` (helper `countUnrouted` exists in `@/panels/shell`), cursor mm, active layer.
2. FloorView: room outline (editable vertices when `ui.layout.tool==='room'`), grid tiles, keep-outs (hatched; draw tool click-click-Enter), racks (rect + name + front arrow; drag with snap → `moveRacks` coalesced — anchored waypoints follow; R rotates; rubber-band select; ghost placement from `ui.layout.placing`), rack array popover → `addRackArray`, trays (thick translucent polylines styled by kind, fittings glyphs, waterfall ▽ over its rack; draw tool from `placing.kind==='tray'`), inactive layers dimmed.
3. Ratsnest: airwires for unrouted links with both ends placed, rack-centre to rack-centre (port positions past `PORT_DETAIL_SCALE`), cable colour at 60 %, modes all/selection/none, live during rack drags (compute from drag preview positions).
4. Routes: per-segment layer colours, side-by-side offsets in trays, drop glyphs, tray fill tooltip, waypoints (pinned ■ / unpinned ○), drag waypoint (`moveWaypoint` keepOrthogonal), segment-midpoint handle inserts, segment drag (`dragSegment`; blocked when an end is pinned), double-click deletes, **P** toggles pinned, route context menu (Pin all / Unpin all / Unroute / Straighten / Change cable ▸ / Service loop…), waypoint menu (Pin / Delete / Anchor to rack).
5. Routing tool: double-click an airwire or select a link + **X** → starts at port A on `activeLayer`; rubber path follows cursor (ortho; Shift 45°; `/` free); click drops waypoint (`snapWaypoint` grid / tray centreline / existing cable, 150 mm); **V** next layer + drop (snap to nearest rack entry within 600 mm; if the tray has no waterfall over that rack, toast with an "Add waterfall" action → `addTrayFitting`); Enter or click destination finishes → `finishRoute`/`setRoute` with `newRouteFromPoints(pinByDefault)`; Esc cancels; tag `segment.trayId` when a segment lies along a tray.
6. Cross-probe both ways; honour `ui.layout.viewportRequest`.
7. Performance: static layer cached; airwires + routes drawn by a single custom `sceneFunc` using `batchStrokes`; `SegmentIndex` for hits; 60 fps on `Large site`.
**Prove it:** unit tests for anything pure you add; `e2e/layout-routing.spec.ts` — Demo pod, Layout tab, status shows `Unrouted: 60 / 80`, select an unrouted link, X, three clicks, Enter → 59, undo → 60.

### WP-D — Rack elevation view + device placement
**Owns** `src/editors/layout/elevation/**` (create `index.tsx` exporting `ElevationView`, no required props) and `src/panels/layout/UnplacedBin.tsx` (register it: editor `layout`, side `left`, order 10, from `src/panels/layout/index.ts`). **Spec:** Layout editor → Views / Placement / Ratsnest (elevation), Cable pathways → auto-dressing (visualised), acceptance 3, 5.
**Build on:** `elevation/geometry.ts` (columns, U ↔ y, `deviceRect`, `portPoint`, `ghostFit`/`ghostColor`, `firstFreeSlot`, `dropSlot`), `elevation/bundles.ts` (`groupBundles`, `velcroTicks`, `fanPoint`), `elevation/segmentIndex.ts`, `elevation/viewport.ts`, `elevation/constants.ts` (`COMPONENT_MIME` for HTML5 drag data, colours); `@/commands` (`placeComponent`, `unplaceComponent`, `moveDevice`, `setPlacementFace`, `checkUFit`, `isURangeFree`); `ui.layout.elevationRackIds/elevationFace/elevationFollowsSelection`.
**Deliverables**
1. Racks side by side (from `elevationRackIds`, else selection, else first 4), face toggle + rack chips + "Follow selection"; U rails numbered from 1 at the bottom; devices as faceplates (ref + model, ports colour-coded by cage type, used ports in cable colour, optic on hover); accessories (VCM channels with finger ticks, HCMs, fiber enclosures, top-entry brush).
2. Placement: HTML5 drag from UnplacedBin (`dataTransfer` type `COMPONENT_MIME`) or drag placed devices between U/racks; green/red ghost; drop → `placeComponent`/`moveDevice` (toast on collision); Delete unplaces; context menu flips face; double-click cross-probes to the schematic.
3. Elevation ratsnest port-to-port for visible racks; stubs with far-rack name for links leaving; routed links drawn as dressed bundles (port → manager → top entry, merged per device+side with velcro ticks, fan-out over the last 150 mm).
4. UnplacedBin: unplaced components with search/group, draggable rows, double-click auto-places into the selected rack's first free slot.
5. Honour `ui.layout.viewportRequest` for components (ensure rack visible, zoom).
**Prove it:** unit tests for slot/ghost math and bundle grouping; `e2e/elevation.spec.ts` — Demo pod, unplace a device via the store, Layout → Elevation, drag it from the bin onto a rack, assert the placement, undo.

### WP-E — 3D viewer (react-three-fiber + drei)
**Owns** `src/editors/viewer3d/**` (keep `export function Viewer3D`). **Spec:** 3D viewer (all), Cable pathways (what the path looks like), acceptance 7, 10.
**Build on:** `@/model/routing` (`routePath3d` → `Vec3[]` mm y-up with per-layer ranges, `bundles`, `portWorldPos`), footprint port positions for faceplate textures, `ui.viewer3d` toggles, `exportRegistry['screenshot-3d-png']` expects `window.__dcCapture3D(): Promise<Blob>`.
**Deliverables**
1. Scene in metres: floor from `room.outline`, optional raised-floor grid, faint ceiling, threaded-rod tray supports every 1.5 m.
2. Racks as instanced frames (posts, roof with top-entry cutouts, optional doors), VCM channels with fingers, HCMs, enclosures.
3. Devices as instanced boxes of true size at their U/face with a `CanvasTexture` faceplate generated from footprint ports (lit ports in cable colour, protruding optics); `useGLTF` when `model3d` is set.
4. Trays by kind (runway U-channel, ladder rails + rungs every 300 mm, basket wire box), fittings, waterfalls as quarter-pipes.
5. Cables: `routePath3d` → Catmull-Rom → `TubeGeometry` (radius from `diameterMm`), fillets respecting `bendRadiusMm`, bundles as packed tubes with velcro rings every 300 mm splitting near ports, geometries merged per layer + colour; airwires as thin lines (toggle).
6. Controls: OrbitControls, Top/Front/Rear/Iso presets, walk mode (WASD at 1.7 m, Esc exits), toggle panel bound to `ui.viewer3d`, Screenshot PNG (`preserveDrawingBuffer`, set `window.__dcCapture3D`), **F** frames the selection (`ui.viewer3d.frameRequest`).
7. Cross-probe: raycast click on device / cable / rack → `revealSelection`; highlight incoming selection (emissive).
8. Memoise builders on the relevant project slices; 60 fps on `Large site` with distance-based tube LOD.
**Prove it:** unit tests for pure builders (faceplate layout, fillet insertion, instance transforms for rotations); `e2e/viewer3d.spec.ts` — 3D tab renders a canvas without errors (skip gracefully if WebGL is unavailable), click near centre selects something.

### WP-F — End-to-end acceptance suite (after A–E)
**Owns** `e2e/**`. Write one Playwright spec per spec acceptance criterion (list in §7), driving the real UI and asserting through `window.__dcStore.getState()`. Keep them resilient (data-testid on toolbars/tabs; the tab strip already has `tab` roles). Add `data-testid`s in editors as needed (small additive edits).

### WP-G — Performance pass
Target from the spec: 60 fps pan/zoom in layout and 3D with `Large site` (50 racks / 1,000 devices / 5,000 links). Profile with the Performance panel; expected levers: Konva layer caching, single-path batching (`batchStrokes`), rbush/segment indices, `InstancedMesh`, merged tube geometries, `useMemo` on project slices, avoiding `indexProject` rebuilds inside render loops (it is memoised per project identity — reuse it).

### WP-H — Gaps and polish
- Catalog: MPO-16 trunk (decision 7); consider `single-homed-server` using `expectedUplinks` (15).
- Ratsnest "shortest candidate" for interchangeable patch-panel ports (spec Ratsnest bullet 4) — model helper + floor view.
- `ui.outOfSync` maintained in the store instead of `useOutOfSync` recomputing per change (cheap now; matters at 5,000 links).
- HCM / fiber-enclosure accessories vs device U ranges in DRC.
- `Route.needsReview` "Mark reviewed" exists in the Route inspector; add a DRC info rule or badge if desired.
- Vitest `test.projects` migration (26); an ErrorBoundary around each editor in `App.tsx`.
- Spec open questions (§8) once the user answers.

### Feature specs (separate documents under `docs/specs/`)
- **Fiber plant — patch panels, trunks, cassettes, tracing, generator:** `docs/specs/fiber-plant-patch-panels.md` (branch `feature/fiber-plant-patch-panels`). Work packages F1–F7 are defined inside it; it is additive to everything above.

---

## 6. Verification

```bash
npm run check                 # tsc + vitest + build — the gate for every package
npx vitest run src/model/sync # any subtree
npm run dev                   # then drive http://localhost:5173; window.__dcStore.getState() exposes everything
npm run test:e2e              # playwright; starts vite on :5199 itself
```

Manual smoke that already works: File ▸ New from template ▸ Demo pod → status bar `Unrouted: 60 / 80`, ERC 8 info, DRC 60 warnings; Layout tab shows Library / Inspector / Proposals and the F8 dialog; reload restores the project; File ▸ Export ▸ any list export downloads a CSV.

The workspace is connected to `https://github.com/munozr1/gnd`, preserving the existing shared history. The editor implementation was pushed to `main` at `0895ab4`. The user explicitly prefers working on and publishing directly to `main`; do not create branches or pull requests unless asked. Build caches are ignored and are no longer tracked.

---

## 7. Spec acceptance criteria → current coverage

| # | Criterion | Model-level proof | UI proof |
| --- | --- | --- | --- |
| 1 | Fabric connector: 2 × 8 mesh < 2 min, ERC clean | `model/schematic/fabric.test.ts`, `model/demo/pod.test.ts` (ERC no errors) | WP-B dialog + WP-F |
| 2 | Duplicate pod sheet → fresh refs, no ERC errors | `model/schematic/sheets*.test.ts` | WP-B + WP-F |
| 3 | F8 change list accurate; new components land in Unplaced; airwires once placed | `model/sync/*.test.ts`, `panels/layout` dialog tests | WP-C/WP-D + WP-F |
| 4 | Delete link + F8 removes route + airwire | `model/sync/apply.test.ts` | WP-F |
| 5 | Pinned waypoints stay put when an endpoint moves; unpinned re-square | `model/routing/waypoints*.test.ts`, `commands/*.test.ts` (moveDevice) | WP-C + WP-F |
| 6 | Moving a rack moves anchored waypoints | `model/routing/waypoints.test.ts`, `commands` (moveRacks) | WP-C + WP-F |
| 7 | Click cable in 3D → selected in layout + schematic | — | WP-E + WP-F |
| 8 | DRC flags 100G-SR4 routed > reach | `model/drc/rules` reach-exceeded tests | WP-F |
| 9 | Undo/redo everywhere; reload restores exactly | `store/*.test.ts`, `io/persistence/*.test.ts` | WP-F |
| 10 | 60 fps at 50 racks / 1,000 devices / 5,000 links | `model/demo/large.test.ts` builds < 2 s | WP-G |

---

## 8. Open questions from the spec (unanswered; defaults chosen)

- Power/PDU modelling → **network only** in v1; `DeviceKind` and `PortType` are open unions to extend.
- Accounts / cloud save → **local only** (IndexedDB + JSON files); `io/persistence` is the seam for a backend.
- 3D placement edits → **view-only**, like KiCad.
- Vendor models → **generic catalog**; add real models in `scripts/gen-catalog.ts` or per project via the custom device form.


## 9. Schematic implementation — 2026-09-24 continuation

**Delivered**
- `src/editors/schematic/index.tsx`: responsive Konva stage; cursor-centred wheel zoom, toolbar zoom/fit, middle/right/space-drag pan, snapped repeated placement, click/shift-click/box selection, rotate/mirror, M/G pickup, delete, and Escape cancellation. Drag previews stay outside the store and commit once on release, so even a long drag is a single undo step.
- Click-click or drag between free pins creates a link through the existing command layer and derives the cable from the endpoint optics. Occupied ports are rejected. W selects the wire tool; L edits a selected wire label; exposed wire segments can be dragged. Context menus support device transforms, pin expansion, layout cross-probing, labels, cable selection, and deletion.
- `scene.ts` uses rbush for pins, component/sheet bodies, and individual wire segments. It handles local wires and parent/child/sibling off-sheet endpoints, selection bounds and sheet-aware reveal requests. Separate wire, symbol, and overlay layers prevent hover from repainting the static symbols.
- `drawing.ts` renders compact symbols, used pins, collapsed-pin expansion controls, cable colours and labels, off-sheet endpoint labels, and child-sheet previews. Long hierarchical connection lists are summarized to preserve sheet symbol dimensions.
- `src/panels/schematic/Inspector.tsx`: unique reference validation, role/value, compatible physical models and optics, pin expansion, cable properties, endpoint navigation, transforms, deletion, and multi-selection actions.
- `SheetsPanel.tsx`: tree navigation, new child, rename, duplicate (reports omitted external links), delete, and breadcrumbs in the canvas.
- Fixed editor dock wrappers to fill their parent height. The placeholder canvases had hidden this sizing problem. Fixed `CommitInput` so Escape cannot save the discarded DOM value during blur and Enter does not commit twice.
- No model/schema/catalog changes; persistence, command history and F8 continue through their existing contracts.

**Verification**
- `npm run check`: TypeScript, 61 test files / 637 unit tests, production build.
- `npm run test:e2e`: six browser tests in `e2e/schematic.spec.ts`. The script explicitly selects `playwright.config.ts` to avoid the old generated JS config. Browser uses native platform information rather than Windows device emulation, so modifier keys match the host.
- On this machine: `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/gnd-playwright npm run test:e2e`. Matching Chromium was downloaded there. Elsewhere run `npx playwright install chromium` once, then `npm run test:e2e`. `PLAYWRIGHT_CHANNEL=chrome` optionally selects installed Chrome.
- Local preview: `npm run dev`; File → New from template → Demo pod; open Pod A in Sheets. The preview used during this session is on port 5199.

**Next work**
1. Finish WP-B: fabric and breakout dialogs, bulk model assignment, virtualized Links panel. Then bind Cmd/Ctrl+Shift+F to the registered fabric dialog; it is deliberately not bound to a missing dialog today.
2. WP-A refinements: dedicated pin-group headings/gaps, breakout lane fan-out, inline optic captions (currently available on hover and in Inspector), body/wire hover accents, and full performance profiling/caching at the Large site scale. Basic canvas functionality is delivered; the 60 fps target has not been measured.
3. Physical editors: core floor/elevation/3D delivery is recorded in §10; continue the listed advanced refinements.
4. Expand end-to-end acceptance coverage as these editors are implemented. The six current browser tests do not certify the complete design spec.


## 10. Pod A physical views — 2026-09-24 continuation

**Delivered**
- Replaced the blank Layout and 3D placeholders using the existing synchronized Demo pod: six racks, 42 devices (40 in Pod A plus two spines), 80 links, 20 routed cables and 60 airwires. Physical views cover the whole site so the spine connections remain visible.
- `src/editors/layout/PhysicalCanvas.tsx`, `FloorView.tsx`, `physicalScene.ts`: responsive Konva floor plan, room/grid, keepouts, rack orientation/counts, trays/fittings/fill and projected routes/airwires. Wheel zoom, middle/right/space pan, selection, snapped rack drag with one undo entry, rotate/delete, rack double-click to elevation, and fit/reveal requests. Preview rack movement applies the model's anchored-waypoint updates without mutating the project until release.
- Basic rack placement, tray/room/keepout point drawing and selected-link routing through existing commands (X, click points, Enter/Finish, Escape). Layer controls and airwire filters share existing UI state.
- `src/editors/layout/elevation/index.tsx`: Front/Rear and All racks/single rack views; U numbering, devices/ports, managers/accessories, routed dressing and airwires. Device dragging previews fit, rejects occupied slots through commands, supports unplace/undo, and double-click reveals the schematic. Split view mounts both canvases. Rack-following does not rearrange columns when selecting a device for a drag.
- `src/panels/layout/UnplacedBin.tsx`: search, drag to elevation, double-click to first free U in a remembered selected rack. F8-created unplaced devices use the existing placement records.
- `src/editors/viewer3d/geometry.ts` and `index.tsx`: pure scene data in metres; instanced frames/devices/accessories/ports; true U/face/rack rotations; trays, fittings and supports; cable tubes from authoritative route paths and dashed unrouted links. Floor grid is clipped to the room polygon. Orbit/pan/zoom, camera presets, full-object selection framing, visibility toggles, selection highlighting, explicit Show in layout/schematic actions, and PNG capture connected to the export registry. HTML rack labels stop click propagation so canvas miss handling cannot clear their selection.
- Project/schema/catalog contracts remain unchanged. Physical edits go through the existing layout command history.

**Verification**
- `npm run check`: strict TypeScript, 62 files / 645 unit tests, production build.
- `e2e/physical.spec.ts`: Pod A floor renders, rack drag/undo and double-click elevation; server movement, occupied-slot rejection and unplace/undo; real WebGL rendering, counts, airwire toggle, PNG download and rack cross-probing. All nine browser tests pass, including the six schematic tests.
- Pure scene tests verify device/route counts, route endpoint agreement, rear-facing placement at all four rack rotations, unplaced omission, concave room-grid clipping, and full rotated rack extents for camera framing.
- Manually inspected the floor, elevation, 3D and exported PNG. Confirmed clicking a device mesh selects the device in the live preview. Browser-test screenshots are in `test-results/pod-*.png` (regenerated by test runs).

**Remaining scope**
- WP-C: interactive waypoint/segment edits, pinned-point controls on canvas, richer snap/route feedback, tray endpoint/fitting editing and the complete routing acceptance suite.
- WP-D: precise accessory/fiber-enclosure visuals, cable picking/bundle fans, external airwire stubs, and automated native drag-from-bin coverage. Current view draws individual dressing paths.
- WP-E: detailed faceplate textures/vendor GLTF, waterfall geometry, bundle packing/velcro/merged geometry, walk mode, underfloor tile controls, and distance-based LOD. PNG currently captures the WebGL scene; HTML rack-name labels and toolbar overlays are excluded.
- Large site performance is not measured or certified. The nine browser tests verify the delivered core, not every design-spec acceptance criterion. Vitest still reports the existing environmentMatchGlobs deprecation and now a non-failing multiple-Three-instances warning in the jsdom app test.

## 11. Cutsheet CSV import — 2026-09-24 continuation

**Delivered**
- File → Import cutsheet CSV opens a preview with automatic header mapping, editable endpoint/speed/state/type columns, project name, validation and optional draft rack placement. JSON restore remains separate. See `docs/cutsheet-import.md` for the user workflow and assumptions.
- `src/io/imports/cutsheet.ts`: quoted CSV parsing, last-underscore endpoint parsing, speed normalization, duplicate detection and occupied-port conflict validation. Preserves exact device/port names and all connection states. Pure project construction creates custom provisional hardware, hierarchical schematic sheets and synchronized placements without changing the schema.
- `src/panels/imports/CutsheetImportDialog.tsx`: saves the previous and new projects before switching, resets stale editor tools/elevation state, fits the schematic and makes the import survive reload. Cancel leaves the open project unchanged.
- The provided `docs/test cutsheet.csv` imports 49 devices and 48 links (46 × 10 Gbps, 2 × 100 Gbps). Draft placement creates five racks; disabling it creates 49 unplaced devices. The root contains the distribution hub and four child sheets with 12 neighbors each.
- Exact optics, cable media and routes are intentionally unassigned because the file only supplies endpoint names and speeds. Generic 1U hardware, port form factors and rack/U assignments are explicitly provisional. Breakout suffixes remain literal port names; parent cages are not inferred. Reimport creates a new project, not an update to an existing one.

**Verification**
- `npm run check`: strict TypeScript, 63 files / 665 unit tests, production build.
- All 12 browser tests pass. `e2e/cutsheet.spec.ts` covers a representative synthetic cutsheet, mapping/preview, persistence of both projects, draft Layout/3D counts, stale elevation reset, conflict blocking, cancellation and alternate-column logical-only import.
- Parser/builder tests verify source names and endpoint pairs, speeds, CSV edge cases, duplicates/conflicts, generated ID uniqueness, sync, rack fit and JSON round trip.
- Visually inspected the preview, generated schematic child sheet and 3D racks/airwires. Browser screenshots are regenerated in `test-results/cutsheet-*.png`.

- Before publishing, the original site CSV was no longer present in the workspace. Automated tests now use `e2e/fixtures/cutsheet.csv`, a synthetic 49-device / 48-link fixture with the same column layout, speed/state distribution and breakout-port coverage. The original site file is not included in the repository.
