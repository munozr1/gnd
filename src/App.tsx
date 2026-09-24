/**
 * Application shell: menu bar, editor tabs, the active editor, the issues
 * drawer and the status bar. Editors own everything inside their tab.
 */
import { LayoutEditor } from '@/editors/layout';
import { SchematicEditor } from '@/editors/schematic';
import { Viewer3D } from '@/editors/viewer3d';
import type { EditorId } from '@/model/types';
import { store, useActiveTab, useStore } from '@/store';
import { EmptyState } from '@/ui/EmptyState';
import { SplitPane } from '@/ui/SplitPane';
import { Tabs, TabsContent } from '@/ui/Tabs';
import { ToastViewport } from '@/ui/Toast';
import { TooltipProvider } from '@/ui/Tooltip';
import '@/panels/layout'; // registers the layout panels, dialogs and toolbar
import '@/panels/library'; // registers the schematic library panel + 'library' / custom-device dialogs
import '@/panels/schematic'; // schematic inspector and hierarchical sheets
import { EditorFrame, RegisteredDialogs } from '@/panels/shell/Docks';
import { EditorTabs } from '@/panels/shell/EditorTabs';
import { IssuesDrawer } from '@/panels/shell/IssuesDrawer';
import { MenuBar } from '@/panels/shell/MenuBar';
import { ProjectPicker } from '@/panels/shell/ProjectPicker';
import { ShortcutsDialog } from '@/panels/shell/ShortcutsDialog';
import { StatusBar } from '@/panels/shell/StatusBar';
import { StatusBarProvider } from '@/panels/shell/StatusBarContext';
import { useAppBootstrap } from '@/panels/shell/useAppBootstrap';
import { useLiveChecks } from '@/panels/shell/useChecks';

const isEditorId = (v: string): v is EditorId => v === 'schematic' || v === 'layout' || v === 'viewer3d';

function AppShell() {
  const { ready } = useAppBootstrap();
  useLiveChecks();
  const activeTab = useActiveTab();
  const drawerOpen = useStore((s) => s.ui.issuesDrawerOpen);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg text-fg">
      <MenuBar />
      <Tabs
        value={activeTab}
        onValueChange={(v) => isEditorId(v) && store.getState().setActiveTab(v)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <EditorTabs />
        <SplitPane direction="vertical" primary="second" defaultSize={220} minSize={96} minSecondarySize={160} collapsed={!drawerOpen}>
          <div className="relative h-full w-full">
            {ready ? (
              <>
                <TabsContent value="schematic" className="h-full">
                  <EditorFrame editor="schematic">
                    <SchematicEditor />
                  </EditorFrame>
                </TabsContent>
                <TabsContent value="layout" className="h-full">
                  <EditorFrame editor="layout">
                    <LayoutEditor />
                  </EditorFrame>
                </TabsContent>
                <TabsContent value="viewer3d" className="h-full">
                  <EditorFrame editor="viewer3d">
                    <Viewer3D />
                  </EditorFrame>
                </TabsContent>
              </>
            ) : (
              <EmptyState title="Loading project…" />
            )}
          </div>
          <IssuesDrawer />
        </SplitPane>
      </Tabs>
      <StatusBar />
      <ProjectPicker />
      <ShortcutsDialog />
      <RegisteredDialogs />
    </div>
  );
}

export function App() {
  return (
    <TooltipProvider>
      <StatusBarProvider>
        <AppShell />
        <ToastViewport />
      </StatusBarProvider>
    </TooltipProvider>
  );
}
