import { describe, expect, it } from 'vitest';
import { buildLargeProject, buildPodProject, demoTemplateById, demoTemplates } from './index';

describe('demoTemplates', () => {
  it('lists the pod and the large site with working builders', () => {
    expect(demoTemplates.map((t) => t.id)).toEqual(['pod', 'large']);
    expect(demoTemplateById('pod')?.build).toBeTypeOf('function');
    expect(demoTemplateById('nope')).toBeUndefined();
    const pod = demoTemplateById('pod')!.build();
    expect(pod.name).toBe('Demo pod');
    expect(pod.links).toHaveLength(buildPodProject().links.length);
    expect(typeof buildLargeProject).toBe('function');
  });
});
