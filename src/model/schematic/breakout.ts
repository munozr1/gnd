/**
 * Breakouts: one QSFP-class port fans out into lanes, each lane a separate
 * link to a different (usually SFP / LC) port. Lane links share the source
 * port id and differ by `lane`.
 */
import { createLink } from '../factories';
import { indexProject, portKey } from '../query';
import type { Id, Link, LinkEnd, PortType, Project } from '../types';
import { isEndFree, linksOnPort, requireComponent } from './lookup';

export const BREAKOUT_CAPABLE: ReadonlySet<PortType> = new Set<PortType>(['QSFP+', 'QSFP28', 'QSFP56', 'QSFP-DD', 'OSFP']);
export const DEFAULT_FANOUT = 4;

export interface BreakoutOptions {
  componentId: Id;
  /** Source port; must be a QSFP-class cage. */
  portId: string;
  /** One per lane, in lane order. */
  targets: { componentId: Id; portId: string }[];
  cableDefId: string | null;
}

export type BreakoutErrorCode =
  | 'missing-source'
  | 'missing-port'
  | 'source-not-breakout-capable'
  | 'source-occupied'
  | 'too-many-targets'
  | 'no-free-lanes'
  | 'missing-target'
  | 'target-occupied'
  | 'duplicate-target'
  | 'target-is-source';

export interface BreakoutError {
  code: BreakoutErrorCode;
  message: string;
  /** Index into `targets` when the error concerns one of them. */
  targetIndex?: number;
}

export interface BreakoutPlan {
  ok: boolean;
  links: Link[];
  errors: BreakoutError[];
  fanout: number;
  /** Lanes already used on the source port before this plan. */
  usedLanes: number[];
}

/**
 * Lanes a source port can fan out to: the cable's declared fanout, else the
 * assigned optic's lane count, else DEFAULT_FANOUT.
 */
export function breakoutFanout(project: Project, componentId: Id, portId: string, cableDefId: string | null): number {
  const idx = indexProject(project);
  const cable = idx.catalog.cable(cableDefId);
  if (cable?.breakout) return cable.breakout.fanout;
  const c = idx.component(componentId);
  const optic = c ? idx.catalog.transceiver(c.optics[portId]) : undefined;
  if (optic && optic.lanes > 1) return optic.lanes;
  return DEFAULT_FANOUT;
}

/** Validate and build lane links without touching the project. Any error makes the plan not ok (no links). */
export function planBreakout(project: Project, opts: BreakoutOptions): BreakoutPlan {
  const idx = indexProject(project);
  const errors: BreakoutError[] = [];
  const fanout = breakoutFanout(project, opts.componentId, opts.portId, opts.cableDefId);
  const fail = (): BreakoutPlan => ({ ok: false, links: [], errors, fanout, usedLanes: [] });

  const source = idx.component(opts.componentId);
  const symbol = source ? idx.symbolOf(source) : undefined;
  if (!source || !symbol) {
    errors.push({ code: 'missing-source', message: `Component ${opts.componentId} not found` });
    return fail();
  }
  const pin = symbol.pins.find((p) => p.portId === opts.portId);
  if (!pin) {
    errors.push({ code: 'missing-port', message: `${source.ref} has no port ${opts.portId}` });
    return fail();
  }
  if (!BREAKOUT_CAPABLE.has(pin.type)) {
    errors.push({
      code: 'source-not-breakout-capable',
      message: `${source.ref}:${opts.portId} is ${pin.type}; only QSFP/OSFP ports break out`,
    });
    return fail();
  }

  const usedLanes: number[] = [];
  for (const l of linksOnPort(project.links, opts.componentId, opts.portId)) {
    const end = l.a.componentId === opts.componentId && l.a.portId === opts.portId ? l.a : l.b;
    if (end.lane === undefined) {
      errors.push({ code: 'source-occupied', message: `${source.ref}:${opts.portId} already has a whole-port link` });
      return fail();
    }
    usedLanes.push(end.lane);
  }
  usedLanes.sort((a, b) => a - b);

  if (opts.targets.length > fanout) {
    errors.push({ code: 'too-many-targets', message: `${opts.targets.length} targets exceed fanout ${fanout}` });
  }
  const freeLanes: number[] = [];
  for (let lane = 0; lane < fanout; lane++) if (!usedLanes.includes(lane)) freeLanes.push(lane);
  if (opts.targets.length > freeLanes.length) {
    errors.push({
      code: 'no-free-lanes',
      message: `${source.ref}:${opts.portId} has ${freeLanes.length} free lane(s) of ${fanout}`,
    });
  }

  const seen = new Set<string>();
  const links: Link[] = [];
  opts.targets.forEach((t, i) => {
    const target = idx.component(t.componentId);
    const targetPin = target ? idx.pinOf(target, t.portId) : undefined;
    if (!target || !targetPin) {
      errors.push({ code: 'missing-target', targetIndex: i, message: `Target ${t.componentId}:${t.portId} not found` });
      return;
    }
    const end: LinkEnd = { componentId: t.componentId, portId: t.portId };
    const key = portKey(end);
    if (t.componentId === opts.componentId && t.portId === opts.portId) {
      errors.push({ code: 'target-is-source', targetIndex: i, message: `${target.ref}:${t.portId} is the source port` });
      return;
    }
    if (seen.has(key)) {
      errors.push({ code: 'duplicate-target', targetIndex: i, message: `${target.ref}:${t.portId} listed twice` });
      return;
    }
    seen.add(key);
    if (!isEndFree(project.links, end)) {
      errors.push({ code: 'target-occupied', targetIndex: i, message: `${target.ref}:${t.portId} is already connected` });
      return;
    }
    const lane = freeLanes[i];
    if (lane === undefined) return; // already reported as no-free-lanes / too-many-targets
    links.push(createLink({ componentId: opts.componentId, portId: opts.portId, lane }, end, opts.cableDefId));
  });

  if (errors.length) return { ok: false, links: [], errors, fanout, usedLanes };
  return { ok: true, links, errors, fanout, usedLanes };
}

/** Push a valid plan's links. Throws when the plan is not ok. Returns the new link ids. */
export function applyBreakout(draft: Project, plan: BreakoutPlan): Id[] {
  if (!plan.ok) throw new Error(`Breakout plan has errors: ${plan.errors.map((e) => e.message).join('; ')}`);
  for (const l of plan.links) {
    requireComponent(draft, l.a.componentId);
    requireComponent(draft, l.b.componentId);
    draft.links.push({ ...l, a: { ...l.a }, b: { ...l.b }, sch: { wirePoints: [] } });
  }
  return plan.links.map((l) => l.id);
}

/** Lane links currently fanned out of a port, sorted by lane. */
export function breakoutLanes(project: Project, componentId: Id, portId: string): Link[] {
  return linksOnPort(project.links, componentId, portId)
    .filter((l) => (l.a.componentId === componentId && l.a.portId === portId ? l.a.lane : l.b.lane) !== undefined)
    .sort((x, y) => {
      const lx = x.a.componentId === componentId && x.a.portId === portId ? x.a.lane! : x.b.lane!;
      const ly = y.a.componentId === componentId && y.a.portId === portId ? y.a.lane! : y.b.lane!;
      return lx - ly;
    });
}
