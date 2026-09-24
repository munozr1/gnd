import { useEffect } from 'react';
import { store, useLayoutUi, useProject } from '@/store';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Select } from '@/ui/Select';
import { SplitPane } from '@/ui/SplitPane';
import type { RoutingLayer } from '@/model/types';
import { FloorView } from './FloorView';
import { ElevationView } from './elevation';
import { selectedRackIds } from './physicalScene';

export function LayoutEditor() {
  const ui = useLayoutUi(), project = useProject();
  useEffect(() => {
    if (ui.viewportRequest?.kind === 'items' && ui.viewportRequest.items.some((i) => i.kind === 'component')) {
      const ids = selectedRackIds(project, ui.viewportRequest.items);
      if (ids.length) store.getState().patchLayout({ view: ui.view === 'floor' ? 'elevation' : ui.view, elevationRackIds: ids });
    }
  }, [ui.viewportRequest, project]);
  return <div data-editor="layout" className="flex h-full min-h-0 flex-col">
    <div role="toolbar" aria-label="Layout views" className="flex min-h-7 shrink-0 flex-wrap items-center gap-1 border-b border-border bg-panel px-1">
      {(['floor', 'elevation', 'split'] as const).map((view) => <Button key={view} active={ui.view === view} onClick={() => store.getState().setLayoutView(view)}>{view === 'floor' ? 'Floor' : view === 'elevation' ? 'Elevation' : 'Split'}</Button>)}
      <Select aria-label="Airwires" value={ui.ratsnest} onValueChange={(v) => store.getState().setRatsnestMode(v as typeof ui.ratsnest)} options={[{ value: 'all', label: 'All airwires' }, { value: 'selection', label: 'Selected airwires' }, { value: 'none', label: 'Hide airwires' }]} />
      <Select aria-label="Active routing layer" value={ui.activeLayer} onValueChange={(v) => store.getState().setActiveLayer(v as RoutingLayer)} options={['overhead', 'underfloor', 'in-rack'].map((v) => ({ value: v, label: v }))} />
      {(['overhead', 'underfloor', 'in-rack'] as const).map((layer) => <Checkbox key={layer} label={layer} checked={ui.visibleLayers[layer]} onCheckedChange={(v) => store.getState().toggleLayerVisible(layer, v === true)} />)}
    </div>
    <div className="min-h-0 flex-1">{ui.view === 'floor' ? <FloorView /> : ui.view === 'elevation' ? <ElevationView /> : <SplitPane className="h-full" direction="vertical" defaultSize={300}><FloorView /><ElevationView /></SplitPane>}</div>
  </div>;
}
