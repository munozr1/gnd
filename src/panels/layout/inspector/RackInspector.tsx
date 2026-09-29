/**
 * Rack properties: name, row, rotation, size (from a RackDef), position, the
 * accessories editor (vertical / horizontal managers, fiber enclosures, top
 * entries) and the devices it holds (click to cross-probe).
 */
import { useMemo, useState } from 'react';
import { catalogIndex } from '@/catalog';
import { isPatchFrame, layout, uLabel } from '@/commands';
import type { AccessoryDef, Face, Id, Rack, RackAccessory, Rotation, Side } from '@/model/types';
import { command, store, useProject, useProjectIndex } from '@/store';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { NumberInput } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { Field, ListRow, Note, Section, Stat, TextField, run } from '../shared';

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

export function describeAccessory(a: RackAccessory): string {
  switch (a.type) {
    case 'vcm':
      return `Vertical manager · ${a.side ?? 'left'}${a.widthMm ? ` · ${a.widthMm} mm` : ''}${a.face ? ` · ${a.face}` : ''}`;
    case 'hcm':
      return `Horizontal manager · ${a.heightU ?? 1}U at U${a.uPosition ?? '?'}${a.face ? ` · ${a.face}` : ''}`;
    case 'fiber-enclosure':
      return `Fiber enclosure · ${a.heightU ?? 1}U at U${a.uPosition ?? '?'}`;
    case 'top-entry':
      return `Top entry · ${a.side ?? 'center'}${a.face ? ` · ${a.face}` : ''}`;
  }
}

/** Change a rack's frame size to a catalog def (devices above the new top are flagged by DRC). */
export const setRackSize = (rackId: Id, def: { heightU: number; widthMm: number; depthMm: number }) =>
  command('Set rack size', 'layout', (d) => {
    const r = d.racks.find((x) => x.id === rackId);
    if (!r) throw new Error(`Rack not found: ${rackId}`);
    r.heightU = def.heightU;
    r.widthMm = def.widthMm;
    r.depthMm = def.depthMm;
  });

function AddAccessory({ rack }: { rack: Rack }) {
  const project = useProject();
  const defs = catalogIndex(project).catalog.accessories;
  const [defId, setDefId] = useState(defs[0]?.id ?? '');
  const [side, setSide] = useState<Side | 'center'>('left');
  const [face, setFace] = useState<Face | 'any'>('any');
  const [u, setU] = useState(1);
  const def: AccessoryDef | undefined = defs.find((x) => x.id === defId);
  const sided = def?.type === 'vcm' || def?.type === 'top-entry';
  const slotted = def?.type === 'hcm' || def?.type === 'fiber-enclosure';

  const add = () => {
    if (!def) return;
    const opts: Parameters<typeof layout.addAccessory>[2] = {};
    if (sided) opts.side = def.type === 'vcm' && side === 'center' ? 'left' : side;
    if (face !== 'any') opts.face = face;
    if (slotted) opts.uPosition = u;
    run(layout.addAccessory(rack.id, def, opts));
  };

  return (
    <div className="flex flex-col gap-1 rounded border border-border bg-bg/40 p-1">
      <Select aria-label="Accessory" value={defId} onValueChange={setDefId} options={defs.map((d) => ({ value: d.id, label: d.name }))} className="w-full" />
      <div className="flex items-center gap-1">
        {sided && (
          <Select
            aria-label="Side"
            value={side}
            onValueChange={(v) => setSide(v as Side | 'center')}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
              ...(def?.type === 'top-entry' ? [{ value: 'center', label: 'Center' }] : []),
            ]}
            className="flex-1"
          />
        )}
        {slotted && <NumberInput aria-label="U position" value={u} min={1} max={rack.heightU} decimals={0} unit="U" onChange={setU} className="w-20" />}
        <Select
          aria-label="Face"
          value={face}
          onValueChange={(v) => setFace(v as Face | 'any')}
          options={[
            { value: 'any', label: 'Any face' },
            { value: 'front', label: 'Front' },
            { value: 'rear', label: 'Rear' },
          ]}
          className="flex-1"
        />
        <Button variant="primary" size="sm" disabled={!def} onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
}

export function RackInspector({ rackId }: { rackId: Id }) {
  const project = useProject();
  const idx = useProjectIndex();
  const rack = idx.rack(rackId);
  const rackDefs = catalogIndex(project).catalog.racks;
  const accessories = useMemo(() => project.accessories.filter((a) => a.rackId === rackId), [project.accessories, rackId]);
  const devices = useMemo(() => {
    if (!rack) return [];
    return idx
      .componentsInRack(rackId)
      .map((c) => ({ c, u: idx.placement(c.id)?.uPosition ?? 0, h: idx.heightUOf(c) }))
      .sort((a, b) => b.u - a.u);
  }, [idx, rack, rackId]);
  if (!rack) return null;

  const sizeValue = rackDefs.find((d) => d.heightU === rack.heightU && d.widthMm === rack.widthMm && d.depthMm === rack.depthMm)?.id ?? 'custom';
  const usedU = devices.reduce((n, d) => n + d.h, 0);

  return (
    <>
      <Section title={`Rack ${rack.name}`}>
        <Field label="Name">
          <TextField aria-label="Rack name" value={rack.name} onCommit={(v) => run(layout.renameRack(rackId, v))} mono />
        </Field>
        {isPatchFrame(rack) && (
          <Stat
            label="Kind"
            value={
              <span className="inline-flex items-center gap-1">
                <Badge tone="warning">Patch frame</Badge>
                <span className="text-fg-muted">free-standing</span>
              </span>
            }
          />
        )}
        <Field label="Row">
          <TextField aria-label="Rack row" value={rack.row ?? ''} placeholder="e.g. A" onCommit={(v) => run(layout.setRackRow(rackId, v || undefined))} />
        </Field>
        <Field label="Rotation">
          <Select
            aria-label="Rotation"
            value={String(rack.rotationDeg)}
            onValueChange={(v) => {
              const target = Number(v) as Rotation;
              const steps = (((target - rack.rotationDeg) / 90) % 4 + 4) % 4;
              if (steps) run(layout.rotateRack(rackId, steps));
            }}
            options={ROTATIONS.map((r) => ({ value: String(r), label: `${r}°` }))}
            className="w-full"
          />
        </Field>
        <Field label="Size">
          <Select
            aria-label="Rack size"
            value={sizeValue}
            onValueChange={(v) => {
              const def = rackDefs.find((d) => d.id === v);
              if (def) run(setRackSize(rackId, def));
            }}
            options={[
              ...rackDefs.map((d) => ({ value: d.id, label: `${d.name} · ${d.widthMm}×${d.depthMm}` })),
              ...(sizeValue === 'custom' ? [{ value: 'custom', label: `Custom ${rack.heightU}U · ${rack.widthMm}×${rack.depthMm}`, disabled: true }] : []),
            ]}
            className="w-full"
          />
        </Field>
        <Field label="Position">
          <NumberInput aria-label="Rack x" value={rack.pos.x} unit="mm" decimals={0} step={100} onChange={(x) => run(layout.moveRacks([rackId], { x: x - rack.pos.x, y: 0 }))} />
          <NumberInput aria-label="Rack y" value={rack.pos.y} unit="mm" decimals={0} step={100} onChange={(y) => run(layout.moveRacks([rackId], { x: 0, y: y - rack.pos.y }))} />
        </Field>
        <Stat label="Capacity" value={`${usedU} / ${rack.heightU}U used · ${devices.length} device${devices.length === 1 ? '' : 's'}`} />
        <div className="flex gap-1 pt-1">
          <Button size="sm" onClick={() => store.getState().setElevationRacks([rackId])}>
            Show elevation
          </Button>
          <Button size="sm" variant="danger" onClick={() => run(layout.deleteRacks(rackId))}>
            Delete rack
          </Button>
        </div>
      </Section>
      <Section title={`Accessories (${accessories.length})`}>
        {accessories.length === 0 && <Note>No cable managers or entries yet. Cables need a vertical manager on the side they use and a top entry to leave the rack.</Note>}
        {accessories.map((a) => (
          <div key={a.id} className="-mx-1 flex items-center gap-1" data-accessory-id={a.id}>
            <ListRow onClick={() => store.getState().select({ kind: 'accessory', id: a.id })}>{describeAccessory(a)}</ListRow>
            <IconButton label="Remove accessory" icon="trash" onClick={() => run(layout.removeAccessory(a.id))} />
          </div>
        ))}
        <AddAccessory rack={rack} />
      </Section>
      <Section title={`Devices (${devices.length})`}>
        {devices.length === 0 && <Note>Empty. Drag devices from the Unplaced bin or use Place by rule.</Note>}
        {devices.slice(0, 80).map(({ c, u, h }) => (
          <ListRow key={c.id} onClick={() => store.getState().select({ kind: 'component', id: c.id })} right={uLabel({ bottom: u, top: u + h - 1 })}>
            <span className="mono">{c.ref}</span>
            <span className="ml-2 text-[11px] text-fg-muted">{idx.footprintOf(c)?.model ?? 'no model'}</span>
          </ListRow>
        ))}
        {devices.length > 80 && <Note>+{devices.length - 80} more</Note>}
      </Section>
    </>
  );
}
