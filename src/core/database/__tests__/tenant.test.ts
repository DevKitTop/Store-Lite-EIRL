import type { TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

// `../client` builds a real pool at import time and throws without DATABASE_URL.
// The runner is exercised through injected dependencies, so the module-level
// client is only needed to exist.
vi.mock('../client', () => ({
  client: { begin: vi.fn() },
  schema: {},
}));

const { claimsPayload, createTenantRunner } = await import('../tenant');

const fakeTx = (unsafe: ReturnType<typeof vi.fn>) => ({ unsafe }) as unknown as TransactionSql;

const tenantDb = { tag: 'tenant-db' };

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
  it('sets the claims transaction-locally before running the caller queries', async () => {
    const unsafe = vi.fn().mockResolvedValue([]);
    const order: string[] = [];
    const begin = vi.fn(async (fn: (tx: TransactionSql) => Promise<unknown>) => {
      order.push('begin');
      return fn(fakeTx(unsafe));
    });

    const withTenant = createTenantRunner({
      begin,
      bind: () => tenantDb as never,
    });

    const result = await withTenant({ sub: 'user-1' }, async (db) => {
      order.push('query');
      expect(db).toBe(tenantDb);
      return 'done';
    });

    expect(result).toBe('done');
    expect(begin).toHaveBeenCalledTimes(1);
    expect(unsafe.mock.calls[0][0]).toBe('set local role app_runtime');
    expect(unsafe).toHaveBeenCalledWith(`select set_config('request.jwt.claims', $1, true)`, [
      '{"sub":"user-1"}',
    ]);
    expect(order).toEqual(['begin', 'query']);
  });

  it('runs without touching the settings when there is no subject', async () => {
    const unsafe = vi.fn().mockResolvedValue([]);
    const withTenant = createTenantRunner({
      begin: async (fn) => fn(fakeTx(unsafe)),
      bind: () => tenantDb as never,
    });

    await withTenant(null, async () => 'ok');

    // The role is assumed even without claims: the transaction must never run
    // with the login role's BYPASSRLS, not even for a query that filters nothing.
    expect(unsafe).toHaveBeenCalledTimes(1);
    expect(unsafe).toHaveBeenCalledWith('set local role app_runtime');
  });

  it('does not swallow a failure from the caller', async () => {
    const withTenant = createTenantRunner({
      begin: async (fn) => fn(fakeTx(vi.fn().mockResolvedValue([]))),
      bind: () => tenantDb as never,
    });

    await expect(
      withTenant({ sub: 'user-1' }, async () => {
        throw new Error('query failed');
      }),
    ).rejects.toThrow('query failed');
  });
});
