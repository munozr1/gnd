import { indexProject } from '../../query';
import { resolveRouteEnds } from '../../routing/owner';
import { managerFor } from '../../routing/positions';
import type { Id, IssueTarget, Rack, Side } from '../../types';
import { defineRule, type DrcFinding } from '../rule';

/** Routes need a vertical manager on a side of a rack that has none, grouped per (rack, side). */
export const missingManager = defineRule({
  id: 'missing-manager',
  name: 'Missing vertical manager',
  description: 'A cable is dressed down a side of the rack that has no vertical cable manager.',
  defaultSeverity: 'warning',
  check(project) {
    const idx = indexProject(project);
    const groups = new Map<string, { rack: Rack; side: Side; linkIds: Id[] }>();
    for (const route of Object.values(project.routes)) {
      const ends = resolveRouteEnds(idx, route);
      if (!ends) continue;
      for (const [endRef, path, furcation] of [
        [ends.a, route.aRack, ends.furcationA],
        [ends.b, route.bRack, ends.furcationB],
      ] as const) {
        // A cable jacket that fans out ends at its furcation point on the floor, not down the rack's manager.
        if (furcation) continue;
        const rack = idx.rackOfComponent(endRef.componentId);
        if (!rack || managerFor(project, rack.id, path.side)) continue;
        const key = `${rack.id}:${path.side}`;
        const g = groups.get(key);
        if (g) {
          if (!g.linkIds.includes(route.linkId)) g.linkIds.push(route.linkId);
        } else groups.set(key, { rack, side: path.side, linkIds: [route.linkId] });
      }
    }
    const out: DrcFinding[] = [];
    for (const [key, g] of groups) {
      const targets: IssueTarget[] = [{ kind: 'rack', id: g.rack.id }, ...g.linkIds.map((id) => ({ kind: 'route' as const, id }))];
      out.push({
        key,
        message: `Rack ${g.rack.name} has no ${g.side} vertical cable manager but ${g.linkIds.length} cable${g.linkIds.length > 1 ? 's use' : ' uses'} it`,
        targets,
      });
    }
    return out;
  },
});
