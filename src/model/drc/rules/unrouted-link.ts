import { indexProject, uRange } from '../../query';
import { linkRoutedByCable } from '../../routing/owner';
import { defineRule, type DrcFinding } from '../rule';

/** Both ends placed but the link still has no route (an airwire remains). A link whose cable jacket is routed counts as routed. */
export const unroutedLink = defineRule({
  id: 'unrouted-link',
  name: 'Unrouted link',
  description: 'Airwires remain: a link with both ends placed has no route.',
  defaultSeverity: 'warning',
  check(project) {
    const idx = indexProject(project);
    const out: DrcFinding[] = [];
    for (const link of project.links) {
      if (project.routes[link.id] || linkRoutedByCable(project, link)) continue;
      if (!uRange(idx, link.a.componentId) || !uRange(idx, link.b.componentId)) continue;
      out.push({ key: link.id, message: `${idx.linkLabel(link)} is not routed`, targets: [{ kind: 'link', id: link.id }] });
    }
    return out;
  },
});
