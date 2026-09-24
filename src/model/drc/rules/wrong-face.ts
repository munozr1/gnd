import { indexProject } from '../../query';
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
      const link = idx.link(route.linkId);
      if (!link) continue;
      for (const [endRef, path, end] of [
        [link.a, route.aRack, 'A'],
        [link.b, route.bRack, 'B'],
      ] as const) {
        const entry = path.entry ? accessories.get(path.entry) : undefined;
        if (!entry?.face) continue;
        const info = portPlacement(project, endRef.componentId, endRef.portId);
        if (!info || info.face === entry.face) continue;
        out.push({
          key: `${route.linkId}:${end}`,
          message: `${idx.linkLabel(link)}: end ${end} enters rack ${info.rack.name} through the ${entry.face} top entry but ${idx.endLabel(endRef)} is on the ${info.face} face`,
          targets: [{ kind: 'route', id: route.linkId }, { kind: 'component', id: endRef.componentId, portId: endRef.portId }],
        });
      }
    }
    return out;
  },
});
