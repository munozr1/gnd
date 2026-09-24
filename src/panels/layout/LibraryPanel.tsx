/**
 * Left-dock library for the layout editor: rack defs to place (or array into
 * a row), trays by kind / width to draw at an elevation, accessories to fit
 * to the selected racks, and the keep-out tool. Placing sets
 * `ui.layout.placing`; the floor plan consumes it.
 */
import { useMemo, useState } from 'react';
import { catalogIndex } from '@/catalog';
import { layout } from '@/commands';
import { rackRect } from '@/model/geometry';
import { defaultLayerElevationMm } from '@/model/routing';
import type { AccessoryDef, Id, Side, TrayDef, TrayKind } from '@/model/types';
import { store, useLayoutUi, useProject, useProjectIndex, useSelection } from '@/store';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { NumberInput } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { toast } from '@/ui/Toast';
import { Field, Note, Section, run } from './shared';

const TRAY_KIND_LABEL: Record<TrayKind, string> = { 'fiber-runway': 'Fiber runway', ladder: 'Ladder rack', basket: 'Wire basket' };

function PlacingBanner() {
  const ui = useLayoutUi();
  const project = useProject();
  if (!ui.placing) return null;
  const cat = catalogIndex(project);
  const what =
    ui.placing.kind === 'rack'
      ? (cat.racks.get(ui.placing.defId)?.name ?? 'rack')
      : ui.placing.kind === 'tray'
        ? `${cat.trays.get(ui.placing.defId)?.name ?? 'tray'} at ${ui.placing.elevationMm} mm`
        : 'keep-out';
  return (
    <div className="flex items-center gap-2 border-b border-border bg-accent/10 px-2 py-1 text-[12px]" data-testid="placing-banner">
      <Badge tone="accent">Placing</Badge>
      <span className="min-w-0 flex-1 truncate">{what} — click on the floor plan; Esc cancels</span>
      <Button size="sm" variant="ghost" onClick={() => store.getState().patchLayout({ placing: null, tool: 'select' })}>
        Cancel
      </Button>
    </div>
  );
}

function RackLibrary() {
  const project = useProject();
  const defs = catalogIndex(project).catalog.racks;
  const [defId, setDefId] = useState(defs[0]?.id ?? '');
  const [count, setCount] = useState(6);
  const [spacing, setSpacing] = useState(0);
  const [row, setRow] = useState('');
  const def = defs.find((d) => d.id === defId) ?? defs[0];

  const place = (id: string) => store.getState().patchLayout({ tool: 'rack', placing: { kind: 'rack', defId: id } });
  const addRow = () => {
    if (!def) return;
    // Below the lowest existing rack, on the floor grid.
    const grid = project.room.gridMm || 600;
    const bottom = project.racks.reduce((m, r) => {
      const rr = rackRect(r);
      return Math.max(m, rr.y + rr.height);
    }, 0);
    const origin = { x: grid, y: Math.ceil((bottom + grid) / grid) * grid };
    const cmd = layout.addRackArray(def, { origin, count, spacingMm: spacing, ...(row.trim() ? { row: row.trim() } : {}) });
    if (run(cmd) && cmd.result) {
      store.getState().select(cmd.result.map((id) => ({ kind: 'rack' as const, id })));
      store.getState().requestViewport('layout', { kind: 'items', items: cmd.result.map((id) => ({ kind: 'rack' as const, id })) });
      toast.ok(`Added ${cmd.result.length} racks`);
    }
  };

  return (
    <Section title="Racks">
      {defs.map((d) => (
        <div key={d.id} className="flex items-center gap-1" data-rack-def={d.id}>
          <span className="min-w-0 flex-1 truncate text-[12px]">{d.name}</span>
          <span className="shrink-0 text-[11px] text-fg-muted">
            {d.widthMm}×{d.depthMm}
          </span>
          <Button size="sm" onClick={() => place(d.id)} aria-label={`Place ${d.name}`}>
            Place
          </Button>
        </div>
      ))}
      <div className="mt-1 flex flex-col gap-1 rounded border border-border bg-bg/40 p-1">
        <Select aria-label="Row rack type" value={def?.id ?? ''} onValueChange={setDefId} options={defs.map((d) => ({ value: d.id, label: d.name }))} className="w-full" />
        <div className="flex items-center gap-1">
          <NumberInput aria-label="Rack count" value={count} min={1} max={100} decimals={0} onChange={setCount} className="w-14" />
          <NumberInput aria-label="Rack gap" value={spacing} min={0} step={100} decimals={0} unit="mm" onChange={setSpacing} className="w-24" />
          <input
            aria-label="Row label"
            value={row}
            onChange={(e) => setRow(e.target.value)}
            placeholder="Row"
            className="h-6 w-12 rounded border border-border bg-bg px-1.5 text-[13px] text-fg outline-none placeholder:text-fg-muted focus:border-accent select-text"
          />
          <Button size="sm" variant="primary" disabled={!def} onClick={addRow} className="ml-auto">
            Add row
          </Button>
        </div>
      </div>
      <Note>Place: a ghost follows the cursor on the floor plan; racks snap to the {project.room.gridMm} mm grid.</Note>
    </Section>
  );
}

function TrayLibrary() {
  const project = useProject();
  const ui = useLayoutUi();
  const defs = catalogIndex(project).catalog.trays;
  const [layer, setLayer] = useState<'overhead' | 'underfloor'>('overhead');
  const [elevation, setElevation] = useState<Record<'overhead' | 'underfloor', number>>(() => ({
    overhead: defaultLayerElevationMm(project.room, 'overhead'),
    underfloor: defaultLayerElevationMm(project.room, 'underfloor'),
  }));
  const groups = useMemo(() => {
    const m = new Map<TrayKind, TrayDef[]>();
    for (const d of defs) {
      const arr = m.get(d.kind);
      if (arr) arr.push(d);
      else m.set(d.kind, [d]);
    }
    return [...m.entries()];
  }, [defs]);
  const elevationMm = elevation[layer];
  const draw = (d: TrayDef) => store.getState().patchLayout({ tool: 'tray', placing: { kind: 'tray', defId: d.id, elevationMm }, activeLayer: layer });

  return (
    <Section title="Trays">
      <Field label="Layer">
        <Select
          aria-label="Tray layer"
          value={layer}
          onValueChange={(v) => setLayer(v as 'overhead' | 'underfloor')}
          options={[
            { value: 'overhead', label: 'Overhead' },
            { value: 'underfloor', label: 'Underfloor' },
          ]}
          className="w-full"
        />
      </Field>
      <Field label="Elevation">
        <NumberInput aria-label="Tray elevation" value={elevationMm} step={50} decimals={0} unit="mm" onChange={(v) => setElevation((e) => ({ ...e, [layer]: v }))} />
      </Field>
      {groups.map(([kind, list]) => (
        <div key={kind} className="flex flex-col gap-0.5" data-tray-kind={kind}>
          <div className="flex items-center gap-1 pt-1 text-[11px] text-fg-muted">
            <span className="flex-1">{TRAY_KIND_LABEL[kind]}</span>
            <span>accepts {list[0]?.accepts.join(' + ')}</span>
          </div>
          {list.map((d) => {
            const active = ui.placing?.kind === 'tray' && ui.placing.defId === d.id;
            return (
              <div key={d.id} className="flex items-center gap-1" data-tray-def={d.id}>
                <span className="min-w-0 flex-1 truncate text-[12px]">{d.name}</span>
                <span className="shrink-0 text-[11px] text-fg-muted">
                  {d.widthMm}×{d.depthMm}
                </span>
                <Button size="sm" active={active} onClick={() => draw(d)} aria-label={`Draw ${d.name}`}>
                  Draw
                </Button>
              </div>
            );
          })}
        </div>
      ))}
      <Note>Fiber rides fiber runway; copper rides ladder or basket (DRC tray-media).</Note>
    </Section>
  );
}

function AccessoryLibrary() {
  const project = useProject();
  const idx = useProjectIndex();
  const selection = useSelection();
  const defs = catalogIndex(project).catalog.accessories;
  const [side, setSide] = useState<Side | 'center'>('left');
  const rackIds = selection.filter((s): s is { kind: 'rack'; id: Id } => s.kind === 'rack').map((s) => s.id);
  const targetLabel = rackIds.length === 0 ? 'no rack selected' : rackIds.length === 1 ? (idx.rack(rackIds[0]!)?.name ?? '') : `${rackIds.length} racks`;

  const add = (def: AccessoryDef) => {
    let ok = 0;
    for (const rackId of rackIds) {
      const rack = idx.rack(rackId);
      const sided = def.type === 'vcm' || def.type === 'top-entry';
      const opts: Parameters<typeof layout.addAccessory>[2] = {};
      if (sided) opts.side = def.type === 'vcm' && side === 'center' ? 'left' : side;
      // Managers and enclosures default to the top of the rack, the classic spot.
      if (def.type === 'hcm' || def.type === 'fiber-enclosure') opts.uPosition = Math.max(1, (rack?.heightU ?? 42) - (def.heightU ?? 1) + 1);
      if (run(layout.addAccessory(rackId, def, opts))) ok++;
    }
    if (ok > 0) toast.ok(`Added ${def.name} to ${ok} rack${ok === 1 ? '' : 's'}`);
  };

  return (
    <Section title="Rack accessories">
      <Field label="Side">
        <Select
          aria-label="Accessory side"
          value={side}
          onValueChange={(v) => setSide(v as Side | 'center')}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' },
            { value: 'center', label: 'Center (top entry)' },
          ]}
          className="w-full"
        />
      </Field>
      {defs.map((d) => (
        <div key={d.id} className="flex items-center gap-1" data-accessory-def={d.id}>
          <span className="min-w-0 flex-1 truncate text-[12px]">{d.name}</span>
          <Button size="sm" disabled={rackIds.length === 0} onClick={() => add(d)} aria-label={`Add ${d.name} to ${targetLabel}`}>
            Add
          </Button>
        </div>
      ))}
      <Note>Applies to the selected rack{rackIds.length === 1 ? '' : 's'}: {targetLabel}. Managers and enclosures land at the top U; adjust them in the inspector.</Note>
    </Section>
  );
}

function KeepoutTool() {
  const ui = useLayoutUi();
  const active = ui.tool === 'keepout';
  return (
    <Section title="Keep-outs">
      <div className="flex items-center gap-1">
        <Button size="sm" active={active} onClick={() => store.getState().patchLayout({ tool: 'keepout', placing: { kind: 'keepout' } })}>
          Draw keep-out
        </Button>
        <Button size="sm" active={ui.tool === 'room'} onClick={() => store.getState().patchLayout({ tool: 'room', placing: null })}>
          Edit room
        </Button>
      </div>
      <Note>Click the corners of a hot / cold aisle or wall clearance; racks inside it are flagged by DRC.</Note>
    </Section>
  );
}

export function LibraryPanel() {
  return (
    <div className="flex flex-col" data-testid="layout-library">
      <PlacingBanner />
      <RackLibrary />
      <TrayLibrary />
      <AccessoryLibrary />
      <KeepoutTool />
    </div>
  );
}
