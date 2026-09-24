/**
 * Room properties, shown when nothing is selected: floor grid, ceiling,
 * raised floor and the outline vertices, plus a site summary.
 */
import { useMemo } from 'react';
import { layout } from '@/commands';
import { countUnrouted } from '@/panels/shell/StatusBar';
import { useProject } from '@/store';
import { NumberInput } from '@/ui/Input';
import { Field, Note, Section, Stat, VertexList, run } from '../shared';

export function RoomInspector() {
  const project = useProject();
  const room = project.room;
  const stats = useMemo(() => {
    const placed = project.placements.filter((p) => p.rackId !== null).length;
    const { unrouted, total } = countUnrouted(project);
    return { placed, unplaced: project.components.length - placed, unrouted, total };
  }, [project]);

  return (
    <>
      <Section title="Room">
        <Field label="Floor grid">
          <NumberInput aria-label="Floor grid" value={room.gridMm} min={0} step={100} decimals={0} unit="mm" onChange={(v) => run(layout.setRoomParam('gridMm', v))} />
        </Field>
        <Field label="Ceiling">
          <NumberInput aria-label="Ceiling height" value={room.ceilingMm} min={1} step={100} decimals={0} unit="mm" onChange={(v) => run(layout.setRoomParam('ceilingMm', v))} />
        </Field>
        <Field label="Raised floor">
          <NumberInput aria-label="Raised floor" value={room.raisedFloorMm} min={0} step={50} decimals={0} unit="mm" onChange={(v) => run(layout.setRoomParam('raisedFloorMm', v))} />
        </Field>
        <Note>Overhead trays default to 600 mm below the ceiling; underfloor trays sit in the raised-floor void.</Note>
      </Section>
      <Section title={`Outline (${room.outline.length} vertices)`}>
        <VertexList points={room.outline} onChange={(pts) => run(layout.setRoomOutline(pts))} />
      </Section>
      <Section title="Site">
        <Stat label="Racks" value={String(project.racks.length)} />
        <Stat label="Devices" value={`${stats.placed} placed · ${stats.unplaced} unplaced`} />
        <Stat label="Cables" value={`${stats.total - stats.unrouted} routed · ${stats.unrouted} airwires`} />
        <Stat label="Trays" value={String(project.trays.length)} />
        <Stat label="Keep-outs" value={String(project.keepouts.length)} />
        <Note>Select a rack, device, cable, tray or waypoint to edit it here.</Note>
      </Section>
    </>
  );
}
