/** Schematic | Layout | 3D tab strip with the sync badge and shell actions on the right. */
import { store, useIssues, useStore } from '@/store';
import { formatKeys } from '@/store/shortcuts';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { Icon } from '@/ui/icons';
import { TabsList, TabsTrigger } from '@/ui/Tabs';
import { Tooltip } from '@/ui/Tooltip';
import { SHELL_KEYS } from './shellShortcuts';
import { useChecks } from './useChecks';
import { useOutOfSync } from './useOutOfSync';

export function EditorTabs() {
  const outOfSync = useOutOfSync();
  const drawerOpen = useStore((s) => s.ui.issuesDrawerOpen);
  const issueCount = useIssues('erc').length + useIssues('drc').length;
  const { runChecks, running } = useChecks();
  const s = () => store.getState();

  return (
    <TabsList aria-label="Editors">
      <TabsTrigger value="schematic">Schematic</TabsTrigger>
      <TabsTrigger value="layout">
        Layout
        {outOfSync && (
          <Badge tone="warning" title="The schematic has changes the layout has not applied (F8)">
            Out of sync
          </Badge>
        )}
      </TabsTrigger>
      <TabsTrigger value="viewer3d">3D</TabsTrigger>
      <div className="flex-1" />
      <div className="flex items-center gap-0.5 py-0.5">
        <Tooltip content="Run ERC and DRC" shortcut={formatKeys(SHELL_KEYS.runErc)}>
          <Button variant="ghost" disabled={running} onClick={() => void runChecks()}>
            <Icon name="play" size={12} />
            Checks
          </Button>
        </Tooltip>
        <Tooltip content="Update Layout from Schematic" shortcut={formatKeys(SHELL_KEYS.updateLayout)}>
          <Button variant="ghost" onClick={() => s().openDialog('update-layout')}>
            <Icon name="sync" size={12} />
            Update Layout
          </Button>
        </Tooltip>
        <IconButton
          label={`Issues (${issueCount})`}
          shortcut={formatKeys(SHELL_KEYS.issues)}
          icon="list"
          active={drawerOpen}
          onClick={() => s().toggleIssuesDrawer()}
        />
      </div>
    </TabsList>
  );
}
