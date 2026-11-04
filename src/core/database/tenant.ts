/**
 * Request-scoped tenant context for queries that act on behalf of one user.
 *
 * The database policies are written against `auth.uid()`, which reads
 * `request.jwt.claims`. The application does not go through PostgREST, so
 * nothing sets those claims: this helper does, inside a transaction, and hands
 * the caller a Drizzle instance bound to that same transaction.
 *
 * Why a transaction and not a session setting: the pool hands connections
 * between requests. `set_config(..., true)` is transaction-local, so the claims
 * die with the transaction instead of leaking into the next request served by
 * the same backend.
 *
 * Until `DATABASE_URL` points at a role without BYPASSRLS, the claims are
 * recorded but not enforced. The point of building this first is that the
 * switch becomes a connection change rather than a code change.
 */

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { Sql, TransactionSql } from 'postgres';
import { client, schema } from './client';

export type TenantDb = PostgresJsDatabase<typeof schema>;

/** The claims a request is allowed to carry. Only the subject is used today. */
export interface TenantClaims {
  sub?: string | null;
}

/**
 * Builds the `request.jwt.claims` payload for a set of claims.
 *
 * Returns null when there is no usable subject, and the caller must then skip
 * the setting entirely. Writing `{"sub": ""}` is not harmless: `auth.uid()`
 * casts the empty string to uuid after `nullif`, so an empty subject raises
 * `22P02 invalid input syntax for type uuid` instead of denying the row.
 */
export function claimsPayload(claims?: TenantClaims | null): string | null {
  const sub = typeof claims?.sub === 'string' ? claims.sub.trim() : '';
  if (!sub) return null;
  return JSON.stringify({ sub });
}

interface RunnerDeps<TTx extends TransactionSql> {
  begin: (fn: (tx: TTx) => Promise<unknown>) => Promise<unknown>;
  bind: (tx: TTx) => TenantDb;
}

/** Applies the claims as a transaction-local setting, before any query runs. */
async function applyClaims(tx: TransactionSql, payload: string): Promise<void> {
  await tx.unsafe(`select set_config('request.jwt.claims', $1, true)`, [payload]);
}

/**
 * Builds a tenant runner over an injected transaction source, so the ordering
 * and the claims handling can be tested without a database.
 *
 * One cast: `postgres.js` types a transaction's return as `UnwrapPromiseArray`,
 * which is the same value for the scalar returns this runner allows.
 */
export function createTenantRunner<TTx extends TransactionSql>(deps: RunnerDeps<TTx>) {
  return function withTenant<R>(
    claims: TenantClaims | null | undefined,
    fn: (db: TenantDb) => Promise<R>,
  ): Promise<R> {
    const run = deps.begin(async (tx) => {
      const payload = claimsPayload(claims);
      if (payload) await applyClaims(tx, payload);
      return fn(deps.bind(tx));
    });
    return run as Promise<R>;
  };
}

/**
 * Drizzle is typed against `Sql`, while a transaction carries the same
 * query surface without the pool methods it must not expose. The cast keeps
 * that difference explicit instead of widening the type everywhere.
 */
function asSql(tx: TransactionSql): Sql {
  return tx as unknown as Sql;
}

/** Runs `fn` with the request claims applied to a dedicated transaction. */
export const withTenantContext = createTenantRunner<TransactionSql>({
  begin: (fn) => client.begin((tx) => fn(tx)),
  bind: (tx) => drizzle(asSql(tx), { schema }),
});
