import { useRef, useState } from 'react';
import { layout } from '@/commands';
import { firstFreeSlot } from '@/editors/layout/elevation/geometry';
import { COMPONENT_MIME } from '@/editors/layout/elevation/constants';
import { selectedRackIds } from '@/editors/layout/physicalScene';
import type { Component } from '@/model/types';
import { store, useProject, useProjectIndex, useSelection } from '@/store';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { toast } from '@/ui/Toast';
import { run } from './shared';

export function UnplacedBin() {
  const project = useProject(), idx = useProjectIndex(), selection = useSelection();
  const [query, setQuery] = useState('');
  const destination = useRef<string>();
  const selectedRack = selectedRackIds(project, selection)[0];
  if (selectedRack) destination.current = selectedRack;
  const unplaced = project.placements.filter((p) => p.rackId === null).flatMap((p) => { const c = idx.component(p.componentId); return c ? [c] : []; });
  // The device becomes its own free-standing patch frame at the next free floor spot: no destination rack needed.
  const ownFrame = (c: Component) => {
    const cmd = layout.placeInNewFrame(c.id);
    if (!run(cmd) || !cmd.result) return;
    const item = { kind: 'rack' as const, id: cmd.result };
    store.getState().select(item);
    store.getState().requestViewport('layout', { kind: 'items', items: [item] });
    toast.ok(`${c.ref} placed as its own frame`);
  };
  const place = (c: Component) => {
    // The last selected rack, else the elevation's; a stale (deleted) destination is skipped.
    const target = [destination.current, store.getState().ui.layout.elevationRackIds[0]].find((id) => id && idx.rack(id));
    if (!target) { ownFrame(c); return; }
    const u = firstFreeSlot(project, target, idx.heightUOf(c));
    if (u === null) { toast('No free U range in this rack.', { tone: 'warning' }); return; }
    run(layout.placeComponent(c.id, target, u));
  };
  return <div className="flex flex-col gap-1 p-2" data-testid="unplaced-bin">
    <Input aria-label="Search unplaced devices" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search devices…" />
    <p className="text-xs text-fg-muted">{unplaced.length} unplaced · drag to a rack elevation, or onto the floor plan to make it its own frame</p>
    {unplaced.filter((c) => `${c.ref} ${c.value ?? ''}`.toLowerCase().includes(query.toLowerCase())).map((c) => <div key={c.id} className="flex items-center gap-1">
      <button draggable data-component-id={c.id} className="min-w-0 flex-1 truncate rounded border border-border bg-panel-2 px-2 py-1 text-left text-xs" title="Drag to a rack elevation or onto the floor · double-click places it" onClick={() => store.getState().select({ kind: 'component', id: c.id })} onDragStart={(e) => { e.dataTransfer.setData(COMPONENT_MIME, c.id); e.dataTransfer.effectAllowed = 'move'; }} onDoubleClick={() => place(c)}>{c.ref} <span className="text-fg-muted">{idx.heightUOf(c)}U · {c.value ?? idx.symbolOf(c)?.kind}</span></button>
      <Button size="sm" className="shrink-0" aria-label={`Place ${c.ref} as its own frame`} title="Place on the floor as its own patch frame" onClick={() => ownFrame(c)}>Own frame</Button>
    </div>)}
    {!unplaced.length && <p className="text-xs text-fg-muted">All synchronized devices are placed. Use Update from schematic to bring in new devices.</p>}
  </div>;
}
