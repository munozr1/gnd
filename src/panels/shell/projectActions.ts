/**
 * Project-level actions shared by the menu bar, the project picker and
 * keyboard shortcuts. Plain functions over the store so non-React code
 * (shortcuts) can call them too.
 */
import { deleteProject, downloadJson, loadProject, projectFileName, readJsonFile, setLastOpened, type AutosaveHandle } from '@/io/persistence';
import { createProject } from '@/model/factories';
import type { Id } from '@/model/types';
import { store } from '@/store';
import { toast } from '@/ui/Toast';
import { errorMessage } from './format';
import { setSaveState } from './saveState';

let autosave: AutosaveHandle | null = null;

/** Called by the bootstrap so actions can flush pending writes. */
export function registerAutosave(handle: AutosaveHandle | null): void {
  autosave = handle;
}

export function flushAutosave(): Promise<void> {
  return autosave ? autosave.flush() : Promise.resolve();
}

/** Replace the open project with a fresh one; autosave persists it within a second. */
export function newProject(name = 'Untitled datacenter'): void {
  const project = createProject(name);
  store.getState().replaceProject(project);
  store.getState().setActiveTab('schematic');
  toast.ok(`Created "${name}"`);
}

/** Open a saved project by id. Returns false (with a toast) when it is missing or fails to load. */
export async function openProject(id: Id): Promise<boolean> {
  try {
    await flushAutosave();
    const project = await loadProject(id);
    if (!project) {
      toast.error('That project no longer exists');
      return false;
    }
    store.getState().replaceProject(project);
    setSaveState('saved');
    await setLastOpened(id);
    return true;
  } catch (err) {
    toast.error(`Could not open project: ${errorMessage(err)}`);
    return false;
  }
}

export async function deleteSavedProject(id: Id): Promise<boolean> {
  try {
    await deleteProject(id);
    return true;
  } catch (err) {
    toast.error(`Could not delete project: ${errorMessage(err)}`);
    return false;
  }
}

/** File > Save: download the project as JSON (autosave already covers IndexedDB). */
export function saveProjectFile(): void {
  const project = store.getState().project;
  try {
    downloadJson(project);
    void flushAutosave();
    toast.ok(`Saved ${projectFileName(project)}`);
  } catch (err) {
    toast.error(`Save failed: ${errorMessage(err)}`);
  }
}

/** Import a project JSON file chosen by the user; becomes the open project. */
export async function importProjectFromFile(file: File): Promise<boolean> {
  try {
    const project = await readJsonFile(file);
    await flushAutosave();
    store.getState().replaceProject(project);
    toast.ok(`Imported "${project.name}"`);
    return true;
  } catch (err) {
    toast.error(`Import failed: ${errorMessage(err)}`);
    return false;
  }
}

/** Open the browser's file picker and import the chosen JSON. Resolves false when cancelled. */
export function importProjectFile(): Promise<boolean> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        resolve(false);
        return;
      }
      void importProjectFromFile(file).then(resolve);
    });
    // Cancel fires on modern browsers; fall back to leaving the promise pending otherwise.
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(false);
    });
    document.body.appendChild(input);
    input.click();
  });
}
