/**
 * Back-annotation proposals (layout -> schematic): the pending list with
 * Accept / Reject, plus a mini-form that proposes moving the selected link's
 * end to another free, compatible port on the same device.
 */
import { useMemo, useState } from 'react';
import { layout } from '@/commands';
import { validatePortSwap } from '@/model/sync';
import type { BackAnnotation, Id, Link, SelectionItem } from '@/model/types';
import { store, useProject, useProjectIndex, useSelection } from '@/store';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Select, type SelectOption } from '@/ui/Select';
import { toast } from '@/ui/Toast';
import { Note, Section, run } from './shared';

export function proposalTarget(b: BackAnnotation): SelectionItem {
  return b.kind === 'port-swap' ? { kind: 'link', id: b.linkId } : { kind: 'component', id: b.componentId };
}

function ProposalRow({ annotation }: { annotation: BackAnnotation }) {
  const idx = useProjectIndex();
  let kind = '';
  let text = '';
  switch (annotation.kind) {
    case 'port-swap': {
      const link = idx.link(annotation.linkId);
      const end = link?.[annotation.end];
      const ref = end ? (idx.component(end.componentId)?.ref ?? end.componentId) : '?';
      kind = 'Port swap';
      text = `${link ? idx.linkLabel(link) : annotation.linkId}: ${ref}:${annotation.fromPortId} → ${ref}:${annotation.toPortId}`;
      break;
    }
    case 'ref-rename':
      kind = 'Rename';
      text = `${annotation.from} → ${annotation.to}`;
      break;
    case 'footprint-change': {
      const name = (id: string | null) => (id === null ? 'no model' : (idx.catalog.footprint(id)?.model ?? id));
      kind = 'Model';
      text = `${idx.component(annotation.componentId)?.ref ?? annotation.from}: ${name(annotation.from)} → ${name(annotation.to)}`;
      break;
    }
  }
  const accept = () => {
    const cmd = layout.acceptBackAnnotation(annotation.id);
    if (run(cmd)) {
      const r = cmd.result;
      if (r?.ok && r.unplaced) toast.warning('Accepted; the device no longer fits its slot and was unplaced');
      else toast.ok(`Accepted ${kind.toLowerCase()}`);
    }
  };
  const reject = () => run(layout.rejectBackAnnotation(annotation.id));
  return (
    <li data-proposal-id={annotation.id} className="flex items-center gap-1 px-2 py-0.5 hover:bg-panel-2">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none"
        title="Select in the editors"
        onClick={() => store.getState().select(proposalTarget(annotation))}
      >
        <Badge tone="accent">{kind}</Badge>
        <span className="mono min-w-0 flex-1 truncate text-[12px]">{text}</span>
      </button>
      <Button size="sm" variant="primary" onClick={accept} aria-label={`Accept ${text}`}>
        Accept
      </Button>
      <Button size="sm" variant="danger" onClick={reject} aria-label={`Reject ${text}`}>
        Reject
      </Button>
    </li>
  );
}

function PortSwapForm({ link }: { link: Link }) {
  const project = useProject();
  const idx = useProjectIndex();
  const [end, setEnd] = useState<'a' | 'b'>('a');
  const [toPort, setToPort] = useState<string>('');
  const current = link[end];
  const component = idx.component(current.componentId);
  const symbol = component ? idx.symbolOf(component) : undefined;

  const candidates = useMemo<SelectOption[]>(() => {
    if (!symbol) return [];
    return symbol.pins
      .filter((p) => p.portId !== current.portId && validatePortSwap(project, link.id, end, p.portId) === null)
      .map((p) => ({ value: p.portId, label: `${p.portId} · ${p.type}` }));
  }, [symbol, project, link.id, end, current.portId]);

  const chosen = candidates.some((c) => c.value === toPort) ? toPort : '';

  const propose = () => {
    if (!chosen) return;
    const cmd = layout.proposePortSwap(link.id, end, chosen);
    if (run(cmd)) {
      toast.info(`Proposed moving ${component?.ref ?? ''}:${current.portId} to ${chosen}; accept it above`);
      setToPort('');
    }
  };

  return (
    <div className="flex flex-col gap-1" data-testid="port-swap-form">
      <div className="mono truncate text-[12px] text-fg">{idx.linkLabel(link)}</div>
      <div className="flex items-center gap-1">
        {(['a', 'b'] as const).map((e) => (
          <Button key={e} size="sm" active={end === e} onClick={() => setEnd(e)} className="flex-1">
            {e.toUpperCase()}: {idx.endLabel(link[e])}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <Select
          aria-label="Target port"
          value={chosen}
          onValueChange={setToPort}
          options={candidates}
          placeholder={candidates.length === 0 ? 'No free compatible port' : 'Free compatible port…'}
          disabled={candidates.length === 0}
          className="min-w-0 flex-1"
        />
        <Button variant="primary" size="sm" disabled={!chosen} onClick={propose}>
          Propose
        </Button>
      </div>
      <Note>
        Moves the cable (and its optic) to another {component ? (idx.pinOf(component, current.portId)?.type ?? '') : ''} port of the same
        device once accepted.
      </Note>
    </div>
  );
}

export function ProposalsPanel() {
  const project = useProject();
  const idx = useProjectIndex();
  const selection = useSelection();
  const proposals = project.backAnnotations;
  const selectedLinkId: Id | undefined = selection.find((i): i is { kind: 'link'; id: Id } => i.kind === 'link')?.id;
  const selectedLink = selectedLinkId ? idx.link(selectedLinkId) : undefined;

  const acceptAll = () => {
    let ok = 0;
    for (const b of [...proposals]) if (run(layout.acceptBackAnnotation(b.id))) ok++;
    if (ok > 0) toast.ok(`Accepted ${ok} proposal${ok === 1 ? '' : 's'}`);
  };

  return (
    <div className="flex flex-col" data-testid="proposals-panel">
      <Section
        title={`Pending (${proposals.length})`}
        actions={
          proposals.length > 1 ? (
            <Button variant="ghost" size="sm" onClick={acceptAll}>
              Accept all
            </Button>
          ) : undefined
        }
      >
        {proposals.length === 0 ? (
          <Note>No pending proposals. Ref, model and port changes made in the layout appear here for acceptance into the schematic.</Note>
        ) : (
          <ul className="-mx-2">
            {proposals.map((b) => (
              <ProposalRow key={b.id} annotation={b} />
            ))}
          </ul>
        )}
      </Section>
      <Section title="Propose port swap">
        {selectedLink ? <PortSwapForm key={selectedLink.id} link={selectedLink} /> : <Note>Select a link (cable) to propose landing one of its ends on another port.</Note>}
      </Section>
    </div>
  );
}
