import { indexProject } from '../../query';
import { resolveRouteEnds, routeLabel } from '../../routing/owner';
import type { Project, TrayKind } from '../../types';
import { defineRule, type DrcFinding } from '../rule';

type MediaClass = 'fiber' | 'copper';

const FALLBACK_ACCEPTS: Record<TrayKind, MediaClass[]> = {
  'fiber-runway': ['fiber'],
  ladder: ['copper'],
  basket: ['fiber', 'copper'],
};

/** Cable classes a tray kind accepts: the union over catalog tray defs of that kind, else the built-in table. */
export function trayKindAccepts(project: Project, kind: TrayKind): MediaClass[] {
  const defs = indexProject(project).catalog.catalog.trays.filter((t) => t.kind === kind);
  if (defs.length === 0) return FALLBACK_ACCEPTS[kind];
  return [...new Set(defs.flatMap((t) => t.accepts))];
}

/** Fiber riding a ladder rack, or copper riding a fiber runway. */
export const trayMedia = defineRule({
  id: 'tray-media',
  name: 'Tray media',
  description: 'A cable rides a tray kind that does not accept its media class.',
  defaultSeverity: 'error',
  check(project) {
    const idx = indexProject(project);
    const trays = new Map(project.trays.map((t) => [t.id, t] as const));
    const out: DrcFinding[] = [];
    for (const route of Object.values(project.routes)) {
      const ends = resolveRouteEnds(idx, route);
      const cable = ends?.cableDef;
      if (!ends || !cable) continue;
      const seen = new Set<string>();
      for (const seg of route.segments) {
        const tray = seg.trayId ? trays.get(seg.trayId) : undefined;
        if (!tray || seen.has(tray.id)) continue;
        seen.add(tray.id);
        if (trayKindAccepts(project, tray.kind).includes(cable.mediaClass)) continue;
        out.push({
          key: `${route.linkId}:${tray.id}`,
          message: `${routeLabel(idx, ends)}: ${cable.mediaClass} cable ${cable.name} rides ${tray.kind} tray ${tray.name ?? tray.id}`,
          targets: [{ kind: 'route', id: route.linkId }, { kind: 'tray', id: tray.id }],
        });
      }
    }
    return out;
  },
});
