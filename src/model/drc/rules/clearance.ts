import {
  pointInPolygon,
  rectIntersectsPolygon,
  rectToPolygon,
  segmentsIntersect,
  type Rect,
} from '../../geometry';
import { rackFloorRect } from '../../routing/positions';
import type { Vec2 } from '../../types';
import { defineRule, type DrcFinding } from '../rule';

/** Shrink so racks that exactly touch a wall or keep-out edge do not trip the rule. */
const INSET_MM = 0.5;

const inset = (r: Rect): Rect => ({
  x: r.x + INSET_MM,
  y: r.y + INSET_MM,
  width: Math.max(0, r.width - 2 * INSET_MM),
  height: Math.max(0, r.height - 2 * INSET_MM),
});

/**
 * Whether a rack footprint leaves the room: a corner outside the outline, or
 * an edge crossing a wall (a rack bridging a notch of a concave room can have
 * every corner inside while its body passes through the wall).
 */
function leavesRoom(corners: readonly Vec2[], room: readonly Vec2[]): boolean {
  if (corners.some((p) => !pointInPolygon(p, room))) return true;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    for (let j = 0, k = room.length - 1; j < room.length; k = j++) {
      if (segmentsIntersect(a, b, room[k]!, room[j]!)) return true;
    }
  }
  return false;
}

/** Rack footprint outside the room outline, or overlapping a keep-out zone. */
export const clearance = defineRule({
  id: 'clearance',
  name: 'Clearance',
  description: 'A rack is outside the room or inside a keep-out zone.',
  defaultSeverity: 'warning',
  check(project) {
    const out: DrcFinding[] = [];
    const room = project.room.outline;
    for (const rack of project.racks) {
      const rect = inset(rackFloorRect(rack));
      if (room.length >= 3 && leavesRoom(rectToPolygon(rect), room)) {
        out.push({
          key: `room:${rack.id}`,
          message: `Rack ${rack.name} is outside the room outline`,
          targets: [{ kind: 'rack', id: rack.id }],
        });
      }
      for (const k of project.keepouts) {
        if (k.outline.length < 3 || !rectIntersectsPolygon(rect, k.outline)) continue;
        out.push({
          key: `keepout:${rack.id}:${k.id}`,
          message: `Rack ${rack.name} is in keep-out ${k.name}`,
          targets: [{ kind: 'rack', id: rack.id }],
        });
      }
    }
    return out;
  },
});
