import { useMemo, useRef, useState } from 'react';
import { buildCutsheetProject, cutsheetGroups, detectCutsheetMapping, planCutsheet, readCutsheetCsv, type CsvTable, type CutsheetMapping } from '@/io/imports/cutsheet';
import { saveProjectNow, setLastOpened } from '@/io/persistence';
import { registerDialog } from '@/panels/registry';
import { flushAutosave } from '@/panels/shell/projectActions';
import { store } from '@/store';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Dialog, DialogContent } from '@/ui/Dialog';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { toast } from '@/ui/Toast';

export const CUTSHEET_IMPORT_DIALOG = 'import-cutsheet';
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
const columnName = (index: number): string => index < 26 ? String.fromCharCode(65 + index) : columnName(Math.floor(index / 26) - 1) + String.fromCharCode(65 + index % 26);

export function CutsheetImportDialog() {
  const [table, setTable] = useState<CsvTable | null>(null), [mapping, setMapping] = useState<CutsheetMapping | null>(null);
  const [name, setName] = useState(''), [filename, setFilename] = useState(''), [error, setError] = useState<string | null>(null);
  const [draftRacks, setDraftRacks] = useState(true), [busy, setBusy] = useState(false), [reading, setReading] = useState(false);
  const readVersion = useRef(0);
  const plan = useMemo(() => table && mapping ? planCutsheet(table, mapping) : null, [table, mapping]);
  const close = () => { if (!busy) store.getState().closeDialog(); };
  const read = async (file?: File) => {
    const version = ++readVersion.current;
    setTable(null); setMapping(null); setError(null); setFilename(file?.name ?? ''); setReading(false);
    if (!file) return;
    setReading(true);
    try {
      if (file.size > 5_000_000) throw new Error('CSV is too large. Use a file smaller than 5 MB.');
      const parsed = readCutsheetCsv(await file.text());
      if (version !== readVersion.current) return;
      setTable(parsed); setMapping(detectCutsheetMapping(parsed)); setName(file.name.replace(/\.csv$/i, ''));
    } catch (e) { if (version === readVersion.current) setError(message(e)); }
    finally { if (version === readVersion.current) setReading(false); }
  };
  const create = async () => {
    if (!plan || busy) return;
    setBusy(true); setError(null);
    try {
      const project = buildCutsheetProject(plan, { name, draftRacks });
      // Persist both documents before switching, so a new import cannot discard the open design.
      await flushAutosave(); await saveProjectNow(store.getState().project); await saveProjectNow(project); await setLastOpened(project.id);
      const s = store.getState(); s.replaceProject(project);
      s.patchLayout({ view: 'floor', elevationRackIds: [], tool: 'select', placing: null, routingLinkId: null, viewportRequest: null });
      s.patchSchematic({ tool: 'select', placing: null, assignFocus: null });
      s.patchViewer3d({ frameRequest: false, showAirwires: true });
      s.setActiveSheet('root'); s.setActiveTab('schematic'); s.requestViewport('schematic', { kind: 'fit' }); s.closeDialog();
      toast.ok(`Imported ${plan.devices.length} devices and ${plan.links.length} links`);
    } catch (e) { setError(message(e)); setBusy(false); }
  };
  const speeds = plan ? [...new Set(plan.links.map((l) => l.speed))].sort((a, b) => a - b).map((speed) => `${plan.links.filter((l) => l.speed === speed).length} × ${speed} Gbps`).join(' · ') : '';
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent title="Import cutsheet CSV" width="xl" description="Create a new design from device_port endpoints and connection speeds. Your current project stays saved in Open projects."
    footer={<><Button disabled={busy} onClick={close}>Cancel</Button><Button variant="primary" disabled={busy || reading || !plan?.links.length || !!plan.errors.length || !name.trim()} onClick={() => void create()}>{busy ? 'Creating design…' : 'Create design'}</Button></>}>
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs">Cutsheet CSV<input aria-label="Cutsheet CSV" type="file" accept=".csv,text/csv" disabled={busy} onChange={(e) => void read(e.target.files?.[0])} className="rounded border border-border p-2 text-sm" /></label>
      {reading && <p role="status">Reading cutsheet…</p>}
      {error && <p role="alert" className="text-red-400">{error}</p>}
      {table && mapping && plan && <>
        <label className="flex flex-col gap-1 text-xs">Project name<Input aria-label="Import project name" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} /></label>
        <div className="grid grid-cols-3 gap-2">{([{ key: 'a', label: 'Endpoint A' }, { key: 'b', label: 'Endpoint B' }, { key: 'speed', label: 'Speed (Gbps)' }, { key: 'state', label: 'Connection state' }, { key: 'linkType', label: 'Link type' }] as const).map(({ key, label }) => <label key={key} className="flex flex-col gap-1 text-xs">{label}<Select aria-label={label} disabled={busy} value={String(mapping[key])} onValueChange={(v) => setMapping({ ...mapping, [key]: Number(v) })} options={[{ value: '-1', label: key === 'state' || key === 'linkType' ? 'Not included' : 'Choose column…' }, ...table.headers.map((header, i) => ({ value: String(i), label: `${columnName(i)} · ${header || '(blank header)'}` }))]} /></label>)}</div>
        <p className="text-xs text-fg-muted">Split endpoints at the last underscore. Port suffixes such as :0 stay part of the port name. Numeric speeds are Gbps. All connection states are included.</p>
        <div role="status" className="rounded border border-border bg-panel-2 p-3"><strong>{plan.devices.length} {plan.devices.length === 1 ? 'device' : 'devices'} · {plan.links.length} {plan.links.length === 1 ? 'link' : 'links'}</strong><div className="text-xs text-fg-muted">{filename} · {plan.sourceRows} source rows · {speeds}</div></div>
        <Checkbox label="Create draft rack layout" disabled={busy} checked={draftRacks} onCheckedChange={(v) => setDraftRacks(v === true)} />
        <p className="text-xs text-fg-muted">{draftRacks ? `${cutsheetGroups(plan).length} draft 42U racks, generic 1U devices, and automatic U positions will make Layout and 3D usable immediately. These are proposed placements, not locations from the cutsheet.` : 'Devices will be synchronized into the Unplaced bin for manual rack placement.'} Device sizes and port form factors are provisional. Speeds are preserved; exact optics, media and cable routes must be assigned later.</p>
        {plan.errors.length > 0 && <div role="alert" className="rounded border border-red-500/40 p-2 text-xs text-red-300"><strong>{plan.errors.length} errors — correct the CSV or column mapping before importing.</strong><ul className="mt-1 list-inside list-disc">{plan.errors.slice(0, 30).map((issue, i) => <li key={i}>Row {issue.row}: {issue.message}</li>)}</ul>{plan.errors.length > 30 && <p>Showing the first 30 errors.</p>}</div>}
        {plan.warnings.length > 0 && <div className="text-xs text-amber-300">{plan.warnings.length} duplicate rows will be skipped.<ul>{plan.warnings.slice(0, 10).map((issue, i) => <li key={i}>Row {issue.row}: {issue.message}</li>)}</ul></div>}
        <div className="max-h-64 overflow-auto rounded border border-border"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-panel-2"><tr>{['Row', 'Device A / port', 'Device B / port', 'Speed', 'State'].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{plan.links.slice(0, 100).map((link) => <tr key={link.row} className="border-t border-border"><td className="p-2">{link.row}</td><td className="p-2">{link.a.device}<div className="text-fg-muted">{link.a.port}</div></td><td className="p-2">{link.b.device}<div className="text-fg-muted">{link.b.port}</div></td><td className="p-2 whitespace-nowrap">{link.speed} Gbps</td><td className="p-2">{link.state || '—'}</td></tr>)}</tbody></table></div>
        {plan.links.length > 100 && <p className="text-xs text-fg-muted">Preview shows 100 of {plan.links.length} links. All valid rows will be imported.</p>}
      </>}
    </div>
  </DialogContent></Dialog>;
}
registerDialog({ id: CUTSHEET_IMPORT_DIALOG, component: CutsheetImportDialog });
