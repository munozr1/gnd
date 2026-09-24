/**
 * Link / route properties: label and cable, per-end in-rack dressing (manager
 * side, top entry, pinned override), the F8 review flag, the length breakdown
 * from the full 3D pathway, service loops and the route actions.
 */
import { useMemo, useState } from 'react';
import { catalogIndex } from '@/catalog';
import { layout, schematic } from '@/commands';
import { estimatedLengthM, managerFor, routedLengthM, type LinkLength } from '@/model/routing';
import type { Id, Link, Route, Side } from '@/model/types';
import { command, store, useProject, useProjectIndex } from '@/store';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { IconButton } from '@/ui/IconButton';
import { NumberInput } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { Field, Note, Section, Stat, TextField, fmtM, run } from '../shared';

const NO_CABLE = 'none';
const NO_ENTRY = 'none';

/** Clear the "needs review" flag F8 set when it re-attached an end. */
export const markRouteReviewed = (linkId: Id) =>
  command('Mark route reviewed', 'layout', (d) => {
    const r = d.routes[linkId];
    if (!r) throw new Error(`Link ${linkId} has no route`);
    delete r.needsReview;
  });

function EndDressing({ link, route, end }: { link: Link; route: Route; end: 'a' | 'b' }) {
  const project = useProject();
  const idx = useProjectIndex();
  const path = end === 'a' ? route.aRack : route.bRack;
  const le = link[end];
  const rack = idx.rackOfComponent(le.componentId);
  const entries = rack ? project.accessories.filter((a) => a.rackId === rack.id && a.type === 'top-entry') : [];
  const manager = rack ? managerFor(project, rack.id, path.side) : undefined;
  const entryLabel = (id: Id) => {
    const a = entries.find((x) => x.id === id);
    return a ? `Top entry · ${a.side ?? 'center'}${a.face ? ` · ${a.face}` : ''}` : id;
  };
  return (
    <div className="flex flex-col gap-1" data-route-end={end}>
      <div className="flex items-center gap-1 text-[12px]">
        <span className="mono min-w-0 flex-1 truncate">
          {end.toUpperCase()}: {idx.endLabel(le)}
          {rack && <span className="ml-1 text-fg-muted">in {rack.name}</span>}
        </span>
        {path.pinned ? <Badge tone="accent">pinned</Badge> : <Badge>auto</Badge>}
      </div>
      {!rack && <Note tone="warning">Device is unplaced; in-rack dressing applies once it sits in a rack.</Note>}
      <Field label="Manager side">
        <Select
          aria-label={`End ${end.toUpperCase()} manager side`}
          value={path.side}
          onValueChange={(v) => run(layout.setInRackPath(link.id, end, { side: v as Side }))}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'right', label: 'Right' },
          ]}
          className="w-full"
        />
      </Field>
      <Field label="Top entry">
        <Select
          aria-label={`End ${end.toUpperCase()} top entry`}
          value={path.entry ?? NO_ENTRY}
          onValueChange={(v) => run(layout.setInRackPath(link.id, end, { entry: v === NO_ENTRY ? null : v }))}
          options={[{ value: NO_ENTRY, label: 'None' }, ...entries.map((a) => ({ value: a.id, label: entryLabel(a.id) }))]}
          className="w-full"
          disabled={!rack}
        />
      </Field>
      {rack && !manager && <Note tone="warning">No vertical manager on the {path.side} of {rack.name} (add one in the rack inspector).</Note>}
      {rack && entries.length === 0 && <Note tone="warning">{rack.name} has no top entry; the cable cannot leave the rack.</Note>}
      {path.pinned && (
        <div>
          <Button size="sm" variant="ghost" onClick={() => run(layout.resetInRackPath(link.id, end))}>
            Back to auto
          </Button>
        </div>
      )}
    </div>
  );
}

function LengthBreakdown({ length }: { length: LinkLength }) {
  const b = length.breakdown;
  return (
    <div className="flex flex-col" data-testid="length-breakdown">
      <Stat label="In-rack A" value={fmtM(b.inRackA)} />
      <Stat label="Rise" value={fmtM(b.rise)} />
      <Stat label="Tray" value={fmtM(b.tray)} />
      <Stat label="Drop" value={fmtM(b.drop)} />
      <Stat label="In-rack B" value={fmtM(b.inRackB)} />
      <Stat label="Path" value={`${fmtM(length.rawM)}${length.est ? ' (est.)' : ''}`} />
      <Stat label="With slack" value={`${fmtM(length.withSlackM)}${length.serviceLoopM > 0 ? ` incl. ${fmtM(length.serviceLoopM)} loops` : ''}`} />
      <Stat label="Standard" value={<span className="font-medium">{length.standardM} m</span>} />
    </div>
  );
}

export function RouteInspector({ linkId }: { linkId: Id }) {
  const project = useProject();
  const idx = useProjectIndex();
  const link = idx.link(linkId);
  const route = project.routes[linkId];
  const cables = catalogIndex(project).catalog.cables;
  const length = useMemo(() => (route ? routedLengthM(project, linkId) : estimatedLengthM(project, linkId)), [project, route, linkId]);
  const loops = useMemo(() => {
    if (!route) return [];
    const out: { segIdx: number; wpId: Id; metres: number; label: string }[] = [];
    route.segments.forEach((seg, segIdx) =>
      seg.points.forEach((wp, i) => {
        if (wp.serviceLoopM !== undefined) out.push({ segIdx, wpId: wp.id, metres: wp.serviceLoopM, label: `${seg.layer} #${i + 1}` });
      }),
    );
    return out;
  }, [route]);
  const [loopTarget, setLoopTarget] = useState<string>('');
  const [loopM, setLoopM] = useState(1);
  if (!link) return null;

  const cableOptions = [{ value: NO_CABLE, label: 'No cable' }, ...cables.map((c) => ({ value: c.id, label: c.name }))];
  const waypointOptions = route
    ? route.segments.flatMap((seg, segIdx) =>
        seg.points.map((wp, i) => ({ value: `${segIdx}:${wp.id}`, label: `${seg.layer} #${i + 1}${wp.pinned ? ' (pinned)' : ''}` })),
      )
    : [];
  const addLoop = () => {
    const [segStr, wpId] = loopTarget.split(':');
    if (segStr === undefined || wpId === undefined) return;
    run(layout.setServiceLoop(linkId, Number(segStr), wpId, loopM));
  };
  const startRouting = () => {
    store.getState().patchLayout({ tool: 'route', routingLinkId: linkId });
  };

  return (
    <>
      <Section title="Link">
        <Field label="Label">
          <TextField aria-label="Link label" value={link.label ?? ''} placeholder={idx.linkLabel(link)} onCommit={(v) => run(schematic.setLinkLabel(linkId, v.trim() || undefined))} mono />
        </Field>
        <Field label="Cable">
          <Select
            aria-label="Cable"
            value={link.cableDefId ?? NO_CABLE}
            onValueChange={(v) => run(schematic.setLinkCable(linkId, v === NO_CABLE ? null : v))}
            options={cableOptions}
            className="w-full"
          />
        </Field>
        <Stat label="Ends" value={<span className="mono">{idx.endLabel(link.a)} — {idx.endLabel(link.b)}</span>} />
        {!route && (
          <>
            <Note tone="info">Unrouted: shown as an airwire.</Note>
            <div>
              <Button size="sm" variant="primary" onClick={startRouting}>
                Route (X)
              </Button>
            </div>
          </>
        )}
      </Section>
      {route && (
        <>
          {route.needsReview && (
            <Section title="Review">
              <div className="flex items-center gap-2">
                <Badge tone="warning">needs review</Badge>
                <span className="min-w-0 flex-1 text-[11px] text-fg-muted">Update Layout re-attached an end of this route.</span>
                <Button size="sm" onClick={() => run(markRouteReviewed(linkId))}>
                  Mark reviewed
                </Button>
              </div>
            </Section>
          )}
          <Section title="In-rack dressing">
            <EndDressing link={link} route={route} end="a" />
            <div className="my-1 border-t border-border" />
            <EndDressing link={link} route={route} end="b" />
          </Section>
          <Section title={`Segments (${route.segments.length})`}>
            {route.segments.map((seg, i) => {
              const tray = seg.trayId ? project.trays.find((t) => t.id === seg.trayId) : undefined;
              const pinned = seg.points.filter((p) => p.pinned).length;
              return (
                <Stat key={i} label={seg.layer} value={`${seg.points.length} waypoints · ${pinned} pinned${tray ? ` · ${tray.name ?? tray.kind}` : ''}`} />
              );
            })}
            <div className="flex flex-wrap gap-1 pt-1">
              <Button size="sm" onClick={() => run(layout.pinAll(linkId))}>
                Pin all
              </Button>
              <Button size="sm" onClick={() => run(layout.unpinAll(linkId))}>
                Unpin all
              </Button>
              <Button size="sm" onClick={() => run(layout.straighten(linkId))}>
                Straighten
              </Button>
              <Button size="sm" variant="danger" onClick={() => run(layout.unroute(linkId))}>
                Unroute
              </Button>
            </div>
          </Section>
          <Section title={`Service loops (${loops.length})`}>
            {loops.map((l) => (
              <div key={l.wpId} className="flex items-center gap-1">
                <span className="w-24 shrink-0 truncate text-[12px] text-fg-muted">{l.label}</span>
                <NumberInput aria-label={`Loop at ${l.label}`} value={l.metres} min={0} step={0.5} decimals={2} unit="m" onChange={(m) => run(layout.setServiceLoop(linkId, l.segIdx, l.wpId, m > 0 ? m : null))} className="flex-1" />
                <IconButton label="Remove service loop" icon="trash" onClick={() => run(layout.setServiceLoop(linkId, l.segIdx, l.wpId, null))} />
              </div>
            ))}
            {waypointOptions.length > 0 && (
              <div className="flex items-center gap-1 rounded border border-border bg-bg/40 p-1">
                <Select aria-label="Loop waypoint" value={loopTarget} onValueChange={setLoopTarget} options={waypointOptions} placeholder="Waypoint…" className="min-w-0 flex-1" />
                <NumberInput aria-label="Loop metres" value={loopM} min={0.5} step={0.5} decimals={2} unit="m" onChange={setLoopM} className="w-20" />
                <Button size="sm" variant="primary" disabled={!loopTarget} onClick={addLoop}>
                  Add
                </Button>
              </div>
            )}
          </Section>
        </>
      )}
      <Section title={route ? 'Length' : 'Length (estimate)'}>
        {length ? <LengthBreakdown length={length} /> : <Note>Both ends must be placed to compute a length.</Note>}
      </Section>
    </>
  );
}
