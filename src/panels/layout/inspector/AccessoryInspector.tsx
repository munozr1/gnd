/**
 * Rack accessory properties (vertical / horizontal manager, fiber enclosure,
 * top entry): side, face, U slot and width, plus the manager fill.
 */
import { useMemo } from 'react';
import { layout } from '@/commands';
import { managerFill } from '@/model/routing';
import type { Face, Id, RackAccessory, Side } from '@/model/types';
import { command, store, useProject, useProjectIndex } from '@/store';
import { Button } from '@/ui/Button';
import { NumberInput } from '@/ui/Input';
import { Select } from '@/ui/Select';
import { Field, Note, Section, Stat, fmtPct, run } from '../shared';
import { describeAccessory } from './RackInspector';

const ANY = 'any';

export const setAccessoryParams = (id: Id, patch: Partial<Pick<RackAccessory, 'side' | 'face' | 'uPosition' | 'heightU' | 'widthMm'>>) =>
  command('Edit accessory', 'layout', (d) => {
    const a = d.accessories.find((x) => x.id === id);
    if (!a) throw new Error(`Accessory not found: ${id}`);
    if (patch.side !== undefined) {
      if (a.type === 'vcm' && patch.side === 'center') throw new Error('A vertical manager sits on the left or right');
      if ((a.type === 'vcm' || a.type === 'top-entry') && d.accessories.some((o) => o.id !== id && o.rackId === a.rackId && o.type === a.type && o.side === patch.side)) {
        throw new Error(`The rack already has a ${a.type === 'vcm' ? 'vertical manager' : 'top entry'} on the ${patch.side}`);
      }
      a.side = patch.side;
    }
    if ('face' in patch) {
      if (patch.face === undefined) delete a.face;
      else a.face = patch.face;
    }
    if (patch.uPosition !== undefined) {
      const rack = d.racks.find((r) => r.id === a.rackId);
      const top = patch.uPosition + (a.heightU ?? 1) - 1;
      if (!Number.isInteger(patch.uPosition) || patch.uPosition < 1 || (rack && top > rack.heightU)) throw new Error(`U${patch.uPosition} does not fit`);
      a.uPosition = patch.uPosition;
    }
    if (patch.heightU !== undefined && patch.heightU >= 1) a.heightU = Math.round(patch.heightU);
    if (patch.widthMm !== undefined && patch.widthMm > 0) a.widthMm = patch.widthMm;
  });

export function AccessoryInspector({ accessoryId }: { accessoryId: Id }) {
  const project = useProject();
  const idx = useProjectIndex();
  const a = project.accessories.find((x) => x.id === accessoryId);
  const rack = a ? idx.rack(a.rackId) : undefined;
  const fill = useMemo(() => (a && a.type === 'vcm' && (a.side === 'left' || a.side === 'right') ? managerFill(project, a.rackId, a.side) : null), [project, a]);
  if (!a) return <Note>Accessory no longer exists.</Note>;
  const sided = a.type === 'vcm' || a.type === 'top-entry';
  const slotted = a.type === 'hcm' || a.type === 'fiber-enclosure';

  return (
    <Section title="Accessory">
      <Stat label="Type" value={describeAccessory(a)} />
      <Stat
        label="Rack"
        value={
          <button type="button" className="mono hover:underline" onClick={() => store.getState().select({ kind: 'rack', id: a.rackId })}>
            {rack?.name ?? a.rackId}
          </button>
        }
      />
      {sided && (
        <Field label="Side">
          <Select
            aria-label="Side"
            value={a.side ?? 'left'}
            onValueChange={(v) => run(setAccessoryParams(accessoryId, { side: v as Side | 'center' }))}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'right', label: 'Right' },
              ...(a.type === 'top-entry' ? [{ value: 'center', label: 'Center' }] : []),
            ]}
            className="w-full"
          />
        </Field>
      )}
      <Field label="Face">
        <Select
          aria-label="Face"
          value={a.face ?? ANY}
          onValueChange={(v) => run(setAccessoryParams(accessoryId, { face: v === ANY ? undefined : (v as Face) }))}
          options={[
            { value: ANY, label: 'Any' },
            { value: 'front', label: 'Front' },
            { value: 'rear', label: 'Rear' },
          ]}
          className="w-full"
        />
      </Field>
      {slotted && (
        <Field label="U position">
          <NumberInput aria-label="U position" value={a.uPosition ?? 1} min={1} max={rack?.heightU} decimals={0} unit="U" onChange={(u) => run(setAccessoryParams(accessoryId, { uPosition: u }))} />
        </Field>
      )}
      {a.type === 'vcm' && (
        <Field label="Width">
          <NumberInput aria-label="Manager width" value={a.widthMm ?? 152} min={50} step={25} decimals={0} unit="mm" onChange={(w) => run(setAccessoryParams(accessoryId, { widthMm: w }))} />
        </Field>
      )}
      {fill && (
        <Stat
          label="Fill"
          value={
            <span className={fill.fraction > project.settings.managerFillWarn ? 'text-warning' : undefined}>
              {fmtPct(fill.fraction)} · {fill.cableCount} cable{fill.cableCount === 1 ? '' : 's'}
            </span>
          }
        />
      )}
      <div className="pt-1">
        <Button size="sm" variant="danger" onClick={() => run(layout.removeAccessory(accessoryId))}>
          Remove
        </Button>
      </div>
    </Section>
  );
}
