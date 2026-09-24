import { indexProject } from '../../query';
import { linkLengthM } from '../../routing/length';
import { defineRule, type DrcFinding } from '../rule';

/** Standard cable length (routed, or estimated when unrouted) exceeds the shorter reach of the two transceivers. */
export const reachExceeded = defineRule({
  id: 'reach-exceeded',
  name: 'Reach exceeded',
  description: 'The cable length exceeds the rated reach of the optics on the link.',
  defaultSeverity: 'error',
  check(project) {
    const idx = indexProject(project);
    const out: DrcFinding[] = [];
    for (const link of project.links) {
      const length = linkLengthM(project, link.id);
      if (!length) continue;
      const xcvrs = [idx.transceiverAt(link, link.a), idx.transceiverAt(link, link.b)].filter(
        (t): t is NonNullable<typeof t> => t !== undefined,
      );
      if (xcvrs.length === 0) continue;
      const limiting = xcvrs.reduce((m, t) => (t.reachM < m.reachM ? t : m));
      if (length.standardM <= limiting.reachM) continue;
      out.push({
        key: link.id,
        message: `${idx.linkLabel(link)}: ${length.standardM} m${length.est ? ' (est.)' : ''} exceeds the ${limiting.reachM} m reach of ${limiting.name}`,
        targets: [{ kind: 'link', id: link.id }],
      });
    }
    return out;
  },
});
