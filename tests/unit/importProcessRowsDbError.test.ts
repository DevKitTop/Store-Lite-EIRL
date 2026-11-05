// =====================================================
// processRows - one rejected row must not take the batch down
//
// The worker shares a single tenant transaction with its caller. PostgreSQL
// aborts a transaction on the first statement error, so a row rejected by a
// CHECK constraint (products.title >= 3, products.description <= 2000) would
// roll back every other row too and turn the whole import into a 500.
//
// This fake models that: after a statement error it answers 25P02 to
// everything until a savepoint clears it. The worker has to give each row its
// own savepoint for the valid row to survive.
// =====================================================

import { getTableName } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockNotifyLowStock, mockNotifyOutOfStock } = vi.hoisted(() => ({
  mockNotifyLowStock: vi.fn(),
  mockNotifyOutOfStock: vi.fn(),
}));

vi.mock('@/core/database/client', () => ({
  db: new Proxy(
    {},
    {
      get() {
        throw new Error('processRows touched the system client');
      },
    },
  ),
}));

vi.mock('@/lib/notifications', () => ({
  notifyLowStock: mockNotifyLowStock,
  notifyOutOfStock: mockNotifyOutOfStock,
}));

import { processRows } from '@/app/api/imports/lib';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';

const ABORTED = Object.assign(
  new Error('current transaction is aborted, commands ignored until end of transaction block'),
  { code: '25P02' },
);
const TITLE_CHECK = Object.assign(
  new Error('new row for relation "products" violates check constraint "title_length_check"'),
  { code: '23514' },
);

function importRow(id: string, rowNumber: number, rawData: Record<string, unknown>) {
  return {
    id,
    jobId: JOB_ID,
    rowNumber,
    status: 'pending' as const,
    productId: null,
    errorMessage: null,
    processedAt: null,
    rawData,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

function tenantAfterConstraintError(recorded: { notifications: string[] }) {
  let aborted = false;
  let seq = 0;

  const guard = () => {
    if (aborted) throw ABORTED;
  };

  const tenant: Record<string, unknown> = {
    query: {
      productCategories: {
        findMany: async () => {
          guard();
          return [];
        },
      },
    },
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        guard();
        if (getTableName(table as never) === 'products') {
          const first = (Array.isArray(values) ? values[0] : values) as { title: string };
          if (first.title.length < 3) {
            aborted = true;
            throw TITLE_CHECK;
          }
        }
        seq += 1;
        const id = `generated-${seq}`;
        const result = { returning: async () => [{ id, name: 'Producto' }] };
        return Object.assign(result, {
          then: (resolve: (value: undefined) => unknown) => resolve(undefined),
        });
      },
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          guard();
          recorded.notifications.push('update');
        },
      }),
    }),
    // A savepoint: the error stops being fatal once the nested scope ends.
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const saved = aborted;
      aborted = false;
      try {
        return await fn(tenant);
      } finally {
        aborted = saved;
      }
    },
  };

  return tenant;
}

describe('processRows when one row breaks a database constraint', () => {
  beforeEach(() => {
    mockNotifyLowStock.mockReset();
    mockNotifyOutOfStock.mockReset();
    mockNotifyLowStock.mockResolvedValue(undefined);
    mockNotifyOutOfStock.mockResolvedValue(undefined);
  });

  it('imports the valid row and reports only the rejected one as an error', async () => {
    const recorded = { notifications: [] as string[] };

    const results = await processRows(
      [
        importRow('r1', 1, { name: 'TV', price: 10, stock: 1 }),
        importRow('r2', 2, { name: 'Laptop', price: 10, stock: 1 }),
      ] as never,
      BUSINESS_ID,
      tenantAfterConstraintError(recorded) as never,
    );

    expect(results.find((r) => r.rowNumber === 1)).toEqual(
      expect.objectContaining({ error: expect.stringMatching(/title_length_check/) }),
    );
    expect(results.find((r) => r.rowNumber === 2)).toEqual(
      expect.objectContaining({ productId: expect.any(String) }),
    );
    expect(results.find((r) => r.rowNumber === 2)?.error).toBeUndefined();
  });

  it('still records the row statuses after a rejected row', async () => {
    const recorded = { notifications: [] as string[] };

    await expect(
      processRows(
        [
          importRow('r1', 1, { name: 'TV', price: 10, stock: 1 }),
          importRow('r2', 2, { name: 'Laptop', price: 10, stock: 1 }),
        ] as never,
        BUSINESS_ID,
        tenantAfterConstraintError(recorded) as never,
      ),
    ).resolves.toBeDefined();

    // processing + one status write per row
    expect(recorded.notifications.length).toBeGreaterThanOrEqual(3);
  });

  it('does not notify low stock for a row that was rolled back', async () => {
    const recorded = { notifications: [] as string[] };

    await processRows(
      [importRow('r1', 1, { name: 'TV', price: 10, stock: 1 })] as never,
      BUSINESS_ID,
      tenantAfterConstraintError(recorded) as never,
    );

    expect(mockNotifyLowStock).not.toHaveBeenCalled();
  });
});
