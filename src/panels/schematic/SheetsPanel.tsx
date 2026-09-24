import { useState } from 'react';
import * as commands from '@/commands';
import { sheetAncestry, sheetOrder } from '@/model/schematic';
import { store, useActiveSheetId, useProject } from '@/store';
import { Button } from '@/ui/Button';
import { Dialog, DialogContent } from '@/ui/Dialog';
import { Input } from '@/ui/Input';
import { toast } from '@/ui/Toast';
import { execute } from './common';

export function SheetsPanel() {
  const project = useProject();
  const active = useActiveSheetId();
  const sheet = project.sheets.find((s) => s.id === active);
  const [editing, setEditing] = useState<'new' | 'rename' | 'duplicate' | null>(null);
  const [name, setName] = useState('');
  const start = (mode: NonNullable<typeof editing>) => { setName(mode === 'new' ? 'New sheet' : `${sheet?.name ?? 'Sheet'}${mode === 'duplicate' ? ' copy' : ''}`); setEditing(mode); };
  const submit = () => {
    if (!name.trim() || !editing) return;
    if (editing === 'new') {
      const siblings = project.sheets.filter((s) => s.parentId === active);
      const right = Math.max(0, ...siblings.map((s) => (s.sch?.pos.x ?? 0) + (s.sch?.width ?? 160)));
      const cmd = commands.createSheet(active, name, { x: right + 40, y: 40 });
      if (!execute(cmd)) return;
      if (cmd.result) store.getState().setActiveSheet(cmd.result);
    } else if (editing === 'rename') { if (!execute(commands.renameSheet(active, name))) return; }
    else {
      const cmd = commands.duplicateSheet(active, name);
      if (!execute(cmd)) return;
      if (cmd.result) {
        store.getState().setActiveSheet(cmd.result.sheetId);
        const count = cmd.result.droppedCrossSheetLinks.length;
        toast(count ? `Sheet duplicated. ${count} external links were omitted; reconnect the new pod to its upstream devices.` : 'Sheet duplicated with new references.', { tone: count ? 'warning' : 'ok' });
      }
    }
    setEditing(null);
  };
  return <div className="flex flex-col gap-2 p-2">
    <div className="flex flex-wrap gap-1">
      <Button onClick={() => start('new')}>New child</Button>
      <Button onClick={() => start('rename')}>Rename</Button>
      <Button disabled={!sheet?.parentId} onClick={() => start('duplicate')}>Duplicate</Button>
      <Button disabled={!sheet?.parentId} onClick={() => { if (sheet?.parentId && execute(commands.deleteSheet(active))) store.getState().setActiveSheet(sheet.parentId); }}>Delete</Button>
    </div>
    <div aria-label="Sheets" className="flex flex-col">
      {sheetOrder(project).map((id) => {
        const s = project.sheets.find((entry) => entry.id === id)!;
        return <button key={id} aria-current={id === active ? 'page' : undefined} className={`rounded py-1 text-left text-xs hover:bg-panel-2 ${id === active ? 'bg-accent/20 text-fg' : 'text-fg-muted'}`} style={{ paddingLeft: 8 + (sheetAncestry(project, id).length - 1) * 14 }} onClick={() => { store.getState().setActiveSheet(id); store.getState().clearSelection(); }}>{s.name}</button>;
      })}
    </div>
    <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
      <DialogContent title={editing === 'new' ? 'New child sheet' : editing === 'duplicate' ? 'Duplicate sheet' : 'Rename sheet'} width="sm" footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={submit}>Save</Button></>}>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}><Input autoFocus aria-label="Sheet name" value={name} onChange={(e) => setName(e.target.value)} /></form>
      </DialogContent>
    </Dialog>
  </div>;
}
