import { cornerAngleDeg, dist, eq } from '../../geometry';
import { indexProject } from '../../query';
import { segmentElevationMm } from '../../routing/path3d';
import type { Project, Route, Vec2 } from '../../types';
import { defineRule, type DrcFinding } from '../rule';

/** Corners flatter than this are treated as straight. */
const MIN_TURN_DEG = 1;

/**
 * Floor-plan polylines of a route, one per run of consecutive segments at the
 * same elevation. Splitting a segment does not create or hide a corner, so
 * segment joins at the same elevation are walked through; a layer change is a
 * vertical drop, so the polyline restarts there. Consecutive duplicate points
 * (a join that repeats its shared point) are collapsed.
 */
function floorPolylines(project: Project, route: Route): Vec2[][] {
  const runs: Vec2[][] = [];
  let prevElev: number | null = null;
  for (const seg of route.segments) {
    if (seg.points.length === 0) continue;
    const elev = segmentElevationMm(project, seg);
    let run = runs[runs.length - 1];
    if (!run || elev !== prevElev) {
      run = [];
      runs.push(run);
    }
    for (const wp of seg.points) {
      const last = run[run.length - 1];
      if (!last || !eq(last, wp.pos)) run.push(wp.pos);
    }
    prevElev = elev;
  }
  return runs;
}

/**
 * Heuristic: a cable turning at a waypoint needs at least its minimum bend
 * radius of straight run on each side to form the arc. Any corner with a
 * real turn (> 1°) whose shorter adjacent segment is shorter than the
 * cable's `bendRadiusMm` therefore cannot be dressed without kinking.
 */
export const bendRadius = defineRule({
  id: 'bend-radius',
  name: 'Bend radius',
  description: 'A route corner is tighter than the cable allows.',
  defaultSeverity: 'warning',
  check(project) {
    const idx = indexProject(project);
    const out: DrcFinding[] = [];
    for (const route of Object.values(project.routes)) {
      const link = idx.link(route.linkId);
      const cable = link ? idx.cableOf(link) : undefined;
      if (!link || !cable) continue;
      let tight = 0;
      let shortest = Infinity;
      for (const pts of floorPolylines(project, route)) {
        for (let i = 1; i < pts.length - 1; i++) {
          const a = pts[i - 1]!;
          const b = pts[i]!;
          const c = pts[i + 1]!;
          if (cornerAngleDeg(a, b, c) <= MIN_TURN_DEG) continue;
          const leg = Math.min(dist(a, b), dist(b, c));
          if (leg < cable.bendRadiusMm) {
            tight++;
            shortest = Math.min(shortest, leg);
          }
        }
      }
      if (tight === 0) continue;
      out.push({
        key: route.linkId,
        message: `${idx.linkLabel(link)}: ${tight} corner${tight > 1 ? 's' : ''} tighter than the ${cable.bendRadiusMm} mm bend radius of ${cable.name} (shortest leg ${Math.round(shortest)} mm)`,
        targets: [{ kind: 'route', id: route.linkId }, { kind: 'link', id: link.id }],
      });
    }
    return out;
  },
});
