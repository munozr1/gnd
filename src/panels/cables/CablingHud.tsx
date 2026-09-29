/**
 * Floating head-up display over the schematic while a cable is being
 * connected: the definition summary, one row per leg (click to make it the
 * current leg, Unplug), Auto-fill for the current side and Finish. Idle, it
 * shrinks to a "Connect cable…" picker so the flow can start without the
 * library.
 */
import { useMemo } from 'react';
import { nextPortAfter, resolveCableOf, unassignedLegs } from '@/model/cables';
import { useProject, useSchematicUi } from '@/store';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { Select } from '@/ui/Select';
import { toast } from '@/ui/Toast';
import { autoFillCurrent, cableById, connectableCableDefs, finishCabling, legRows, resumeCabling, startCabling, unplugAt } from './cabling';

const PICK = '__pick__';

function ConnectPicker() {
  const project = useProject();
  // Catalog name first; the derived display name disambiguates legacy names ('MPO breakout') from the seeds.
  const options = useMemo(() => connectableCableDefs(project).map(({ def, resolved }) => ({ value: def.id, label: def.name === resolved.displayName ? def.name : `${def.name} · ${resolved.displayName}` })), [project]);
  return (
    <div className="pointer-events-auto absolute left-2 top-2 z-10" data-testid="cabling-hud-idle" onPointerDown={(e) => e.stopPropagation()}>
      <Select aria-label="Connect cable" placeholder="Connect cable…" value={PICK} options={[{ value: PICK, label: 'Connect cable…', disabled: true }, ...options]} onValueChange={(v) => v !== PICK && startCabling(v)} className="w-[220px] bg-panel/95" />
    </div>
  );
}

export function CablingHud() {
  const project = useProject();
  const cabling = useSchematicUi().cabling;
  const cable = cabling ? cableById(project, cabling.cableId) : undefined;
  const rows = useMemo(() => (cable ? legRows(project, cable) : []), [project, cable]);
  if (!cabling || !cable) return <ConnectPicker />;
  const resolved = resolveCableOf(project, cable);
  const autoFill = () => {
    // Continue on the port after the last plugged leg of the current side; the first leg is a Shift+click on the canvas.
    const plugged = rows.filter((r) => r.side === cabling.side && r.portRef);
    const last = plugged[plugged.length - 1]?.portRef;
    if (!last) return toast(`Shift+click the first port for side ${cabling.side} to auto-fill`, { tone: 'info' });
    const next = nextPortAfter(project, last);
    if (!next) return toast('No port after the last plugged leg on that device', { tone: 'warning' });
    autoFillCurrent(next);
  };
  const remaining = unassignedLegs(cable, cabling.side).length;
  return (
    <div className="pointer-events-auto absolute left-2 top-2 z-10 flex w-[280px] flex-col rounded border border-accent/60 bg-panel/95 text-[13px] shadow-lg" data-testid="cabling-hud" onPointerDown={(e) => e.stopPropagation()}>
      <div className="flex h-7 items-center gap-1.5 border-b border-border px-2">
        <span className="font-medium text-fg">Cable {cable.label}</span>
        <Badge tone="accent">side {cabling.side} · leg {cabling.leg + 1}</Badge>
        <span className="flex-1" />
        <Button size="sm" variant="primary" onClick={finishCabling}>Finish</Button>
      </div>
      <div className="truncate px-2 py-1 text-[11px] text-fg-muted" title={resolved?.summary}>{resolved?.summary ?? cable.cableDefId}</div>
      <div className="max-h-[40vh] overflow-auto" role="listbox" aria-label="Cable legs">
        {(['A', 'B'] as const).map((side) => (
          <div key={side}>
            <div className="flex h-5 items-center gap-1 bg-panel-2 px-2 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
              <span className="flex-1">Side {side} · {rows.find((r) => r.side === side)?.connector}</span>
              {cabling.side === side && remaining > 1 && <Button size="sm" variant="ghost" onClick={autoFill}>Auto-fill</Button>}
            </div>
            {rows.filter((r) => r.side === side).map((r) => {
              const current = cabling.side === r.side && cabling.leg === r.leg;
              return (
                <div key={`${r.side}${r.leg}`} role="option" aria-selected={current} data-leg={`${r.side}${r.leg + 1}`} className={cn('flex h-6 cursor-default items-center gap-2 px-2', current && 'bg-accent/15')} onClick={() => resumeCabling(cable.id, r.side, r.leg)}>
                  <span className="w-5 shrink-0 text-fg-muted">{r.label}</span>
                  <span className={cn('min-w-0 flex-1 truncate', r.port ? 'text-fg' : 'text-fg-muted')}>{r.port ?? '—'}</span>
                  {r.port && <Button size="sm" variant="ghost" aria-label={`Unplug leg ${r.side}${r.leg + 1}`} onClick={(e) => { e.stopPropagation(); unplugAt(cable.id, r.side, r.leg); resumeCabling(cable.id, r.side, r.leg); }}>Unplug</Button>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="border-t border-border px-2 py-1 text-[11px] text-fg-muted">Click a pin to plug · Shift+click auto-fills · Enter or Esc finishes</div>
      <span className="sr-only" data-testid="cabling-hud-remaining">{remaining}</span>
    </div>
  );
}
