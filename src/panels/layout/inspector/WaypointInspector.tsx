/**
 * Waypoint properties: position, pinned flag, rack anchor and service loop.
 */
import { layout } from '@/commands';
import type { Id } from '@/model/types';
import { store, useProject, useProjectIndex } from '@/store';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { NumberInput } from '@/ui/Input';
import { Field, Note, Section, Stat, run } from '../shared';

export function WaypointInspector({ routeId, segmentIndex, waypointId }: { routeId: Id; segmentIndex: number; waypointId: Id }) {
  const project = useProject();
  const idx = useProjectIndex();
  const route = project.routes[routeId];
  const seg = route?.segments[segmentIndex];
  const i = seg?.points.findIndex((p) => p.id === waypointId) ?? -1;
  const wp = i >= 0 ? seg?.points[i] : undefined;
  const link = idx.link(routeId);
  if (!route || !seg || !wp) return <Note>Waypoint no longer exists.</Note>;
  const anchorRack = wp.anchor ? idx.rack(wp.anchor.rackId) : undefined;

  return (
    <>
      <Section title={`Waypoint ${i + 1} of ${seg.points.length}`}>
        <Stat
          label="Route"
          value={
            <button type="button" className="mono truncate hover:underline" onClick={() => store.getState().select({ kind: 'link', id: routeId })}>
              {link ? idx.linkLabel(link) : routeId}
            </button>
          }
        />
        <Stat label="Layer" value={`${seg.layer}${seg.trayId ? ` · ${project.trays.find((t) => t.id === seg.trayId)?.name ?? 'tray'}` : ''}`} />
        <Field label="Position">
          <NumberInput aria-label="Waypoint x" value={wp.pos.x} unit="mm" decimals={0} step={50} onChange={(x) => run(layout.moveWaypoint(routeId, segmentIndex, waypointId, { x, y: wp.pos.y }))} />
          <NumberInput aria-label="Waypoint y" value={wp.pos.y} unit="mm" decimals={0} step={50} onChange={(y) => run(layout.moveWaypoint(routeId, segmentIndex, waypointId, { x: wp.pos.x, y }))} />
        </Field>
        <Field label="Pinned">
          <Checkbox
            checked={wp.pinned}
            aria-label="Pinned"
            label={wp.pinned ? 'Never moved by rack or device moves' : 'Re-squared when an endpoint moves'}
            onCheckedChange={(v) => run(layout.setPinned(routeId, segmentIndex, waypointId, v === true))}
          />
        </Field>
        <Stat
          label="Anchor"
          value={
            wp.anchor
              ? `${anchorRack?.name ?? wp.anchor.rackId} · offset ${Math.round(wp.anchor.offset.x)},${Math.round(wp.anchor.offset.y)} mm (moves with the rack)`
              : 'none'
          }
        />
        <Field label="Service loop" hint="0 = none">
          <NumberInput
            aria-label="Service loop"
            value={wp.serviceLoopM ?? 0}
            min={0}
            step={0.5}
            decimals={2}
            unit="m"
            onChange={(m) => run(layout.setServiceLoop(routeId, segmentIndex, waypointId, m > 0 ? m : null))}
          />
        </Field>
        <div className="pt-1">
          <Button size="sm" variant="danger" onClick={() => run(layout.deleteWaypoint(routeId, segmentIndex, waypointId))}>
            Delete waypoint
          </Button>
        </div>
      </Section>
    </>
  );
}
