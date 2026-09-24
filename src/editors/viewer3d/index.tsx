import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { registerCapture3D, capture3dPng } from '@/io/exports/screenshot3d';
import { downloadBlob } from '@/io/exports/download';
import { indexProject } from '@/model/query';
import type { Project, SelectionItem, Tray } from '@/model/types';
import { store, useProject, useSelection, useViewer3dUi } from '@/store';
import { registerShortcut } from '@/store/shortcuts';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { toast } from '@/ui/Toast';
import { buildPhysicalScene, boxCorners, roomGrid, type BoxPart, type CablePart, type V3 } from './geometry';

type Preset = 'iso' | 'top' | 'front' | 'rear';
const sameTarget = (a: SelectionItem, b: SelectionItem) => a.kind === b.kind && 'id' in a && 'id' in b && a.id === b.id;
function select(target: SelectionItem, e: ThreeEvent<MouseEvent>) { e.stopPropagation(); store.getState().select(target, { toggle: e.shiftKey }); }

function Boxes({ parts, transparent = false }: { parts: BoxPart[]; transparent?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null), selection = useSelection();
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D(), color = new THREE.Color();
    parts.forEach((part, i) => {
      dummy.position.set(...part.position); dummy.rotation.set(0, part.rotation, 0); dummy.scale.set(...part.size); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix); mesh.setColorAt(i, color.set(selection.some((s) => sameTarget(s, part.target)) ? '#87cfff' : part.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [parts, selection]);
  if (!parts.length) return null;
  return <instancedMesh key={parts.length} ref={ref} args={[undefined, undefined, parts.length]} onClick={transparent ? undefined : (e) => { const part = parts[e.instanceId ?? -1]; if (part) select(part.target, e); }} raycast={transparent ? () => {} : undefined}>
    <boxGeometry /><meshStandardMaterial roughness={0.7} metalness={0.2} transparent={transparent} opacity={transparent ? 0.15 : 1} depthWrite={!transparent} />
  </instancedMesh>;
}

function cableGeometry(cable: CablePart) {
  const points = cable.points.map((p) => new THREE.Vector3(...p)).filter((p, i, all) => i === 0 || p.distanceTo(all[i - 1]!) > 1e-7);
  const curve = new THREE.CurvePath<THREE.Vector3>();
  if (points.length < 2) return new THREE.BufferGeometry();
  let last = points[0]!;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!, prev = points[i - 1]!, next = points[i + 1]!;
    const cut = Math.min(cable.bendRadius, p.distanceTo(prev) * 0.4, p.distanceTo(next) * 0.4);
    const before = p.clone().add(prev.clone().sub(p).normalize().multiplyScalar(cut));
    const after = p.clone().add(next.clone().sub(p).normalize().multiplyScalar(cut));
    if (last.distanceTo(before) > 1e-7) curve.add(new THREE.LineCurve3(last, before));
    curve.add(new THREE.QuadraticBezierCurve3(before, p, after)); last = after;
  }
  curve.add(new THREE.LineCurve3(last, points.at(-1)!));
  return new THREE.TubeGeometry(curve, Math.max(24, points.length * 8), cable.radius, 6, false);
}
function Cable({ cable }: { cable: CablePart }) {
  const selected = useSelection().some((s) => s.kind === 'link' && s.id === cable.id);
  const geometry = useMemo(() => cableGeometry(cable), [cable]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} onClick={(e) => select({ kind: 'link', id: cable.id }, e)}>
    <meshStandardMaterial color={selected ? '#ffffff' : cable.color} emissive={selected ? '#3c7b9e' : '#000000'} roughness={0.55} />
  </mesh>;
}
function Beam({ a, b, width, depth, color, target }: { a: V3; b: V3; width: number; depth: number; color: string; target?: SelectionItem }) {
  const vector = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)), length = vector.length();
  if (length < 1e-6) return null;
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), vector.normalize());
  return <mesh position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]} quaternion={quaternion} onClick={target ? (e) => select(target, e) : undefined}>
    <boxGeometry args={[width, depth, length]} /><meshStandardMaterial color={color} roughness={0.65} />
  </mesh>;
}
function TrayMesh({ tray, ceiling }: { tray: Tray; ceiling: number }) {
  const parts: ReactNode[] = [], height = tray.elevationMm / 1000, width = tray.widthMm / 1000, depth = tray.depthMm / 1000;
  const color = tray.kind === 'fiber-runway' ? '#d7b53d' : '#8092a4', target: SelectionItem = { kind: 'tray', id: tray.id };
  for (let i = 1; i < tray.points.length; i++) {
    const p = tray.points[i - 1]!, q = tray.points[i]!, dx = q.x - p.x, dz = q.y - p.y, length = Math.hypot(dx, dz) / 1000;
    if (!length) continue;
    const ux = dx / 1000 / length, uz = dz / 1000 / length;
    const point = (along: number, side: number, y = height): V3 => [p.x / 1000 + along * ux - side * uz, y, p.y / 1000 + along * uz + side * ux];
    for (const side of [-width / 2, width / 2]) parts.push(<Beam key={`${i}:rail:${side}`} a={point(0, side, height + depth / 2)} b={point(length, side, height + depth / 2)} width={0.012} depth={depth} color={color} target={target} />);
    if (tray.kind === 'fiber-runway') parts.push(<Beam key={`${i}:base`} a={point(0, 0)} b={point(length, 0)} width={width} depth={0.012} color={color} target={target} />);
    else for (let t = 0; t <= length; t += 0.3) parts.push(<Beam key={`${i}:rung:${t}`} a={point(t, -width / 2)} b={point(t, width / 2)} width={0.018} depth={0.018} color={color} target={target} />);
    if (height > 0 && ceiling > height) for (let t = 0.2; t < length; t += 1.5) for (const side of [-width / 2, width / 2]) parts.push(<Beam key={`${i}:rod:${t}:${side}`} a={point(t, side)} b={point(t, side, ceiling)} width={0.008} depth={0.008} color="#687988" />);
  }
  return <group>{parts}{tray.fittings.map((f, i) => <mesh key={i} position={[f.at.x / 1000, height + 0.04, f.at.y / 1000]} onClick={(e) => select(target, e)}><boxGeometry args={[width + 0.04, 0.08, 0.12]} /><meshStandardMaterial color="#edca55" /></mesh>)}</group>;
}
function Floor({ project, grid, underfloor }: { project: Project; grid: boolean; underfloor: boolean }) {
  const shape = useMemo(() => {
    const shape = new THREE.Shape();
    project.room.outline.forEach((p, i) => { if (!i) shape.moveTo(p.x / 1000, p.y / 1000); else shape.lineTo(p.x / 1000, p.y / 1000); }); shape.closePath(); return shape;
  }, [project.room.outline]);
  const geometry = useMemo(() => new THREE.ShapeGeometry(shape), [shape]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const gridGeometry = useMemo(() => new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(roomGrid(project), 3)), [project.room]);
  useEffect(() => () => gridGeometry.dispose(), [gridGeometry]);
  return <group>
    <mesh geometry={geometry} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.012, 0]}><meshStandardMaterial color="#283747" side={THREE.DoubleSide} transparent={underfloor} opacity={underfloor ? 0.35 : 1} depthWrite={!underfloor} /></mesh>
    {grid && <lineSegments geometry={gridGeometry}><lineBasicMaterial color="#3b5268" /></lineSegments>}
  </group>;
}
function CameraRig({ preset, frameCounter, data, project }: { preset: Preset; frameCounter: number; data: ReturnType<typeof buildPhysicalScene>; project: Project }) {
  const { camera, gl, scene, invalidate } = useThree();
  const controls = useRef<OrbitControlsImpl>(null);
  const lastFrame = useRef('');
  const ui = useViewer3dUi(), selection = useSelection();
  useEffect(() => {
    const key = `${project.id}:${preset}:${frameCounter}`;
    if (key === lastFrame.current && !ui.frameRequest) return;
    lastFrame.current = key;
    const chosen = ui.frameRequest ? selection.flatMap((s) => {
      if (s.kind === 'component') return data.devices.filter((d) => sameTarget(s, d.target)).flatMap(boxCorners);
      if (s.kind === 'rack') return data.frames.filter((d) => sameTarget(s, d.target)).flatMap(boxCorners);
      if (s.kind === 'link') return data.cables.find((c) => c.id === s.id)?.points ?? [];
      return [];
    }) : [];
    const target = chosen.length ? new THREE.Box3().setFromPoints(chosen.map((p) => new THREE.Vector3(...p))).getCenter(new THREE.Vector3()) : new THREE.Vector3(...data.center);
    const span = chosen.length ? Math.max(1.5, new THREE.Box3().setFromPoints(chosen.map((p) => new THREE.Vector3(...p))).getSize(new THREE.Vector3()).length()) : data.span;
    const distance = span * (camera instanceof THREE.PerspectiveCamera ? 0.65 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.min(1, camera.aspect) : 2);
    const direction = preset === 'top' ? new THREE.Vector3(0, 1, 0.001) : preset === 'front' ? new THREE.Vector3(0, 0.18, 1) : preset === 'rear' ? new THREE.Vector3(0, 0.18, -1) : new THREE.Vector3(1, 0.75, 1.15);
    camera.position.copy(target).add(direction.normalize().multiplyScalar(distance)); camera.up.set(0, 1, 0); camera.lookAt(target);
    controls.current?.target.copy(target); controls.current?.update(); invalidate();
    if (ui.frameRequest) store.getState().patchViewer3d({ frameRequest: false });
    // Project edits keep the camera stable; only explicit framing resets it.
  }, [preset, frameCounter, project.id, ui.frameRequest]);
  useEffect(() => registerCapture3D(async () => {
    gl.render(scene, camera);
    return new Promise<Blob>((resolve, reject) => gl.domElement.toBlob((b) => b ? resolve(b) : reject(new Error('Could not capture the 3D view')), 'image/png'));
  }), [gl, scene, camera]);
  return <OrbitControls ref={controls} makeDefault enableDamping minDistance={0.2} maxDistance={200} maxPolarAngle={Math.PI * 0.92} />;
}
class ViewerBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="p-6 text-fg-muted" role="alert">The 3D view could not start. Enable WebGL or hardware acceleration and reopen this tab.</div> : this.props.children; }
}
export function Viewer3D() {
  const project = useProject(), ui = useViewer3dUi(), selection = useSelection();
  const data = useMemo(() => buildPhysicalScene(project), [project]);
  const [preset, setPreset] = useState<Preset>('iso'), [frameCounter, setFrameCounter] = useState(0), [ready, setReady] = useState(false);
  useEffect(() => registerShortcut({ id: 'viewer.frame', keys: 'f', editor: 'viewer3d', description: 'Frame selection', handler: () => store.getState().patchViewer3d({ frameRequest: true }) }), []);
  const cables = data.cables.filter((c) => c.routed && ui.showCables && (!c.layers.length || c.layers.some((l) => l === 'in-rack' || (l === 'overhead' ? ui.showOverhead : ui.showUnderfloor))));
  const airwires = data.cables.filter((c) => !c.routed && ui.showAirwires);
  const screenshot = async () => { try { downloadBlob(await capture3dPng(), `${project.name}-3d.png`); } catch (e) { toast.error(e instanceof Error ? e.message : String(e)); } };
  const first = selection[0], idx = indexProject(project);
  const selectedName = first?.kind === 'component' ? idx.component(first.id)?.ref : first?.kind === 'rack' ? idx.rack(first.id)?.name : first?.kind === 'link' ? idx.link(first.id)?.label ?? 'Cable' : first?.kind;
  return <div data-editor="viewer3d" className="flex h-full min-h-0 flex-col" data-testid="viewer3d" data-ready={ready} data-device-count={data.devices.length} data-rack-count={project.racks.length} data-cable-count={cables.length} data-airwire-count={airwires.length}>
    <div role="toolbar" aria-label="3D controls" className="flex min-h-8 shrink-0 flex-wrap items-center gap-1 border-b border-border bg-panel px-2">
      {(['iso', 'top', 'front', 'rear'] as const).map((v) => <Button key={v} active={preset === v} onClick={() => { setPreset(v); setFrameCounter((n) => n + 1); }}>{v === 'iso' ? 'Isometric' : v.charAt(0).toUpperCase() + v.slice(1)}</Button>)}
      <Button onClick={() => { setFrameCounter((n) => n + 1); }}>Fit site</Button>
      <Button disabled={!selection.length} onClick={() => store.getState().patchViewer3d({ frameRequest: true })}>Frame selection</Button>
      <span className="mx-1 h-4 w-px bg-border" />
      {([{ key: 'showDoors', label: 'Doors' }, { key: 'showOverhead', label: 'Overhead' }, { key: 'showUnderfloor', label: 'Underfloor' }, { key: 'showCables', label: 'Cables' }, { key: 'showAirwires', label: 'Airwires' }, { key: 'showRaisedFloor', label: 'Floor grid' }] as const).map(({ key, label }) => <Checkbox key={key} label={label} checked={ui[key]} onCheckedChange={(v) => store.getState().patchViewer3d({ [key]: v === true })} />)}
      <Button disabled={!ready} onClick={() => void screenshot()}>Save PNG</Button>
    </div>
    <div className="relative min-h-0 flex-1 bg-[#101924]">
      <ViewerBoundary><Suspense fallback={<p className="p-4 text-fg-muted">Preparing 3D scene…</p>}>
        <Canvas camera={{ position: [8, 6, 10], fov: 42, near: 0.01, far: 300 }} gl={{ antialias: true, preserveDrawingBuffer: true }} dpr={[1, 2]} onCreated={() => setReady(true)} onPointerMissed={() => store.getState().clearSelection()}>
          <color attach="background" args={['#101924']} /><ambientLight intensity={1.2} /><hemisphereLight args={['#e4f4ff', '#334353', 1.5]} /><directionalLight position={[4, 10, 6]} intensity={2.5} />
          <Floor project={project} grid={ui.showRaisedFloor} underfloor={ui.showUnderfloor && project.trays.some((t) => t.layer === 'underfloor')} />
          <Boxes parts={data.frames} /><Boxes parts={data.devices} /><Boxes parts={data.ports} /><Boxes parts={data.accessories} />
          {ui.showDoors && <Boxes parts={data.doors} transparent />}
          {project.trays.filter((t) => t.layer === 'underfloor' ? ui.showUnderfloor : ui.showOverhead).map((tray) => <TrayMesh key={tray.id} tray={tray} ceiling={project.room.ceilingMm / 1000} />)}
          {cables.map((cable) => <Cable key={cable.id} cable={cable} />)}
          {airwires.map((cable) => <Line key={cable.id} points={cable.points} color={cable.color} transparent opacity={0.25} lineWidth={0.7} dashed dashSize={0.035} gapSize={0.025} onClick={(e) => select({ kind: 'link', id: cable.id }, e)} />)}
          {data.labels.map((label) => <Html key={label.id} position={label.position} center zIndexRange={[10, 0]}><button className="rounded border border-[#527083] bg-[#142532]/90 px-2 py-0.5 text-[11px] text-[#c4e1ed]" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); store.getState().select({ kind: 'rack', id: label.id }); }}>{label.text}</button></Html>)}
          <CameraRig project={project} data={data} preset={preset} frameCounter={frameCounter} />
        </Canvas>
      </Suspense></ViewerBoundary>
      <div className="absolute bottom-3 left-3 rounded border border-border bg-panel/95 px-3 py-2 text-xs text-fg-muted">{project.racks.length} racks · {data.devices.length} devices · {data.cables.filter((c) => c.routed).length} routed cables<br />Drag to orbit · Right-drag to pan · Scroll to zoom</div>
      {first && <div className="absolute right-3 top-3 flex items-center gap-2 rounded border border-border bg-panel/95 p-2 text-xs"><span>{selectedName}</span><Button onClick={() => store.getState().revealSelection(selection, 'layout')}>Show in layout</Button>{(first.kind === 'component' || first.kind === 'link') && <Button onClick={() => store.getState().revealSelection(selection, 'schematic')}>Show in schematic</Button>}</div>}
      {!project.racks.length && <p className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-fg-muted">Place racks and devices in Layout to build the 3D scene.</p>}
    </div>
  </div>;
}
