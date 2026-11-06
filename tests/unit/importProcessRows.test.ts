// =====================================================
// processRows - the import worker writes through the tenant runner
//
// The worker used to write products, categories, media and row statuses with
// the system client, the one client that bypasses every policy. The rows it
// worked on were already scoped by an authorized job, so it was not exploitable
// â€” but it meant the product policies could never apply to the one place that
// creates products in bulk.
//
// The guard here is blunt on purpose: `db` throws on ANY property access. If
// the worker ever reaches for the system client again, this suite fails.
// =====================================================

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
import { getTableName } from 'drizzle-orm';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';

interface RowOverrides {
  id?: string;
  rowNumber?: number;
  rawData?: Record<string, unknown>;
}

function importRow(overrides: RowOverrides = {}) {
  return {
    id: overrides.id ?? '33333333-3333-4333-8333-333333333333',
    jobId: JOB_ID,
    rowNumber: overrides.rowNumber ?? 1,
    status: 'pending' as const,
    productId: null,
    errorMessage: null,
    processedAt: null,
    rawData: overrides.rawData ?? { name: 'Producto', price: 10, stock: 3 },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

interface Recorded {
  inserts: { table: string; values: unknown }[];
  updates: { table: string; values: Record<string, unknown> }[];
}

/**
 * A stand-in for `TenantDb` that records what the worker asked for and answers
 * with plausible rows. `values()` has to be both awaitable (media inserts are
 * awaited directly) and able to expose `.returning()`.
 */
function fakeTenant(recorded: Recorded, options: { categories?: unknown[] } = {}) {
  let insertSeq = 0;

  const tenant = {
    query: {
      productCategories: {
        findMany: async () => options.categories ?? [],
      },
    },
    insert: (table: { [k: symbol]: unknown }) => ({
      values: (values: unknown) => {
        recorded.inserts.push({ table: getTableName(table as never), values });
        insertSeq += 1;
        const id = `generated-${insertSeq}`;
        const result = { returning: async () => [{ id, name: 'Producto' }] };
        return Object.assign(result, {
          then: (resolve: (value: undefined) => unknown) => resolve(undefined),
        });
      },
    }),
    update: (table: { [k: symbol]: unknown }) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          recorded.updates.push({ table: getTableName(table as never), values });
        },
      }),
    }),
    // Per-row savepoint. Runs the callback with itself so the fake stays one
    // object; the real runner nests a transaction here.
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tenant),
  };

  return tenant;
}

describe('processRows', () => {
  beforeEach(() => {
    mockNotifyLowStock.mockReset();
    mockNotifyOutOfStock.mockReset();
    mockNotifyLowStock.mockResolvedValue(undefined);
    mockNotifyOutOfStock.mockResolvedValue(undefined);
  });

  it('never touches the system client', async () => {
    const recorded: Recorded = { inserts: [], updates: [] };
    const tenant = fakeTenant(recorded);

    await expect(
      processRows([importRow()] as never, BUSINESS_ID, tenant as never),
    ).resolves.toBeDefined();
  });

  it('inserts the product for the requested business and reports its id', async () => {
    const recorded: Recorded = { inserts: [], updates: [] };
    const tenant = fakeTenant(recorded);

    const results = await processRows([importRow()] as never, BUSINESS_ID, tenant as never);

    expect(results).toEqual([
      {
        rowId: '33333333-3333-4333-8333-333333333333',
        rowNumber: 1,
        productId: expect.any(String),
      },
    ]);

    const productInsert = recorded.inserts.find((i) => i.table === 'products');
    expect(productInsert).toBeDefined();
    const values = productInsert!.values as Record<string, unknown>;
    expect(values.businessId).toBe(BUSINESS_ID);
    expect(values.title).toBe('Producto');
  });

  it('marks the rows processing first and completed after', async () => {
    const recorded: Recorded = { inserts: [], updates: [] };
    const tenant = fakeTenant(recorded);

    await processRows([importRow()] as never, BUSINESS_ID, tenant as never);

    const importRowUpdates = recorded.updates.filter((u) => u.table === 'import_rows');
    expect(importRowUpdates[0]!.values.status).toBe('processing');
    expect(importRowUpdates.at(-1)!.values.status).toBe('completed');
  });

  it('creates a category that does not exist yet, scoped to the business', async () => {
    const recorded: Recorded = { inserts: [], updates: [] };
    const tenant = fakeTenant(recorded);

    await processRows(
      [importRow({ rawData: { name: 'Prod', category: 'Nueva', price: 5, stock: 1 } })] as never,
      BUSINESS_ID,
      tenant as never,
    );

    const categoryInsert = recorded.inserts.find((i) => i.table === 'product_categories');
    expect(categoryInsert).toBeDefined();
    expect((categoryInsert!.values as Record<string, unknown>[])[0]).toEqual(
      expect.objectContaining({ businessId: BUSINESS_ID, name: 'Nueva' }),
    );
  });

  it('reports a row without a name as an error and inserts no product for it', async () => {
    const recorded: Recorded = { inserts: [], updates: [] };
    const tenant = fakeTenant(recorded);

    const results = await processRows(
      [importRow({ rawData: { name: '   ', price: 5 } })] as never,
      BUSINESS_ID,
      tenant as never,
    );

    expect(results[0]).toEqual(
      expect.objectContaining({ rowNumber: 1, error: 'El nombre del producto es requerido' }),
    );
    expect(recorded.inserts.find((i) => i.table === 'products')).toBeUndefined();
  });
});
