import { rectToPolygon, segmentIntersectsPolygon } from '../../geometry';
import { rackFloorRect, rackTopMm } from '../../routing/positions';
import { defineRule, type DrcFinding } from '../rule';

/** Minimum gap between a rack top and the bottom of an overhead tray passing over it. */
export const TRAY_CLEARANCE_MM = 150;

/** An overhead tray passes over a rack with less than the required clearance above the rack top. */
export const trayClearance = defineRule({
  id: 'tray-clearance',
  name: 'Tray clearance',
  description: `An overhead tray is within ${TRAY_CLEARANCE_MM} mm of the top of a rack it passes over.`,
  defaultSeverity: 'error',
  check(project) {
    const out: DrcFinding[] = [];
    for (const tray of project.trays) {
      if (tray.layer !== 'overhead' || tray.points.length < 2) continue;
      for (const rack of project.racks) {
        const required = rackTopMm(rack) + TRAY_CLEARANCE_MM;
        if (tray.elevationMm >= required) continue;
        const poly = rectToPolygon(rackFloorRect(rack));
        let over = false;
        for (let i = 1; i < tray.points.length && !over; i++) {
          over = segmentIntersectsPolygon(tray.points[i - 1]!, tray.points[i]!, poly);
        }
        if (!over) continue;
        out.push({
          key: `${tray.id}:${rack.id}`,
          message: `Tray ${tray.name ?? tray.id} at ${tray.elevationMm} mm passes over rack ${rack.name} (needs ≥ ${Math.round(required)} mm)`,
          targets: [{ kind: 'tray', id: tray.id }, { kind: 'rack', id: rack.id }],
        });
      }
    }
    return out;
  },
});
