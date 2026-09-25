import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { builtinCatalog } from '@/catalog';
import { autoFillCableSide, plugCableLeg } from '@/model/cables';
import { createCable } from '@/model/factories';
import { newRouteFromPoints } from '@/model/routing';
import { addDevice, fresh, routeTwoRacks, twoRackFixture } from '@/model/routing/test-fixtures';
import { countUnrouted } from './StatusBar';

const TRUNK = builtinCatalog.cables.find((c) => c.id === 'cbl.om4-8f-mpo8-4lc')!;

describe('countUnrouted', () => {
  it('counts plain links by their own route', () => {
    const f = twoRackFixture();
    expect(countUnrouted(fresh(f.project))).toEqual({ unrouted: 1, total: 1 });
    routeTwoRacks(f);
    expect(countUnrouted(fresh(f.project))).toEqual({ unrouted: 0, total: 1 });
  });

  it('treats the links of a cable as routed once the cable jacket has a route', () => {
    const f = twoRackFixture();
    const panel = addDevice(f.project, 'sym.fiber-patch-panel-24lc', 'PP1', { rackId: f.r2.id, u: 10 });
    const cable = createCable(TRUNK, 'CBL1');
    f.project.cables.push(cable);
    f.sw1.optics['eth1/50'] = 'xcvr.100g-sr4';
    const plugged = produce(fresh(f.project), (d) => {
      plugCableLeg(d, cable.id, 'A', 0, { componentId: f.sw1.id, portId: 'eth1/50' });
      autoFillCableSide(d, cable.id, 'B', { componentId: panel.id, portId: 'f1' });
    });
    // The fixture link plus four channel links owned by the trunk.
    expect(countUnrouted(plugged)).toEqual({ unrouted: 5, total: 5 });
    const routed = produce(plugged, (d) => {
      d.routes[cable.id] = newRouteFromPoints(d, cable.id, [{ layer: 'overhead', trayId: d.trays[0]!.id, points: [{ x: 1150, y: 500 }, { x: 4150, y: 500 }] }])!;
    });
    expect(countUnrouted(routed)).toEqual({ unrouted: 1, total: 5 });
  });
});
