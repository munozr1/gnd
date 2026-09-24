/**
 * Keep-out zone properties: name, kind and the outline vertices.
 */
import { layout } from '@/commands';
import type { Id, Keepout } from '@/model/types';
import { useProject } from '@/store';
import { Button } from '@/ui/Button';
import { Select } from '@/ui/Select';
import { Field, Note, Section, TextField, VertexList, run } from '../shared';

const KINDS: { value: Keepout['kind']; label: string }[] = [
  { value: 'aisle', label: 'Hot / cold aisle' },
  { value: 'wall', label: 'Wall clearance' },
  { value: 'custom', label: 'Custom' },
];

export function KeepoutInspector({ keepoutId }: { keepoutId: Id }) {
  const project = useProject();
  const k = project.keepouts.find((x) => x.id === keepoutId);
  if (!k) return <Note>Keep-out no longer exists.</Note>;
  return (
    <>
      <Section title="Keep-out">
        <Field label="Name">
          <TextField aria-label="Keep-out name" value={k.name} onCommit={(v) => run(layout.setKeepoutParams(keepoutId, { name: v }))} />
        </Field>
        <Field label="Kind">
          <Select aria-label="Keep-out kind" value={k.kind} onValueChange={(v) => run(layout.setKeepoutParams(keepoutId, { kind: v as Keepout['kind'] }))} options={KINDS} className="w-full" />
        </Field>
        <Note>Racks overlapping a keep-out are flagged by the DRC clearance rule.</Note>
        <div className="pt-1">
          <Button size="sm" variant="danger" onClick={() => run(layout.deleteKeepout(keepoutId))}>
            Delete keep-out
          </Button>
        </div>
      </Section>
      <Section title={`Outline (${k.outline.length} vertices)`}>
        <VertexList points={k.outline} onChange={(pts) => run(layout.setKeepoutOutline(keepoutId, pts))} />
      </Section>
    </>
  );
}
