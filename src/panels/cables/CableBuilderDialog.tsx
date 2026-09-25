/**
 * 'cable-builder' dialog: define a fiber cable by fiber count, fiber type and
 * the connector on each end. Legs, kind (straight / trunk), channels, name,
 * strand map and the legacy fields are derived live through `resolveCable`;
 * the SVG preview comes from `previewLayout`. Advanced holds polarity,
 * breakout length, diameter, bend radius, per-leg labels / colours and an
 * editable strand map (any edit makes the map custom and stores it on the
 * definition). Save runs `addCableDef`.
 */
import { Fragment, useMemo, useState } from 'react';
import { addCableDef, defaultBendRadiusMm, type FiberCableDefInput } from '@/commands';
import {
  connectorById,
  connectorCatalog,
  defaultJacketColor,
  defaultLegLabel,
  isBijection,
  resolveCable,
  validateCableDef,
  type Leg,
  type ResolvedCable,
  type ResolvedSide,
} from '@/model/cables';
import type { CableDef, CablePolarity, CableSideDef, FiberType, StrandLink } from '@/model/types';
import { store } from '@/store';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Dialog, DialogContent } from '@/ui/Dialog';
import { Input, NumberInput } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { toast } from '@/ui/Toast';
import { execute, Field, TH } from '@/panels/schematic/common';
import { GLYPH_W, previewHeight, previewLayout, type PreviewLayout, type PreviewLeg, type PreviewSide, type PreviewSideId } from './preview';

export const CABLE_BUILDER_DIALOG = 'cable-builder';
export const FIBER_COUNTS: readonly number[] = [2, 8, 12, 16, 24, 32, 48, 72, 96, 144];
const FIBER_TYPES: readonly FiberType[] = ['OS2', 'OM3', 'OM4', 'OM5'];
const POLARITIES: readonly CablePolarity[] = ['A', 'B', 'C'];
const CUSTOM_COUNT = 'custom';
const PREVIEW_WIDTH = 620;

const CONNECTOR_OPTIONS = connectorCatalog.map((c) => ({
  value: c.id,
  label: `${c.id} · ${c.family}${c.vsff ? ' (VSFF)' : ''} · ${c.fibersUsed}F`,
}));

export interface CableBuilderForm {
  fiberCount: number;
  /** Show the free number input instead of the preset list. */
  customCount: boolean;
  fiberType: FiberType;
  connA: string;
  connB: string;
  // null = automatic: the fiber type's jacket colour, the derived name, the default polarity / lengths.
  color: string | null;
  name: string | null;
  polarity: CablePolarity | null;
  breakoutLengthM: number | null;
  diameterMm: number | null;
  bendRadiusMm: number | null;
  /** Sparse per-leg overrides by leg index ('' = default). */
  legLabelsA: string[];
  legLabelsB: string[];
  legColorsA: string[];
  legColorsB: string[];
  /** Set as soon as the user edits the strand-map table; null = derived from sides + polarity. */
  strandMap: StrandLink[] | null;
}

/** The acceptance example: 8F OM4, MPO-8 → LC-duplex (1 MPO leg, 4 LC legs, trunk, 4 channels). */
export const DEFAULT_FORM: CableBuilderForm = {
  fiberCount: 8,
  customCount: false,
  fiberType: 'OM4',
  connA: 'MPO-8',
  connB: 'LC-duplex',
  color: null,
  name: null,
  polarity: null,
  breakoutLengthM: null,
  diameterMm: null,
  bendRadiusMm: null,
  legLabelsA: [],
  legLabelsB: [],
  legColorsA: [],
  legColorsB: [],
  strandMap: null,
};

function sideDef(connector: string, labels: string[], colors: string[], legCount?: number): CableSideDef {
  const s: CableSideDef = { connector };
  const trim = (list: string[]) => (legCount === undefined ? list : list.slice(0, legCount)).map((v) => v.trim());
  const l = trim(labels);
  const c = trim(colors);
  if (l.some(Boolean)) s.legLabels = l;
  if (c.some(Boolean)) s.legColors = c;
  return s;
}

/** The definition the form describes, as the command layer takes it; automatic fields are left out. */
export function formToDef(form: CableBuilderForm, name: string, legCounts?: { a: number; b: number }): FiberCableDefInput {
  const def: FiberCableDefInput = {
    name,
    fiberCount: form.fiberCount,
    fiberType: form.fiberType,
    sideA: sideDef(form.connA, form.legLabelsA, form.legColorsA, legCounts?.a),
    sideB: sideDef(form.connB, form.legLabelsB, form.legColorsB, legCounts?.b),
  };
  if (form.color !== null) def.color = form.color;
  if (form.polarity !== null) def.polarity = form.polarity;
  if (form.breakoutLengthM !== null) def.breakoutLengthM = form.breakoutLengthM;
  if (form.diameterMm !== null) def.diameterMm = form.diameterMm;
  if (form.bendRadiusMm !== null) def.bendRadiusMm = form.bendRadiusMm;
  if (form.strandMap !== null) def.strandMap = form.strandMap;
  return def;
}

/** A throwaway full CableDef for the live derivation (resolveCable / validateCableDef take the stored shape). */
function candidateDef(form: CableBuilderForm): CableDef {
  const input = formToDef(form, form.name ?? 'preview');
  return {
    ...input,
    id: 'cbl.preview',
    media: form.fiberType,
    mediaClass: 'fiber',
    endA: '',
    endB: '',
    color: input.color ?? '',
    bendRadiusMm: input.bendRadiusMm ?? 0,
    diameterMm: input.diameterMm ?? 0,
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
/** `<input type="color">` only accepts #rrggbb; anything else falls back so React does not warn. */
const hexOr = (value: string | undefined, fallback: string): string => (value && HEX.test(value) ? value.toLowerCase() : HEX.test(fallback) ? fallback.toLowerCase() : '#000000');

interface HoverLeg {
  side: PreviewSideId;
  leg: PreviewLeg;
}

export function CableBuilderDialog() {
  const [form, setForm] = useState<CableBuilderForm>(DEFAULT_FORM);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [hover, setHover] = useState<HoverLeg | null>(null);

  const patch = (p: Partial<CableBuilderForm>) => {
    setSubmitError(null);
    setForm((f) => ({ ...f, ...p }));
  };
  const close = () => store.getState().closeDialog();

  const derived = useMemo(() => {
    const def = candidateDef(form);
    const resolved = resolveCable(def);
    return {
      resolved: 'error' in resolved ? null : resolved,
      error: 'error' in resolved ? resolved.error : null,
      problems: validateCableDef(def),
    };
  }, [form]);
  const { resolved, problems } = derived;
  const error = derived.error ?? problems[0] ?? null;
  const name = form.name ?? resolved?.displayName ?? '';
  const color = form.color ?? defaultJacketColor(form.fiberType);
  const layout = useMemo(() => (resolved ? previewLayout(resolved, PREVIEW_WIDTH, previewHeight(resolved)) : null), [resolved]);

  const submit = () => {
    if (!resolved || error) {
      setSubmitError(error ?? 'Fix the definition first');
      return;
    }
    const cmd = addCableDef(formToDef(form, name.trim(), { a: resolved.sideA.legs.length, b: resolved.sideB.legs.length }));
    if (!execute(cmd) || !cmd.result) {
      setSubmitError(store.getState().ui.lastError ?? 'Could not add the cable');
      return;
    }
    toast.ok(`Added ${name.trim()} to the cable library`);
    close();
  };

  const shownError = submitError ?? error;

  return (
    <Dialog open onOpenChange={(o) => !o && close()}>
      <DialogContent
        title="Cable Builder"
        description="Define a fiber cable by its fiber count and the connector on each end; legs, kind and strand map are derived. Saved in this project's catalog."
        width="lg"
        footer={
          <>
            <span className="mr-auto truncate text-[12px] text-fg-muted" data-testid="cable-display-name">
              {resolved ? resolved.displayName : ''}
            </span>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={!resolved || !!error || !name.trim()} data-testid="cable-save">
              Save
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          <Field label="Fiber count">
            <span className="flex items-center gap-1">
              <Select
                aria-label="Fiber count"
                value={form.customCount ? CUSTOM_COUNT : String(form.fiberCount)}
                onValueChange={(v) => (v === CUSTOM_COUNT ? patch({ customCount: true }) : patch({ customCount: false, fiberCount: Number(v) }))}
                options={[...FIBER_COUNTS.map((n) => ({ value: String(n), label: `${n}F` })), { value: CUSTOM_COUNT, label: 'Custom…' }]}
                className="w-24"
              />
              {form.customCount && (
                <NumberInput aria-label="Custom fiber count" value={form.fiberCount} min={2} step={2} decimals={0} unit="F" onChange={(v) => patch({ fiberCount: v })} className="w-20" />
              )}
            </span>
          </Field>
          <Field label="Fiber type">
            <span className="flex items-center gap-1">
              <Select aria-label="Fiber type" value={form.fiberType} onValueChange={(v) => patch({ fiberType: v as FiberType })} options={FIBER_TYPES.map((t) => ({ value: t, label: t }))} className="w-20" />
              <input
                type="color"
                aria-label="Jacket colour"
                title="Jacket colour"
                value={hexOr(color, defaultJacketColor(form.fiberType))}
                onChange={(e) => patch({ color: e.target.value })}
                className="h-6 w-8 shrink-0 cursor-pointer rounded border border-border bg-bg p-0.5"
              />
              <Input aria-label="Jacket colour hex" mono value={color} onChange={(e) => patch({ color: e.target.value })} className="w-20" />
              {form.color !== null && (
                <Button size="sm" variant="ghost" onClick={() => patch({ color: null })} title="Back to the fiber type's default colour">
                  Auto
                </Button>
              )}
            </span>
          </Field>
          <Field label="Side A">
            <Select aria-label="Side A connector" value={form.connA} onValueChange={(v) => patch({ connA: v })} options={CONNECTOR_OPTIONS} className="w-full" />
          </Field>
          <Field label="Side B">
            <Select aria-label="Side B connector" value={form.connB} onValueChange={(v) => patch({ connB: v })} options={CONNECTOR_OPTIONS} className="w-full" />
          </Field>
          <Field label="Name" className="col-span-2">
            <span className="flex items-center gap-1">
              <Input aria-label="Cable name" value={name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. 8F OM4 MPO-8 → 4×LC-duplex" className="flex-1" />
              {form.name !== null && (
                <Button size="sm" variant="ghost" onClick={() => patch({ name: null })} title="Back to the derived name">
                  Auto
                </Button>
              )}
            </span>
          </Field>
        </div>

        <div className="mt-3 rounded border border-border bg-bg/40 p-2" data-testid="cable-preview" data-kind={resolved?.kind}>
          {layout ? (
            <CablePreview layout={layout} hover={hover} onHover={setHover} />
          ) : (
            <div className="flex h-24 items-center justify-center text-[12px] text-fg-muted">Fix the definition to see the preview.</div>
          )}
          <div className="mt-1 flex items-center gap-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate text-fg" data-testid="cable-summary">
              {resolved?.summary ?? '—'}
            </span>
            {resolved && (
              <span className="shrink-0 text-[11px] text-fg-muted">
                Polarity {resolved.polarity}
                {resolved.strandMapCustom ? ' · custom strand map' : ''}
              </span>
            )}
          </div>
        </div>

        {shownError && (
          <div className="mt-2 rounded border border-error/40 bg-error/10 px-2 py-1 text-[12px] text-error" role="alert" data-testid="cable-error">
            {shownError}
            {problems.length > 1 && submitError === null ? ` (+${problems.length - 1} more)` : ''}
          </div>
        )}

        <details className="mt-3" open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)} data-testid="cable-advanced">
          <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-wide text-fg-muted">Advanced</summary>
          {advancedOpen && resolved && (
            <div className="mt-2 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <Field label="Polarity" hint="B for multi-fiber connectors, A for a duplex cord">
                  <Select
                    aria-label="Polarity"
                    value={form.polarity ?? resolved.polarity}
                    onValueChange={(v) => patch({ polarity: v as CablePolarity })}
                    options={POLARITIES.map((p) => ({ value: p, label: `Polarity ${p}` }))}
                    className="w-32"
                  />
                </Field>
                <Field label="Breakout" hint={resolved.kind === 'trunk' ? 'jacket to legs' : 'straight cable: none'}>
                  <NumberInput
                    aria-label="Breakout length"
                    value={form.breakoutLengthM ?? resolved.breakoutLengthM}
                    min={0}
                    step={0.1}
                    decimals={2}
                    unit="m"
                    onChange={(v) => patch({ breakoutLengthM: v })}
                    disabled={resolved.kind !== 'trunk'}
                    className="w-24"
                  />
                </Field>
                <Field label="Diameter">
                  <NumberInput aria-label="Outer diameter" value={form.diameterMm ?? resolved.diameterMm} min={0.5} step={0.5} decimals={1} unit="mm" onChange={(v) => patch({ diameterMm: v })} className="w-24" />
                </Field>
                <Field label="Bend radius">
                  <NumberInput
                    aria-label="Bend radius"
                    value={form.bendRadiusMm ?? defaultBendRadiusMm(resolved.diameterMm)}
                    min={1}
                    step={5}
                    decimals={0}
                    unit="mm"
                    onChange={(v) => patch({ bendRadiusMm: v })}
                    className="w-24"
                  />
                </Field>
              </div>
              <LegTable side="A" resolvedSide={resolved.sideA} labels={form.legLabelsA} colors={form.legColorsA} onChange={(legLabelsA, legColorsA) => patch({ legLabelsA, legColorsA })} />
              <LegTable side="B" resolvedSide={resolved.sideB} labels={form.legLabelsB} colors={form.legColorsB} onChange={(legLabelsB, legColorsB) => patch({ legLabelsB, legColorsB })} />
              <StrandMapTable resolved={resolved} custom={form.strandMap !== null} onChange={(strandMap) => patch({ strandMap })} onReset={() => patch({ strandMap: null })} />
            </div>
          )}
        </details>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Preview (SVG)
// ---------------------------------------------------------------------------

const legTitle = (leg: PreviewLeg): string => `Leg ${leg.label} · ${leg.connector} · positions ${leg.positions.join(', ')}`;

function CablePreview({ layout, hover, onHover }: { layout: PreviewLayout; hover: HoverLeg | null; onHover: (h: HoverLeg | null) => void }) {
  const { jacket, sides, badge, width, height } = layout;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block max-w-full" role="img" aria-label="Cable preview">
        <line x1={jacket.x1} x2={jacket.x2} y1={jacket.y} y2={jacket.y} stroke={jacket.color} strokeWidth={jacket.thickness} strokeLinecap="round" data-testid="cable-jacket" />
        {(['A', 'B'] as const).map((id) => (
          <SideGlyphs key={id} id={id} side={sides[id]} jacket={jacket} height={height} hover={hover} onHover={onHover} />
        ))}
        <g data-testid="cable-badge" className="text-panel-2">
          <rect x={badge.x - 32} y={badge.y - 9} width={64} height={14} rx={7} fill="currentColor" stroke="rgba(255,255,255,0.15)" />
          <text x={badge.x} y={badge.y + 2} textAnchor="middle" fontSize={10} fontFamily="ui-monospace, monospace" className="text-fg" fill="currentColor">
            {badge.text}
          </text>
        </g>
      </svg>
      {hover && (
        <span
          data-testid="cable-leg-tip"
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded border border-border bg-panel-2 px-1.5 py-0.5 text-[11px] text-fg shadow"
          style={{ left: hover.leg.x, top: hover.leg.y + 12, transform: hover.side === 'B' ? 'translateX(-100%)' : undefined }}
        >
          {legTitle(hover.leg)}
        </span>
      )}
    </div>
  );
}

function SideGlyphs({
  id,
  side,
  jacket,
  height,
  hover,
  onHover,
}: {
  id: PreviewSideId;
  side: PreviewSide;
  jacket: PreviewLayout['jacket'];
  height: number;
  hover: HoverLeg | null;
  onHover: (h: HoverLeg | null) => void;
}) {
  // +1 points from this side's glyphs towards the jacket.
  const dir = id === 'A' ? 1 : -1;
  return (
    <g data-side={id}>
      {side.furcation && <FurcationBoot x={side.furcation.x} y={side.furcation.y} dir={dir} thickness={jacket.thickness} color={jacket.color} side={id} />}
      {side.legs.map((leg) => {
        const inner = leg.x + dir * (GLYPH_W / 2);
        const active = hover?.side === id && hover.leg.index === leg.index;
        return (
          <g
            key={leg.index}
            data-testid="cable-leg"
            data-side={id}
            data-leg={leg.index}
            data-connector={leg.connector}
            onMouseEnter={() => onHover({ side: id, leg })}
            onMouseLeave={() => onHover(null)}
            className="cursor-default"
          >
            <title>{legTitle(leg)}</title>
            <line x1={side.origin.x} y1={side.origin.y} x2={inner} y2={leg.y} stroke={jacket.color} strokeWidth={leg.family === 'multi' ? 3 : 2} strokeLinecap="round" />
            <ConnectorGlyph leg={leg} active={active} />
            <text
              x={leg.x - dir * (GLYPH_W / 2 + 4)}
              y={leg.y + 3.5}
              textAnchor={dir === 1 ? 'end' : 'start'}
              fontSize={10}
              fontFamily="ui-monospace, monospace"
              className={active ? 'text-fg' : 'text-fg-muted'}
              fill="currentColor"
            >
              {leg.label}
            </text>
          </g>
        );
      })}
      {side.hiddenLegs > 0 && (
        <text x={side.legs[0]?.x ?? 0} y={height - 4} textAnchor="middle" fontSize={10} className="text-fg-muted" fill="currentColor" data-testid="cable-hidden-legs" data-side={id}>
          +{side.hiddenLegs} more
        </text>
      )}
    </g>
  );
}

/** MPO / MMC: a body with a lighter ferrule window; LC / SN / CS: one square per fiber (a duplex pair). */
function ConnectorGlyph({ leg, active }: { leg: PreviewLeg; active: boolean }) {
  const stroke = active ? '#ffffff' : 'rgba(0,0,0,0.55)';
  if (leg.family === 'multi') {
    return (
      <g>
        <rect x={leg.x - GLYPH_W / 2} y={leg.y - 5} width={GLYPH_W} height={10} rx={1.5} fill={leg.color} stroke={stroke} />
        <rect x={leg.x - 7} y={leg.y - 2.5} width={14} height={5} fill="rgba(255,255,255,0.35)" />
      </g>
    );
  }
  const w = 7;
  const xs = leg.fibers <= 1 ? [leg.x - w / 2] : [leg.x - w - 1, leg.x + 1];
  return (
    <g>
      {xs.map((x, i) => (
        <rect key={i} x={x} y={leg.y - w / 2} width={w} height={w} rx={1} fill={leg.color} stroke={stroke} />
      ))}
    </g>
  );
}

/** The boot where the jacket splits: a trapezoid widening from the jacket towards the legs. */
function FurcationBoot({ x, y, dir, thickness, color, side }: { x: number; y: number; dir: number; thickness: number; color: string; side: PreviewSideId }) {
  const t = thickness / 2 + 1;
  const wide = t + 4;
  const pts = [
    [x + dir * 6, y - t],
    [x + dir * 6, y + t],
    [x - dir * 6, y + wide],
    [x - dir * 6, y - wide],
  ];
  return <polygon points={pts.map((p) => p.join(',')).join(' ')} fill={color} stroke="rgba(0,0,0,0.55)" data-testid="cable-furcation" data-side={side} />;
}

// ---------------------------------------------------------------------------
// Advanced tables
// ---------------------------------------------------------------------------

const setAt = (list: string[], i: number, v: string): string[] => {
  const next = [...list];
  while (next.length <= i) next.push('');
  next[i] = v;
  return next;
};

function LegTable({
  side,
  resolvedSide,
  labels,
  colors,
  onChange,
}: {
  side: PreviewSideId;
  resolvedSide: ResolvedSide;
  labels: string[];
  colors: string[];
  onChange: (labels: string[], colors: string[]) => void;
}) {
  const conn = connectorById(resolvedSide.connector);
  const family = conn?.family ?? 'small';
  const defaultColor = conn?.color ?? '#94a3b8';
  return (
    <div data-testid={`legs-${side}`}>
      <div className="flex h-5 items-center text-[11px] font-medium uppercase tracking-wide text-fg-muted">
        Side {side} legs · {resolvedSide.legs.length}×{resolvedSide.connector}
      </div>
      <div className="grid grid-cols-[32px_1fr_1fr_1.2fr] items-center gap-x-1 gap-y-0.5">
        <TH>#</TH>
        <TH>Label</TH>
        <TH>Colour</TH>
        <TH>Positions</TH>
        {resolvedSide.legs.map((leg: Leg, i: number) => (
          <Fragment key={leg.index}>
            <span className="px-1.5 text-[12px] text-fg-muted">{i + 1}</span>
            <Input aria-label={`Side ${side} leg ${i + 1} label`} value={labels[i] ?? ''} placeholder={defaultLegLabel(family, i)} onChange={(e) => onChange(setAt(labels, i, e.target.value), colors)} />
            <span className="flex items-center gap-1">
              <input
                type="color"
                aria-label={`Side ${side} leg ${i + 1} colour`}
                value={hexOr(colors[i], defaultColor)}
                onChange={(e) => onChange(labels, setAt(colors, i, e.target.value))}
                className="h-6 w-8 shrink-0 cursor-pointer rounded border border-border bg-bg p-0.5"
              />
              <Input mono aria-label={`Side ${side} leg ${i + 1} colour hex`} value={colors[i] ?? ''} placeholder="default" onChange={(e) => onChange(labels, setAt(colors, i, e.target.value))} className="w-full" />
            </span>
            <span className="mono truncate text-[12px] text-fg-muted" title={leg.positions.join(', ')}>
              {leg.positions.join(', ')}
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function StrandMapTable({ resolved, custom, onChange, onReset }: { resolved: ResolvedCable; custom: boolean; onChange: (map: StrandLink[]) => void; onReset: () => void }) {
  const map = resolved.strandMap;
  const check = custom ? isBijection(map, resolved.sideA, resolved.sideB) : null;
  const legLabel = (side: ResolvedSide, leg: number): string => side.legs[leg]?.label ?? '?';
  const edit = (row: number, end: 'a' | 'b', field: 'leg' | 'pos', value: number) => {
    const next = map.map((l) => ({ a: { ...l.a }, b: { ...l.b } }));
    const link = next[row];
    if (!link) return;
    link[end][field] = field === 'leg' ? value - 1 : value;
    onChange(next);
  };
  return (
    <div data-testid="strand-map">
      <div className="flex h-5 items-center gap-2">
        <span className="flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-fg-muted">Strand map · {map.length} fibers</span>
        <Badge tone={custom ? 'warning' : 'neutral'} data-testid="strand-map-mode">
          {custom ? 'custom' : 'derived'}
        </Badge>
        <Button size="sm" variant="ghost" disabled={!custom} onClick={onReset}>
          Reset to derived
        </Button>
      </div>
      <div className="grid grid-cols-[36px_60px_60px_1fr_20px_60px_60px_1fr] items-center gap-x-1 gap-y-0.5">
        <TH>Fiber</TH>
        <TH>A leg</TH>
        <TH>A pos</TH>
        <TH />
        <TH />
        <TH>B leg</TH>
        <TH>B pos</TH>
        <TH />
        {map.map((link, i) => (
          <Fragment key={i}>
            <span className="px-1.5 text-[12px] text-fg-muted">{i + 1}</span>
            <NumberInput aria-label={`Fiber ${i + 1} side A leg`} value={link.a.leg + 1} min={1} decimals={0} onChange={(v) => edit(i, 'a', 'leg', v)} />
            <NumberInput aria-label={`Fiber ${i + 1} side A position`} value={link.a.pos} min={1} decimals={0} onChange={(v) => edit(i, 'a', 'pos', v)} />
            <span className="truncate text-[11px] text-fg-muted">{legLabel(resolved.sideA, link.a.leg)}</span>
            <span className="text-center text-[11px] text-fg-muted">↔</span>
            <NumberInput aria-label={`Fiber ${i + 1} side B leg`} value={link.b.leg + 1} min={1} decimals={0} onChange={(v) => edit(i, 'b', 'leg', v)} />
            <NumberInput aria-label={`Fiber ${i + 1} side B position`} value={link.b.pos} min={1} decimals={0} onChange={(v) => edit(i, 'b', 'pos', v)} />
            <span className="truncate text-[11px] text-fg-muted">{legLabel(resolved.sideB, link.b.leg)}</span>
          </Fragment>
        ))}
      </div>
      {check && !check.ok && (
        <div className="mt-1 text-[11px] text-error" role="alert" data-testid="strand-map-problems">
          {check.problems.slice(0, 5).join(' · ')}
          {check.problems.length > 5 ? ` · +${check.problems.length - 5} more` : ''}
        </div>
      )}
    </div>
  );
}
