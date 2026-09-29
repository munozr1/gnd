/**
 * "Fiber cables" library list: every fiber cable definition the project can
 * see (this project's custom ones first, then the built-ins) with its
 * summary, a 'New cable…' button that opens the Cable Builder and, per row,
 * 'Connect' (starts the connecting flow, see ./cabling.ts) and, for custom
 * rows, delete. Rendered as a section of the layout Library panel and as a
 * dock panel on the schematic tab.
 */
import { useMemo } from 'react';
import { catalogIndex } from '@/catalog';
import { deleteCableDef } from '@/commands';
import { isFiberCableDef, resolveCable } from '@/model/cables';
import type { CableDef, Project } from '@/model/types';
import { store, useProject } from '@/store';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { cn } from '@/ui/cn';
import { IconButton } from '@/ui/IconButton';
import { Icon } from '@/ui/icons';
import { toast } from '@/ui/Toast';
import { execute } from '@/panels/schematic/common';
import { Section } from '@/panels/layout/shared';
import { CABLE_BUILDER_DIALOG } from './CableBuilderDialog';
import { startCabling } from './cabling';

export interface FiberCableRow {
  def: CableDef;
  /** '8F OM4 · Trunk (breakout) · MPO-8 → 4×LC-duplex · 4 channels', or the name when the def does not resolve. */
  summary: string;
  custom: boolean;
  error: string | null;
}

/** Fiber definitions in the project's catalog, custom ones first. */
export function fiberCableRows(project: Pick<Project, 'customCatalog'>): FiberCableRow[] {
  const customIds = new Set(project.customCatalog.cables.map((c) => c.id));
  const rows = catalogIndex(project)
    .catalog.cables.filter(isFiberCableDef)
    .map((def): FiberCableRow => {
      const r = resolveCable(def);
      return { def, custom: customIds.has(def.id), summary: 'error' in r ? def.name : r.summary, error: 'error' in r ? r.error : null };
    });
  return [...rows.filter((r) => r.custom), ...rows.filter((r) => !r.custom)];
}

export interface CableLibrarySectionProps {
  /** 'section' draws its own header (inside the layout Library panel); 'panel' is bare, for a dock panel that already has a title. */
  variant?: 'section' | 'panel';
  className?: string;
}

const openBuilder = () => store.getState().openDialog(CABLE_BUILDER_DIALOG);

/** Install a cable of this definition and start assigning its legs on the schematic (switches tab when needed). */
function connect(def: CableDef): void {
  startCabling(def.id);
}

function remove(def: CableDef): void {
  if (execute(deleteCableDef(def.id))) toast.ok(`Removed ${def.name} from the cable library`);
}

function NewCableButton() {
  return (
    <Button size="sm" onClick={openBuilder}>
      <Icon name="plus" size={12} />
      New cable…
    </Button>
  );
}

function Rows({ rows }: { rows: FiberCableRow[] }) {
  if (rows.length === 0) return <p className="text-[11px] text-fg-muted">No fiber cable definitions.</p>;
  return (
    <>
      {rows.map(({ def, summary, custom, error }) => (
        <div key={def.id} className="flex items-center gap-1" data-cable-def={def.id} data-custom={custom || undefined}>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate text-[12px]">{def.name}</span>
              {custom && <Badge tone="accent">custom</Badge>}
            </span>
            <span className={cn('truncate text-[11px]', error ? 'text-error' : 'text-fg-muted')} title={error ?? summary}>
              {error ?? summary}
            </span>
          </span>
          <Button size="sm" onClick={() => connect(def)} disabled={!!error} aria-label={`Connect ${def.name}`}>
            Connect
          </Button>
          {custom && <IconButton label={`Delete ${def.name}`} icon="trash" onClick={() => remove(def)} />}
        </div>
      ))}
    </>
  );
}

export function CableLibrarySection({ variant = 'section', className }: CableLibrarySectionProps) {
  const project = useProject();
  const rows = useMemo(() => fiberCableRows(project), [project]);
  if (variant === 'panel') {
    return (
      <div className={cn('flex flex-col gap-1 px-2 py-1', className)} data-testid="cables-library">
        <div className="flex items-center gap-1">
          <span className="flex-1 text-[11px] text-fg-muted">
            {rows.length} definition{rows.length === 1 ? '' : 's'}
          </span>
          <NewCableButton />
        </div>
        <Rows rows={rows} />
      </div>
    );
  }
  return (
    <Section title="Fiber cables" actions={<NewCableButton />} className={cn(className)}>
      <div data-testid="cables-library" className="flex flex-col gap-1">
        <Rows rows={rows} />
      </div>
    </Section>
  );
}

/** The schematic tab's "Fiber cables" dock panel. */
export function CablesDockPanel() {
  return <CableLibrarySection variant="panel" />;
}
