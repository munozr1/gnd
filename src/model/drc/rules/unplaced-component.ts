import { indexProject } from '../../query';
import { defineRule, type DrcFinding } from '../rule';

export const unplacedComponent = defineRule({
  id: 'unplaced-component',
  name: 'Unplaced component',
  description: 'A component in the schematic has no rack placement.',
  defaultSeverity: 'error',
  check(project) {
    const idx = indexProject(project);
    const out: DrcFinding[] = [];
    for (const c of project.components) {
      const p = idx.placement(c.id);
      if (p && p.rackId !== null && p.uPosition !== null) continue;
      out.push({ key: c.id, message: `${c.ref} is not placed in a rack`, targets: [{ kind: 'component', id: c.id }] });
    }
    return out;
  },
});
