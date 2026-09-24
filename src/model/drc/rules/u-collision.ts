import { indexProject, uRange } from '../../query';
import { defineRule, type DrcFinding } from '../rule';

/** Overlapping U ranges in a rack, devices above the rack top, or below U1. */
export const uCollision = defineRule({
  id: 'u-collision',
  name: 'U collision / overflow',
  description: 'Devices overlap in a rack or exceed its height.',
  defaultSeverity: 'error',
  check(project) {
    const idx = indexProject(project);
    const out: DrcFinding[] = [];
    for (const rack of project.racks) {
      const placed = idx
        .componentsInRack(rack.id)
        .map((c) => ({ c, r: uRange(idx, c.id) }))
        .filter((x): x is { c: (typeof x)['c']; r: NonNullable<(typeof x)['r']> } => x.r !== null)
        .sort((a, b) => a.r.bottom - b.r.bottom);
      const label = (x: (typeof placed)[number]): string =>
        `${x.c.ref} (${x.r.bottom === x.r.top ? `U${x.r.bottom}` : `U${x.r.bottom}–U${x.r.top}`})`;
      for (const x of placed) {
        if (x.r.bottom < 1) {
          out.push({
            key: `below:${x.c.id}`,
            message: `${label(x)} is below U1 of rack ${rack.name}`,
            targets: [{ kind: 'component', id: x.c.id }, { kind: 'rack', id: rack.id }],
          });
        }
        if (x.r.top > rack.heightU) {
          out.push({
            key: `overflow:${x.c.id}`,
            message: `${label(x)} exceeds the ${rack.heightU}U height of rack ${rack.name}`,
            targets: [{ kind: 'component', id: x.c.id }, { kind: 'rack', id: rack.id }],
          });
        }
      }
      for (let i = 0; i < placed.length; i++) {
        const a = placed[i]!;
        for (let j = i + 1; j < placed.length; j++) {
          const b = placed[j]!;
          if (b.r.bottom > a.r.top) break;
          out.push({
            key: `overlap:${a.c.id}:${b.c.id}`,
            message: `${label(a)} overlaps ${label(b)} in rack ${rack.name}`,
            targets: [
              { kind: 'component', id: a.c.id },
              { kind: 'component', id: b.c.id },
              { kind: 'rack', id: rack.id },
            ],
          });
        }
      }
    }
    return out;
  },
});
