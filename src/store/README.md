# Store: commands, undo/redo, shortcuts

One Zustand store (`useStore`, imperative `store`) holds the `Project`, per-editor history (`schematic`, `layout`; `viewer3d` is read-only) and a non-undoable `ui` slice.

## Mutating the project

Never mutate `project` directly (it is frozen). Wrap a pure model mutator in a command:

```ts
import { store, command, transaction } from '@/store';
store.getState().execute(command('Move SW1', 'schematic', (d) => moveComponent(d, id, pos), `drag:${id}`));
store.getState().execute(transaction('Fabric', 'schematic', [(d) => addLink(d, a, b), (d) => addLink(d, c, e)]));
```

- `coalesceKey`: same-key commands within 500 ms merge into one undo entry (drags, nudges, typing).
- Capture ids inside `mutate`, never draft objects: `let id; mutate: (d) => { id = addX(d).id; }`.
- `execute` returns `false` and sets `ui.lastError` if the mutator throws (show it as a toast).
- `undo(editor)` / `redo(editor)` / `canUndo` / `undoLabel` are per editor; history stores Immer patches.
- `replaceProject(p)` clears history, selection and issues; `setProjectMeta` and all `ui` setters are not undoable.

## Shortcuts

```ts
useEffect(() => registerShortcut({ id: 'sch.rotate', keys: 'r', editor: 'schematic', handler: rotate }), []);
```

`keys`: `'mod+z'`, `'f8'`, `'shift+x'`, `'delete'`, or an array of alternatives; `mod` is cmd on mac, ctrl
elsewhere. Editor-scoped shortcuts fire only on their tab and beat global ones; text inputs are skipped unless
`allowInInputs`. The app shell calls `installShortcutListener(window)` once, which also registers mod+z /
mod+shift+z / mod+y undo/redo for the active tab. `formatKeys('mod+z')` gives menu labels.
