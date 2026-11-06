/**
 * Request-scoped tenant context for queries that act on behalf of one user.
 *
 * Two things happen here, and both are transaction-local:
 *
 * 1. the transaction is downgraded to `app_runtime`, the role without
 *    BYPASSRLS. Without it, policies are bypassed and nothing below matters;
 * 2. `request.jwt.claims` is set, because the policies are written against
 *    `auth.uid()` and the application does not go through PostgREST, which is
 *    what normally populates it.
 *
 * Why a transaction and not a session setting: the pool hands connections
 * between requests. Everything set here dies with the transaction instead of
 * leaking into the next request served by the same backend — the role included.
 *
 * The transaction is opened by Drizzle itself (`db.transaction`). That detail
 * is not style: the previous version wrapped the raw postgres.js transaction
 * with `drizzle(tx)`, and Drizzle reads `client.options.parsers` when it
 * builds a database, which a `TransactionSql` does not have. It compiled and
 * every unit test passed because they mocked the transaction, but at runtime
 * it threw before the first query reached the database.
 *
 * Nested calls (`tx.transaction` inside the callback) become SAVEPOINTs, so a
 * caller can isolate one row of a batch without leaving the governed context.
 *
 * The consequence worth knowing: a query inside this runner can only reach
 * tables granted to `app_runtime`. Tables the application still reads as the
 * owning role (public projections, system writes) must stay on the system
 * client; mixing them here fails closed with 42501.
 */

import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { schema } from './client';
import { db } from './client';

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

/**
 * Builds a tenant runner over a database whose `transaction` opens the scope.
 *
 * Taking the database as an argument is what makes the ordering testable: the
 * suite injects a fake whose `transaction` records the statements, and asserts
 * that the role is assumed before the claims are written.
 */
export function createTenantRunner(database: TenantDb) {
  return function withTenant<R>(
    claims: TenantClaims | null | undefined,
    fn: (tenant: TenantDb) => Promise<R>,
  ): Promise<R> {
    return database.transaction(async (tx) => {
      // Role first: a transaction that is not the runtime role has no reason
      // to receive the claims.
      await tx.execute(sql`set local role app_runtime`);

      const payload = claimsPayload(claims);
      if (payload) {
        await tx.execute(sql`select set_config('request.jwt.claims', ${payload}, true)`);
      }

      // A Drizzle transaction exposes the same query surface the runner
      // promises; the cast keeps the narrower public type instead of widening
      // it to the transaction's full generics.
      return fn(tx as unknown as TenantDb);
    }) as Promise<R>;
  };
}

/** Runs `fn` with the request claims applied to a dedicated transaction. */
export const withTenantContext = createTenantRunner(db);
