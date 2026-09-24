/**
 * 'custom-device' dialog: name / kind / ref prefix / size plus port rows
 * (prefix, start, count, type, speeds, group, side) that expand into the
 * port list of a `CustomDeviceForm`. Submit runs `addCustomSymbolAndFootprint`
 * and starts placing the new symbol.
 */
import { useMemo, useState } from 'react';
import { addCustomSymbolAndFootprint, DEFAULT_REF_PREFIX, DEVICE_KINDS, validateCustomDevice, type CustomDeviceForm, type CustomPortSpec, type PortRole } from '@/commands';
import type { DeviceKind, Face, PortType } from '@/model/types';
import { store } from '@/store';
import { Button } from '@/ui/Button';
import { Dialog, DialogContent } from '@/ui/Dialog';
import { IconButton } from '@/ui/IconButton';
import { Icon } from '@/ui/icons';
import { Input, NumberInput } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { toast } from '@/ui/Toast';
import { execute, Field, NONE, TH } from '@/panels/schematic/common';
import { summariseTypes } from './catalogView';
import { startPlacing } from './LibraryList';

export const PORT_TYPES: readonly PortType[] = ['SFP', 'SFP+', 'SFP28', 'QSFP+', 'QSFP28', 'QSFP56', 'QSFP-DD', 'OSFP', 'RJ45', 'LC', 'MPO-12'];
const ROLES: readonly PortRole[] = ['uplink', 'downlink', 'mgmt', 'data', 'front', 'rear'];

export interface PortRowForm {
  key: number;
  prefix: string;
  start: number;
  count: number;
  type: PortType;
  /** Comma-separated Gbps; empty = the type's defaults. */
  speeds: string;
  role: PortRole | '';
  face: Face;
}

let rowKey = 1;
const newRow = (partial: Partial<PortRowForm> = {}): PortRowForm => ({
  key: rowKey++,
  prefix: 'eth1/',
  start: 1,
  count: 1,
  type: 'SFP28',
  speeds: '',
  role: '',
  face: 'front',
  ...partial,
});

/** Expand port rows into the flat port specs the builder takes. Throws on bad speeds. */
export function expandPortRows(rows: readonly PortRowForm[]): CustomPortSpec[] {
  const out: CustomPortSpec[] = [];
  for (const r of rows) {
    const speeds = r.speeds
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => Number(s));
    if (speeds.some((s) => Number.isNaN(s))) throw new Error(`Speeds for '${r.prefix}' must be numbers (Gbps)`);
    for (let i = 0; i < r.count; i++) {
      out.push({
        id: `${r.prefix}${r.start + i}`,
        type: r.type,
        face: r.face,
        ...(speeds.length ? { speedsGbps: speeds } : {}),
        ...(r.role ? { role: r.role } : {}),
      });
    }
  }
  return out;
}

export function CustomDeviceDialog() {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DeviceKind>('switch');
  const [refPrefix, setRefPrefix] = useState('');
  const [heightU, setHeightU] = useState(1);
  const [depthMm, setDepthMm] = useState(500);
  const [widthMm, setWidthMm] = useState(482.6);
  const [vendor, setVendor] = useState('');
  const [expectedUplinks, setExpectedUplinks] = useState(0);
  const [rows, setRows] = useState<PortRowForm[]>([newRow({ prefix: 'eth1/', count: 48, type: 'SFP28', role: 'downlink' }), newRow({ prefix: 'eth1/', start: 49, count: 8, type: 'QSFP28', role: 'uplink' })]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const close = () => store.getState().closeDialog();

  const form = useMemo((): { form: CustomDeviceForm | null; error: string | null } => {
    try {
      const ports = expandPortRows(rows);
      const f: CustomDeviceForm = {
        name,
        kind,
        heightU,
        depthMm,
        widthMm,
        ports,
        ...(refPrefix.trim() ? { refPrefix: refPrefix.trim() } : {}),
        ...(vendor.trim() ? { vendor: vendor.trim() } : {}),
        ...(expectedUplinks > 0 ? { expectedUplinks } : {}),
      };
      return { form: f, error: validateCustomDevice(f) };
    } catch (err) {
      return { form: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [name, kind, heightU, depthMm, widthMm, rows, refPrefix, vendor, expectedUplinks]);

  const summary = form.form ? summariseTypes(form.form.ports.map((p) => p.type)) : '';
  const totalPorts = form.form?.ports.length ?? 0;

  const updateRow = (key: number, patch: Partial<PortRowForm>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = () => {
    if (!form.form || form.error) {
      setSubmitError(form.error ?? 'Fill in the form first');
      return;
    }
    const cmd = addCustomSymbolAndFootprint(form.form);
    if (!execute(cmd) || !cmd.result) {
      setSubmitError(store.getState().ui.lastError ?? 'Could not add the device');
      return;
    }
    toast.ok(`Added ${form.form.name.trim()} to the library`);
    close();
    startPlacing(cmd.result.symbolId);
  };

  const error = submitError ?? (name.trim() ? form.error : null);

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent
        title="Custom device"
        description="A symbol for the schematic and a physical model for the layout, saved in this project's catalog."
        width="lg"
        footer={
          <>
            <span className="mr-auto truncate text-[12px] text-fg-muted">
              {totalPorts} {totalPorts === 1 ? 'port' : 'ports'}
              {summary && totalPorts > 0 ? ` · ${summary}` : ''}
            </span>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={!name.trim() || !!form.error}>
              Add to library
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          <Field label="Name">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Edge router 2U" aria-label="Device name" />
          </Field>
          <Field label="Kind">
            <Select value={kind} onValueChange={(v) => setKind(v as DeviceKind)} options={DEVICE_KINDS.map((k) => ({ value: k, label: k }))} aria-label="Device kind" />
          </Field>
          <Field label="Ref prefix">
            <Input value={refPrefix} onChange={(e) => setRefPrefix(e.target.value)} placeholder={DEFAULT_REF_PREFIX[kind]} mono aria-label="Reference prefix" />
          </Field>
          <Field label="Vendor">
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="optional" aria-label="Vendor" />
          </Field>
          <Field label="Height">
            <NumberInput value={heightU} onChange={setHeightU} min={1} max={48} step={1} unit="U" decimals={0} aria-label="Height in U" />
          </Field>
          <Field label="Depth">
            <NumberInput value={depthMm} onChange={setDepthMm} min={1} step={10} unit="mm" decimals={0} aria-label="Depth" />
          </Field>
          <Field label="Width">
            <NumberInput value={widthMm} onChange={setWidthMm} min={1} step={1} unit="mm" decimals={1} aria-label="Width" />
          </Field>
          <Field label="Uplinks" hint="Expected uplinks per device (ERC single-homed); 0 = unset">
            <NumberInput value={expectedUplinks} onChange={setExpectedUplinks} min={0} max={64} step={1} decimals={0} aria-label="Expected uplinks" />
          </Field>
        </div>

        <div className="mt-3 flex h-5 items-center">
          <span className="flex-1 text-[11px] font-medium uppercase tracking-wide text-fg-muted">Ports</span>
          <Button size="sm" onClick={() => setRows((rs) => [...rs, newRow({ start: nextStart(rs) })])}>
            <Icon name="plus" size={12} />
            Add row
          </Button>
        </div>
        <div className="mt-1 grid grid-cols-[1.2fr_64px_64px_100px_1fr_100px_84px_24px] items-center gap-x-1 gap-y-1">
          <TH>Prefix</TH>
          <TH>Start</TH>
          <TH>Count</TH>
          <TH>Type</TH>
          <TH>Speeds (Gbps)</TH>
          <TH>Group</TH>
          <TH>Side</TH>
          <TH />
          {rows.map((r) => (
            <RowEditor key={r.key} row={r} onChange={(patch) => updateRow(r.key, patch)} onRemove={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} />
          ))}
        </div>
        {rows.length === 0 && <div className="mt-1 text-[12px] text-fg-muted">No ports (a blank panel, for example).</div>}
        {error && (
          <div className="mt-3 rounded border border-error/40 bg-error/10 px-2 py-1 text-[12px] text-error" role="alert">
            {error}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const nextStart = (rows: readonly PortRowForm[]): number => {
  const last = rows[rows.length - 1];
  return last ? last.start + last.count : 1;
};

function RowEditor({ row, onChange, onRemove }: { row: PortRowForm; onChange: (patch: Partial<PortRowForm>) => void; onRemove: () => void }) {
  return (
    <>
      <Input value={row.prefix} onChange={(e) => onChange({ prefix: e.target.value })} mono aria-label="Port prefix" />
      <NumberInput value={row.start} onChange={(start) => onChange({ start })} min={0} step={1} decimals={0} aria-label="First port number" />
      <NumberInput value={row.count} onChange={(count) => onChange({ count })} min={1} max={512} step={1} decimals={0} aria-label="Port count" />
      <Select value={row.type} onValueChange={(v) => onChange({ type: v as PortType })} options={PORT_TYPES.map((t) => ({ value: t, label: t }))} aria-label="Port type" />
      <Input value={row.speeds} onChange={(e) => onChange({ speeds: e.target.value })} placeholder="default" mono aria-label="Port speeds" />
      <Select
        value={row.role || NONE}
        onValueChange={(v) => onChange({ role: v === NONE ? '' : (v as PortRole) })}
        options={[{ value: NONE, label: 'none' }, ...ROLES.map((r) => ({ value: r, label: r }))]}
        aria-label="Port group"
      />
      <Select value={row.face} onValueChange={(v) => onChange({ face: v as Face })} options={[{ value: 'front', label: 'front' }, { value: 'rear', label: 'rear' }]} aria-label="Port side" />
      <IconButton label="Remove row" icon="trash" onClick={onRemove} />
    </>
  );
}
