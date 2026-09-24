/** File > Open: saved projects from IndexedDB, with open / delete / new. */
import { useCallback, useEffect, useState } from 'react';
import { listProjects, type ProjectSummary } from '@/io/persistence';
import type { Id } from '@/model/types';
import { store, useActiveDialog, useStore } from '@/store';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { Dialog, DialogClose, DialogContent } from '@/ui/Dialog';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/icons';
import { toast } from '@/ui/Toast';
import { errorMessage, formatRelativeTime } from './format';
import { deleteSavedProject, importProjectFile, newProject, openProject } from './projectActions';

export const PROJECT_PICKER_DIALOG = 'project-picker';

export function ProjectPicker() {
  const open = useActiveDialog() === PROJECT_PICKER_DIALOG;
  const currentId = useStore((s) => s.project.id);
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Id | null>(null);

  const refresh = useCallback(async () => {
    try {
      setList(await listProjects());
    } catch (err) {
      toast.error(`Could not list projects: ${errorMessage(err)}`);
      setList([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setConfirmDelete(null);
    void refresh();
  }, [open, refresh]);

  const close = () => store.getState().closeDialog();

  const onOpen = async (id: Id) => {
    setBusy(true);
    const ok = await openProject(id);
    setBusy(false);
    if (ok) close();
  };

  const onDelete = async (id: Id) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setBusy(true);
    const ok = await deleteSavedProject(id);
    setBusy(false);
    setConfirmDelete(null);
    if (ok) void refresh();
  };

  const onNew = () => {
    newProject();
    close();
  };

  const onImport = async () => {
    const ok = await importProjectFile();
    if (ok) close();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent
        title="Open project"
        width="lg"
        bodyClassName="p-0"
        footer={
          <>
            <Button onClick={onNew} disabled={busy}>
              <Icon name="plus" size={12} />
              New project
            </Button>
            <Button onClick={() => void onImport()} disabled={busy}>
              <Icon name="file" size={12} />
              Import JSON…
            </Button>
            <span className="flex-1" />
            <DialogClose asChild>
              <Button variant="ghost">Cancel</Button>
            </DialogClose>
          </>
        }
      >
        {list === null ? (
          <EmptyState title="Loading…" />
        ) : list.length === 0 ? (
          <EmptyState icon="folder" title="No saved projects" description="Projects autosave to this browser as you work." />
        ) : (
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 bg-panel-2 text-[11px] uppercase tracking-wide text-fg-muted">
              <tr>
                <th className="px-3 py-1 text-left font-medium">Name</th>
                <th className="w-12 px-2 py-1 text-left font-medium">Rev</th>
                <th className="w-40 px-2 py-1 text-left font-medium">Updated</th>
                <th className="w-40 px-2 py-1" />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const isCurrent = p.id === currentId;
                return (
                  <tr
                    key={p.id}
                    data-project-id={p.id}
                    onDoubleClick={() => !isCurrent && void onOpen(p.id)}
                    className={cn('border-t border-border hover:bg-panel-2', isCurrent && 'bg-accent/10')}
                  >
                    <td className="truncate px-3 py-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium text-fg">{p.name}</span>
                        {isCurrent && <Badge tone="accent">Open</Badge>}
                      </span>
                    </td>
                    <td className="mono px-2 py-1 text-fg-muted">{p.rev}</td>
                    <td className="px-2 py-1 text-fg-muted" title={p.updatedAt}>
                      {formatRelativeTime(p.updatedAt)}
                    </td>
                    <td className="px-2 py-1">
                      <span className="flex justify-end gap-1">
                        <Button variant="primary" disabled={busy || isCurrent} onClick={() => void onOpen(p.id)}>
                          Open
                        </Button>
                        <Button
                          variant="danger"
                          disabled={busy || isCurrent}
                          title={isCurrent ? 'Open another project first' : 'Delete from this browser'}
                          onClick={() => void onDelete(p.id)}
                          onBlur={() => confirmDelete === p.id && setConfirmDelete(null)}
                        >
                          {confirmDelete === p.id ? 'Confirm delete' : 'Delete'}
                        </Button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </DialogContent>
    </Dialog>
  );
}
