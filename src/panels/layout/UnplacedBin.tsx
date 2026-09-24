import { useRef, useState } from 'react';
import { layout } from '@/commands';
import { firstFreeSlot } from '@/editors/layout/elevation/geometry';
import { COMPONENT_MIME } from '@/editors/layout/elevation/constants';
import { selectedRackIds } from '@/editors/layout/physicalScene';
import { store, useProject, useProjectIndex, useSelection } from '@/store';
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
  return <div className="flex flex-col gap-1 p-2" data-testid="unplaced-bin">
    <Input aria-label="Search unplaced devices" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search devices…" />
    <p className="text-xs text-fg-muted">{unplaced.length} unplaced · drag to a rack elevation</p>
    {unplaced.filter((c) => `${c.ref} ${c.value ?? ''}`.toLowerCase().includes(query.toLowerCase())).map((c) => <button key={c.id} draggable data-component-id={c.id} className="rounded border border-border bg-panel-2 px-2 py-1 text-left text-xs" onClick={() => store.getState().select({ kind: 'component', id: c.id })} onDragStart={(e) => { e.dataTransfer.setData(COMPONENT_MIME, c.id); e.dataTransfer.effectAllowed = 'move'; }} onDoubleClick={() => {
      const target = destination.current ?? store.getState().ui.layout.elevationRackIds[0];
      if (!target) { toast('Select a destination rack first.'); return; }
      const u = firstFreeSlot(project, target, idx.heightUOf(c));
      if (u === null) { toast('No free U range in this rack.', { tone: 'warning' }); return; }
      run(layout.placeComponent(c.id, target, u));
    }}>{c.ref} <span className="text-fg-muted">{idx.heightUOf(c)}U · {c.value ?? idx.symbolOf(c)?.kind}</span></button>)}
    {!unplaced.length && <p className="text-xs text-fg-muted">All synchronized devices are placed. Use Update from schematic to bring in new devices.</p>}
  </div>;
}
