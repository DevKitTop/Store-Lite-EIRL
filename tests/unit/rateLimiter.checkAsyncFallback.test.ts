// =====================================================
// RateLimiter.checkAsync — shared-store outage (B1 regression)
// =====================================================
// The shared store MUST fail loud, not open. Before this guard, a DB error was
// swallowed inside `checkRateLimitShared` as `allowed: true`, so the payment
// route silently lost its rate limit during an outage. This test pins the
// fallback to the per-instance limiter when the shared store cannot answer.
//
// It mocks the DB client (not the shared module) so the REAL
// `checkRateLimitShared` error path is exercised.
// =====================================================

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockInsert } = vi.hoisted(() => ({ mockInsert: vi.fn() }));

vi.mock('@/core/database/client', () => ({
  db: {
    insert: mockInsert,
    delete: () => ({ where: () => Promise.resolve() }),
  },
}));

describe('RateLimiter.checkAsync — shared-store outage', () => {
  beforeEach(() => {
    mockInsert.mockReset();
  });

  test('propagates the store failure instead of failing open', async () => {
    const { checkRateLimitShared } = await import('@/core/payments/rateLimitShared');

    mockInsert.mockImplementation(() => {
      throw new Error('db down');
    });

    await expect(
      checkRateLimitShared('outage-key', { windowMs: 30_000, maxRequests: 3 }),
    ).rejects.toThrow('db down');
  });

  test('falls back to the per-instance limiter when the shared store throws', async () => {
    const { RateLimiter } = await import('@/core/payments/rateLimiter');
    const limiter = new RateLimiter(30_000, 1);

    mockInsert.mockImplementation(() => {
      throw new Error('db down');
    });

    await expect(limiter.checkAsync('outage')).resolves.toBe(true);
    await expect(limiter.checkAsync('outage')).resolves.toBe(false);
  });
});
