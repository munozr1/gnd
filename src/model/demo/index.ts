/**
 * Demo / sample project generators: the "New from template" menu, the e2e
 * tests and the performance pass build projects from here. Pure; each call
 * returns a brand-new Project with its own id.
 */
import type { Project } from '../types';
import { buildLargeProject, type LargeOptions } from './large';
import { buildPodProject, type PodOptions } from './pod';

export { buildLargeProject, buildPodProject };
export type { LargeOptions, PodOptions };

export interface DemoTemplate {
  id: string;
  name: string;
  /** One line for the menu / picker. */
  description: string;
  build: () => Project;
}

export const demoTemplates: readonly DemoTemplate[] = [
  {
    id: 'pod',
    name: 'Demo pod',
    description: '2 spines × 8 leafs full mesh, 32 dual-homed servers in one rack row, partly routed.',
    build: () => buildPodProject(),
  },
  {
    id: 'large',
    name: 'Large site',
    description: '50 racks, 1,000 devices, 5,000 links: the performance fixture.',
    build: () => buildLargeProject(),
  },
];

export const demoTemplateById = (id: string): DemoTemplate | undefined => demoTemplates.find((t) => t.id === id);
