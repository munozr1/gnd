import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { produce } from 'immer';
import { cables as cableCommands, isPatchFrame, layout } from '@/commands';
import type { CableSide } from '@/model/cables';
import { boundsOf, dist, pointInPolygon, snapVec } from '@/model/geometry';
import { indexProject } from '@/model/query';
import { onRackMoved, rackCenter, rackFloorRect, rackFrontDir, routeFloorEndpoints, trayFill } from '@/model/routing';
import type { SelectionItem, Vec2 } from '@/model/types';
import { store, useLayoutUi, useProject, useSelection } from '@/store';
import { registerShortcut } from '@/store/shortcuts';
import { run } from '@/panels/layout/shared';
import { useStatusBarFields } from '@/panels/shell/StatusBarContext';
import { Button } from '@/ui/Button';
import { toast } from '@/ui/Toast';
import { COMPONENT_MIME } from './elevation/constants';
import { firstFreeSlot } from './elevation/geometry';
import { caption, floorBounds, floorCables, floorLinks, furcationGlyph, physicalSelectionBounds, selectedRackIds, stroke, tooltip } from './physicalScene';
import { PhysicalCanvas } from './PhysicalCanvas';
import { segmentEntry, SegmentIndex } from './spatial';
import { constrainPoint, trayAlongPolyline } from './constraints';

/** Patch frames are drawn warmer than device racks so a free-standing frame reads at a glance. */
const FRAME = { fill: '#3a3424', fillSelected: '#4d4322', stroke: '#c9a24b', strokeSelected: '#ffd166', text: '#f1dfae', subtext: '#d8b86a' };
/** Furcation node half-size and hit radius, screen pixels. */
const NODE_PX = 5;
const NODE_HIT_PX = 9;

export function FloorView() {
  const project = useProject(), ui = useLayoutUi(), selection = useSelection();
  const idx = indexProject(project);
  const [cursor, setCursor] = useState<Vec2>({ x: 0, y: 0 });
  const [points, setPoints] = useState<Vec2[]>([]);
  const [preview, setPreview] = useState<{ ids: string[]; delta: Vec2 } | null>(null);
  /** Floor point under an Unplaced-bin drag, while one is over the canvas. */
  const [dragPoint, setDragPoint] = useState<Vec2 | null>(null);
  /** Furcation node under the pointer, as '<cableId>:<side>'. */
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const drag = useRef<{ ids: string[]; start: Vec2 } | null>(null);
  /** A furcation node being dragged: every step is a coalesced setFurcation, so the whole drag is one undo entry. */
  const nodeDrag = useRef<{ cableId: string; side: CableSide; dragId: string } | null>(null);
  const scale = useRef(0.1);
  const [fit, setFit] = useState(0);
  const selectedRacks = selectedRackIds(project, selection);
  const selectedLinks = new Set(selection.flatMap((s) => s.kind === 'link' ? [s.id] : []));
  const selectedCables = new Set(selection.flatMap((s) => s.kind === 'cable' ? [s.id] : []));
  const data = useMemo(() => preview ? produce(project, (d) => {
    for (const id of preview.ids) { const rack = d.racks.find((r) => r.id === id); if (rack) { rack.pos.x += preview.delta.x; rack.pos.y += preview.delta.y; onRackMoved(d, id, preview.delta); } }
  }) : project, [project, preview]);
  const links = useMemo(() => floorLinks(data), [data]);
  const cables = useMemo(() => floorCables(data), [data]);
  const visibleLinks = links.filter((entry) => {
    if (entry.routed) return !entry.layers.length || entry.layers.some((l) => ui.visibleLayers[l]);
    if (ui.ratsnest === 'none') return false;
    return ui.ratsnest === 'all' || selectedLinks.has(entry.link.id) || [entry.link.a, entry.link.b].some((e) => selectedRacks.includes(idx.rackOfComponent(e.componentId)?.id ?? ''));
  });
  const visibleCables = cables.filter((c) => {
    if (c.routed) return !c.layers.length || c.layers.some((l) => ui.visibleLayers[l]);
    if (ui.ratsnest === 'none') return false;
    return ui.ratsnest === 'all' || selectedCables.has(c.cable.id) || c.rackIds.some((id) => selectedRacks.includes(id));
  });
  const nodes = visibleCables.flatMap((c) => c.furcations.map((f) => ({ key: `${c.cable.id}:${f.side}`, cableId: c.cable.id, side: f.side, pos: f.pos, pinned: f.pinned, tip: `${c.label} · ${c.fiberCount}F` })));
  const hitIndex = useMemo(() => new SegmentIndex<SelectionItem>([
    ...visibleLinks.flatMap((l) => l.points.slice(1).map((p, i) => segmentEntry(l.points[i]!, p, { kind: 'link', id: l.link.id } as SelectionItem))),
    ...visibleCables.flatMap((c) => [c.jacket, ...c.legs.map((l) => l.points)].flatMap((pts) => pts.slice(1).map((p, i) => segmentEntry(pts[i]!, p, { kind: 'cable', id: c.cable.id } as SelectionItem)))),
    ...data.trays.filter((t) => ui.visibleLayers[t.layer]).flatMap((t) => t.points.slice(1).map((p, i) => segmentEntry(t.points[i]!, p, { kind: 'tray', id: t.id } as SelectionItem))),
  ]), [visibleLinks, visibleCables, data.trays, ui.visibleLayers]);
  const bounds = useMemo(() => floorBounds(project), [project]);
  const frame = useMemo(() => {
    const r = ui.viewportRequest;
    return !r || (ui.view === 'split' && r.kind === 'items' && r.items.some((i) => i.kind === 'component')) ? null : r.kind === 'fit' ? bounds : r.kind === 'rect' ? r.rect : physicalSelectionBounds(project, r.items);
  }, [ui.viewportRequest, ui.view, project, bounds]);
  const handled = useCallback(() => store.getState().requestViewport('layout', null), []);
  const cancel = useCallback(() => { drag.current = null; nodeDrag.current = null; setPreview(null); setPoints([]); setDragPoint(null); store.getState().patchLayout({ tool: 'select', placing: null, routingLinkId: null }); }, []);
  useEffect(() => { setPoints([]); setPreview(null); setDragPoint(null); drag.current = null; nodeDrag.current = null; }, [project.id, ui.tool, ui.placing]);
  /** Where the route being drawn starts and must end: the link's two ports, or a cable jacket's side-A port and side-B furcation point. */
  const routeTarget = useMemo(() => ui.tool === 'route' && ui.routingLinkId ? routeFloorEndpoints(project, ui.routingLinkId) : null, [ui.tool, ui.routingLinkId, project]);
  useStatusBarFields({ mode: `Layout · ${ui.tool}`, coords: `x ${Math.round(cursor.x)}  y ${Math.round(cursor.y)} mm`, message: ui.tool === 'select' ? 'Drag racks · Double-click a rack for elevation · X route · P pin furcation · Scroll to zoom · Drop devices on the floor' : ui.tool === 'route' ? 'Click points · Enter or a click on the end finishes · Esc cancels' : 'Click points · Enter finishes · Esc cancels' });
  const finish = () => {
    if (ui.tool === 'route' && ui.routingLinkId && points.length) {
      const end = routeTarget?.end;
      if (end) {
        const last = points.at(-1)!;
        const path = [...points, { x: end.x, y: last.y }, end];
        const trayId = trayAlongPolyline(path, project.trays, 150, ui.activeLayer);
        if (run(layout.finishRoute(ui.routingLinkId, [{ layer: ui.activeLayer, points: path, ...(trayId ? { trayId } : {}) }]))) cancel();
      }
    } else if (ui.placing?.kind === 'tray' && points.length >= 2) {
      const def = idx.catalog.trays.get(ui.placing.defId);
      if (def && run(layout.addTray(def, points, ui.placing.elevationMm))) cancel();
    } else if (ui.tool === 'keepout' && points.length >= 3) { if (run(layout.addKeepout({ outline: points }))) cancel(); }
    else if (ui.tool === 'room' && points.length >= 3) { if (run(layout.setRoomOutline(points))) cancel(); }
  };
  /** Start routing a link, or a cable's jacket (from side A's port to the furcation point). */
  const startRoute = (id?: string) => {
    const routeId = id ?? selection.flatMap((s) => s.kind === 'link' || s.kind === 'cable' ? [s.id] : [])[0];
    if (!routeId || !routeFloorEndpoints(project, routeId)) return;
    store.getState().patchLayout({ tool: 'route', routingLinkId: routeId, placing: null });
  };
  useEffect(() => {
    if (ui.tool === 'route' && ui.routingLinkId) {
      const ends = routeFloorEndpoints(project, ui.routingLinkId);
      if (ends) setPoints([ends.start]);
    }
  }, [ui.tool, ui.routingLinkId, project.id]);
  /** P: pin the selected cables' furcation nodes where they are, or let them follow the ports again. */
  const togglePinnedFurcations = () => {
    for (const c of cables) {
      if (!selectedCables.has(c.cable.id)) continue;
      for (const f of c.furcations) run(cableCommands.setFurcation(c.cable.id, f.side, f.pos, !f.pinned));
    }
  };
  useEffect(() => {
    const bind = (id: string, keys: string | string[], handler: () => void) => registerShortcut({ id: `floor.${id}`, editor: 'layout', keys, handler, when: () => !store.getState().ui.activeDialog });
    const off = [bind('cancel', 'escape', cancel), bind('finish', 'enter', finish), bind('route', 'x', () => startRoute()), bind('pin-furcation', 'p', togglePinnedFurcations), bind('rotate', 'r', () => { for (const id of selectedRacks) run(layout.rotateRack(id)); }), bind('delete', ['delete', 'backspace'], () => {
      if (selectedRacks.length && selection.every((s) => s.kind === 'rack')) run(layout.deleteRacks(selectedRacks));
      else if (selectedLinks.size) run(layout.unroute([...selectedLinks]));
      else if (selectedCables.size) { const routed = [...selectedCables].filter((id) => project.routes[id]); if (routed.length) run(layout.unroute(routed)); }
      else { const ids = selection.flatMap((s) => s.kind === 'component' ? [s.id] : []); if (ids.length) run(layout.unplaceComponent(ids)); }
    })];
    return () => off.forEach((f) => f());
  });
  const rackAt = (p: Vec2) => [...data.racks].reverse().find((r) => { const b = rackFloorRect(r); return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height; });
  const nodeAt = (p: Vec2) => { let best: (typeof nodes)[number] | null = null, bestD = NODE_HIT_PX / scale.current; for (const n of nodes) { const d = dist(p, n.pos); if (d <= bestD) { best = n; bestD = d; } } return best; };
  const snapped = (p: Vec2) => snapVec(p, ui.snapMm || 1);
  const drawingPoint = points.length && (ui.tool === 'tray' || ui.tool === 'route') ? constrainPoint(points.at(-1)!, snapped(cursor), 'ortho') : snapped(cursor);
  // Drop ghost: over a rack the device goes into that rack; over empty floor it gets its own patch frame (smallest catalog frame as the outline).
  const frameDef = idx.catalog.catalog.racks.filter((r) => r.kind === 'patch-frame').sort((a, b) => a.heightU - b.heightU)[0];
  const frameSize = { widthMm: frameDef?.widthMm ?? 600, depthMm: frameDef?.depthMm ?? 300 };
  const dropRack = dragPoint ? rackAt(dragPoint) : undefined;
  const dropGhost = dragPoint && !dropRack ? snapVec(dragPoint, project.room.gridMm) : null;
  const dropComponent = (p: Vec2, id: string) => {
    const c = idx.component(id);
    if (!c) return;
    const rack = rackAt(p);
    if (rack) {
      const u = firstFreeSlot(project, rack.id, idx.heightUOf(c));
      if (u === null) { toast(`No free U range in ${rack.name}.`, { tone: 'warning' }); return; }
      if (run(layout.placeComponent(id, rack.id, u))) { store.getState().select({ kind: 'component', id }); toast.ok(`${c.ref} placed in ${rack.name} at U${u}`); }
      return;
    }
    const cmd = layout.placeInNewFrame(id, snapVec(p, project.room.gridMm));
    if (run(cmd) && cmd.result) { store.getState().select({ kind: 'rack', id: cmd.result }); toast.ok(`${c.ref} placed as its own frame`); }
  };
  const routedCount = links.filter((l) => l.routed).length + cables.filter((c) => c.routed).length;
  const airwireCount = links.filter((l) => !l.routed).length + cables.filter((c) => !c.routed && c.jacket.length > 0).length;
  const tipNode = hoverNode && !nodeDrag.current ? nodes.find((n) => n.key === hoverNode) : undefined;
  return <div className="relative h-full min-h-0" data-rack-count={project.racks.length} data-route-count={routedCount} data-airwire-count={airwireCount} data-cable-count={cables.length} data-furcation-count={nodes.length} data-hover-furcation={hoverNode ?? undefined}>
    <PhysicalCanvas testId="floor-canvas" label="Floor plan" bounds={bounds} resetKey={`${project.id}:${fit}`} frame={frame} onFrame={handled} onCancel={cancel}
      onDown={(p, e) => {
        if (ui.placing?.kind === 'rack') { const def = idx.catalog.racks.get(ui.placing.defId); if (def) run(layout.addRack(def, snapVec(p, project.room.gridMm))); return; }
        // Routing: a click on the end (the far port, or a cable's furcation node) finishes the route there.
        if (ui.tool === 'route' && routeTarget && points.length && dist(p, routeTarget.end) <= NODE_HIT_PX / scale.current) { finish(); return; }
        if (ui.tool === 'tray' || ui.tool === 'route' || ui.tool === 'room' || ui.tool === 'keepout') { setPoints((old) => [...old, old.length && (ui.tool === 'tray' || ui.tool === 'route') ? constrainPoint(old.at(-1)!, snapped(p), e.shift ? 'diag' : 'ortho') : snapped(p)]); return; }
        // Furcation nodes sit inside rack footprints, so they win over the rack under them.
        const node = nodeAt(p);
        if (node && !e.alt) {
          store.getState().select({ kind: 'cable', id: node.cableId }, { toggle: e.shift });
          if (!e.shift) nodeDrag.current = { cableId: node.cableId, side: node.side, dragId: crypto.randomUUID() };
          return;
        }
        const rack = rackAt(p);
        const lineHit = hitIndex.nearest(p, 7 / scale.current);
        if (rack && !e.alt) {
          if (e.shift) { store.getState().select({ kind: 'rack', id: rack.id }, { toggle: true }); return; }
          const ids = selection.some((s) => s.kind === 'rack' && s.id === rack.id) ? selection.flatMap((s) => s.kind === 'rack' ? [s.id] : []) : [rack.id];
          store.getState().select(ids.map((id) => ({ kind: 'rack', id }))); drag.current = { ids, start: p };
        } else if (lineHit) store.getState().select(lineHit.ref, { toggle: e.shift });
        else { const keepout = project.keepouts.find((k) => pointInPolygon(p, k.outline)); if (keepout) store.getState().select({ kind: 'keepout', id: keepout.id }); else store.getState().clearSelection(); }
      }}
      onMove={(p) => {
        setCursor(p);
        const g = drag.current;
        if (g) { setPreview({ ids: g.ids, delta: snapVec({ x: p.x - g.start.x, y: p.y - g.start.y }, ui.snapMm || 1) }); return; }
        const nd = nodeDrag.current;
        if (nd) { store.getState().execute(cableCommands.setFurcation(nd.cableId, nd.side, snapped(p), true, nd.dragId)); return; }
        if (ui.tool === 'select') { const key = nodeAt(p)?.key ?? null; if (key !== hoverNode) setHoverNode(key); }
      }}
      onUp={() => { if (preview && (preview.delta.x || preview.delta.y)) run(layout.moveRacks(preview.ids, preview.delta, crypto.randomUUID())); drag.current = null; nodeDrag.current = null; setPreview(null); }}
      onDoubleClick={(p) => { const rack = rackAt(p); if (rack && !nodeAt(p)) { store.getState().setElevationRacks([rack.id]); store.getState().setLayoutView('elevation'); } else { const hit = hitIndex.nearest(p, 8 / scale.current); const id = nodeAt(p)?.cableId ?? (hit?.ref.kind === 'link' || hit?.ref.kind === 'cable' ? hit.ref.id : undefined); if (id) startRoute(id); } }}
      onDragMove={(p, dt) => { if (dt.types.includes(COMPONENT_MIME)) setDragPoint(p); }}
      onDragLeave={() => setDragPoint(null)}
      onDrop={(p, dt) => { setDragPoint(null); const id = dt.getData(COMPONENT_MIME); if (id) dropComponent(p, id); }}
      paint={(ctx, zoom) => {
        scale.current = zoom;
        const room = data.room.outline;
        stroke(ctx, room, '#44566a', 2 / zoom, true); ctx.fillStyle = '#141e28'; ctx.fill();
        const b = boundsOf(room), grid = Math.max(100, data.room.gridMm);
        ctx.save(); ctx.clip();
        // Bound the grid work for imported rooms with very large extents.
        const step = grid * Math.max(1, Math.ceil(Math.max(b.width, b.height) / grid / 200));
        for (let x = Math.ceil(b.x / step) * step; x <= b.x + b.width; x += step) stroke(ctx, [{ x, y: b.y }, { x, y: b.y + b.height }], '#24313e', 0.5 / zoom);
        for (let y = Math.ceil(b.y / step) * step; y <= b.y + b.height; y += step) stroke(ctx, [{ x: b.x, y }, { x: b.x + b.width, y }], '#24313e', 0.5 / zoom);
        ctx.restore();
        for (const k of data.keepouts) { stroke(ctx, k.outline, '#dd9a58', 1 / zoom, true); ctx.fillStyle = '#b9742828'; ctx.fill(); const r = boundsOf(k.outline); caption(ctx, k.name, { x: r.x + r.width / 2, y: r.y + r.height / 2 }, 10 / zoom, '#ddb079'); }
        for (const r of data.racks) {
          const b = rackFloorRect(r), selected = selectedRacks.includes(r.id), center = rackCenter(r), front = rackFrontDir(r), count = idx.componentsInRack(r.id).length;
          if (isPatchFrame(r)) {
            ctx.fillStyle = selected ? FRAME.fillSelected : FRAME.fill; ctx.fillRect(b.x, b.y, b.width, b.height);
            ctx.setLineDash([8 / zoom, 5 / zoom]); ctx.strokeStyle = selected ? FRAME.strokeSelected : FRAME.stroke; ctx.lineWidth = (selected ? 2 : 1) / zoom; ctx.strokeRect(b.x, b.y, b.width, b.height); ctx.setLineDash([]);
            // The wall is only 120 mm deep, so both captions sit outside the bar, clear of the front arrow.
            caption(ctx, r.name, { x: center.x, y: b.y - 120 }, 12 / zoom, FRAME.text);
            caption(ctx, `patch frame · ${count} panel${count === 1 ? '' : 's'}`, { x: center.x, y: b.y + b.height + 120 }, 9 / zoom, FRAME.subtext);
          } else {
            ctx.fillStyle = selected ? '#204467' : '#25394c'; ctx.fillRect(b.x, b.y, b.width, b.height);
            ctx.strokeStyle = selected ? '#69bfff' : '#6f8aa2'; ctx.lineWidth = (selected ? 2 : 1) / zoom; ctx.strokeRect(b.x, b.y, b.width, b.height);
            caption(ctx, r.name, { x: center.x, y: center.y - 80 }, 12 / zoom);
            caption(ctx, `${count} devices`, { x: center.x, y: center.y + 110 }, 9 / zoom, '#9bb3c8');
          }
          const tip = { x: center.x + front.x * r.depthMm * 0.42, y: center.y + front.y * r.depthMm * 0.42 };
          stroke(ctx, [center, tip], '#7edac4', 2 / zoom);
          caption(ctx, 'F', tip, 9 / zoom, '#7edac4');
          if (dropRack?.id === r.id) { ctx.strokeStyle = '#7edac4'; ctx.lineWidth = 3 / zoom; ctx.strokeRect(b.x, b.y, b.width, b.height); }
        }
        for (const t of data.trays) {
          if (!ui.visibleLayers[t.layer]) continue;
          ctx.globalAlpha = t.layer === ui.activeLayer ? 0.65 : 0.3;
          stroke(ctx, t.points, t.kind === 'fiber-runway' ? '#e9c350' : '#a2b6c9', Math.max(t.widthMm, 5 / zoom)); ctx.globalAlpha = 1;
          if (t.points[0]) caption(ctx, `${t.name ?? t.kind} · ${Math.round((trayFill(data, t.id)?.fraction ?? 0) * 100)}%`, { x: t.points[0].x, y: t.points[0].y - 180 }, 10 / zoom, '#dec578');
          for (const f of t.fittings) { ctx.fillStyle = '#efcc67'; ctx.beginPath(); ctx.arc(f.at.x, f.at.y, 4 / zoom, 0, Math.PI * 2); ctx.fill(); }
        }
        for (const l of visibleLinks) {
          ctx.globalAlpha = selectedLinks.has(l.link.id) ? 1 : l.routed ? 0.8 : 0.35;
          ctx.setLineDash(l.routed ? [] : [4 / zoom, 4 / zoom]);
          stroke(ctx, l.points, selectedLinks.has(l.link.id) ? '#ffffff' : l.color, (selectedLinks.has(l.link.id) ? 3 : l.routed ? 1.5 : 0.8) / zoom);
        }
        // Installed cables: one jacket (airwire or route) to the furcation, thin legs from there to each port, and a node per fanned side.
        for (const c of visibleCables) {
          const selected = selectedCables.has(c.cable.id), color = selected ? '#ffffff' : c.color;
          ctx.globalAlpha = selected ? 1 : c.routed ? 0.85 : 0.5;
          ctx.setLineDash(c.routed ? [] : [8 / zoom, 5 / zoom]);
          stroke(ctx, c.jacket, color, (selected ? 4 : c.routed ? 2.5 : 1.8) / zoom);
          ctx.setLineDash([3 / zoom, 3 / zoom]);
          for (const leg of c.legs) stroke(ctx, leg.points, color, (selected ? 1.5 : 0.9) / zoom);
          ctx.setLineDash([]);
          for (const f of c.furcations) {
            const hot = selected || hoverNode === `${c.cable.id}:${f.side}`;
            furcationGlyph(ctx, f.pos, f.pinned, NODE_PX / zoom, hot ? '#ffffff' : c.color, 1.5 / zoom);
          }
        }
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        if (tipNode) tooltip(ctx, tipNode.tip, { x: tipNode.pos.x + 10 / zoom, y: tipNode.pos.y - 10 / zoom }, zoom);
        if (points.length) stroke(ctx, [...points, drawingPoint], '#76c6ff', 2 / zoom, ui.tool === 'keepout' || ui.tool === 'room');
        if (routeTarget && points.length) furcationGlyph(ctx, routeTarget.end, false, NODE_PX / zoom, '#76c6ff', 1.5 / zoom);
        if (ui.placing?.kind === 'rack') { const def = idx.catalog.racks.get(ui.placing.defId), p = snapVec(cursor, project.room.gridMm); if (def) { ctx.fillStyle = '#78c8ff44'; ctx.fillRect(p.x, p.y, def.widthMm, def.depthMm); } }
        if (dropGhost) {
          ctx.setLineDash([8 / zoom, 5 / zoom]); ctx.fillStyle = `${FRAME.stroke}33`; ctx.fillRect(dropGhost.x, dropGhost.y, frameSize.widthMm, frameSize.depthMm);
          ctx.strokeStyle = FRAME.stroke; ctx.lineWidth = 1.5 / zoom; ctx.strokeRect(dropGhost.x, dropGhost.y, frameSize.widthMm, frameSize.depthMm); ctx.setLineDash([]);
          caption(ctx, 'new frame', { x: dropGhost.x + frameSize.widthMm / 2, y: dropGhost.y + frameSize.depthMm / 2 }, 9 / zoom, FRAME.stroke);
        }
      }}>
      <div className="absolute bottom-2 left-2 rounded border border-border bg-panel/90 px-2 py-1 text-xs text-fg-muted">{project.racks.length} racks · {project.placements.filter((p) => p.rackId).length} placed devices · {routedCount} routed cables</div>
      <div className="absolute right-2 top-2 flex gap-1"><Button onClick={() => setFit((v) => v + 1)}>Fit floor</Button>{points.length > 0 && <Button onClick={finish}>Finish</Button>}</div>
      {dragPoint && <div className="pointer-events-none absolute bottom-2 right-2 rounded border border-border bg-panel/90 px-2 py-1 text-xs" data-testid="floor-drop-hint">{dropRack ? `Drop into ${dropRack.name} at the first free U` : 'Drop here to place as its own patch frame'}</div>}
      {!project.racks.length && <p className="pointer-events-none absolute inset-x-0 top-1/2 px-8 text-center text-fg-muted">Add racks from the Library, then place devices in Elevation — or drag a device from the Unplaced bin onto the floor to give it its own frame.</p>}
    </PhysicalCanvas>
  </div>;
}
