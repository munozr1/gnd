/**
 * Layout toolbar actions: Update from schematic (F8), Place by rule, Run DRC.
 * The floor plan's own tool strip (select / route / measure ...) registers
 * separately; this one carries the sync and placement verbs.
 */
import { runChecks } from '@/panels/shell/useChecks';
import { SHELL_KEYS } from '@/panels/shell/shellShortcuts';
import { useOutOfSync } from '@/panels/shell/useOutOfSync';
import { store, useProject } from '@/store';
import { formatKeys } from '@/store/shortcuts';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/icons';
import { Tooltip } from '@/ui/Tooltip';
import { PLACE_BY_RULE_DIALOG } from './PlaceByRuleDialog';
import { UPDATE_LAYOUT_DIALOG } from './UpdateLayoutDialog';

export function LayoutToolbar() {
  const outOfSync = useOutOfSync();
  const pending = useProject().backAnnotations.length;
  const s = () => store.getState();
  return (
    <div className="flex items-center gap-0.5" data-testid="layout-toolbar">
      <Tooltip content="Update Layout from Schematic" shortcut={formatKeys(SHELL_KEYS.updateLayout)}>
        <Button variant="ghost" onClick={() => s().openDialog(UPDATE_LAYOUT_DIALOG)} data-testid="tb-update-layout">
          <Icon name="sync" size={12} />
          Update from schematic
          {outOfSync && <Badge tone="warning">Out of sync</Badge>}
        </Button>
      </Tooltip>
      <Tooltip content="Place matching devices into racks by rule">
        <Button variant="ghost" onClick={() => s().openDialog(PLACE_BY_RULE_DIALOG)} data-testid="tb-place-by-rule">
          <Icon name="list" size={12} />
          Place by rule…
        </Button>
      </Tooltip>
      <Tooltip content="Run DRC" shortcut={formatKeys(SHELL_KEYS.runDrc)}>
        <Button
          variant="ghost"
          onClick={() => {
            s().setIssuesDrawerOpen(true);
            void runChecks(['drc'], { notify: true });
          }}
          data-testid="tb-run-drc"
        >
          <Icon name="play" size={12} />
          Run DRC
        </Button>
      </Tooltip>
      {pending > 0 && (
        <Badge tone="accent" title="Back-annotation proposals awaiting acceptance">
          {pending} proposal{pending === 1 ? '' : 's'}
        </Badge>
      )}
    </div>
  );
}
