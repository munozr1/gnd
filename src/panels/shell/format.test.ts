import { describe, expect, it } from 'vitest';
import { errorMessage, formatRelativeTime } from './format';

const now = Date.parse('2026-09-23T12:00:00.000Z');

describe('formatRelativeTime', () => {
  it('buckets recent times', () => {
    expect(formatRelativeTime('2026-09-23T11:59:50.000Z', now)).toBe('just now');
    expect(formatRelativeTime('2026-09-23T11:45:00.000Z', now)).toBe('15 min ago');
    expect(formatRelativeTime('2026-09-23T09:00:00.000Z', now)).toBe('3 h ago');
    expect(formatRelativeTime('2026-09-22T09:00:00.000Z', now)).toBe('yesterday');
    expect(formatRelativeTime('2026-09-20T09:00:00.000Z', now)).toBe('3 days ago');
  });
  it('falls back to a date for old or bad input', () => {
    expect(formatRelativeTime('2025-06-15T12:00:00.000Z', now)).toMatch(/2025/);
    expect(formatRelativeTime('nope', now)).toBe('nope');
  });
});

describe('errorMessage', () => {
  it('unwraps errors and stringifies the rest', () => {
    expect(errorMessage(new Error('x'))).toBe('x');
    expect(errorMessage(42)).toBe('42');
  });
});
