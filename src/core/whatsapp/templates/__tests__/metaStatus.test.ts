import { describe, expect, it } from 'vitest';
import { normalizeMetaStatus } from '../metaStatus';

describe('normalizeMetaStatus', () => {
  it('lowercases UPPERCASE YCloud/Meta statuses so DB values stay lowercase', () => {
    expect(normalizeMetaStatus('APPROVED')).toBe('approved');
    expect(normalizeMetaStatus('REJECTED')).toBe('rejected');
    expect(normalizeMetaStatus('PENDING')).toBe('pending');
  });

  it('passes already-lowercase statuses through unchanged', () => {
    expect(normalizeMetaStatus('approved')).toBe('approved');
    expect(normalizeMetaStatus('rejected')).toBe('rejected');
    expect(normalizeMetaStatus('pending')).toBe('pending');
  });

  it('falls back to "pending" for unknown statuses', () => {
    expect(normalizeMetaStatus('in_review')).toBe('pending');
  });

  it('falls back to "pending" for missing or empty status values', () => {
    expect(normalizeMetaStatus('')).toBe('pending');
    expect(normalizeMetaStatus(undefined)).toBe('pending');
    expect(normalizeMetaStatus(null)).toBe('pending');
  });
});