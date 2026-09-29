import { isPlugged } from '../../cables/instances';
import { cableLegViews, cableReach, cableTarget, resolveCableWith, type CableLegView } from '../../cables/validation';
import { indexProject } from '../../query';
import { dist3, portWorldPos } from '../../routing/positions';
import type { Id, Project, Vec3 } from '../../types';
import { defineRule, type DrcFinding } from '../rule';

interface PlacedLeg {
  view: CableLegView;
  componentId: Id;
  portId: string;
  pos: Vec3;
}

/** The plugged legs of one side whose port is placed, with the port's 3D position (mm). */
function placedLegs(project: Project, legs: readonly CableLegView[], side: 'A' | 'B'): PlacedLeg[] {
  const out: PlacedLeg[] = [];
  for (const view of legs) {
    if (view.side !== side || !isPlugged(view.plug)) continue;
    const pos = portWorldPos(project, view.plug.componentId, view.plug.portId);
    if (pos) out.push({ view, componentId: view.plug.componentId, portId: view.plug.portId, pos });
  }
  return out;
}

/** '2', '3.27': metres to two decimals without trailing zeros. */
const fmt = (m: number): string => String(Math.round(m * 100) / 100);

/**
 * The cable cannot physically span its ends: its jacket (the routed jacket's
 * geometric length, else the declared length) plus the breakout on each
 * fanned side is shorter than the straight-line distance from a side-A port
 * to a plugged side-B leg's port. One finding per leg that is out of reach.
 * Cables with neither a route nor a declared length are not checked.
 */
export const cableLengthShort = defineRule({
  id: 'cable-length-short',
  name: 'Cable too short',
  description: "A cable's routed or declared jacket length plus its breakout is shorter than the straight-line run to one of its legs' ports.",
  defaultSeverity: 'warning',
  check(project) {
    const idx = indexProject(project);
    const out: DrcFinding[] = [];
    for (const cable of project.cables) {
      const resolved = resolveCableWith(idx, cable);
      if (!resolved) continue;
      const reach = cableReach(project, cable, resolved);
      if (!reach) continue;
      const legs = cableLegViews(resolved, cable);
      const aLegs = placedLegs(project, legs, 'A');
      if (aLegs.length === 0) continue;
      for (const b of placedLegs(project, legs, 'B')) {
        // The farthest side-A port is the run the jacket must span to this leg.
        const far = aLegs.reduce((m, a) => (dist3(a.pos, b.pos) > dist3(m.pos, b.pos) ? a : m));
        const runM = dist3(far.pos, b.pos) / 1000;
        if (reach.totalM + 1e-6 >= runM) continue;
        const jacket = `${fmt(reach.jacketM)} m ${reach.routed ? 'routed' : 'declared'} jacket`;
        const breakout = reach.breakoutM > 0 ? ` + ${fmt(reach.breakoutM)} m breakout` : '';
        out.push({
          key: `${cable.id}:${b.view.side}${b.view.leg.index}`,
          message: `${cable.label}: ${jacket}${breakout} is shorter than the ${fmt(runM)} m straight run from ${idx.endLabel(far)} to ${idx.endLabel(b)} (${b.view.name})`,
          targets: [cableTarget(cable.id), { kind: 'component', id: b.componentId, portId: b.portId }],
        });
      }
    }
    return out;
  },
});
