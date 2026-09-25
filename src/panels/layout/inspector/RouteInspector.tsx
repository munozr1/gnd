/**
 * Link / route properties: label and cable, per-end in-rack dressing (manager
 * side, top entry, pinned override), the F8 review flag, the length breakdown
 * from the full 3D pathway, service loops and the route actions.
 *
 * The same inspector serves an installed cable (`{ kind: 'cable' }`): its
 * route is the JACKET, keyed by the cable id (`Route.owner === 'cable'`), so
 * every route verb takes the cable id; the furcation nodes are edited here too.
 */
import { useMemo, useState } from 'react';
import { catalogIndex } from '@/catalog';
import { cables as cableCommands, layout, schematic } from '@/commands';
import { cableEnds, furcationFloorPos, sideIsFanned, unassignedLegs, resolveCableOf, type CableSide, type PortRef } from '@/model/cables';
import { estimatedLengthM, managerFor, resolveEndsOf, routedLengthM, type LinkLength } from '@/model/routing';
import type { Cable, Id, Route, Side, Vec2 } from '@/model/types';
import type { ProjectIndex } from '@/model/query';
import { command, store, useProject, useProjectIndex } from '@/store';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { IconButton } from '@/ui/IconButton';
import { NumberInput } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { Field, Note, Section, Stat, TextField, fmtM, run } from '../shared';

const NO_CABLE = 'none';
const NO_ENTRY = 'none';

/** Clear the "needs review" flag F8 set when it re-attached an end. */
export const markRouteReviewed = (routeId: Id) =>
  command('Mark route reviewed', 'layout', (d) => {
    const r = d.routes[routeId];
    if (!r) throw new Error(`Route not found: ${routeId}`);
    delete r.needsReview;
  });

/** One end of a route. `furcation` is set when a cable jacket fans out there: the jacket then drops to that floor point and never enters the rack, so there is nothing to dress. */
function EndDressing({ routeId, endRef, route, end, furcation }: { routeId: Id; endRef: PortRef; route: Route; end: 'a' | 'b'; furcation?: Vec2 }) {
  const project = useProject();
  const idx = useProjectIndex();
  const path = end === 'a' ? route.aRack : route.bRack;
  const rack = idx.rackOfComponent(endRef.componentId);
  const entries = rack ? project.accessories.filter((a) => a.rackId === rack.id && a.type === 'top-entry') : [];
  const manager = rack ? managerFor(project, rack.id, path.side) : undefined;
  const entryLabel = (id: Id) => {
    const a = entries.find((x) => x.id === id);
    return a ? `Top entry · ${a.side ?? 'center'}${a.face ? ` · ${a.face}` : ''}` : id;
  };
  if (furcation) {
    return (
      <div className="flex flex-col gap-1" data-route-end={end} data-furcation-end>
        <div className="flex items-center gap-1 text-[12px]">
          <span className="mono min-w-0 flex-1 truncate">
            {end.toUpperCase()}: furcation point
            {rack && <span className="ml-1 text-fg-muted">for {rack.name}</span>}
          </span>
          <Badge>legs auto</Badge>
        </div>
        <Note>The jacket drops to the furcation node at {Math.round(furcation.x)}, {Math.round(furcation.y)} mm; the legs run from there to their ports.</Note>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1" data-route-end={end}>
      <div className="flex items-center gap-1 text-[12px]">
        <span className="mono min-w-0 flex-1 truncate">
          {end.toUpperCase()}: {idx.endLabel(endRef)}
          {rack && <span className="ml-1 text-fg-muted">in {rack.name}</span>}
        </span>
        {path.pinned ? <Badge tone="accent">pinned</Badge> : <Badge>auto</Badge>}
      </div>
      {!rack && <Note tone="warning">Device is unplaced; in-rack dressing applies once it sits in a rack.</Note>}
      <Field label="Manager side">
        <Select
          aria-label={`End ${end.toUpperCase()} manager side`}
          value={path.side}
          onValueChange={(v) => run(layout.setInRackPath(routeId, end, { side: v as Side }))}
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
          onValueChange={(v) => run(layout.setInRackPath(routeId, end, { entry: v === NO_ENTRY ? null : v }))}
          options={[{ value: NO_ENTRY, label: 'None' }, ...entries.map((a) => ({ value: a.id, label: entryLabel(a.id) }))]}
          className="w-full"
          disabled={!rack}
        />
      </Field>
      {rack && !manager && <Note tone="warning">No vertical manager on the {path.side} of {rack.name} (add one in the rack inspector).</Note>}
      {rack && entries.length === 0 && <Note tone="warning">{rack.name} has no top entry; the cable cannot leave the rack.</Note>}
      {path.pinned && (
        <div>
          <Button size="sm" variant="ghost" onClick={() => run(layout.resetInRackPath(routeId, end))}>
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

/** 'SW3:eth1/51' or 'PP1:f1, PP1:f2 … · 2 unassigned' for one side of a cable. */
function sideLabel(idx: ProjectIndex, cable: Cable, side: CableSide): string {
  const refs = cableEnds(idx.project, cable)[side];
  const missing = unassignedLegs(cable, side).length;
  const names = refs.map((r) => idx.endLabel(r));
  const shown = names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
  return `${shown || '—'}${missing ? ` · ${missing} unassigned` : ''}`;
}

/** Position and pinned state of one side's furcation node (the point where the jacket splits into legs). */
function FurcationFields({ cable, side }: { cable: Cable; side: CableSide }) {
  const project = useProject();
  const f = furcationFloorPos(project, cable, side);
  const set = (pos: Vec2, pinned: boolean) => run(cableCommands.setFurcation(cable.id, side, pos, pinned));
  if (!f) return <Note>Side {side}: place one of its ports to position the furcation.</Note>;
  return (
    <div className="flex flex-col gap-1" data-furcation-side={side}>
      <div className="flex items-center gap-1 text-[12px]">
        <span className="min-w-0 flex-1 truncate">Side {side}</span>
        {f.pinned ? <Badge tone="accent">pinned</Badge> : <Badge>auto</Badge>}
      </div>
      <Field label="Position">
        <NumberInput aria-label={`Furcation ${side} x`} value={f.pos.x} unit="mm" decimals={0} step={50} onChange={(x) => set({ x, y: f.pos.y }, true)} />
        <NumberInput aria-label={`Furcation ${side} y`} value={f.pos.y} unit="mm" decimals={0} step={50} onChange={(y) => set({ x: f.pos.x, y }, true)} />
      </Field>
      <Field label="Pinned">
        <Checkbox
          checked={f.pinned}
          aria-label={`Furcation ${side} pinned`}
          label={f.pinned ? 'Stays put when the ports move (P toggles)' : 'Follows the ports at the breakout length'}
          onCheckedChange={(v) => set(f.pos, v === true)}
        />
      </Field>
    </div>
  );
}

export function RouteInspector({ linkId }: { linkId: Id }) {
  const routeId = linkId;
  const project = useProject();
  const idx = useProjectIndex();
  // A route's ends: the link's, or a cable jacket's (side A's port → side B's furcation). Null while a cable side is unplugged.
  const ends = resolveEndsOf(idx, routeId);
  const link = ends?.link ?? idx.link(routeId);
  const cable = ends?.cable ?? idx.cable(routeId);
  const route = project.routes[routeId];
  const cables = catalogIndex(project).catalog.cables;
  const length = useMemo(() => (route ? routedLengthM(project, routeId) : estimatedLengthM(project, routeId)), [project, route, routeId]);
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
  if (!link && !cable) return null;
  const resolved = cable ? resolveCableOf(project, cable) : undefined;
  const fanned = cable ? (['A', 'B'] as const).filter((s) => sideIsFanned(project, cable, s)) : [];

  const cableOptions = [{ value: NO_CABLE, label: 'No cable' }, ...cables.map((c) => ({ value: c.id, label: c.name }))];
  const waypointOptions = route
    ? route.segments.flatMap((seg, segIdx) =>
        seg.points.map((wp, i) => ({ value: `${segIdx}:${wp.id}`, label: `${seg.layer} #${i + 1}${wp.pinned ? ' (pinned)' : ''}` })),
      )
    : [];
  const addLoop = () => {
    const [segStr, wpId] = loopTarget.split(':');
    if (segStr === undefined || wpId === undefined) return;
    run(layout.setServiceLoop(routeId, Number(segStr), wpId, loopM));
  };
  const startRouting = () => {
    store.getState().patchLayout({ tool: 'route', routingLinkId: routeId });
  };

  return (
    <>
      {link ? (
        <Section title="Link">
          <Field label="Label">
            <TextField aria-label="Link label" value={link.label ?? ''} placeholder={idx.linkLabel(link)} onCommit={(v) => run(schematic.setLinkLabel(routeId, v.trim() || undefined))} mono />
          </Field>
          <Field label="Cable">
            <Select
              aria-label="Cable"
              value={link.cableDefId ?? NO_CABLE}
              onValueChange={(v) => run(schematic.setLinkCable(routeId, v === NO_CABLE ? null : v))}
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
      ) : (
        cable && (
          <Section title="Cable" className="cable-route">
            <Field label="Label">
              <TextField aria-label="Cable label" value={cable.label} onCommit={(v) => run(cableCommands.setCableLabel(cable.id, v))} mono />
            </Field>
            <Stat label="Definition" value={resolved?.displayName ?? cable.cableDefId} />
            {resolved && <Stat label="Type" value={resolved.summary} />}
            <Stat label="Side A" value={<span className="mono">{sideLabel(idx, cable, 'A')}</span>} />
            <Stat label="Side B" value={<span className="mono">{sideLabel(idx, cable, 'B')}</span>} />
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" onClick={() => store.getState().revealSelection([{ kind: 'cable', id: cable.id }], 'schematic')}>
                Show in schematic
              </Button>
            </div>
            {!route && (
              <>
                <Note tone="info">
                  {ends
                    ? 'Unrouted: the jacket shows as an airwire from side A to the furcation point; the legs fan out from there.'
                    : 'Plug a port on each side (in the schematic) to route the jacket.'}
                </Note>
                {ends && (
                  <div>
                    <Button size="sm" variant="primary" onClick={startRouting}>
                      Route jacket (X)
                    </Button>
                  </div>
                )}
              </>
            )}
          </Section>
        )
      )}
      {cable && fanned.length > 0 && (
        <Section title="Furcation">
          {fanned.map((side) => (
            <FurcationFields key={side} cable={cable} side={side} />
          ))}
        </Section>
      )}
      {route && (
        <>
          {route.needsReview && (
            <Section title="Review">
              <div className="flex items-center gap-2">
                <Badge tone="warning">needs review</Badge>
                <span className="min-w-0 flex-1 text-[11px] text-fg-muted">Update Layout re-attached an end of this route.</span>
                <Button size="sm" onClick={() => run(markRouteReviewed(routeId))}>
                  Mark reviewed
                </Button>
              </div>
            </Section>
          )}
          <Section title="In-rack dressing">
            {ends ? (
              <>
                <EndDressing routeId={routeId} endRef={ends.a} route={route} end="a" {...(ends.furcationA ? { furcation: ends.furcationA } : {})} />
                <div className="my-1 border-t border-border" />
                <EndDressing routeId={routeId} endRef={ends.b} route={route} end="b" {...(ends.furcationB ? { furcation: ends.furcationB } : {})} />
              </>
            ) : (
              <Note tone="warning">A side of the cable is unplugged; the route is kept but cannot be dressed until it is plugged again.</Note>
            )}
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
              <Button size="sm" onClick={() => run(layout.pinAll(routeId))}>
                Pin all
              </Button>
              <Button size="sm" onClick={() => run(layout.unpinAll(routeId))}>
                Unpin all
              </Button>
              <Button size="sm" onClick={() => run(layout.straighten(routeId))}>
                Straighten
              </Button>
              <Button size="sm" variant="danger" onClick={() => run(layout.unroute(routeId))}>
                Unroute
              </Button>
            </div>
          </Section>
          <Section title={`Service loops (${loops.length})`}>
            {loops.map((l) => (
              <div key={l.wpId} className="flex items-center gap-1">
                <span className="w-24 shrink-0 truncate text-[12px] text-fg-muted">{l.label}</span>
                <NumberInput aria-label={`Loop at ${l.label}`} value={l.metres} min={0} step={0.5} decimals={2} unit="m" onChange={(m) => run(layout.setServiceLoop(routeId, l.segIdx, l.wpId, m > 0 ? m : null))} className="flex-1" />
                <IconButton label="Remove service loop" icon="trash" onClick={() => run(layout.setServiceLoop(routeId, l.segIdx, l.wpId, null))} />
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
      <Section title={route ? (cable ? 'Jacket length' : 'Length') : cable ? 'Jacket length (estimate)' : 'Length (estimate)'}>
        {length ? <LengthBreakdown length={length} /> : <Note>Both ends must be placed to compute a length.</Note>}
      </Section>
    </>
  );
}
