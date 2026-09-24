/** 'library' dialog (A key): search-first symbol picker; picking starts placement and closes. */
import { store } from '@/store';
import { Dialog, DialogContent } from '@/ui/Dialog';
import { LibraryList, startPlacing } from './LibraryList';

export const LIBRARY_DIALOG = 'library';

export function LibraryDialog() {
  const close = () => store.getState().closeDialog();
  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent title="Add symbol" width="md" bodyClassName="flex h-[60vh] flex-col p-0">
        <LibraryList
          autoFocus
          onPick={(id) => {
            close();
            startPlacing(id);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
