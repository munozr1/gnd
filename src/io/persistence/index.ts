/**
 * Project persistence: IndexedDB autosave (idb-keyval) and JSON files.
 *
 * Keys: `project:<id>` holds the Project, `projects` the picker index, and
 * `lastOpened` the id to reopen on startup. Loaded projects are tracked as
 * "clean" so autosave does not rewrite (and re-stamp) a project that was
 * merely opened.
 */
import { clear, createStore, del, get, set, update, type UseStore } from 'idb-keyval';
import type { Id, Project } from '@/model/types';
import { migrate, ProjectParseError } from './migrations';

export { migrate, ProjectParseError, CURRENT_PROJECT_VERSION } from './migrations';

export const AUTOSAVE_DEBOUNCE_MS = 1000;
const DB_NAME = 'datacenter-eda';
const STORE_NAME = 'kv';
const INDEX_KEY = 'projects';
const LAST_OPENED_KEY = 'lastOpened';
const projectKey = (id: Id): string => `project:${id}`;

export interface ProjectSummary {
  id: Id;
  name: string;
  rev: string;
  createdAt: string;
  updatedAt: string;
}

let kv: UseStore | undefined;
/** Lazily created so importing this module never touches indexedDB. */
const kvStore = (): UseStore => (kv ??= createStore(DB_NAME, STORE_NAME));

/** Project objects that match what is on disk (just loaded / just saved). */
const cleanProjects = new WeakSet<Project>();

const summaryOf = (p: Project): ProjectSummary => ({
  id: p.id,
  name: p.name,
  rev: p.rev,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

const byNewest = (a: ProjectSummary, b: ProjectSummary): number => b.updatedAt.localeCompare(a.updatedAt);

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------

/** Write the project (stamped with `updatedAt = now`) and update the picker index. Returns the stamped copy. */
export async function saveProjectNow(project: Project, now: string = new Date().toISOString()): Promise<Project> {
  const stamped: Project = { ...project, updatedAt: now };
  await set(projectKey(project.id), stamped, kvStore());
  await update<ProjectSummary[]>(
    INDEX_KEY,
    (list) => [...(list ?? []).filter((s) => s.id !== project.id), summaryOf(stamped)].sort(byNewest),
    kvStore(),
  );
  cleanProjects.add(stamped);
  return stamped;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const list = await get<ProjectSummary[]>(INDEX_KEY, kvStore());
  return [...(list ?? [])].sort(byNewest);
}

/** Load and migrate a saved project; null when no such id. */
export async function loadProject(id: Id): Promise<Project | null> {
  const raw = await get<unknown>(projectKey(id), kvStore());
  if (raw === undefined) return null;
  const project = migrate(raw);
  cleanProjects.add(project);
  return project;
}

export async function deleteProject(id: Id): Promise<void> {
  await del(projectKey(id), kvStore());
  await update<ProjectSummary[]>(INDEX_KEY, (list) => (list ?? []).filter((s) => s.id !== id), kvStore());
  if ((await getLastOpened()) === id) await del(LAST_OPENED_KEY, kvStore());
}

export async function setLastOpened(id: Id | null): Promise<void> {
  if (id === null) await del(LAST_OPENED_KEY, kvStore());
  else await set(LAST_OPENED_KEY, id, kvStore());
}

export async function getLastOpened(): Promise<Id | null> {
  return (await get<Id>(LAST_OPENED_KEY, kvStore())) ?? null;
}

/** Wipe every saved project (tests, "reset app"). */
export async function clearPersistence(): Promise<void> {
  await clear(kvStore());
}

/** Mark an in-memory project as matching what is saved, so autosave skips it. */
export function markProjectClean(project: Project): void {
  cleanProjects.add(project);
}

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

/** The subset of the app store autosave needs; structural so this module stays independent of it. */
export interface ProjectStoreLike {
  getState(): { project: Project };
  subscribe(listener: (state: { project: Project }, prev: { project: Project }) => void): () => void;
}

export interface AutosaveOptions {
  debounceMs?: number;
  onSaved?: (project: Project) => void;
  onError?: (error: unknown) => void;
  /** Also record the saved project as last opened (default true). */
  trackLastOpened?: boolean;
}

export interface AutosaveHandle {
  stop(): void;
  /** Save any pending change now; resolves once every queued write has landed. */
  flush(): Promise<void>;
  /** True while an edit is waiting for the debounce timer. */
  isPending(): boolean;
}

/**
 * Subscribe to project changes and save them, debounced. Projects the store
 * was given by `loadProject` (or `markProjectClean`) are not re-saved until
 * they change. Pending edits are flushed when the page is hidden or unloaded,
 * and before switching to a different project.
 */
export function startAutosave(projectStore: ProjectStoreLike, opts: AutosaveOptions = {}): AutosaveHandle {
  const debounceMs = opts.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
  const onError = opts.onError ?? ((err: unknown) => console.error('[autosave] save failed', err));
  const trackLastOpened = opts.trackLastOpened ?? true;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Project | null = null;
  let lastSaved: Project = projectStore.getState().project;
  /** Writes are chained so they land in order; flush() awaits the tail. */
  let inFlight: Promise<void> = Promise.resolve();

  const write = async (project: Project): Promise<void> => {
    try {
      await saveProjectNow(project);
      if (trackLastOpened) await setLastOpened(project.id);
      lastSaved = project;
      opts.onSaved?.(project);
    } catch (err) {
      onError(err);
    }
  };

  const flush = (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const project = pending;
    pending = null;
    if (project) inFlight = inFlight.then(() => write(project));
    return inFlight;
  };

  const schedule = (project: Project) => {
    pending = project;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, debounceMs);
  };

  const unsubscribe = projectStore.subscribe((state, prev) => {
    const project = state.project;
    if (project === prev.project) return;
    // Leaving a project with unsaved edits: write them before moving on.
    if (pending && pending.id !== project.id) void flush();
    if (project === lastSaved || cleanProjects.has(project)) {
      lastSaved = project;
      return;
    }
    schedule(project);
  });

  const onHidden = () => {
    if (typeof document === 'undefined' || document.visibilityState === 'hidden') void flush();
  };
  const onPageHide = () => void flush();
  const doc = typeof document !== 'undefined' ? document : null;
  const win = typeof window !== 'undefined' ? window : null;
  doc?.addEventListener('visibilitychange', onHidden);
  win?.addEventListener('pagehide', onPageHide);

  return {
    stop: () => {
      unsubscribe();
      doc?.removeEventListener('visibilitychange', onHidden);
      win?.removeEventListener('pagehide', onPageHide);
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
    flush,
    isPending: () => pending !== null,
  };
}

// ---------------------------------------------------------------------------
// JSON files
// ---------------------------------------------------------------------------

export function serializeProject(project: Project, opts: { updatedAt?: string; pretty?: boolean } = {}): string {
  const out = opts.updatedAt !== undefined ? { ...project, updatedAt: opts.updatedAt } : project;
  return JSON.stringify(out, null, opts.pretty === false ? undefined : 2);
}

/** Parse project JSON, running migrations. Throws ProjectParseError on bad input. */
export function parseProject(json: string, now?: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new ProjectParseError(`Not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return migrate(raw, now);
}

const fileSlug = (name: string): string =>
  name
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'project';

export function projectFileName(project: Project): string {
  return `${fileSlug(project.name)}.dceda.json`;
}

/** Trigger a browser download of the project as JSON (stamped with the current time). */
export function downloadJson(project: Project, filename: string = projectFileName(project)): void {
  const json = serializeProject(project, { updatedAt: new Date().toISOString() });
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsText(file);
  });
}

/** Read a JSON file chosen by the user into a migrated Project. */
export async function readJsonFile(file: File): Promise<Project> {
  return parseProject(await readFileText(file));
}
