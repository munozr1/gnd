# Datacenter EDA — agent guide

KiCad-style browser app for designing datacenter networks: **schematic** (logical topology) → **F8 Update Layout** → **layout** (racks, ratsnest, cable routing) → **3D viewer** → exports. The master design spec is `Datacenter Topology Builder — Design Spec.md` (provided alongside the repo); it is the source of truth for behaviour. `docs/HANDOFF.md` is the current state, decision log and remaining work packages — read it before starting anything.

## Commands

```bash
npm run dev          # vite on :5173 (also .claude/launch.json "dev")
npm run check        # tsc -b && vitest run && vite build  — must be green before you stop
npm test             # vitest run (60 files / 630+ tests)
npm run test:e2e     # playwright (chromium installed; specs live in e2e/)
npm run gen:catalog  # regenerate src/catalog/*.json from scripts/gen-catalog.ts
```

## Layout of the code

| Dir | Role | Rules |
| --- | --- | --- |
| `src/model/**` | Types, catalog index, pure logic: `schematic/`, `sync/` (F8), `erc/`, `drc/`, `routing/`, `demo/` | **No React/Konva/Three imports.** Mutators take an Immer `draft: Project`; readers take `project` and use `indexProject(project)`. |
| `src/store/**` | Zustand store: `project`, per-editor undo/redo (Immer patches), non-undoable `ui` slice, shortcut registry | Never set `project` directly — `store.getState().execute(command)`. See `src/store/README.md`. |
| `src/commands/**` | Typed undoable command factories for every verb (schematic + layout) | Editors call these; add a factory here when you add a verb. |
| `src/io/**` | `persistence/` (IndexedDB autosave, JSON + migrations), `exports/` (registry of CSV/SVG/HTML/PNG generators) | Add an export = push an entry to `exportRegistry`; the menu reads it. |
| `src/ui/**` | Tailwind + Radix primitives (Button, Panel, SplitPane, Dialog, Select, ContextMenu, Toast…) | Dense pro-tool UI: 13 px text, 28 px toolbars, dark theme only, tokens in `src/index.css`. |
| `src/panels/**` | `registry.ts` + `shell/` (menubar, tabs, status bar, issues drawer, docks) + per-editor panels/dialogs | Panels/dialogs/toolbars **register at module load** via `registerPanel/registerDialog/registerToolbar`; `App.tsx` imports the module once for the side effect. |
| `src/editors/**` | Konva editors (`schematic/`, `layout/` with `elevation/`) and the R3F `viewer3d/` | Keep the exported component names `SchematicEditor`, `LayoutEditor`, `ElevationView`, `Viewer3D`. |
| `src/catalog/**` | Generated JSON (symbols, footprints, optics, cables, racks, trays, accessories) | Edit `scripts/gen-catalog.ts`, then `npm run gen:catalog`. Never hand-edit the JSON. |

Contract files — change only additively and update `createProject()` + `src/io/persistence/migrations.ts` when you do: `src/model/types.ts`, `src/model/query.ts`, `src/panels/registry.ts`, the `ui` slice in `src/store/index.ts`.

## Conventions

- TypeScript strict with `noUncheckedIndexedAccess`; 2-space, single quotes, semicolons, named exports; comments say *why*.
- Every project mutation is a command (`label`, `editor`, `mutate(draft)`, optional `coalesceKey` for drags). `execute` returns `false` and sets `ui.lastError` when the mutator throws — surface it with `toast`.
- Cross-editor selection lives in `ui.selection`; use `store.getState().revealSelection(items, editor)` to select + switch tab + ask the editor to zoom (`ui.<editor>.viewportRequest`, cleared by the editor via `requestViewport(editor, null)`).
- Keyboard: `registerShortcut({ id, keys: 'mod+shift+f', editor, handler })` from `@/store/shortcuts` inside a `useEffect`, unregister on unmount. `mod` = ⌘ on macOS.
- Units: schematic = abstract units on a 10-unit grid (pin pitch 10); floor plan = **mm**, rack `pos` is the top-left of its footprint at rotation 0, front face points **+y**; rack elevation = mm with the floor at y = 0 and y **down**; 3D = metres (mm/1000), **y up**. 1U = 44.45 mm.
- Tests live next to code (`*.test.ts[x]`); `src/store` and `src/io` run in jsdom with fake-indexeddb, everything else in node. Build fixtures with `createProject()` / `createComponent()` / `builtinCatalog`, or `buildPodProject()` from `@/model/demo`.
- `window.__dcStore` is the live store (dev + e2e hook).
- Shared repository: `https://github.com/munozr1/gnd`. The user explicitly prefers working on `main` and pushing directly when publishing is requested; do not create a feature branch or pull request unless asked.

## Working in parallel

Own a directory, don't touch others' directories, and never edit `package.json` / `tsconfig*` / `src/model/types.ts` without saying so. Integrate with `npm run check` and, for UI, drive the app with Playwright against `window.__dcStore`. The ownership map and the remaining work packages are in `docs/HANDOFF.md`.
