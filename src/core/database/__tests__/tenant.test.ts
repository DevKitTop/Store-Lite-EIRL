import { describe, expect, it, vi } from 'vitest';

// `../client` builds a real pool at import time and throws without DATABASE_URL.
// The runner is exercised through an injected database, so the module-level
// client is only needed to exist.
vi.mock('../client', () => ({
  client: { begin: vi.fn(), options: { parsers: {}, serializers: {} } },
  db: { transaction: vi.fn() },
  schema: {},
}));

const { claimsPayload, createTenantRunner } = await import('../tenant');

/**
 * Records what the runner asks of the transaction, in order.
 *
 * The runner used to wrap the raw postgres.js transaction with `drizzle(tx)`,
 * which throws at runtime because a `TransactionSql` has no `options.parsers`.
 * Every test here passed anyway, because they injected the dependencies and
 * never exercised that call. The regression test at the bottom pins the shape
 * that makes the failure impossible: the runner must take the transaction from
 * the database, not build one from a raw client.
 */
function fakeDatabase() {
  const order: string[] = [];
  const execute = vi.fn(async (query: unknown) => {
    const chunks = (query as { queryChunks?: unknown[] }).queryChunks ?? [];
    const text = chunks
      .map((chunk) => (chunk as { value?: string[] }).value?.join('') ?? '')
      .join('');
    order.push(text.includes('set local role') ? 'role' : 'claims');
    return [];
  });
  const tx = { execute, transaction: vi.fn() };
  const database = {
    transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => {
      order.push('begin');
      return fn(tx);
    }),
  };

  return { database, tx, execute, order };
}

describe('claimsPayload', () => {
  it('serialises the subject as request claims', () => {
    expect(claimsPayload({ sub: '716bc578-352b-4969-ab6c-6a1847073fa3' })).toBe(
      '{"sub":"716bc578-352b-4969-ab6c-6a1847073fa3"}',
    );
  });

  it('omits the payload when there is no subject', () => {
    expect(claimsPayload(null)).toBeNull();
    expect(claimsPayload(undefined)).toBeNull();
    expect(claimsPayload({})).toBeNull();
    expect(claimsPayload({ sub: null })).toBeNull();
  });

  it('omits the payload for a blank subject instead of writing an empty one', () => {
    // An empty subject makes auth.uid() fail with 22P02, so it must never be
    // written; denying every row is the safe outcome.
    expect(claimsPayload({ sub: '' })).toBeNull();
    expect(claimsPayload({ sub: '   ' })).toBeNull();
  });

  it('trims a padded subject', () => {
    expect(claimsPayload({ sub: '  abc  ' })).toBe('{"sub":"abc"}');
  });
});

describe('createTenantRunner', () => {
  it('assumes the runtime role before writing the claims', async () => {
    const { database, execute, order } = fakeDatabase();
    const withTenant = createTenantRunner(database as never);

    await withTenant({ sub: 'user-1' }, async () => 'done');

    expect(order).toEqual(['begin', 'role', 'claims']);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('hands the caller the same transaction it governs', async () => {
    const { database, tx } = fakeDatabase();
    const withTenant = createTenantRunner(database as never);

    const result = await withTenant({ sub: 'user-1' }, async (tenant) => {
      expect(tenant).toBe(tx);
      return 'done';
    });

    expect(result).toBe('done');
    expect(database.transaction).toHaveBeenCalledTimes(1);
  });

  it('runs without touching the settings when there is no subject', async () => {
    const { database, order } = fakeDatabase();
    const withTenant = createTenantRunner(database as never);

    await withTenant(null, async () => 'ok');

    // The role is assumed even without claims: the transaction must never run
    // with the login role's BYPASSRLS, not even for a query that filters nothing.
    expect(order).toEqual(['begin', 'role']);
  });

  it('does not swallow a failure from the caller', async () => {
    const { database } = fakeDatabase();
    const withTenant = createTenantRunner(database as never);

    await expect(
      withTenant({ sub: 'user-1' }, async () => {
        throw new Error('query failed');
      }),
    ).rejects.toThrow('query failed');
  });

  it('takes the transaction from the database instead of wrapping a raw client', async () => {
    // The regression guard. `createTenantRunner` receives a Drizzle database;
    // it must never need a raw postgres.js transaction, because the Drizzle
    // driver reads `client.options.parsers` and a `TransactionSql` has no such
    // property. An argument that only exposes `transaction` is enough.
    const { database } = fakeDatabase();
    const withTenant = createTenantRunner(database as never);

    await expect(withTenant({ sub: 'user-1' }, async () => 'ok')).resolves.toBe('ok');
    expect(Object.keys(database)).toEqual(['transaction']);
  });
});
