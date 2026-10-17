// =====================================================
// payment idempotency — releaseIdempotencyKey (W-P1)
// =====================================================
// The release mechanism lets an attempt that failed BEFORE any money moved
// retry. It must be scoped by status so it can never delete a key that was
// concurrently completed.

import { releaseIdempotencyKey } from '@/core/payments/idempotency';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockDeleteWhere, mockDelete } = vi.hoisted(() => {
  const mockDeleteWhere = vi.fn(async () => undefined);
  const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }));
  return { mockDeleteWhere, mockDelete };
});

vi.mock('@/core/database/client', () => ({
  db: {
    delete: mockDelete,
  },
}));

function compileWhere(where: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(where as never);
}

describe('releaseIdempotencyKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('is a no-op for a null key (no DELETE issued)', async () => {
    await releaseIdempotencyKey(null);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  test('deletes the reservation scoped by key AND status = processing', async () => {
    await releaseIdempotencyKey('charge-ord_abc');

    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDeleteWhere).toHaveBeenCalledTimes(1);
    const compiled = compileWhere(mockDeleteWhere.mock.calls[0][0]);
    expect(compiled.sql).toMatch(/key.* and .*status/);
    expect(compiled.params).toEqual(expect.arrayContaining(['charge-ord_abc', 'processing']));
  });
});
