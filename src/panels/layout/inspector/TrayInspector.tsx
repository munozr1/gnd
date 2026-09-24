/**
 * Tray properties: name, kind / cross-section from a TrayDef, elevation
 * (layer follows its sign), fill %, the fittings list (type + rack picker for
 * waterfalls) and the cables riding it.
 */
import { useMemo, useState } from 'react';
import { catalogIndex } from '@/catalog';
import { layout, racksInOrder } from '@/commands';
import { polylineLength } from '@/model/geometry';
import { cablesInTray, trayFill } from '@/model/routing';
import type { Id, TrayDef, TrayFitting, TrayFittingType } from '@/model/types';
import { command, store, useProject, useProjectIndex } from '@/store';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { NumberInput } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { Field, ListRow, Note, Section, Stat, TextField, fmtM, fmtPct, run } from '../shared';

const FITTING_TYPES: TrayFittingType[] = ['elbow', 'tee', 'cross', 'reducer', 'waterfall'];
const NO_RACK = 'none';

/** Swap a tray's kind and cross-section for another catalog def. */
export const setTrayDef = (trayId: Id, def: TrayDef) =>
  command(`Set tray to ${def.name}`, 'layout', (d) => {
    const t = d.trays.find((x) => x.id === trayId);
    if (!t) throw new Error(`Tray not found: ${trayId}`);
    t.kind = def.kind;
    t.widthMm = def.widthMm;
    t.depthMm = def.depthMm;
  });

/** Edit one fitting in place (type / rack). */
export const setTrayFitting = (trayId: Id, index: number, patch: Partial<TrayFitting>) =>
  command('Edit fitting', 'layout', (d) => {
    const t = d.trays.find((x) => x.id === trayId);
    const f = t?.fittings[index];
    if (!t || !f) throw new Error(`Tray has no fitting #${index}`);
    if (patch.type !== undefined) f.type = patch.type;
    if (patch.at !== undefined) f.at = { x: patch.at.x, y: patch.at.y };
    if ('rackId' in patch) {
      if (patch.rackId === undefined) delete f.rackId;
      else {
        if (!d.racks.some((r) => r.id === patch.rackId)) throw new Error(`Rack not found: ${patch.rackId}`);
        f.rackId = patch.rackId;
      }
    }
  });

export function TrayInspector({ trayId }: { trayId: Id }) {
  const project = useProject();
  const idx = useProjectIndex();
  const tray = project.trays.find((t) => t.id === trayId);
  const defs = catalogIndex(project).catalog.trays;
  const racks = useMemo(() => racksInOrder(project), [project]);
  const fill = useMemo(() => trayFill(project, trayId), [project, trayId]);
  const cables = useMemo(() => cablesInTray(project, trayId), [project, trayId]);
  const [newType, setNewType] = useState<TrayFittingType>('waterfall');
  const [newRack, setNewRack] = useState<string>(NO_RACK);
  if (!tray) return null;

  const defValue = defs.find((d) => d.kind === tray.kind && d.widthMm === tray.widthMm && d.depthMm === tray.depthMm)?.id ?? 'custom';
  const rackOptions = [{ value: NO_RACK, label: 'No rack' }, ...racks.map((r) => ({ value: r.id, label: r.name }))];
  const lengthM = polylineLength(tray.points) / 1000;
  const fillTone = fill && fill.fraction > project.settings.trayFillWarn ? 'text-warning' : 'text-fg';

  const addFitting = () => {
    const at = tray.points[tray.points.length - 1] ?? { x: 0, y: 0 };
    const fitting: TrayFitting = { at, type: newType, ...(newRack !== NO_RACK ? { rackId: newRack } : {}) };
    run(layout.addTrayFitting(trayId, fitting));
  };

  return (
    <>
      <Section title={`Tray ${tray.name ?? ''}`}>
        <Field label="Name">
          <TextField aria-label="Tray name" value={tray.name ?? ''} onCommit={(v) => run(layout.setTrayParams(trayId, { name: v }))} />
        </Field>
        <Field label="Type">
          <Select
            aria-label="Tray type"
            value={defValue}
            onValueChange={(v) => {
              const def = defs.find((d) => d.id === v);
              if (def) run(setTrayDef(trayId, def));
            }}
            options={[
              ...defs.map((d) => ({ value: d.id, label: d.name })),
              ...(defValue === 'custom' ? [{ value: 'custom', label: `Custom ${tray.kind} ${tray.widthMm}×${tray.depthMm}`, disabled: true }] : []),
            ]}
            className="w-full"
          />
        </Field>
        <Field label="Width">
          <NumberInput aria-label="Tray width" value={tray.widthMm} min={10} unit="mm" decimals={0} step={10} onChange={(widthMm) => run(layout.setTrayParams(trayId, { widthMm }))} />
        </Field>
        <Field label="Depth">
          <NumberInput aria-label="Tray depth" value={tray.depthMm} min={10} unit="mm" decimals={0} step={10} onChange={(depthMm) => run(layout.setTrayParams(trayId, { depthMm }))} />
        </Field>
        <Field label="Elevation" hint={tray.layer}>
          <NumberInput aria-label="Tray elevation" value={tray.elevationMm} unit="mm" decimals={0} step={50} onChange={(elevationMm) => run(layout.setTrayParams(trayId, { elevationMm }))} />
        </Field>
        <Stat label="Kind" value={`${tray.kind} · accepts ${defs.find((d) => d.kind === tray.kind)?.accepts.join(' + ') ?? '?'}`} />
        <Stat label="Run" value={`${fmtM(lengthM)} · ${tray.points.length} points`} />
        <Stat
          label="Fill"
          value={
            fill ? (
              <span className={fillTone}>
                {fmtPct(fill.fraction)} · {fill.cableCount} cable{fill.cableCount === 1 ? '' : 's'} · {Math.round(fill.usedMm2)} / {Math.round(fill.areaMm2)} mm²
              </span>
            ) : (
              '—'
            )
          }
        />
        {fill && (
          <div className="h-1.5 w-full overflow-hidden rounded bg-panel-2" aria-hidden>
            <div
              className={fill.fraction > project.settings.trayFillWarn ? 'h-full bg-warning' : 'h-full bg-accent'}
              style={{ width: `${Math.min(100, fill.fraction * 100)}%` }}
            />
          </div>
        )}
        <div className="pt-1">
          <Button size="sm" variant="danger" onClick={() => run(layout.deleteTray(trayId))}>
            Delete tray
          </Button>
        </div>
      </Section>
      <Section title={`Fittings (${tray.fittings.length})`}>
        {tray.fittings.length === 0 && <Note>No fittings. A cable can only drop into a rack at a waterfall over that rack.</Note>}
        {tray.fittings.map((f, i) => (
          <div key={i} className="flex items-center gap-1" data-fitting={i}>
            <Select
              aria-label={`Fitting ${i + 1} type`}
              value={f.type}
              onValueChange={(v) => run(setTrayFitting(trayId, i, { type: v as TrayFittingType }))}
              options={FITTING_TYPES.map((t) => ({ value: t, label: t }))}
              className="w-24"
            />
            <Select
              aria-label={`Fitting ${i + 1} rack`}
              value={f.rackId ?? NO_RACK}
              onValueChange={(v) => run(setTrayFitting(trayId, i, { rackId: v === NO_RACK ? undefined : v }))}
              options={rackOptions}
              className="min-w-0 flex-1"
            />
            <span className="mono shrink-0 text-[10px] text-fg-muted" title="Position (mm)">
              {Math.round(f.at.x)},{Math.round(f.at.y)}
            </span>
            <IconButton label="Remove fitting" icon="trash" onClick={() => run(layout.removeTrayFitting(trayId, i))} />
          </div>
        ))}
        <div className="flex items-center gap-1 rounded border border-border bg-bg/40 p-1">
          <Select aria-label="New fitting type" value={newType} onValueChange={(v) => setNewType(v as TrayFittingType)} options={FITTING_TYPES.map((t) => ({ value: t, label: t }))} className="w-24" />
          <Select aria-label="New fitting rack" value={newRack} onValueChange={setNewRack} options={rackOptions} className="min-w-0 flex-1" />
          <Button size="sm" variant="primary" onClick={addFitting}>
            Add
          </Button>
        </div>
      </Section>
      <Section title={`Cables (${cables.length})`}>
        {cables.length === 0 && <Note>No routed cable rides this tray yet.</Note>}
        {cables.slice(0, 60).map((id) => {
          const link = idx.link(id);
          return (
            <ListRow key={id} onClick={() => store.getState().select({ kind: 'link', id })} right={link ? (idx.cableOf(link)?.media ?? '') : ''}>
              <span className="mono">{link ? idx.linkLabel(link) : id}</span>
            </ListRow>
          );
        })}
        {cables.length > 60 && <Note>+{cables.length - 60} more</Note>}
      </Section>
    </>
  );
}
