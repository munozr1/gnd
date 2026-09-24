## 
All re-exported from '@/model/sync' (src/model/sync/index.ts):

// diff.ts (readers; take a plain Project and use indexProject — callers must not mutate a project in place outside Immer or the memoised index goes stale)
computeSyncPlan(project: Project): SyncPlan
isOutOfSync(project: Project): boolean            // cheap: stops at the first change
changeKey(change: SyncChange): string             // `${kind}:${componentId|linkId}`, unique per change, for dialog checkboxes
linkEndsEqual(x: LinkEnd, y: LinkEnd): boolean   // componentId + portId + lane
footprintFits(idx: ProjectIndex, componentId: Id, footprintDefId: string | null): boolean  // unplaced -> true; else within rack height and no U overlap with other placed devices
routesTouchingComponent(project: Project, componentId: Id): Id[]  // route ids (== link ids) of live or last-synced links on the component

// apply.ts (mutating; take an Immer draft)
interface ApplySummary { applied: number; removedRoutes: Id[]; unplaced: Id[] }
applySyncPlan(draft: Project, changes: readonly SyncChange[]): ApplySummary  // applies exactly the given subset; idempotent; stale changes skipped and not counted; prunes placements of missing components
copyEnd(end: LinkEnd): LinkEnd                    // copy without an explicit `lane: undefined` key

// backAnnotate.ts
type AcceptResult = { ok: true; annotation: BackAnnotation; unplaced: boolean } | { ok: false; error: string }
validatePortSwap(project: Project, linkId: Id, end: 'a' | 'b', toPortId: string): string | null
validateRefRename(project: Project, componentId: Id, to: string): string | null
validateFootprintChange(project: Project, componentId: Id, to: string | null): string | null
proposePortSwap(draft: Project, linkId: Id, end: 'a' | 'b', toPortId: string): BackAnnotation   // throws Error(message) on invalid input; supersedes a pending proposal for the same link end
proposeRefRename(draft: Project, componentId: Id, to: string): BackAnnotation                     // trims `to`; throws on invalid; supersedes per component
proposeFootprintChange(draft: Project, componentId: Id, to: string | null): BackAnnotation        // throws on invalid; supersedes per component
acceptBackAnnotation(draft: Project, id: Id): AcceptResult   // re-validates; applies to schematic AND syncState; port swap moves the optic with the cable; footprint change unplaces if it no longer fits; on failure the proposal stays pending
rejectBackAnnotation(draft: Project, id: Id): boolean        // true when a proposal was removed

// testFixtures.ts (test helper, not part of the runtime API): buildFabric(), syncAll(project), edit(project, recipe), place(draft, componentId, rackId, u), addRoute(draft, linkId, points?), placementOf(project, componentId), plus catalog id constants.

## 
// '@/model/erc' (index.ts)
export interface Rule { id: string; name: string; defaultSeverity: Severity; check(project: Project, idx: ProjectIndex): Issue[] }
export const ercRules: readonly Rule[]                       // 9 rules in spec order
export const ercRuleById: ReadonlyMap<string, Rule>
export function runErc(project: Project, idx?: ProjectIndex): Issue[]   // applies settings.ercSeverities ('ignore' drops), sorted error->warning->info->message->id
export function ercSeverity(project: Project, rule: Rule): Severity      // override or default
export function compareIssues(a: Issue, b: Issue): number
export { portReuseRule, formFactorMismatchRule, speedMismatchRule, mediaMismatchRule, connectorMismatchRule, missingOpticRule, unassignedModelRule, singleHomedServerRule, unconnectedUplinksRule }: Rule
// rule.ts helpers (re-exported from index)
export function ercIssue(rule: Rule, message: string, targets: IssueTarget[], keys?: readonly string[]): Issue
export function issueId(ruleId: string, keys: readonly string[]): string   // 'erc.<ruleId>.<16 hex>'
export function hashKey(s: string): string
export function targetKey(t: IssueTarget): string                           // 'component:<id>[:<portId>]' | 'link:<id>' | ...
export const componentTarget: (id: Id, portId?: string) => IssueTarget
export const linkTarget: (id: Id) => IssueTarget
// helpers.ts (internal but importable)
portTypeOf(idx, c, portId): PortType | undefined; assignedOptic(idx, c, portId): TransceiverDef | undefined; isIntegratedCable(cable?): boolean; cableEndMedia(cable): 'MMF'|'SMF'|'Copper'|undefined; pinsWithRole(symbol, role): SymbolPin[]; pinsInGroup(symbol, groupId): SymbolPin[]; distinctLinksOf(idx, componentId): Link[]; formatGbps(n): string
// rules/speed-mismatch.ts: endSpeedGbps(xcvr, end): number
// rules/connector-mismatch.ts: expectedConnectorAt(idx, c, portId): { connector; describe } | undefined; cableEndsFor(cable, link): [string, string]
// fixtures.ts (test helpers, reusable by other test suites): addComponent(project, symbolId, ref, { footprintDefId?, optics? }), connect(project, a, b, cableDefId?), end(c, portId, lane?), check(rule, project), buildSpineLeafMesh(), symbol constants LEAF/SPINE/MGMT_SWITCH/SERVER_1U/SERVER_2U/GPU_SERVER/LC_PANEL/MPO_PANEL

## 
## '@/store' (src/store/index.ts)
- `useStore` (zustand hook, `create<StoreState>()`), `store: StoreApi<StoreState>` (getState/setState/subscribe)
- `StoreState = { project: Project; history: History; ui: UiState; execute(cmd: Command, now?: number): boolean; undo(editor: EditorId): boolean; redo(editor): boolean; canUndo(editor): boolean; canRedo(editor): boolean; undoLabel(editor): string|null; redoLabel(editor): string|null; replaceProject(p: Project): void; setProjectMeta({name?, rev?}): void; setActiveTab(EditorId); setActiveSheet(Id); select(items: SelectionItem|readonly SelectionItem[], opts?: {additive?, toggle?}); clearSelection(); setHovered(SelectionItem|null); setLayoutView('floor'|'elevation'|'split'); setActiveLayer(RoutingLayer); toggleLayerVisible(layer, visible?); setRatsnestMode('all'|'selection'|'none'); setElevationRacks(ids: readonly Id[], face?: Face); setElevationFace(Face); setViewer3dOption(key: keyof Viewer3dUi, value: boolean); toggleViewer3dOption(key); setIssues('erc'|'drc', Issue[]); setIssuesDrawerOpen(boolean); toggleIssuesDrawer(); openDialog(id: string, data?: unknown); closeDialog(); setLastError(string|null); patchUi(Partial<UiState>) }`
- `UiState = { activeTab: EditorId; activeSheetId: Id; selection: SelectionItem[]; hovered: SelectionItem|null; layout: LayoutUi; viewer3d: Viewer3dUi; issues: Record<'erc'|'drc', Issue[]>; issuesDrawerOpen: boolean; activeDialog: string|null; dialogData: unknown; lastError: string|null }`; `LayoutUi = { view; activeLayer; visibleLayers: Record<RoutingLayer,boolean>; ratsnest; elevationRackIds: Id[]; elevationFace: Face }`; `Viewer3dUi = { showDoors; showOverhead; showUnderfloor; showCables; showAirwires; showRaisedFloor }`; `initialUi(): UiState`
- Hooks: `useProject(): Project`, `useProjectIndex(): ProjectIndex`, `useUi(): UiState`, `useSelection(): SelectionItem[]`, `useIsSelected(item: SelectionItem|null|undefined): boolean`, `useHovered()`, `useActiveTab()`, `useActiveSheetId()`, `useCanUndo(editor)`, `useCanRedo(editor)`, `useUndoLabel(editor)`, `useRedoLabel(editor)`, `useActiveDialog()`, `useIssues(domain)`
- Re-exported from commands: `Command`, `History`, `HistoryEntry`, `EditorHistory`, `StepResult`, `UndoableEditor`, `command(label, editor, mutate, coalesceKey?): Command`, `transaction(label, editor, fns: ((draft: Project) => void)[], coalesceKey?): Command`, `emptyHistory()`, `HISTORY_CAP=200`, `COALESCE_WINDOW_MS=500`, `isUndoableEditor(e)`
- Re-exported from selection: `selectionKey(item): string`, `sameItem(a,b)`, `isSelected(selection, item)`, `dedupeSelection(items)`, `mergeSelection(current, items)`, `toggleSelection(current, items)`, `selectionItemExists(project, item)`, `pruneSelection(project, selection)`

## '@/store/commands' (pure, no store dependency)
- `interface Command { label: string; editor: EditorId; mutate(draft: Project): void; coalesceKey?: string }`
- `executeCommand(project, history, cmd, now = Date.now()): StepResult` (throws for editor 'viewer3d' or if mutate throws; inputs untouched)
- `undoCommand(project, history, editor): StepResult`, `redoCommand(project, history, editor): StepResult`, `StepResult = { project; history; changed: boolean; label: string|null }`
- `canUndoHistory(history, editor)`, `canRedoHistory(history, editor)`, `undoLabelOf(history, editor)`, `redoLabelOf(history, editor)`

## '@/store/shortcuts'
- `registerShortcut({ id, keys: string|string[], editor?: EditorId, when?: () => boolean, handler: (e: KeyboardEvent) => void, allowInInputs?, preventDefault? (default true), description? }): () => void`
- `unregisterShortcut(id)`, `listShortcuts(): ShortcutDef[]`, `installShortcutListener(target: EventTarget = window): () => void` (also registers global.undo 'mod+z', global.redo ['mod+shift+z','mod+y']), `registerGlobalShortcuts(): () => void`, `dispatchKeydown(e, activeEditor?): boolean`
- `parseKeys(keys): ParsedKeys`, `matchesEvent(parsed, e, platform?)`, `formatKeys(keys, platform?): string` ('⇧⌘Z' / 'Ctrl+Shift+Z'), `detectPlatform(): 'mac'|'other'`, `setPlatform(p|null)`, `isEditableTarget(target)`

## '@/io/persistence'
- `saveProjectNow(project, now = ISO now): Promise<Project>` (returns copy stamped with updatedAt; updates 'projects' index)
- `listProjects(): Promise<ProjectSummary[]>` (`{ id, name, rev, createdAt, updatedAt }`, newest first), `loadProject(id): Promise<Project|null>` (migrated, marked clean), `deleteProject(id): Promise<void>`, `setLastOpened(id|null)`, `getLastOpened(): Promise<Id|null>`, `clearPersistence()`, `markProjectClean(project)`
- `startAutosave(store: ProjectStoreLike, opts?: { debounceMs?=1000; onSaved?; onError?; trackLastOpened?=true }): AutosaveHandle { stop(); flush(): Promise<void>; isPending(): boolean }`; `ProjectStoreLike = { getState(): {project}; subscribe(listener(state, prev)): () => void }` (the app `store` satisfies it)
- `serializeProject(project, opts?: { updatedAt?; pretty?=true }): string`, `parseProject(json, now?): Project` (throws `ProjectParseError`), `downloadJson(project, filename = projectFileName(project))`, `projectFileName(project)`, `readJsonFile(file: File): Promise<Project>`
- from migrations: `migrate(raw: unknown, now?): Project`, `CURRENT_PROJECT_VERSION = 1`, `ProjectParseError`

## 
All exported from '@/model/schematic' (index.ts). 

symbolGeometry.ts: PIN_PITCH=10, PIN_LENGTH=20, GRID=10, MAX_VISIBLE_PINS_PER_SIDE=12, MIN_BODY_SIZE=40; interfaces PinPlacement {portId, pin, side: PinSide, pos, bodyPos, dir}, CollapsedStub {side, count, hiddenPortIds, pos, bodyPos, dir}, PinLayoutOptions {collapsed: boolean; usedPortIds: ReadonlySet<string>}, SymbolLayout {pins: Map<string, PinPlacement>; stubs: CollapsedStub[]; width; height; bounds: Rect; collapsed}; symbolLayout(symbol, component, opts): SymbolLayout; pinPositions(symbol, component, opts?): Map<string, PinPlacement>; collapsedStubs(symbol, component, opts?): CollapsedStub[]; symbolBounds(symbol, component, opts?): Rect; symbolBoundsWithPins(layout): Rect; pinEndpoint(layout, portId): {pos, dir, hidden} | undefined; isCollapsed(component): boolean; portLabel(pin): string ('eth1/49 QSFP28'); localToWorld(p, component): Vec2; localToWorldDir(d, component): Vec2; worldToLocal(p, component): Vec2; worldSide(dir): PinSide; usedPortIds(project, componentId): Set<string>; layoutOptionsFor(project, component): PinLayoutOptions; componentLayout(project, componentId): SymbolLayout | undefined (memoised per project identity). Frame: component.sch.pos = top-left of unrotated body; mirror then rotate about pos.

wires.ts: WIRE_STUB=20; autoWirePoints(aPos, aDir, bPos, bDir, stub?): Vec2[] (intermediate only); wireEndpoints(link, project): {a: WireEnd, b: WireEnd} | undefined; fullWirePolyline(link, project): Vec2[] (pin ends included; [] if unresolvable); wirePointsFromPolyline(points): Vec2[]; simplifyWire(points): Vec2[]; dragWireSegment(points, segmentIndex, delta): Vec2[] (pure; end segments get an inserted lead so pin ends stay fixed); wireMidpoint(points): Vec2; wireLabelAnchor(points): {pos, horizontal, segmentIndex}; hitTestWire(points, p, tolerance): {segmentIndex, point, dist} | null; sheetWires(project, sheetId): {link, points}[] (both ends on sheet).

annotate.ts: annotate(draft, opts?: {scope?: 'all'|'unannotated'; sheetId?: Id}): RefChange[] ({componentId, from, to}); nextRef(project, prefix): string; isUnannotated(ref): boolean; parseRef(ref): {prefix, n} | null; refPrefixOf(project, component): string; annotationOrder(project, components): Component[]; duplicateRefs(project): Map<string, Component[]>.

fabric.ts: planFabric(project, {leafIds, spineIds, leafPortIds, spinePortIds, cableDefId, opticId?, labelPrefix?}): FabricPlan {links: Link[]; optics: {componentId, portId, opticId}[]; skipped: {reason: FabricSkipReason, leafId?, spineId?, portId?, message}[]}; applyFabric(draft, plan): Id[]; suggestFabricPorts(symbol): {uplinks: string[]; downlinks: string[]}.

breakout.ts: BREAKOUT_CAPABLE, DEFAULT_FANOUT=4; planBreakout(project, {componentId, portId, targets: {componentId, portId}[], cableDefId}): BreakoutPlan {ok, links, errors: {code: BreakoutErrorCode, message, targetIndex?}[], fanout, usedLanes}; applyBreakout(draft, plan): Id[] (throws if !ok); breakoutFanout(project, componentId, portId, cableDefId): number; breakoutLanes(project, componentId, portId): Link[].

sheets.ts (+ re-exported hierarchy.ts): createChildSheet(draft, parentId, name, pos): Sheet; duplicateSheet(draft, sheetId, newName): {sheetId, sheetIdMap, componentIdMap, linkIdMap, droppedCrossSheetLinks: Id[]}; deleteSheet(draft, sheetId): {sheetIds, componentIds, linkIds}; renameSheet(draft, sheetId, name); moveSheetSymbol(draft, sheetId, pos); crossSheetLinks(project, sheetId): {link, insideEnd, outsideEnd}[]; sheetPath(project, sheetId, separator?): string; sheetSubtreeIds(project, sheetId): Id[]; sheetOrder(project): Id[]; sheetAncestry(project, sheetId): Sheet[]; childSheets(project, parentId): Sheet[]; isRootSheet(sheet): boolean; SHEET_DUPLICATE_GAP.

assignment.ts: assignFootprint(draft, componentIds, footprintDefId|null): number; assignOptic(draft, componentId, portId, opticId|null): void; bulkAssign(draft, {refGlob, footprintDefId?, optics?: {portGlob, opticId}[]}): number (matched components; ill-fitting optics skipped); globToRegExp(glob): RegExp; globMatch(glob, s): boolean; compatibleFootprints(catalog: Catalog, symbol): FootprintDef[]; compatibleOptics(catalog: Catalog, portType): TransceiverDef[]; defaultCableFor(catalog: Catalog, opticA: TransceiverDef|string|null|undefined, opticB): string|null; defaultCableForConnectors(catalog, a: {connector, media?}, b): string|null; endConnector(project, end): {connector, media?} | null; defaultCableForLink(project, {a, b}): string|null.

mutations.ts: addComponent(draft, symbolId, sheetId, pos, opts?: {value?, footprintDefId?, annotate?}): Component (snaps to GRID, auto-ref, no placement created); moveComponents(draft, ids, delta): void; rotateComponent(draft, id, steps=1): void; mirrorComponent(draft, id): void; deleteComponents(draft, ids): {componentIds, linkIds} (removes links, routes, placements; syncState untouched); addLink(draft, a: LinkEnd, b: LinkEnd, cableDefId?: string|null): Id (undefined => derive from optics; throws when occupied/missing); deleteLinks(draft, ids): void (removes routes); setLinkLabel(draft, id, label|undefined); setLinkCable(draft, id, cableDefId|null); setLinkWirePoints(draft, id, points); setComponentValue(draft, id, value|undefined); setComponentRef(draft, id, ref) (throws on clash/empty); toggleExpandedPins(draft, id): boolean; clearRef(draft, id).

lookup.ts: findComponent/requireComponent/findLink/requireLink/findSheet/requireSheet(project, id); linksOnPort(links, componentId, portId): Link[]; isEndFree(links, end): boolean; sameEnd(a, b): boolean.

## 
All routing exports are re-exported from '@/model/routing' (src/model/routing/index.ts).

positions.ts — constants U_MM=44.45, RACK_BASE_MM=100, DEFAULT_DEVICE_WIDTH_MM=482.6, DEFAULT_MANAGER_WIDTH_MM=152, DEFAULT_MANAGER_DEPTH_MM=100.
  rackFloorRect(rack): Rect; rackFrontDir(rack): Vec2 (rot 0 → {0,1}); rackAcrossDir(rack): Vec2 (viewer's right when facing the front); rackCenter(rack): Vec2; rackTopMm(rack): number (heightU×U_MM+100); uElevationMm(u): number; rackLocalToFloor(rack, {across, depth}): Vec2; floorToWorld(p, elevMm): Vec3; worldToFloor(p): Vec2; oppositeFace/oppositeSide; effectiveFace(portFace, placementFace): Face.
  portPlacement(project, componentId, portId): PortPlacementInfo|null ({rack, uPosition, face, acrossFromViewerLeft, faceplateX, faceplateWidth, elevationMm}); portFloorPos(project, componentId, portId): Vec2|null; facePointToFloor(rack, face, acrossFromViewerLeft): Vec2; portElevationMm(project, componentId, portId): number|null; portWorldPos(project, componentId, portId): Vec3|null.
  rackEntryPoints(project, rack): {topLeft, topRight, bottom}; managerFor(project, rackId, side): RackAccessory|undefined; managerCrossSection(acc?): {widthMm, depthMm}; managerFloorCenter(project, rackId, side): Vec2|null; managerFloorRect(project, rackId, side): Rect|null; polyline3dLength(points: Vec3[]): number; dist3(a, b): number.

dressing.ts — autoInRackPath(project, componentId, portId, opts?: {forceSide?: Side; mediaClass?: 'fiber'|'copper'}): InRackPath; managerFor (re-export); nearerSide(faceplateX, faceplateWidth, face): Side; topEntryFor(project, rackId, side, face?): RackAccessory|undefined; inRackPolyline3d(project, componentId, portId, path, trayElevationMm): Vec3[]|null; inRackPolyline3dDetailed(...): {points: Vec3[]; riseStart: number}|null; same3(a, b, eps?): boolean.

path3d.ts — defaultLayerElevationMm(room, layer): number (overhead=ceiling-600, underfloor=-raisedFloor/2, in-rack=0); segmentElevationMm(project, segment): number; routePath3d(project, linkId): RoutePath3d|null where RoutePath3d = {points: Vec3[]; segmentsByLayer: {layer, from, to}[]; parts: {inRackA, rise, tray, drop, inRackB}: [from, to] index ranges}; routeEndFloorPos(project, route, end: 'a'|'b'): Vec2|null (rack entry point the hand-routed path meets); bundleKey(rackId, side): string (`${rackId}:${side}`); bundles(project): Map<string, Id[]>.

length.ts — STANDARD_LENGTHS_M: readonly number[]; roundToStandard(m): number; LinkLength = {rawM, withSlackM, standardM, serviceLoopM, est: boolean, breakdown: {inRackA, rise, tray, drop, inRackB, verticalTotal}} (metres); routedLengthM(project, linkId): LinkLength|null; estimatedLengthM(project, linkId): LinkLength|null; linkLengthM(project, linkId): LinkLength|null.

waypoints.ts — (mutate the given Route/draft in place) findWaypoint(route, wpId): {segIdx, idx, wp}|null; insertWaypoint(route, segIdx, afterIdx, pos, pinned=false): Waypoint|null (afterIdx -1 = start); deleteWaypoint(route, segIdx, wpId): boolean; moveWaypoint(route, segIdx, wpId, pos, {keepOrthogonal?}): boolean; dragSegment(route, segIdx, i, delta): boolean; setPinned(route, segIdx, wpId|'all', pinned): number; setAllPinned(route, pinned): void; straighten(route): number removed; snapWaypoint(pos, {gridMm, trays, otherRoutePoints, toleranceMm}): {pos, snappedTo: 'cable'|'tray'|'grid'|'none', trayId?}; anchorWaypointsInRacks(project, route): void; onRackMoved(draft, rackId, delta): number moved; onEndpointMoved(draft, linkId, end: 'a'|'b'): boolean; newRouteFromPoints(project, linkId, layerPoints: {layer, trayId?, points: Vec2[]}[], pinByDefault = project.settings.pinWaypointsByDefault): Route|null; dropsOf(route): {pos, fromLayer, toLayer, segmentIndex}[].

fill.ts — DEFAULT_CABLE_DIAMETER_MM=3; FillStats = {areaMm2, usedMm2, fraction, cableCount}; cableDiameterMm(idx, link?): number; cablesInTray(project, trayId): Id[]; trayFill(project, trayId): FillStats|null; routesUsingManager(project, rackId, side): Id[]; managerFill(project, rackId, side): FillStats; trayCableSlots(project, trayId): Map<Id, CableSlot>; cableOffsetInTray(project, trayId, linkId): CableSlot|null where CableSlot = {lateralMm, verticalMm, row, index, diameterMm}.

drc/rule.ts — DrcFinding = {message, targets: IssueTarget[], key?}; DrcRule = {id, name, description, defaultSeverity: Severity, domain: 'drc', check(project): DrcFinding[]}; defineRule(rule without domain): DrcRule.
drc/index.ts — drcRules: readonly DrcRule[] (ids: u-collision, unplaced-component, unrouted-link, reach-exceeded, tray-overfill, bend-radius, clearance, wrong-face, out-of-sync, tray-media, missing-manager, manager-overfill, missing-waterfall, tray-clearance); drcRuleById(id); drcSeverity(project, rule): Severity; runDrc(project, rules = drcRules): Issue[] (issue id = `${rule.id}:${finding.key ?? index}`; 'ignore' rules skipped). drc/rules/tray-media.ts also exports trayKindAccepts(project, kind); drc/rules/tray-clearance.ts exports TRAY_CLEARANCE_MM=150.

Test helpers (not part of the runtime API, but usable by other agents' tests): src/model/routing/test-fixtures.ts — twoRackFixture(opts?), routeTwoRacks(f, pinned?), addRack/addDevice/place/removePlacement/addLink/addAccessory/addTray/addRoute, fresh(project).

## 
## '@/ui' (src/ui/index.ts)
- cn(...parts: ClassValue[]): string
- Icon({ name: IconName; size?; className? }), SeverityIcon({ severity: 'error'|'warning'|'info'|'ignore'; size? }); IconName = 'chevron-down'|'chevron-right'|'chevron-up'|'close'|'error'|'warning'|'info'|'check'|'undo'|'redo'|'plus'|'trash'|'folder'|'save'|'search'|'sync'|'play'|'list'|'dot'|'ok'|'file'|'keyboard'
- Button (forwardRef) props: ButtonHTMLAttributes & { variant?: 'default'|'primary'|'ghost'|'danger'; size?: 'sm'(24px)|'md'(28px); active?: boolean }
- IconButton (forwardRef) props: { label: string (aria-label + tooltip); icon?: IconName; children?; shortcut?: string; size?; active?; variant?: 'ghost'|'default'; noTooltip? }
- Toolbar (28px, role=toolbar), ToolbarGroup, ToolbarSeparator, ToolbarSpacer, ToolbarLabel
- Panel({ title; actions?; collapsible?; defaultCollapsed?; collapsed?; onCollapsedChange?; className?; bodyClassName?; children })
- SplitPane({ direction: 'horizontal'|'vertical'; children: [a, b]; primary?: 'first'|'second'; defaultSize?; size?; onSizeChange?; minSize?; maxSize?; minSecondarySize?; collapsed?; gutterSize?; className? }) — gutter has data-testid="split-gutter", double-click resets, arrow keys resize
- Dialog (Radix Root), DialogTrigger, DialogClose, DialogContent({ title; description?; footer?; width?: 'sm'|'md'|'lg'|'xl'; className?; bodyClassName?; hideClose?; children })
- DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem({ shortcut? }), DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub/SubTrigger/SubContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuGroup, MenuShortcut
- ContextMenu* (same shape as DropdownMenu*)
- Tabs (Radix Root), TabsList (28px strip), TabsTrigger, TabsContent
- Select({ value?; defaultValue?; onValueChange?; options: SelectOption[]; placeholder?; disabled?; size?; className?; 'aria-label'?; name? }); SelectOption = { value: string; label: ReactNode; disabled? }
- Checkbox({ checked?: boolean|'indeterminate'; defaultChecked?; onCheckedChange?; label?; disabled?; className?; id?; name?; 'aria-label'? })
- TooltipProvider({ children }) — mounted once in App; Tooltip({ content; shortcut?; side?; children })
- Kbd (kbd element), Badge({ tone?: 'neutral'|'accent'|'error'|'warning'|'info'|'ok' })
- Input (forwardRef; { mono?; inputSize?: 'sm'|'md' }), NumberInput({ value: number; onChange(v: number); min?; max?; step?; unit?; decimals?; inputSize? }) commits on Enter/blur/arrows, Escape reverts; INPUT_CLASS
- EmptyState({ title; description?; icon?; action?; className? })
- toast(message, { tone?, title?, durationMs? }): number; toast.info/ok/warning/error(message, opts?); dismissToast(id); clearToasts(); useToasts(); ToastViewport (mounted in App)
- (src/ui/testing.tsx, tests only) mount(element): { container, root, rerender, unmount }; flush(); waitFor(predicate, timeoutMs?); click(el); text(el)

## '@/panels/shell' (src/panels/shell/index.ts)
- MenuBar, EditorTabs (renders TabsList; expects to be inside <Tabs>), StatusBar, IssuesDrawer, ProjectPicker (dialog id PROJECT_PICKER_DIALOG='project-picker'), ShortcutsDialog (SHORTCUTS_DIALOG='shortcuts'), ProjectTitle
- StatusBarProvider; useStatusBar(): { mode, coords, message, set(partial), clear() }; useStatusBarWriter(): { set, clear } (no subscription); useStatusBarFields({ mode?, coords?, message? }) — publishes while mounted, clears on unmount; all no-op without a provider
- countUnrouted(project): { unrouted, total } (links with no project.routes entry); countBySeverity(issues)
- focusIssue(issue): selects targets, switches tab (erc→schematic + owning sheet, drc→layout); selectionForTarget(IssueTarget): SelectionItem (route→link); targetLabels(issue): string
- useIssuesFilter(), setIssuesFilter({ domain?: 'all'|'erc'|'drc'; severities? }), toggleIssueSeverity(sev), resetIssuesFilter()
- runChecks(domains = ['erc','drc'], { project?, notify? }): Promise<Record<'erc'|'drc', Issue[]|null>> (writes store.setIssues; null = module unavailable); useChecks(): { runChecks, running }; useLiveChecks(debounceMs = 600); CHECK_DOMAINS; LIVE_CHECK_DEBOUNCE_MS
- useOutOfSync(): boolean
- useAppBootstrap(): { ready, error }; loadInitialProject(): Promise<'loaded'|'created'>
- registerShellShortcuts(): () => void; SHELL_KEYS = { tabSchematic:'alt+1', tabLayout:'alt+2', tabViewer3d:'alt+3', updateLayout:'f8', runErc:'mod+e', runDrc:'mod+shift+e', open:'mod+o', save:'mod+s', shortcuts:'mod+/', issues:'mod+shift+m' }
- newProject(name?), openProject(id): Promise<boolean>, deleteSavedProject(id), saveProjectFile() (JSON download), importProjectFile(): Promise<boolean> (file picker), importProjectFromFile(file), flushAutosave()
- EXPORT_KINDS: { id, label, fn }[]; runExport(kind): Promise<boolean>; exportsModuleAvailable()
- useSaveState(): 'idle'|'dirty'|'saved'|'error'; setSaveState()
- formatRelativeTime(iso, now?), errorMessage(err)

## Editors (placeholders, keep names)
- '@/editors/schematic' SchematicEditor(), '@/editors/layout' LayoutEditor(), '@/editors/viewer3d' Viewer3D() — each renders a full-size div with data-editor="<id>"

## '@/App' App()