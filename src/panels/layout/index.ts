/**
 * Layout-side panels and dialogs. Importing this module registers them with
 * '@/panels/registry' (App.tsx imports it once for the side effect):
 *
 *   dialogs   'update-layout' (F8), 'place-by-rule'
 *   left      Library (racks, trays, accessories, keep-out tool)
 *   right     Inspector, Proposals (back-annotation)
 *   toolbar   Update from schematic / Place by rule / Run DRC
 */
import { registerDialog, registerPanel, registerToolbar } from '@/panels/registry';
import { store } from '@/store';
import { LayoutInspector } from './LayoutInspector';
import { LayoutToolbar } from './LayoutToolbar';
import { LibraryPanel } from './LibraryPanel';
import { PLACE_BY_RULE_DIALOG, PlaceByRuleDialog } from './PlaceByRuleDialog';
import { ProposalsPanel } from './ProposalsPanel';
import { UPDATE_LAYOUT_DIALOG, UpdateLayoutDialog } from './UpdateLayoutDialog';

export { UpdateLayoutDialog, UPDATE_LAYOUT_DIALOG, describeChange } from './UpdateLayoutDialog';
export { PlaceByRuleDialog, PLACE_BY_RULE_DIALOG, type PlaceByRuleDialogData } from './PlaceByRuleDialog';
export { ProposalsPanel, proposalTarget } from './ProposalsPanel';
export { LayoutInspector } from './LayoutInspector';
export { LibraryPanel } from './LibraryPanel';
export { LayoutToolbar } from './LayoutToolbar';
export { run } from './shared';

export const LAYOUT_LIBRARY_PANEL = 'layout.library';
export const LAYOUT_INSPECTOR_PANEL = 'layout.inspector';
export const LAYOUT_PROPOSALS_PANEL = 'layout.proposals';
export const LAYOUT_ACTIONS_TOOLBAR = 'layout.actions';

const proposalsTitle = (n: number): string => (n > 0 ? `Proposals (${n})` : 'Proposals');

let registered = false;

/** Idempotent; called at module load. */
export function registerLayoutPanels(): void {
  if (registered) return;
  registered = true;
  registerDialog({ id: UPDATE_LAYOUT_DIALOG, component: UpdateLayoutDialog });
  registerDialog({ id: PLACE_BY_RULE_DIALOG, component: PlaceByRuleDialog });
  registerPanel({ id: LAYOUT_LIBRARY_PANEL, editor: 'layout', side: 'left', title: 'Library', component: LibraryPanel, order: 20 });
  registerPanel({ id: LAYOUT_INSPECTOR_PANEL, editor: 'layout', side: 'right', title: 'Inspector', component: LayoutInspector, order: 10 });
  const registerProposals = (n: number) =>
    registerPanel({ id: LAYOUT_PROPOSALS_PANEL, editor: 'layout', side: 'right', title: proposalsTitle(n), component: ProposalsPanel, order: 20 });
  registerProposals(store.getState().project.backAnnotations.length);
  // The registry's title is a plain string, so the badge count is kept current by re-registering.
  let last = store.getState().project.backAnnotations.length;
  store.subscribe((s) => {
    const n = s.project.backAnnotations.length;
    if (n !== last) {
      last = n;
      registerProposals(n);
    }
  });
  registerToolbar({ id: LAYOUT_ACTIONS_TOOLBAR, editor: 'layout', component: LayoutToolbar, order: 50 });
}

registerLayoutPanels();
