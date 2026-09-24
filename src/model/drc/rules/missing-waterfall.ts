import { rectContains } from '../../geometry';
import { indexProject } from '../../query';
import { rackFloorRect } from '../../routing/positions';
import type { Rack, RouteSegment, Tray } from '../../types';
import { defineRule, type DrcFinding } from '../rule';

const firstNonEmpty = (segs: readonly RouteSegment[]): RouteSegment | undefined => segs.find((s) => s.points.length > 0);
const lastNonEmpty = (segs: readonly RouteSegment[]): RouteSegment | undefined =>
  [...segs].reverse().find((s) => s.points.length > 0);

/**
 * A waterfall serves a rack when it is bound to it by `rackId`, or, when it
 * carries no binding, when it physically sits over the rack footprint.
 */
const hasWaterfallOver = (tray: Tray, rack: Rack): boolean => {
  const footprint = rackFloorRect(rack);
  return tray.fittings.some(
    (f) => f.type === 'waterfall' && (f.rackId === undefined ? rectContains(footprint, f.at) : f.rackId === rack.id),
  );
};

/** An overhead run enters/leaves a rack on a tray that has no waterfall fitting for that rack. */
export const missingWaterfall = defineRule({
  id: 'missing-waterfall',
  name: 'Missing waterfall',
  description: 'A cable drops out of an overhead tray into a rack with no waterfall fitting over it.',
  defaultSeverity: 'error',
  check(project) {
    const idx = indexProject(project);
    const trays = new Map(project.trays.map((t) => [t.id, t] as const));
    const out: DrcFinding[] = [];
    for (const route of Object.values(project.routes)) {
      const link = idx.link(route.linkId);
      if (!link) continue;
      for (const [endRef, seg, end] of [
        [link.a, firstNonEmpty(route.segments), 'A'],
        [link.b, lastNonEmpty(route.segments), 'B'],
      ] as const) {
        if (!seg || seg.layer !== 'overhead' || !seg.trayId) continue;
        const tray = trays.get(seg.trayId);
        const rack = idx.rackOfComponent(endRef.componentId);
        if (!tray || !rack) continue;
        if (hasWaterfallOver(tray, rack)) continue;
        out.push({
          key: `${route.linkId}:${end}`,
          message: `${idx.linkLabel(link)}: end ${end} drops from tray ${tray.name ?? tray.id} into rack ${rack.name} with no waterfall`,
          targets: [{ kind: 'route', id: route.linkId }, { kind: 'tray', id: tray.id }, { kind: 'rack', id: rack.id }],
        });
      }
    }
    return out;
  },
});
