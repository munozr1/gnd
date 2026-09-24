/**
 * Device (component + placement) properties. Ref and model edits do not touch
 * the schematic directly: they create back-annotation proposals (spec: "Ref
 * and model changes made in the layout inspector also flow back"). Rack / U /
 * face edit the placement through moveDevice.
 */
import { useMemo, useState } from 'react';
import { resolveCatalog } from '@/catalog';
import { layout, racksInOrder, uLabel } from '@/commands';
import { compatibleFootprints } from '@/model/schematic';
import { validateFootprintChange, validateRefRename } from '@/model/sync';
import type { BackAnnotation, Face, Id } from '@/model/types';
import { store, useProject, useProjectIndex } from '@/store';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { NumberInput } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { toast } from '@/ui/Toast';
import { Field, ListRow, Note, Section, Stat, TextField, run } from '../shared';

const NONE = 'none';
const UNPLACED = 'unplaced';

const FACES: { value: Face; label: string }[] = [
  { value: 'front', label: 'Front' },
  { value: 'rear', label: 'Rear' },
];

export function DeviceInspector({ componentId }: { componentId: Id }) {
  const project = useProject();
  const idx = useProjectIndex();
  const c = idx.component(componentId);
  const symbol = c ? idx.symbolOf(c) : undefined;
  const footprint = c ? idx.footprintOf(c) : undefined;
  const placement = idx.placement(componentId);
  const placed = !!placement && placement.rackId !== null && placement.uPosition !== null;
  const rack = placement?.rackId ? idx.rack(placement.rackId) : undefined;
  const heightU = c ? idx.heightUOf(c) : 1;
  const racks = useMemo(() => racksInOrder(project), [project]);
  const footprints = useMemo(() => (symbol ? compatibleFootprints(resolveCatalog(project), symbol) : []), [project, symbol]);
  const links = idx.linksOf(componentId);
  const pending = project.backAnnotations.filter(
    (b): b is Extract<BackAnnotation, { kind: 'ref-rename' | 'footprint-change' }> => b.kind !== 'port-swap' && b.componentId === componentId,
  );
  // Target slot while the device is unplaced (committed with the Place button).
  const [pendingRack, setPendingRack] = useState<string>(racks[0]?.id ?? '');
  const [pendingU, setPendingU] = useState(1);
  if (!c) return null;

  const proposeRef = (to: string) => {
    const err = validateRefRename(project, componentId, to);
    if (err) {
      toast.error(err);
      return;
    }
    if (run(layout.proposeRefRename(componentId, to))) toast.info(`Proposed renaming ${c.ref} to ${to.trim()}; accept it under Proposals`);
  };
  const proposeModel = (v: string) => {
    const to = v === NONE ? null : v;
    if (to === c.footprintDefId) return;
    const err = validateFootprintChange(project, componentId, to);
    if (err) {
      toast.error(err);
      return;
    }
    if (run(layout.proposeFootprintChange(componentId, to))) toast.info(`Proposed model change for ${c.ref}; accept it under Proposals`);
  };

  const modelOptions = [
    { value: NONE, label: 'No model' },
    ...footprints.map((f) => ({ value: f.id, label: `${f.model} · ${f.heightU}U` })),
    ...(c.footprintDefId && !footprints.some((f) => f.id === c.footprintDefId)
      ? [{ value: c.footprintDefId, label: footprint?.model ?? c.footprintDefId }]
      : []),
  ];
  const rackOptions = [{ value: UNPLACED, label: 'Unplaced' }, ...racks.map((r) => ({ value: r.id, label: `${r.name} · ${r.heightU}U` }))];
  const pendingRackDef = racks.find((r) => r.id === pendingRack) ?? racks[0];

  return (
    <>
      <Section title={`Device ${c.ref}`}>
        <Field label="Ref">
          <TextField aria-label="Reference" value={c.ref} onCommit={proposeRef} mono />
        </Field>
        <Field label="Model">
          <Select aria-label="Model" value={c.footprintDefId ?? NONE} onValueChange={proposeModel} options={modelOptions} className="w-full" />
        </Field>
        <Stat label="Symbol" value={symbol?.name ?? c.symbolDefId} />
        {c.value && <Stat label="Role" value={c.value} />}
        <Stat label="Height" value={`${heightU}U${footprint ? ` · ${footprint.depthMm} mm deep` : ''}`} />
        {pending.length > 0 && (
          <div className="flex flex-col gap-0.5 pt-1">
            {pending.map((b) => (
              <div key={b.id} className="flex items-center gap-1 text-[11px]">
                <Badge tone="accent">Proposed</Badge>
                <span className="mono min-w-0 flex-1 truncate">
                  {b.kind === 'ref-rename' ? `${b.from} → ${b.to}` : `model → ${b.to === null ? 'none' : (idx.catalog.footprint(b.to)?.model ?? b.to)}`}
                </span>
                <Button size="sm" variant="ghost" onClick={() => run(layout.acceptBackAnnotation(b.id))}>
                  Accept
                </Button>
                <Button size="sm" variant="ghost" onClick={() => run(layout.rejectBackAnnotation(b.id))}>
                  Reject
                </Button>
              </div>
            ))}
          </div>
        )}
        <Note>Ref and model changes are proposed back to the schematic rather than applied here.</Note>
      </Section>
      <Section title="Placement">
        {placed && placement && rack ? (
          <>
            <Field label="Rack">
              <Select
                aria-label="Rack"
                value={rack.id}
                onValueChange={(v) => {
                  if (v === UNPLACED) run(layout.unplaceComponent(componentId));
                  else if (v !== rack.id) run(layout.moveDevice(componentId, v, Math.min(placement.uPosition!, (idx.rack(v)?.heightU ?? 42) - heightU + 1), placement.face));
                }}
                options={rackOptions}
                className="w-full"
              />
            </Field>
            <Field label="U position" hint={uLabel({ bottom: placement.uPosition!, top: placement.uPosition! + heightU - 1 })}>
              <NumberInput
                aria-label="U position"
                value={placement.uPosition!}
                min={1}
                max={Math.max(1, rack.heightU - heightU + 1)}
                decimals={0}
                unit="U"
                onChange={(u) => run(layout.moveDevice(componentId, rack.id, u, placement.face))}
              />
            </Field>
            <Field label="Face">
              <Select aria-label="Face" value={placement.face} onValueChange={(v) => run(layout.setPlacementFace(componentId, v as Face))} options={FACES} className="w-full" />
            </Field>
            <div className="flex gap-1 pt-1">
              <Button size="sm" onClick={() => store.getState().setElevationRacks([rack.id], placement.face)}>
                Show in elevation
              </Button>
              <Button size="sm" onClick={() => run(layout.unplaceComponent(componentId))}>
                Unplace
              </Button>
            </div>
          </>
        ) : (
          <>
            <Note tone="warning">{placement ? 'Unplaced: in the Unplaced bin.' : 'No placement yet: run Update Layout (F8) to bring it into the layout.'}</Note>
            {racks.length === 0 ? (
              <Note>Add a rack from the Library first.</Note>
            ) : (
              <>
                <Field label="Rack">
                  <Select aria-label="Target rack" value={pendingRackDef?.id ?? ''} onValueChange={setPendingRack} options={rackOptions.slice(1)} className="w-full" />
                </Field>
                <Field label="U position">
                  <NumberInput aria-label="Target U" value={pendingU} min={1} max={Math.max(1, (pendingRackDef?.heightU ?? 42) - heightU + 1)} decimals={0} unit="U" onChange={setPendingU} />
                </Field>
                <div>
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!pendingRackDef}
                    onClick={() => pendingRackDef && run(layout.placeComponent(componentId, pendingRackDef.id, pendingU, 'front'))}
                  >
                    Place
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </Section>
      <Section title={`Links (${links.length})`}>
        {links.length === 0 && <Note>No links.</Note>}
        {links.slice(0, 60).map((l) => (
          <ListRow key={l.id} onClick={() => store.getState().select({ kind: 'link', id: l.id })} right={project.routes[l.id] ? 'routed' : 'airwire'}>
            <span className="mono">{idx.linkLabel(l)}</span>
          </ListRow>
        ))}
        {links.length > 60 && <Note>+{links.length - 60} more</Note>}
      </Section>
    </>
  );
}
