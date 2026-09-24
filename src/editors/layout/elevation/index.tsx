import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { layout } from '@/commands';
import { indexProject } from '@/model/query';
import type { Vec2 } from '@/model/types';
import { store, useLayoutUi, useProject, useSelection } from '@/store';
import { registerShortcut } from '@/store/shortcuts';
import { run } from '@/panels/layout/shared';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';
import { PhysicalCanvas } from '../PhysicalCanvas';
import { caption, selectedRackIds, stroke } from '../physicalScene';
import { columnAt, columnRect, columnsBounds, deviceRect, dropSlot, ghostFit, layoutColumns, managerCenterX, portPoint, uAtY, uBottomY, uTopY } from './geometry';
import { COMPONENT_MIME, portTypeColor } from './constants';

export function ElevationView() {
  const project = useProject(), ui = useLayoutUi(), selection = useSelection(), idx = indexProject(project);
  const [fit, setFit] = useState(0);
  const selectedRacks = selectedRackIds(project, selection.filter((s) => s.kind === 'rack'));
  const followed = ui.elevationFollowsSelection && selectedRacks.length ? selectedRacks : ui.elevationRackIds;
  const racks = project.racks.filter((r) => !followed.length || followed.includes(r.id));
  const columns = useMemo(() => layoutColumns(racks, project.accessories, ui.elevationFace), [racks, project.accessories, ui.elevationFace]);
  const bounds = columnsBounds(columns, 300);
  const drag = useRef<{ id: string; offset: number } | null>(null);
  const [ghost, setGhost] = useState<{ id: string; rackId: string; u: number; ok: boolean; reason: string | null } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const devices = columns.flatMap((column) => idx.componentsInRack(column.rack.id).flatMap((c) => {
    const p = idx.placement(c.id);
    if (p?.uPosition == null) return [];
    const fp = idx.footprintOf(c);
    return [{ c, p, column, fp, rect: deviceRect(column, p.uPosition, fp?.heightU ?? 1, fp?.widthMm) }];
  }));
  const at = (p: Vec2) => devices.find(({ rect: r }) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height);
  const target = (p: Vec2, id: string, offset = 0) => {
    const column = columnAt(columns, p.x), c = idx.component(id);
    if (!column || !c || p.y > 0 || p.y < -column.stackTop) return null;
    const u = dropSlot(column.rack.heightU, p.y, idx.heightUOf(c), offset);
    return { id, rackId: column.rack.id, ...ghostFit(project, id, column.rack.id, u) };
  };
  const cancel = useCallback(() => { drag.current = null; setGhost(null); }, []);
  useEffect(() => {
    const off = [registerShortcut({ id: 'elevation.cancel', editor: 'layout', keys: 'escape', handler: cancel }), registerShortcut({ id: 'elevation.unplace', editor: 'layout', keys: ['delete', 'backspace'], when: () => selection.some((s) => s.kind === 'component'), handler: () => {
      const ids = selection.flatMap((s) => s.kind === 'component' ? [s.id] : []);
      if (ids.length) run(layout.unplaceComponent(ids));
    } })];
    return () => off.forEach((f) => f());
  }, [selection, cancel]);
  const request = ui.viewportRequest;
  const frame = useMemo(() => request && request.kind !== 'rect' ? bounds : null, [request, bounds.x, bounds.y, bounds.width, bounds.height]);
  const handled = useCallback(() => store.getState().requestViewport('layout', null), []);
  return <div className="flex h-full min-h-0 flex-col" data-testid="elevation-view" data-device-count={devices.length}>
    <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-1">
      <Select aria-label="Elevation rack" value={followed.length === 1 ? followed[0] : 'all'} onValueChange={(v) => { store.getState().patchLayout({ elevationFollowsSelection: false, elevationRackIds: v === 'all' ? [] : [v] }); }} options={[{ value: 'all', label: 'All racks' }, ...project.racks.map((r) => ({ value: r.id, label: r.name }))]} />
      <Button active={ui.elevationFace === 'front'} onClick={() => store.getState().setElevationFace('front')}>Front</Button>
      <Button active={ui.elevationFace === 'rear'} onClick={() => store.getState().setElevationFace('rear')}>Rear</Button>
      <Button active={ui.elevationFollowsSelection} onClick={() => store.getState().patchLayout({ elevationFollowsSelection: !ui.elevationFollowsSelection })}>Follow rack selection</Button>
      <Button onClick={() => setFit((v) => v + 1)}>Fit racks</Button>
    </div>
    <div className="min-h-0 flex-1"><PhysicalCanvas testId="elevation-canvas" label="Rack elevation" bounds={bounds} resetKey={`${project.id}:${columns.map((c) => c.rack.id).join(',')}:${fit}`} frame={frame} onFrame={handled} onCancel={cancel}
      onDown={(p, e) => { const hit = at(p); if (hit) { store.getState().select({ kind: 'component', id: hit.c.id }, { toggle: e.shift }); if (!e.shift) drag.current = { id: hit.c.id, offset: uAtY(p.y) - hit.p.uPosition! }; } else { const c = columnAt(columns, p.x); if (c) store.getState().select({ kind: 'rack', id: c.rack.id }); } }}
      onMove={(p) => { if (drag.current) setGhost(target(p, drag.current.id, drag.current.offset)); else setHover(at(p)?.c.id ?? null); }}
      onUp={(p) => { const g = drag.current; if (g) { const t = target(p, g.id, g.offset); if (t && (idx.placement(g.id)?.rackId !== t.rackId || idx.placement(g.id)?.uPosition !== t.u)) run(layout.moveDevice(g.id, t.rackId, t.u)); } cancel(); }}
      onDoubleClick={(p) => { const d = at(p); if (d) store.getState().revealSelection([{ kind: 'component', id: d.c.id }], 'schematic'); }}
      onDrop={(p, data) => { const id = data.getData(COMPONENT_MIME); const t = target(p, id); if (t) run(layout.placeComponent(id, t.rackId, t.u, ui.elevationFace)); }}
      paint={(ctx, zoom) => {
        for (const column of columns) {
          const r = columnRect(column);
          ctx.fillStyle = '#131e29'; ctx.fillRect(r.x, r.y, r.width, r.height); ctx.strokeStyle = '#688298'; ctx.lineWidth = 2 / zoom; ctx.strokeRect(r.x, r.y, r.width, r.height);
          caption(ctx, column.rack.name, { x: r.x + r.width / 2, y: r.y - 90 }, 16 / zoom, '#85c9fa');
          for (let u = 1; u <= column.rack.heightU; u++) {
            stroke(ctx, [{ x: r.x, y: uBottomY(u) }, { x: r.x + r.width, y: uBottomY(u) }], '#293947', 0.5 / zoom);
            caption(ctx, String(u), { x: r.x + 25, y: (uTopY(u) + uBottomY(u)) / 2 }, Math.min(25, 9 / zoom), '#8096aa');
          }
          for (const manager of Object.values(column.managers)) if (manager) {
            ctx.fillStyle = '#1f303d'; ctx.fillRect(manager.x, column.y, manager.width, column.top);
            for (let u = 1; u <= column.rack.heightU; u++) stroke(ctx, [{ x: manager.x, y: uBottomY(u) }, { x: manager.x + manager.width, y: uBottomY(u) }], '#405466', 0.6 / zoom);
          }
          for (const accessory of project.accessories.filter((a) => a.rackId === column.rack.id && a.uPosition && a.type !== 'vcm')) {
            const ar = deviceRect(column, accessory.uPosition!, accessory.heightU ?? 1);
            ctx.fillStyle = '#65522f'; ctx.fillRect(ar.x, ar.y, ar.width, ar.height); caption(ctx, accessory.type, { x: ar.x + ar.width / 2, y: ar.y + ar.height / 2 }, Math.min(22, 10 / zoom), '#ead5a1');
          }
        }
        for (const { c, p, fp, rect: r, column } of devices) {
          const selected = selection.some((s) => s.kind === 'component' && s.id === c.id);
          ctx.fillStyle = selected ? '#265679' : p.face === ui.elevationFace ? '#304757' : '#1d303e'; ctx.fillRect(r.x, r.y, r.width, r.height);
          ctx.strokeStyle = selected ? '#8ed6ff' : '#708a9e'; ctx.lineWidth = (selected ? 2 : 0.7) / zoom; ctx.strokeRect(r.x, r.y, r.width, r.height);
          caption(ctx, c.ref, { x: r.x + r.width / 2, y: r.y + r.height / 2 }, Math.min(28, 11 / zoom));
          for (const port of fp?.ports ?? []) {
            const pos = portPoint(column, p.uPosition!, port, p.face, fp?.widthMm);
            if (!pos.visible) continue;
            ctx.fillStyle = idx.isPortFree(c.id, port.id) ? portTypeColor(port.type) : '#59ddd2'; ctx.fillRect(pos.x - 4, pos.y - 3, 8, 6);
          }
        }
        for (const link of project.links) {
          const route = project.routes[link.id], selected = selection.some((s) => s.kind === 'link' && s.id === link.id);
          if (!route && (ui.ratsnest === 'none' || (ui.ratsnest === 'selection' && !selected && ![link.a, link.b].some((e) => selection.some((s) => s.kind === 'component' && s.id === e.componentId))))) continue;
          const ends = [link.a, link.b].map((end) => {
            const d = devices.find((d) => d.c.id === end.componentId), port = d?.fp?.ports.find((p) => p.id === end.portId);
            return d && port ? { ...d, point: portPoint(d.column, d.p.uPosition!, port, d.p.face, d.fp?.widthMm) } : null;
          });
          const color = selected ? '#fff' : idx.cableOf(link)?.color ?? '#85b2c9';
          ctx.globalAlpha = selected ? 1 : route ? 0.7 : 0.25; ctx.setLineDash(route ? [] : [4 / zoom, 4 / zoom]);
          const a = ends[0], b = ends[1];
          if (!route && a && b) stroke(ctx, [a.point, b.point], color, 0.8 / zoom);
          else if (route) {
            ends.forEach((end, i) => { if (!end) return; const side = i ? route.bRack.side : route.aRack.side, x = managerCenterX(end.column, side);
              const other = ends[i ? 0 : 1]; const top = other?.column.rack.id === end.column.rack.id ? other.point.y : end.column.y - 100;
              stroke(ctx, [end.point, { x, y: end.point.y }, { x, y: top }], color, (selected ? 2 : 1) / zoom);
            });
            if (a && b && a.column.rack.id !== b.column.rack.id) stroke(ctx, [{ x: managerCenterX(a.column, route.aRack.side), y: a.column.y - 100 }, { x: managerCenterX(b.column, route.bRack.side), y: b.column.y - 100 }], color, 1 / zoom);
          }
        }
        ctx.globalAlpha = 1; ctx.setLineDash([]);
        if (ghost) { const col = columns.find((c) => c.rack.id === ghost.rackId), c = idx.component(ghost.id); if (col && c) { const r = deviceRect(col, ghost.u, idx.heightUOf(c)); ctx.fillStyle = ghost.ok ? '#4ade8066' : '#ff555577'; ctx.fillRect(r.x, r.y, r.width, r.height); } }
      }}>
      {ghost && <div className="absolute bottom-2 left-2 rounded bg-panel px-2 py-1 text-xs">{ghost.ok ? `Place at U${ghost.u}` : ghost.reason}</div>}
      {hover && !ghost && <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-panel px-2 py-1 text-xs">{idx.component(hover)?.ref} · {idx.footprintOf(idx.component(hover)!)?.model} · drag to move · double-click for schematic</div>}
      {!columns.length && <p className="absolute inset-x-0 top-1/2 text-center text-fg-muted">Add a rack in Floor view to begin.</p>}
    </PhysicalCanvas></div>
  </div>;
}
