import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The dedup store is DB-backed in production. These tests exercise the two
 * contracts that matter and that a future refactor could silently break:
 *
 * 1. In production the claim NEVER falls back to per-instance memory. A DB
 *    failure must surface (so the caller returns a retryable error and the
 *    provider redelivers), instead of processing the event on one instance
 *    while another instance processes the same delivery.
 * 2. A conflicting insert (duplicate event) yields `false`; a genuinely new
 *    event yields `true`.
 */

const insertReturning = vi.fn();
const insertValues = vi.fn();
const insertOnConflict = vi.fn();
const findFirst = vi.fn();
const deleteWhere = vi.fn();

vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      webhookEvents: {
        findFirst: (...args: unknown[]) => findFirst(...args),
      },
    },
    insert: () => {
      const chain = {
        values: (...args: unknown[]) => {
          insertValues(...args);
          return chain;
        },
        onConflictDoNothing: () => {
          insertOnConflict();
          return chain;
        },
        returning: () => insertReturning(),
      };
      return chain;
    },
    delete: () => ({
      where: (...args: unknown[]) => deleteWhere(...args),
    }),
  },
}));

const { claimWebhookEvent } = await import('@/core/payments/webhookDedup');

beforeEach(() => {
  vi.stubEnv('VITEST', 'false');
  vi.stubEnv('NODE_ENV', 'production');
  insertReturning.mockReset();
  insertValues.mockReset();
  insertOnConflict.mockReset();
  findFirst.mockReset();
  deleteWhere.mockReset();
});

describe('claimWebhookEvent (production, DB-backed)', () => {
  it('does NOT fall back to memory when the DB claim fails', async () => {
    findFirst.mockResolvedValue(undefined);
    insertReturning.mockRejectedValue(new Error('connection refused'));

    // The old behaviour swallowed this and returned true (processed anyway).
    await expect(claimWebhookEvent('evt_1', 'charge.paid')).rejects.toThrow('connection refused');
  });

  it('returns true when the insert actually created the row', async () => {
    findFirst.mockResolvedValue(undefined);
    insertReturning.mockResolvedValue([{ eventId: 'evt_2' }]);

    await expect(claimWebhookEvent('evt_2', 'charge.paid')).resolves.toBe(true);
  });

  it('returns false when an existing unexpired row is found', async () => {
    findFirst.mockResolvedValue({
      eventId: 'evt_3',
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(claimWebhookEvent('evt_3', 'charge.paid')).resolves.toBe(false);
  });

  it('returns false when the insert loses the race (conflict, zero rows)', async () => {
    findFirst.mockResolvedValue(undefined);
    insertReturning.mockResolvedValue([]);

    await expect(claimWebhookEvent('evt_4', 'charge.paid')).resolves.toBe(false);
  });
});
