/** Drawer filter (domain + severities), shared so the status bar can pre-select a domain. */
import { useSyncExternalStore } from 'react';

export type IssueDomainFilter = 'all' | 'erc' | 'drc';
export type FilterableSeverity = 'error' | 'warning' | 'info';

export interface IssuesFilter {
  domain: IssueDomainFilter;
  severities: Record<FilterableSeverity, boolean>;
}

const DEFAULT: IssuesFilter = { domain: 'all', severities: { error: true, warning: true, info: true } };

let filter: IssuesFilter = DEFAULT;
const listeners = new Set<() => void>();

export const getIssuesFilter = (): IssuesFilter => filter;

export function setIssuesFilter(patch: Partial<IssuesFilter>): void {
  filter = { ...filter, ...patch, severities: { ...filter.severities, ...(patch.severities ?? {}) } };
  listeners.forEach((l) => l());
}

export function toggleIssueSeverity(severity: FilterableSeverity): void {
  setIssuesFilter({ severities: { ...filter.severities, [severity]: !filter.severities[severity] } });
}

export function resetIssuesFilter(): void {
  filter = DEFAULT;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useIssuesFilter(): IssuesFilter {
  return useSyncExternalStore(subscribe, getIssuesFilter, getIssuesFilter);
}
