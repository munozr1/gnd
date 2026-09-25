/**
 * Right-dock inspector for a selected cable instance: label, definition
 * summary, installed length, a legs table (plug / unplug / auto-fill) and
 * delete. Rendered by the schematic Inspector panel while a cable is selected.
 */
import { useMemo } from 'react';
import * as commands from '@/commands';
import { nextPortAfter, resolveCableOf, unassignedLegs } from '@/model/cables';
import { CommitInput, execute, Field, Readout, Section } from '@/panels/schematic/common';
import { store, useProject, useSchematicUi, useSelection } from '@/store';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { NumberInput } from '@/ui/Input';
import { toast } from '@/ui/Toast';
import { autoFillCurrent, cableById, finishCabling, legRows, resumeCabling, unplugAt } from './cabling';

export function CableInspector() {
  const project = useProject();
  const selection = useSelection();
  const cabling = useSchematicUi().cabling;
  const item = selection.length === 1 && selection[0]?.kind === 'cable' ? selection[0] : undefined;
  const cable = item ? cableById(project, item.id) : undefined;
  const rows = useMemo(() => (cable ? legRows(project, cable) : []), [project, cable]);
  if (!cable) return <Section title="Cable"><p className="text-xs text-fg-muted">Select one cable to edit it.</p></Section>;
  const resolved = resolveCableOf(project, cable);
  const unassigned = cable.plugs.filter((p) => p.componentId === null).length;
  const autoFill = (side: 'A' | 'B') => {
    const plugged = rows.filter((r) => r.side === side && r.portRef);
    const last = plugged[plugged.length - 1]?.portRef;
    const next = last && nextPortAfter(project, last);
    if (!next) {
      resumeCabling(cable.id, side, unassignedLegs(cable, side)[0] ?? 0);
      return toast(`Shift+click the first port for side ${side} on the schematic to auto-fill`, { tone: 'info' });
    }
    resumeCabling(cable.id, side, unassignedLegs(cable, side)[0] ?? 0);
    autoFillCurrent(next);
  };
  return (
    <div className="overflow-auto" data-testid="cable-inspector">
      <Section title="Cable" actions={unassigned > 0 ? <Badge tone="warning">{unassigned} unassigned</Badge> : <Badge tone="ok">connected</Badge>}>
        <Field label="Label"><CommitInput aria-label="Cable label" value={cable.label} onCommit={(v) => execute(commands.setCableLabel(cable.id, v))} validate={(v) => (v ? null : 'Label is required')} /></Field>
        <Readout label="Definition">{resolved?.displayName ?? cable.cableDefId}</Readout>
        <Readout label="Summary">{resolved?.summary ?? '—'}</Readout>
        <Field label="Length" hint="Installed length; blank uses the routed estimate.">
          <NumberInput aria-label="Cable length" value={cable.lengthM ?? 0} min={0} step={0.5} unit="m" decimals={2} onChange={(v) => execute(commands.setCableLength(cable.id, v > 0 ? v : undefined))} />
        </Field>
        <Readout label="Links">{project.links.filter((l) => l.cableId === cable.id).length} of {resolved?.channels ?? '?'} channels</Readout>
        <div className="flex flex-wrap gap-1">
          {cabling?.cableId === cable.id
            ? <Button onClick={finishCabling}>Finish connecting</Button>
            : <Button onClick={() => { const next = cable.plugs.find((p) => p.componentId === null); resumeCabling(cable.id, next?.side ?? 'A', next?.leg ?? 0); }}>Continue connecting</Button>}
          <Button variant="danger" onClick={() => { execute(commands.deleteCable(cable.id)); store.getState().clearSelection(); }}>Delete cable</Button>
        </div>
      </Section>
      {(['A', 'B'] as const).map((side) => (
        <Section key={side} title={`Side ${side} · ${rows.find((r) => r.side === side)?.connector ?? ''}`} actions={unassignedLegs(cable, side).length > 0 && <Button variant="ghost" onClick={() => autoFill(side)}>Auto-fill</Button>}>
          <div className="flex flex-col" role="table" aria-label={`Side ${side} legs`}>
            {rows.filter((r) => r.side === side).map((r) => {
              const current = cabling?.cableId === cable.id && cabling.side === r.side && cabling.leg === r.leg;
              return (
                <div key={r.leg} role="row" className={cn('flex h-6 items-center gap-2 border-b border-border last:border-b-0', current && 'bg-accent/15')}>
                  <span className="w-6 shrink-0 text-[12px] text-fg-muted">{r.label}</span>
                  {r.portRef
                    ? <Button variant="ghost" className="min-w-0 flex-1 justify-start truncate" onClick={() => store.getState().revealSelection([{ kind: 'component', id: r.portRef!.componentId }], 'schematic')}>{r.port}</Button>
                    : <span className="min-w-0 flex-1 truncate text-fg-muted">—</span>}
                  {r.portRef
                    ? <Button size="sm" variant="ghost" aria-label={`Unplug leg ${r.side}${r.leg + 1}`} onClick={() => unplugAt(cable.id, r.side, r.leg)}>Unplug</Button>
                    : <Button size="sm" variant="ghost" aria-label={`Plug leg ${r.side}${r.leg + 1}`} onClick={() => resumeCabling(cable.id, r.side, r.leg)}>Plug…</Button>}
                </div>
              );
            })}
          </div>
        </Section>
      ))}
    </div>
  );
}
