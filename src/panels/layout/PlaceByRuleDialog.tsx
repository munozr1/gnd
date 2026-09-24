/**
 * Place by rule: "put SW* with role leaf at U42 of each rack in row A",
 * "fill SRV* bottom-up in R01–R06". The form previews the pure planner's
 * result live and applies it as one undoable command.
 */
import { useMemo, useState } from 'react';
import { layout, planPlaceByRule, racksInOrder, type PlaceByRulePlan, type PlaceMode, type PlaceRule } from '@/commands';
import type { Face, Id } from '@/model/types';
import { store, useActiveDialog, useProject } from '@/store';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Dialog, DialogContent } from '@/ui/Dialog';
import { Input, NumberInput } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { toast } from '@/ui/Toast';
import { Field, Note, run } from './shared';

export const PLACE_BY_RULE_DIALOG = 'place-by-rule';

/** Optional `ui.dialogData` for this dialog. */
export interface PlaceByRuleDialogData {
  refGlob?: string;
  role?: string;
  rackIds?: Id[];
}

type FilterMode = 'all' | 'row' | 'racks';

const MODES: { value: PlaceMode; label: string }[] = [
  { value: 'fill-bottom-up', label: 'Fill bottom-up' },
  { value: 'fill-top-down', label: 'Fill top-down' },
  { value: 'fixed-u', label: 'Fixed U in each rack' },
];

const isData = (v: unknown): v is PlaceByRuleDialogData => typeof v === 'object' && v !== null;

export function PlaceByRuleDialog() {
  const open = useActiveDialog() === PLACE_BY_RULE_DIALOG;
  const project = useProject();
  const initial = isData(store.getState().ui.dialogData) ? (store.getState().ui.dialogData as PlaceByRuleDialogData) : {};
  const racks = useMemo(() => racksInOrder(project), [project]);

  const [refGlob, setRefGlob] = useState(initial.refGlob ?? 'SRV*');
  const [role, setRole] = useState(initial.role ?? '');
  const [filterMode, setFilterMode] = useState<FilterMode>(initial.rackIds?.length ? 'racks' : 'all');
  const [row, setRow] = useState('');
  const [rackIds, setRackIds] = useState<ReadonlySet<Id>>(() => new Set(initial.rackIds ?? []));
  const [mode, setMode] = useState<PlaceMode>('fill-bottom-up');
  const [u, setU] = useState(42);
  const [face, setFace] = useState<Face>('front');
  const [includePlaced, setIncludePlaced] = useState(false);

  const rule = useMemo<PlaceRule>(() => {
    const names = racks.filter((r) => rackIds.has(r.id)).map((r) => r.name);
    return {
      refGlob,
      mode,
      face,
      includePlaced,
      ...(role.trim() ? { role: role.trim() } : {}),
      ...(mode === 'fixed-u' ? { u } : {}),
      rackFilter: filterMode === 'row' ? { row } : filterMode === 'racks' ? { names: names.length ? names : ['\u0000'] } : {},
    };
  }, [refGlob, role, filterMode, row, rackIds, racks, mode, u, face, includePlaced]);

  const preview = useMemo<{ plan: PlaceByRulePlan | null; error: string | null }>(() => {
    if (!open) return { plan: null, error: null };
    try {
      return { plan: planPlaceByRule(project, rule), error: null };
    } catch (err) {
      return { plan: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [open, project, rule]);

  const close = () => store.getState().closeDialog();
  const apply = () => {
    const cmd = layout.placeByRule(rule);
    if (!run(cmd)) return;
    const plan = cmd.result;
    const n = plan?.placements.length ?? 0;
    const s = plan?.skipped.length ?? 0;
    const msg = `Placed ${n} device${n === 1 ? '' : 's'}${s ? `, ${s} skipped` : ''}`;
    if (s) toast.warning(msg, { title: 'Place by rule' });
    else toast.ok(msg, { title: 'Place by rule' });
    if (plan && n > 0) store.getState().select(plan.placements.map((p) => ({ kind: 'component' as const, id: p.componentId })));
    close();
  };

  const plan = preview.plan;
  const canApply = !!plan && plan.placements.length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        title="Place by rule"
        width="lg"
        bodyClassName="p-0"
        footer={
          <>
            <span className="mr-auto text-[12px] text-fg-muted" data-testid="place-preview-count">
              {preview.error
                ? preview.error
                : plan
                  ? `Will place ${plan.placements.length} of ${plan.candidateIds.length} matching device${plan.candidateIds.length === 1 ? '' : 's'} in ${plan.rackIds.length} rack${plan.rackIds.length === 1 ? '' : 's'}`
                  : ''}
            </span>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" disabled={!canApply} onClick={apply} data-testid="place-apply">
              Apply
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-[1fr_1fr] gap-3 p-3">
          <div className="flex flex-col gap-1">
            <Field label="Ref pattern">
              <Input aria-label="Ref pattern" value={refGlob} onChange={(e) => setRefGlob(e.target.value)} placeholder="SRV*" mono className="w-full" />
            </Field>
            <Field label="Role">
              <Input aria-label="Role pattern" value={role} onChange={(e) => setRole(e.target.value)} placeholder="any (e.g. leaf*)" className="w-full" />
            </Field>
            <Field label="Racks">
              <Select
                aria-label="Rack filter"
                value={filterMode}
                onValueChange={(v) => setFilterMode(v as FilterMode)}
                options={[
                  { value: 'all', label: 'All racks' },
                  { value: 'row', label: 'Row…' },
                  { value: 'racks', label: 'Chosen racks…' },
                ]}
                className="w-full"
              />
            </Field>
            {filterMode === 'row' && (
              <Field label="Row">
                <Input aria-label="Row" value={row} onChange={(e) => setRow(e.target.value)} placeholder="A" className="w-full" />
              </Field>
            )}
            {filterMode === 'racks' && (
              <div className="ml-22 flex max-h-40 flex-col gap-0.5 overflow-auto rounded border border-border bg-bg p-1" data-testid="rack-picker">
                {racks.length === 0 && <Note>No racks yet.</Note>}
                {racks.map((r) => (
                  <Checkbox
                    key={r.id}
                    checked={rackIds.has(r.id)}
                    label={`${r.name}${r.row ? ` · row ${r.row}` : ''}`}
                    onCheckedChange={(v) =>
                      setRackIds((prev) => {
                        const next = new Set(prev);
                        if (v === true) next.add(r.id);
                        else next.delete(r.id);
                        return next;
                      })
                    }
                  />
                ))}
              </div>
            )}
            <Field label="Mode">
              <Select aria-label="Mode" value={mode} onValueChange={(v) => setMode(v as PlaceMode)} options={MODES} className="w-full" />
            </Field>
            {mode === 'fixed-u' && (
              <Field label="U position">
                <NumberInput aria-label="U position" value={u} min={1} decimals={0} unit="U" onChange={setU} />
              </Field>
            )}
            <Field label="Face">
              <Select
                aria-label="Face"
                value={face}
                onValueChange={(v) => setFace(v as Face)}
                options={[
                  { value: 'front', label: 'Front' },
                  { value: 'rear', label: 'Rear' },
                ]}
                className="w-full"
              />
            </Field>
            <Field label="">
              <Checkbox checked={includePlaced} label="Re-pack already placed matches" onCheckedChange={(v) => setIncludePlaced(v === true)} />
            </Field>
            <Note>Globs: * matches anything, ? one character. Devices are placed in natural ref order, racks in name order.</Note>
          </div>
          <div className="flex min-h-0 flex-col gap-1">
            <div className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">Preview</div>
            {preview.error && <Note tone="error">{preview.error}</Note>}
            {plan && plan.placements.length === 0 && plan.skipped.length === 0 && <Note>No unplaced device matches the pattern.</Note>}
            {plan && (
              <ul className="max-h-64 overflow-auto rounded border border-border bg-bg" data-testid="place-preview">
                {plan.placements.slice(0, 40).map((p) => (
                  <li key={p.componentId} className="mono flex h-5 items-center gap-2 px-2 text-[12px]">
                    <span className="w-16 truncate">{p.ref}</span>
                    <span className="text-fg-muted">→</span>
                    <span className="flex-1 truncate">
                      {p.rackName} U{p.uPosition}
                      {p.heightU > 1 ? `–U${p.uPosition + p.heightU - 1}` : ''}
                    </span>
                    <span className="text-[11px] text-fg-muted">{p.face}</span>
                  </li>
                ))}
                {plan.placements.length > 40 && <li className="px-2 text-[11px] text-fg-muted">+{plan.placements.length - 40} more</li>}
                {plan.skipped.slice(0, 20).map((s) => (
                  <li key={s.componentId} className="flex min-h-5 items-center gap-2 px-2 text-[12px]" title={s.message}>
                    <span className="mono w-16 truncate">{s.ref}</span>
                    <Badge tone="warning">{s.reason}</Badge>
                    <span className="min-w-0 flex-1 truncate text-[11px] text-fg-muted">{s.message}</span>
                  </li>
                ))}
                {plan.skipped.length > 20 && <li className="px-2 text-[11px] text-fg-muted">+{plan.skipped.length - 20} more skipped</li>}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
