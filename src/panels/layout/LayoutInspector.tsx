/**
 * Right-dock inspector for the layout editor: shows the properties of the
 * primary selected item (rack, device, cable/route, tray, waypoint, keep-out,
 * accessory) or the room when nothing is selected.
 */
import { useMemo } from 'react';
import { layout } from '@/commands';
import type { SelectionItem } from '@/model/types';
import { useProjectIndex, useSelection } from '@/store';
import { Badge } from '@/ui/Badge';
import { AccessoryInspector } from './inspector/AccessoryInspector';
import { DeviceInspector } from './inspector/DeviceInspector';
import { KeepoutInspector } from './inspector/KeepoutInspector';
import { RackInspector } from './inspector/RackInspector';
import { RoomInspector } from './inspector/RoomInspector';
import { RouteInspector } from './inspector/RouteInspector';
import { TrayInspector } from './inspector/TrayInspector';
import { WaypointInspector } from './inspector/WaypointInspector';
import { Field, Note, Section, TextField, run } from './shared';

const KIND_LABEL: Record<SelectionItem['kind'], string> = {
  component: 'device',
  link: 'cable',
  rack: 'rack',
  tray: 'tray',
  waypoint: 'waypoint',
  sheet: 'sheet',
  keepout: 'keep-out',
  accessory: 'accessory',
  cable: 'cable',
};

function MultiSelection({ selection }: { selection: readonly SelectionItem[] }) {
  const idx = useProjectIndex();
  const counts = useMemo(() => {
    const m = new Map<SelectionItem['kind'], number>();
    for (const s of selection) m.set(s.kind, (m.get(s.kind) ?? 0) + 1);
    return [...m.entries()];
  }, [selection]);
  const rackIds = selection.filter((s): s is { kind: 'rack'; id: string } => s.kind === 'rack').map((s) => s.id);
  const allRacks = rackIds.length === selection.length;
  const rows = new Set(rackIds.map((id) => idx.rack(id)?.row ?? ''));
  const linkIds = selection.filter((s): s is { kind: 'link'; id: string } => s.kind === 'link').map((s) => s.id);
  return (
    <Section title={`${selection.length} items selected`}>
      <div className="flex flex-wrap gap-1">
        {counts.map(([kind, n]) => (
          <Badge key={kind}>
            {n} {KIND_LABEL[kind]}
            {n === 1 ? '' : 's'}
          </Badge>
        ))}
      </div>
      {allRacks && (
        <Field label="Row">
          <TextField
            aria-label="Rack row"
            value={rows.size === 1 ? [...rows][0]! : ''}
            placeholder={rows.size > 1 ? 'mixed' : 'e.g. A'}
            onCommit={(v) => run(layout.setRackRow(rackIds, v || undefined))}
          />
        </Field>
      )}
      {linkIds.length === selection.length && (
        <Note>
          {linkIds.length} cables: use the context menu on the floor plan to pin, unpin or unroute them together.
        </Note>
      )}
      {!allRacks && linkIds.length !== selection.length && <Note>Select a single item to edit its properties.</Note>}
    </Section>
  );
}

export function LayoutInspector() {
  const selection = useSelection();
  const primary = selection[0];
  let body: React.ReactNode;
  if (!primary) body = <RoomInspector />;
  else if (selection.length > 1) body = <MultiSelection selection={selection} />;
  else {
    switch (primary.kind) {
      case 'rack':
        body = <RackInspector rackId={primary.id} />;
        break;
      case 'component':
        body = <DeviceInspector componentId={primary.id} />;
        break;
      case 'link':
        body = <RouteInspector linkId={primary.id} />;
        break;
      case 'cable':
        // An installed cable's route is its jacket, keyed by the cable id.
        body = <RouteInspector linkId={primary.id} />;
        break;
      case 'tray':
        body = <TrayInspector trayId={primary.id} />;
        break;
      case 'waypoint':
        body = <WaypointInspector routeId={primary.routeId} segmentIndex={primary.segmentIndex} waypointId={primary.waypointId} />;
        break;
      case 'keepout':
        body = <KeepoutInspector keepoutId={primary.id} />;
        break;
      case 'accessory':
        body = <AccessoryInspector accessoryId={primary.id} />;
        break;
      case 'sheet':
        body = <RoomInspector />;
        break;
    }
  }
  return (
    <div className="flex flex-col" data-testid="layout-inspector" data-kind={primary?.kind ?? 'room'}>
      {body}
    </div>
  );
}
