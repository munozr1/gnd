import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Context } from 'konva/lib/Context';
import { Layer, Shape, Stage } from 'react-konva/lib/ReactKonvaCore';
import { produce } from 'immer';
import * as commands from '@/commands';
import { createComponent } from '@/model/factories';
import { snapVec, type Rect } from '@/model/geometry';
import { indexProject } from '@/model/query';
import { autoWirePoints, componentLayout, dragWireSegment, moveComponents as previewMove, pinEndpoint, sheetAncestry, symbolLayout, wireMidpoint } from '@/model/schematic';
import type { LinkEnd, Vec2 } from '@/model/types';
import { execute } from '@/panels/schematic/common';
import { useStatusBarWriter } from '@/panels/shell/StatusBarContext';
import { runChecks } from '@/panels/shell/useChecks';
import { store, useActiveSheetId, useProject, useSchematicUi, useSelection } from '@/store';
import { isEditableTarget, registerShortcut } from '@/store/shortcuts';
import { Button } from '@/ui/Button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger } from '@/ui/ContextMenu';
import { Input } from '@/ui/Input';
import { toast } from '@/ui/Toast';
import { Toolbar } from '@/ui/Toolbar';
import { COLORS, drawDevice, drawSymbols, drawWire, line } from './drawing';
import { boxSelection, buildScene, hitItem, hitScene, selectionBounds, selectionSheet, type Hit } from './scene';
import { DEFAULT_VIEWPORT, fitRect, screenToWorld, wheelZoomFactor, worldToScreen, zoomAt, zoomStep, type Viewport } from './viewport';

type Gesture =
  | { kind: 'pan'; start: Vec2; viewport: Viewport }
  | { kind: 'box'; start: Vec2; additive: boolean }
  | { kind: 'move'; start: Vec2; ids: string[]; pickup?: boolean }
  | { kind: 'sheet'; start: Vec2; id: string; origin: Vec2 }
  | { kind: 'wire'; start: Vec2; id: string; segment: number; points: Vec2[] }
  | { kind: 'connect'; start: Vec2; end: LinkEnd };
const deltaBetween = (a: Vec2, b: Vec2) => snapVec({ x: a.x - b.x, y: a.y - b.y }, 10);
const box = (a: Vec2, b: Vec2): Rect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
const sameEnd = (a: LinkEnd, b: LinkEnd) => a.componentId === b.componentId && a.portId === b.portId;

export function SchematicEditor() {
  const project = useProject();
  const sheetId = useActiveSheetId();
  const ui = useSchematicUi();
  const selection = useSelection();
  const idx = useMemo(() => indexProject(project), [project]);
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
  const [cursor, setCursor] = useState<Vec2>({ x: 0, y: 0 });
  const [hover, setHover] = useState<Hit | null>(null);
  const [wireStart, setWireStart] = useState<LinkEnd | null>(null);
  const [move, setMove] = useState<{ ids: string[]; delta: Vec2 } | null>(null);
  const [sheetMove, setSheetMove] = useState<{ id: string; pos: Vec2 } | null>(null);
  const [wireMove, setWireMove] = useState<{ id: string; points: Vec2[] } | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [label, setLabel] = useState<{ id: string; text: string } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const space = useRef(false);
  const panned = useRef(false);
  const status = useStatusBarWriter();
  const displayProject = useMemo(() => {
    if (!move && !sheetMove) return project;
    return produce(project, (draft) => {
      if (move) previewMove(draft, move.ids, move.delta);
      if (sheetMove) {
        const sheet = draft.sheets.find((s) => s.id === sheetMove.id);
        if (sheet?.sch) sheet.sch.pos = sheetMove.pos;
      }
    });
  }, [project, move, sheetMove]);
  const scene = useMemo(() => buildScene(displayProject, sheetId), [displayProject, sheetId]);
  const paintSymbols = useCallback((context: Context) => drawSymbols(context._context, scene, displayProject), [scene, displayProject]);
  const paintWires = useCallback((context: Context) => {
    for (const wire of scene.wires) drawWire(context._context, wireMove?.id === wire.link.id ? { ...wire, points: wireMove.points } : wire, displayProject);
  }, [scene, displayProject, wireMove]);
  const selected = useMemo(() => new Set(selection.flatMap((s) => 'id' in s ? [`${s.kind}:${s.id}`] : [])), [selection]);
  const activeIds = selection.flatMap((s) => s.kind === 'component' && idx.component(s.id)?.sch.sheetId === sheetId ? [s.id] : []);
  const cancel = useCallback(() => {
    gesture.current = null;
    setMove(null); setSheetMove(null); setWireMove(null); setMarquee(null); setWireStart(null); setLabel(null);
    store.getState().patchSchematic({ tool: 'select', placing: null });
  }, []);

  useEffect(() => {
    const element = host.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const fitted = useRef('');
  useEffect(() => {
    if (!size.width || !size.height) return;
    const key = `${project.id}:${sheetId}`;
    if (fitted.current !== key) {
      fitted.current = key;
      setViewport(scene.bounds ? fitRect(scene.bounds, size) : DEFAULT_VIEWPORT);
      cancel();
    }
  }, [project.id, sheetId, scene.bounds, size, cancel]);
  useEffect(() => {
    if (!project.sheets.some((s) => s.id === sheetId)) {
      const root = project.sheets.find((s) => s.parentId === null);
      if (root) store.getState().setActiveSheet(root.id);
    }
  }, [project.sheets, sheetId]);
  useEffect(() => {
    const request = ui.viewportRequest;
    if (!request || !size.width || !size.height) return;
    if (request.kind === 'items') {
      const target = selectionSheet(project, request.items);
      if (target && target !== sheetId) { store.getState().setActiveSheet(target); return; }
    }
    const rect = request.kind === 'rect' ? request.rect : request.kind === 'fit' ? scene.bounds : selectionBounds(scene, request.items);
    if (rect) setViewport(fitRect(rect, size));
    store.getState().requestViewport('schematic', null);
  }, [ui.viewportRequest, project, sheetId, scene, size]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !isEditableTarget(e.target)) { e.preventDefault(); space.current = true; } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') space.current = false; };
    const blur = () => { space.current = false; cancel(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); status.clear(); };
  }, [cancel, status]);
  useEffect(() => {
    status.set({ mode: ui.placing ? 'Place symbol' : wireStart ? 'Wire: choose destination' : ui.tool,
      message: ui.placing ? 'Click to place · Esc to finish' : 'A add · W wire · R rotate · Space-drag pan · Scroll to zoom' });
  }, [ui.placing, ui.tool, wireStart, status]);

  const editLabel = (id: string) => { setLabel({ id, text: idx.link(id)?.label ?? '' }); store.getState().patchSchematic({ tool: 'select' }); };
  const remove = () => { if (selection.length) execute(commands.deleteSelection(selection)); cancel(); };
  const pickup = () => {
    if (!activeIds.length) return;
    gesture.current = { kind: 'move', ids: activeIds, start: cursor, pickup: true };
    store.getState().patchSchematic({ tool: 'move', placing: null });
  };
  useEffect(() => {
    const bind = (id: string, keys: string | string[], description: string, handler: () => void) => registerShortcut({ id: `schematic.${id}`, keys, description, editor: 'schematic', when: () => store.getState().ui.activeDialog === null, handler });
    const offs = [
      bind('add', 'a', 'Add symbol', () => store.getState().openDialog('library')),
      bind('wire', 'w', 'Draw wire', () => { cancel(); store.getState().patchSchematic({ tool: 'wire' }); }),
      bind('label', 'l', 'Label wire', () => { const link = selection.find((s) => s.kind === 'link'); if (link?.kind === 'link') editLabel(link.id); else store.getState().patchSchematic({ tool: 'label' }); }),
      bind('rotate', 'r', 'Rotate selection', () => { if (activeIds.length) execute(commands.rotateComponents(activeIds)); }),
      bind('mirror', 'x', 'Mirror selection', () => { if (activeIds.length) execute(commands.mirrorComponents(activeIds)); }),
      bind('move', ['m', 'g'], 'Pick up selection', pickup),
      bind('delete', ['delete', 'backspace'], 'Delete selection', remove),
      bind('all', 'mod+a', 'Select sheet contents', () => store.getState().select([
        ...scene.devices.map(({ component }) => ({ kind: 'component' as const, id: component.id })),
        ...scene.wires.map(({ link }) => ({ kind: 'link' as const, id: link.id })),
        ...scene.sheets.map(({ sheet }) => ({ kind: 'sheet' as const, id: sheet.id })),
      ])),
      bind('cancel', 'escape', 'Cancel tool', cancel),
      bind('fit', 'home', 'Fit schematic', () => store.getState().requestViewport('schematic', { kind: 'fit' })),
    ];
    return () => offs.forEach((off) => off());
  });
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = element.getBoundingClientRect();
      setViewport((v) => zoomAt(v, { x: e.clientX - rect.left, y: e.clientY - rect.top }, wheelZoomFactor(e.deltaY, e.deltaMode)));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  const screenPoint = (e: { clientX: number; clientY: number }): Vec2 => {
    const rect = host.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const finishConnection = (end: LinkEnd) => {
    if (!wireStart || sameEnd(wireStart, end)) return;
    const command = commands.addLink(wireStart, end);
    if (execute(command)) { setWireStart(null); if (command.result) store.getState().select({ kind: 'link', id: command.result }); }
  };
  const finishGesture = () => {
    const g = gesture.current;
    if (g?.kind === 'move' && move && (move.delta.x || move.delta.y)) execute(commands.moveComponents(g.ids, move.delta, crypto.randomUUID()));
    if (g?.kind === 'sheet' && sheetMove) execute(commands.moveSheetSymbol(g.id, sheetMove.pos, crypto.randomUUID()));
    if (g?.kind === 'wire' && wireMove) execute(commands.setLinkWirePoints(g.id, wireMove.points.slice(1, -1), crypto.randomUUID()));
    if (g?.kind === 'box' && marquee && (marquee.width > 3 || marquee.height > 3)) store.getState().select(boxSelection(scene, marquee), { additive: g.additive });
    gesture.current = null; setMove(null); setSheetMove(null); setWireMove(null); setMarquee(null);
    if (g?.kind === 'move' && g.pickup) store.getState().patchSchematic({ tool: 'select' });
  };
  const pointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('input,button')) return;
    e.currentTarget.focus();
    const screen = screenPoint(e), point = screenToWorld(viewport, screen);
    if (e.button === 1 || e.button === 2 || space.current) {
      e.preventDefault(); panned.current = false;
      gesture.current = { kind: 'pan', start: screen, viewport };
      e.currentTarget.setPointerCapture(e.pointerId); return;
    }
    if (e.button !== 0) return;
    if (gesture.current?.kind === 'move' && gesture.current.pickup) { finishGesture(); return; }
    if (ui.placing) {
      const command = commands.addComponent(ui.placing, sheetId, snapVec(point, 10));
      if (execute(command) && command.result) store.getState().select({ kind: 'component', id: command.result });
      return;
    }
    const hit = hitScene(scene, point, Math.min(5, 7 / viewport.scale));
    if (hit?.kind === 'stub') { execute(commands.toggleExpandedPins(hit.id)); return; }
    if (hit?.kind === 'pin') {
      if (wireStart) { finishConnection(hit.end); return; }
      if (!idx.isPortFree(hit.end.componentId, hit.end.portId)) { toast('This port is already connected.', { tone: 'warning' }); return; }
      setWireStart(hit.end); store.getState().patchSchematic({ tool: 'wire' });
      gesture.current = { kind: 'connect', start: screen, end: hit.end };
      e.currentTarget.setPointerCapture(e.pointerId); return;
    }
    if (ui.tool === 'wire' || wireStart) return;
    if (hit && ui.tool === 'label') { if (hit.kind === 'link') editLabel(hit.id); return; }
    if (!hit) {
      if (!e.shiftKey) store.getState().clearSelection();
      gesture.current = { kind: 'box', start: point, additive: e.shiftKey };
    } else {
      const item = hitItem(hit);
      if (e.shiftKey) { store.getState().select(item, { toggle: true }); return; }
      const alreadySelected = 'id' in item && selected.has(`${item.kind}:${item.id}`);
      if (!alreadySelected) store.getState().select(item);
      if (hit.kind === 'component') gesture.current = { kind: 'move', start: point, ids: alreadySelected ? activeIds : [hit.id] };
      if (hit.kind === 'sheet') {
        const sheet = project.sheets.find((s) => s.id === hit.id);
        if (sheet?.sch) gesture.current = { kind: 'sheet', start: point, id: hit.id, origin: sheet.sch.pos };
      }
      if (hit.kind === 'link') {
        const wire = scene.wires.find((w) => w.link.id === hit.id);
        if (wire && !wire.offSheetLabel) gesture.current = { kind: 'wire', start: point, id: hit.id, segment: hit.segment, points: wire.points };
      }
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const pointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const screen = screenPoint(e), point = screenToWorld(viewport, screen);
    setCursor(point);
    status.set({ coords: `x ${Math.round(point.x)}  y ${Math.round(point.y)}` });
    const g = gesture.current;
    if (g?.kind === 'pan') {
      const dx = screen.x - g.start.x, dy = screen.y - g.start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) panned.current = true;
      setViewport({ ...g.viewport, x: g.viewport.x + dx, y: g.viewport.y + dy }); return;
    }
    if (g?.kind === 'move') setMove({ ids: g.ids, delta: deltaBetween(point, g.start) });
    else if (g?.kind === 'sheet') { const d = deltaBetween(point, g.start); setSheetMove({ id: g.id, pos: { x: g.origin.x + d.x, y: g.origin.y + d.y } }); }
    else if (g?.kind === 'wire') setWireMove({ id: g.id, points: dragWireSegment(g.points, g.segment, deltaBetween(point, g.start)) });
    else if (g?.kind === 'box') setMarquee(box(g.start, point));
    else {
      const hit = hitScene(scene, point, Math.min(5, 7 / viewport.scale));
      setHover(hit); store.getState().setHovered(hit ? hitItem(hit) : null);
    }
  };
  const pointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (g?.kind === 'connect') {
      const screen = screenPoint(e);
      if (Math.hypot(screen.x - g.start.x, screen.y - g.start.y) > 4) {
        const hit = hitScene(scene, screenToWorld(viewport, screen), Math.min(5, 7 / viewport.scale));
        if (hit?.kind === 'pin' && !sameEnd(g.end, hit.end)) finishConnection(hit.end);
      }
    }
    if (!(g?.kind === 'move' && g.pickup)) finishGesture();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const ghost = useMemo(() => {
    const symbol = ui.placing ? idx.catalog.symbol(ui.placing) : undefined;
    if (!symbol) return null;
    const component = createComponent(symbol, { sheetId, pos: snapVec(cursor, 10) });
    return { component, layout: symbolLayout(symbol, component, { collapsed: true, usedPortIds: new Set() }) };
  }, [ui.placing, idx, sheetId, cursor]);
  const startLayout = wireStart && componentLayout(project, wireStart.componentId);
  const startPin = startLayout && wireStart ? pinEndpoint(startLayout, wireStart.portId) : null;
  const targetPin = hover?.kind === 'pin' ? hover : null;
  const wireInvalid = !!targetPin && !!wireStart && (sameEnd(targetPin.end, wireStart) || !idx.isPortFree(targetPin.end.componentId, targetPin.end.portId));
  const labelWire = label && scene.wires.find((w) => w.link.id === label.id);
  const labelPos = labelWire ? worldToScreen(viewport, wireMidpoint(labelWire.points)) : { x: 24, y: 24 };
  const one = selection.length === 1 ? selection[0] : undefined;
  const grid = (viewport.scale * 10 < 7 ? 100 : 10) * viewport.scale;
  return (
    <div data-editor="schematic" className="flex h-full w-full min-w-0 flex-col bg-bg">
      <Toolbar aria-label="Schematic tools" className="overflow-x-auto">
        <Button variant="ghost" active={ui.tool === 'select' && !ui.placing} onClick={cancel}>Select</Button>
        <Button variant="ghost" onClick={() => store.getState().openDialog('library')}>Add symbol</Button>
        <Button variant="ghost" active={ui.tool === 'wire'} onClick={() => { cancel(); store.getState().patchSchematic({ tool: 'wire' }); }}>Wire</Button>
        <Button variant="ghost" onClick={() => execute(commands.annotate())}>Annotate</Button>
        <Button variant="ghost" onClick={() => { store.getState().setIssuesDrawerOpen(true); void runChecks(['erc']); }}>Run ERC</Button>
        <Button variant="ghost" onClick={() => store.getState().openDialog('update-layout')}>Update Layout</Button>
        <span className="flex-1" />
        <Button variant="ghost" aria-label="Zoom out" onClick={() => setViewport((v) => zoomStep(v, size, -1))}>−</Button>
        <Button variant="ghost" onClick={() => store.getState().requestViewport('schematic', { kind: 'fit' })}>Fit</Button>
        <Button variant="ghost" aria-label="Zoom in" onClick={() => setViewport((v) => zoomStep(v, size, 1))}>+</Button>
      </Toolbar>
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-2 text-xs text-fg-muted" aria-label="Sheet path">
        {sheetAncestry(project, sheetId).map((s, i) => <span key={s.id}>{i > 0 && ' / '}<button className="px-1 hover:text-fg" onClick={() => store.getState().setActiveSheet(s.id)}>{s.name}</button></span>)}
        <span className="ml-auto">{scene.devices.length} devices · {scene.wires.length} links · {Math.round(viewport.scale * 100)}%</span>
      </div>
      <ContextMenu><ContextMenuTrigger asChild>
        <div ref={host} data-testid="schematic-canvas" data-viewport={JSON.stringify(viewport)} tabIndex={0} role="region" aria-label="Schematic canvas"
          className="relative min-h-0 flex-1 overflow-hidden outline-none" style={{ touchAction: 'none', cursor: ui.placing || ui.tool === 'wire' ? 'crosshair' : 'default', backgroundImage: 'radial-gradient(circle, #304052 0.7px, transparent 0.8px)', backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${viewport.x}px ${viewport.y}px` }}
          onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancel}
          onPointerLeave={() => { setHover(null); store.getState().setHovered(null); }}
          onContextMenuCapture={(e) => {
            if (panned.current) { e.preventDefault(); e.stopPropagation(); panned.current = false; return; }
            const hit = hitScene(scene, screenToWorld(viewport, screenPoint(e)), Math.min(5, 7 / viewport.scale));
            if (hit) store.getState().select(hitItem(hit));
          }}
          onDoubleClick={(e) => {
            const hit = hitScene(scene, screenToWorld(viewport, screenPoint(e)), Math.min(5, 7 / viewport.scale));
            if (hit?.kind === 'sheet') store.getState().setActiveSheet(hit.id);
            if (hit?.kind === 'link') editLabel(hit.id);
          }}>
          {size.width > 0 && size.height > 0 && <Stage width={size.width} height={size.height} x={viewport.x} y={viewport.y} scaleX={viewport.scale} scaleY={viewport.scale} listening={false}>
            <Layer listening={false}><Shape sceneFunc={paintWires} /></Layer>
            <Layer listening={false}><Shape sceneFunc={paintSymbols} /></Layer>
            <Layer listening={false}><Shape sceneFunc={(context) => {
              const ctx = context._context;
              for (const [key, r] of scene.itemBounds) {
                if (!selected.has(key)) continue;
                if (key.startsWith('link:')) { const wire = scene.wires.find((w) => key === `link:${w.link.id}`); if (wire) drawWire(ctx, wireMove?.id === wire.link.id ? { ...wire, points: wireMove.points } : wire, displayProject, COLORS.accent, 2.5); }
                else { ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 1.5 / viewport.scale; ctx.strokeRect(r.x, r.y, r.width, r.height); }
              }
              if (hover?.kind === 'pin') { ctx.beginPath(); ctx.arc(hover.pos.x, hover.pos.y, 4, 0, Math.PI * 2); ctx.strokeStyle = wireInvalid ? '#f87171' : COLORS.accent; ctx.lineWidth = 1.5; ctx.stroke(); }
              if (startPin) {
                const end = targetPin?.pos ?? snapVec(cursor, 10), dir = targetPin?.dir ?? { x: -startPin.dir.x, y: -startPin.dir.y };
                line(ctx, [startPin.pos, ...autoWirePoints(startPin.pos, startPin.dir, end, dir), end], wireInvalid ? '#f87171' : COLORS.accent, 1.5);
              }
              if (ghost) { ctx.save(); ctx.globalAlpha = 0.65; drawDevice(ctx, ghost, project); ctx.restore(); }
              if (marquee) { ctx.fillStyle = '#60b7ff20'; ctx.fillRect(marquee.x, marquee.y, marquee.width, marquee.height); ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 1 / viewport.scale; ctx.strokeRect(marquee.x, marquee.y, marquee.width, marquee.height); }
            }} /></Layer>
          </Stage>}
          {!scene.devices.length && !scene.sheets.length && !ui.placing && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><div className="text-center text-fg-muted"><p className="mb-2 text-base text-fg">Start your network topology</p><p>Press A or choose a device from the library.</p><p className="mt-1 text-xs">Connect its ports, then update the physical layout.</p></div></div>}
          {hover?.kind === 'pin' && !gesture.current && <div className="pointer-events-none absolute bottom-2 left-2 rounded border border-border bg-panel px-2 py-1 text-xs">{idx.endLabel(hover.end)} · {idx.catalog.transceiver(idx.component(hover.end.componentId)?.optics[hover.end.portId])?.name ?? 'No optic assigned'}</div>}
          {label && <form className="absolute z-10 rounded border border-accent bg-panel p-1 shadow-lg" style={{ left: Math.max(0, Math.min(size.width - 230, labelPos.x)), top: Math.max(0, Math.min(size.height - 40, labelPos.y)) }} onPointerDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); execute(commands.setLinkLabel(label.id, label.text.trim())); setLabel(null); }}>
            <Input autoFocus aria-label="Wire label" value={label.text} onChange={(e) => setLabel({ ...label, text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setLabel(null); } }} />
          </form>}
        </div>
      </ContextMenuTrigger><ContextMenuContent>
        {one?.kind === 'component' && <>
          <ContextMenuItem onSelect={() => execute(commands.rotateComponents(one.id))}>Rotate</ContextMenuItem>
          <ContextMenuItem onSelect={() => execute(commands.mirrorComponents(one.id))}>Mirror</ContextMenuItem>
          <ContextMenuItem onSelect={() => execute(commands.toggleExpandedPins(one.id))}>Expand / collapse pins</ContextMenuItem>
          <ContextMenuItem onSelect={() => store.getState().revealSelection([one], 'layout')}>Show in layout</ContextMenuItem>
        </>}
        {one?.kind === 'link' && <>
          <ContextMenuItem onSelect={() => editLabel(one.id)}>Label…</ContextMenuItem>
          <ContextMenuSub><ContextMenuSubTrigger>Change cable</ContextMenuSubTrigger><ContextMenuSubContent>
            <ContextMenuItem onSelect={() => execute(commands.setLinkCable(one.id, null))}>Unassigned</ContextMenuItem>
            {idx.catalog.catalog.cables.map((c) => <ContextMenuItem key={c.id} onSelect={() => execute(commands.setLinkCable(one.id, c.id))}>{c.name}</ContextMenuItem>)}
          </ContextMenuSubContent></ContextMenuSub>
        </>}
        {one?.kind === 'sheet' && <ContextMenuItem onSelect={() => store.getState().setActiveSheet(one.id)}>Enter sheet</ContextMenuItem>}
        <ContextMenuItem disabled={!selection.length} onSelect={remove}>Delete selection</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => store.getState().openDialog('library')}>Add symbol…</ContextMenuItem>
        <ContextMenuItem onSelect={() => store.getState().requestViewport('schematic', { kind: 'fit' })}>Fit schematic</ContextMenuItem>
      </ContextMenuContent></ContextMenu>
    </div>
  );
}
