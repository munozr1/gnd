import { useState } from 'react';
import * as commands from '@/commands';
import { compatibleFootprints, compatibleOptics, usedPortIds } from '@/model/schematic';
import { CableInspector } from '@/panels/cables/CableInspector';
import { store, useProject, useProjectIndex, useSelection } from '@/store';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';
import { CommitInput, execute, Field, fromSelect, NONE, Readout, Section, toSelect } from './common';

export function SchematicInspector() {
  const project = useProject();
  const idx = useProjectIndex();
  const selection = useSelection();
  const [allPorts, setAllPorts] = useState(false);
  const item = selection.length === 1 ? selection[0] : undefined;
  if (!item) return <Section title="Selection">
    <p className="text-xs text-fg-muted">{selection.length ? `${selection.length} items selected` : 'Select a device, wire, or sheet to edit its properties.'}</p>
    {selection.length > 0 && <div className="flex flex-wrap gap-1">
      <Button onClick={() => execute(commands.rotateComponents(selection.flatMap((s) => s.kind === 'component' ? [s.id] : [])))}>Rotate</Button>
      <Button onClick={() => execute(commands.deleteSelection(selection))}>Delete</Button>
    </div>}
  </Section>;
  if (item.kind === 'component') {
    const c = idx.component(item.id);
    const symbol = c && idx.symbolOf(c);
    if (!c || !symbol) return null;
    const used = usedPortIds(project, c.id);
    const ports = symbol.pins.filter((p) => allPorts || used.has(p.portId) || c.optics[p.portId]);
    return <div className="overflow-auto" data-testid="schematic-inspector">
      <Section title="Device">
        <Field label="Reference"><CommitInput aria-label="Reference" value={c.ref} onCommit={(v) => execute(commands.setComponentRef(c.id, v))} validate={(v) => !v ? 'Reference is required' : project.components.some((other) => other.id !== c.id && other.ref === v) ? 'Reference already used' : null} /></Field>
        <Field label="Role / value"><CommitInput aria-label="Role / value" value={c.value ?? ''} onCommit={(v) => execute(commands.setComponentValue(c.id, v))} /></Field>
        <Readout label="Symbol">{symbol.name}</Readout>
        <Field label="Model"><Select aria-label="Physical model" value={toSelect(c.footprintDefId)} onValueChange={(v) => execute(commands.setFootprint(c.id, fromSelect(v)))} options={[{ value: NONE, label: 'Unassigned' }, ...compatibleFootprints(idx.catalog.catalog, symbol).map((f) => ({ value: f.id, label: f.model }))]} /></Field>
        <div className="flex flex-wrap gap-1">
          <Button onClick={() => execute(commands.rotateComponents(c.id))}>Rotate</Button>
          <Button onClick={() => execute(commands.mirrorComponents(c.id))}>Mirror</Button>
          <Button onClick={() => execute(commands.toggleExpandedPins(c.id))}>{c.expandedPins ? 'Collapse pins' : 'Expand pins'}</Button>
          <Button onClick={() => store.getState().revealSelection([item], 'layout')}>Show in layout</Button>
        </div>
      </Section>
      <Section title="Port optics" actions={<Button variant="ghost" onClick={() => setAllPorts(!allPorts)}>{allPorts ? 'Used ports' : 'All ports'}</Button>}>
        {!ports.length && <p className="text-xs text-fg-muted">No connected ports. Choose All ports to assign optics before wiring.</p>}
        {ports.map((p) => <div key={p.portId} className="flex flex-col gap-1 border-b border-border py-1">
          <span className="text-xs">{p.portId} <span className="text-fg-muted">{p.type} · {p.speedsGbps.join('/')} Gbps{used.has(p.portId) ? ' · connected' : ''}</span></span>
          <Select aria-label={`Optic on ${p.portId}`} value={toSelect(c.optics[p.portId])} onValueChange={(v) => execute(commands.setOptic(c.id, p.portId, fromSelect(v)))} options={[{ value: NONE, label: 'No optic' }, ...compatibleOptics(idx.catalog.catalog, p.type).map((o) => ({ value: o.id, label: o.name }))]} />
        </div>)}
      </Section>
    </div>;
  }
  if (item.kind === 'link') {
    const link = idx.link(item.id);
    if (!link) return null;
    return <Section title="Link">
      <Field label="Label"><CommitInput aria-label="Link label" value={link.label ?? ''} onCommit={(v) => execute(commands.setLinkLabel(link.id, v))} /></Field>
      <Field label="Cable"><Select aria-label="Cable type" value={toSelect(link.cableDefId)} onValueChange={(v) => execute(commands.setLinkCable(link.id, fromSelect(v)))} options={[{ value: NONE, label: 'Unassigned' }, ...idx.catalog.catalog.cables.map((c) => ({ value: c.id, label: c.name }))]} /></Field>
      {[link.a, link.b].map((end, i) => <Field key={i} label={i ? 'End B' : 'End A'}><Button variant="ghost" className="justify-start" onClick={() => store.getState().revealSelection([{ kind: 'component', id: end.componentId }], 'schematic')}>{idx.endLabel(end)}</Button></Field>)}
      <Button onClick={() => execute(commands.deleteLinks(link.id))}>Delete link</Button>
    </Section>;
  }
  if (item.kind === 'sheet') {
    const sheet = project.sheets.find((s) => s.id === item.id);
    if (!sheet) return null;
    return <Section title="Sheet">
      <Field label="Name"><CommitInput aria-label="Sheet name" value={sheet.name} onCommit={(v) => execute(commands.renameSheet(sheet.id, v))} validate={(v) => v ? null : 'Name is required'} /></Field>
      <Button onClick={() => store.getState().setActiveSheet(sheet.id)}>Enter sheet</Button>
    </Section>;
  }
  // A cable instance (the connecting flow) has its own inspector; sharing this panel keeps the right dock to one Inspector.
  if (item.kind === 'cable') return <CableInspector />;
  return <Section title="Selection"><p className="text-xs text-fg-muted">Select a schematic device or link.</p></Section>;
}
