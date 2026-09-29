import { indexProject } from '../../query';
import { resolveRouteEnds, routeLabel } from '../../routing/owner';
import { portPlacement } from '../../routing/positions';
import { defineRule, type DrcFinding } from '../rule';

/** The top-entry accessory a route uses is on the opposite rack face from the port. */
export const wrongFace = defineRule({
  id: 'wrong-face',
  name: 'Wrong face',
  description: 'A cable drops into the rack on the face opposite its port.',
  defaultSeverity: 'warning',
  check(project) {
    const idx = indexProject(project);
    const accessories = new Map(project.accessories.map((a) => [a.id, a] as const));
    const out: DrcFinding[] = [];
    for (const route of Object.values(project.routes)) {
      const ends = resolveRouteEnds(idx, route);
      if (!ends) continue;
      for (const [endRef, path, end, furcation] of [
        [ends.a, route.aRack, 'A', ends.furcationA],
        [ends.b, route.bRack, 'B', ends.furcationB],
      ] as const) {
        // A cable jacket that fans out ends at its furcation point on the floor; it enters no rack on that side.
        if (furcation) continue;
        const entry = path.entry ? accessories.get(path.entry) : undefined;
        if (!entry?.face) continue;
        const info = portPlacement(project, endRef.componentId, endRef.portId);
        if (!info || info.face === entry.face) continue;
        out.push({
          key: `${route.linkId}:${end}`,
          message: `${routeLabel(idx, ends)}: end ${end} enters rack ${info.rack.name} through the ${entry.face} top entry but ${idx.endLabel(endRef)} is on the ${info.face} face`,
          targets: [{ kind: 'route', id: route.linkId }, { kind: 'component', id: endRef.componentId, portId: endRef.portId }],
        });
      }
    }
    return out;
  },
});
