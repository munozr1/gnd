import type { Issue, TransceiverDef } from '@/model/types';
import { componentTarget, ercIssue, linkTarget, targetKey, type Rule } from '../rule';
import { assignedOptic, cableEndMedia, endsOf, isIntegratedCable } from '../helpers';

/**
 * Optical media disagree along a link: an MMF optic facing an SMF one, an
 * optic whose media the cable cannot carry (OM4 needs MMF, OS2 needs SMF,
 * Cat6A needs copper), or an optic assigned on a DAC / AOC link, whose
 * integrated ends leave no cage for one.
 *
 * Issue ids hash sorted target keys plus a per-kind tag, so they do not depend
 * on which way round a link was drawn.
 */
export const mediaMismatchRule: Rule = {
  id: 'media-mismatch',
  name: 'Media mismatch',
  defaultSeverity: 'error',
  check(project, idx) {
    const issues: Issue[] = [];
    for (const link of project.links) {
      const cable = idx.cableOf(link);
      const ends = endsOf(link);
      const optics: (TransceiverDef | undefined)[] = ends.map((end) => {
        const c = idx.component(end.componentId);
        return c ? assignedOptic(idx, c, end.portId) : undefined;
      });

      if (cable && isIntegratedCable(cable)) {
        ends.forEach((end, i) => {
          const optic = optics[i];
          if (!optic) return;
          const targets = [componentTarget(end.componentId, end.portId), linkTarget(link.id)];
          issues.push(
            ercIssue(
              mediaMismatchRule,
              `${idx.endLabel(end)}: ${optic.name} assigned on ${cable.name} link (integrated cable has no cage for an optic)`,
              targets,
              [...targets.map(targetKey).sort(), 'optic-on-integrated'],
            ),
          );
        });
        continue;
      }

      const [oa, ob] = optics;
      if (oa && ob && oa.media !== ob.media) {
        const targets = [
          linkTarget(link.id),
          componentTarget(link.a.componentId, link.a.portId),
          componentTarget(link.b.componentId, link.b.portId),
        ];
        issues.push(
          ercIssue(
            mediaMismatchRule,
            `${idx.endLabel(link.a)} (${oa.name}, ${oa.media}) — ${idx.endLabel(link.b)} (${ob.name}, ${ob.media}): optic media differ`,
            targets,
            [...targets.map(targetKey).sort(), 'optic-vs-optic'],
          ),
        );
      }

      if (!cable) continue;
      const need = cableEndMedia(cable);
      if (!need) continue;
      ends.forEach((end, i) => {
        const optic = optics[i];
        if (!optic || optic.media === need) return;
        const targets = [componentTarget(end.componentId, end.portId), linkTarget(link.id)];
        issues.push(
          ercIssue(
            mediaMismatchRule,
            `${idx.endLabel(end)}: ${optic.name} (${optic.media}) on ${cable.name} cable (needs ${need})`,
            targets,
            [...targets.map(targetKey).sort(), 'optic-vs-cable'],
          ),
        );
      });
    }
    return issues;
  },
};
