// =====================================================
// Tenant runner wiring - the two invariants that were only ever in comments
//
// 1. The runner must take its transaction from the Drizzle database. Wrapping
//    a raw postgres.js transaction with `drizzle(tx)` throws at runtime because
//    a `TransactionSql` has no `options.parsers` - and every unit test passed
//    anyway, because they injected the transaction.
//
// 2. The import worker relies on `tx.transaction(...)` being a SAVEPOINT, so a
//    rejected row cannot abort the batch. Drizzle routes a transaction's
//    `transaction()` to `client.savepoint`, not to `client.begin`. Faking the
//    runner cannot prove that; the assertion has to reach the real session.
// =====================================================

import { PgDialect } from 'drizzle-orm/pg-core';
import { PostgresJsSession, PostgresJsTransaction } from 'drizzle-orm/postgres-js/session';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('tenant runner wiring', () => {
  it('takes the transaction from the database instead of wrapping a raw client', () => {
    const source = readFileSync(join(process.cwd(), 'src/core/database/tenant.ts'), 'utf8');
    // Comments explain the old failure; only the code can repeat it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // `drizzle(tx)` on a transaction is the exact call that broke every
    // governed path; it must never come back.
    expect(code).not.toMatch(/drizzle\(/);
    expect(code).not.toMatch(/asSql/);
    expect(code).toMatch(/database\.transaction\(/);
  });
});

describe('PostgresJs transaction nesting', () => {
  it('routes tx.transaction to savepoint, so a row can be isolated', async () => {
    const calls: string[] = [];

    const savepointClient = {
      unsafe: () => {
        calls.push('unsafe-savepoint');
      },
      savepoint: (fn: (client: unknown) => Promise<unknown>) => {
        calls.push('savepoint');
        return fn(savepointClient);
      },
    };

    const txClient = {
      unsafe: () => {
        calls.push('unsafe-tx');
      },
      savepoint: (fn: (client: unknown) => Promise<unknown>) => {
        calls.push('savepoint-on-tx');
        return fn(savepointClient);
      },
    };

    const root = {
      unsafe: () => {
        calls.push('unsafe-root');
      },
      begin: (fn: (client: unknown) => Promise<unknown>) => {
        calls.push('begin');
        return fn(txClient);
      },
    };

    const session = new PostgresJsSession(root as never, new PgDialect(), {});

    let nested: unknown;
    await session.transaction(async (tx) => {
      nested = tx;
      await tx.transaction(async () => {
        calls.push('nested-body');
      });
    });

    expect(nested).toBeInstanceOf(PostgresJsTransaction);
    expect(calls).toEqual(['begin', 'savepoint-on-tx', 'nested-body']);
    expect(calls).not.toContain('begin-on-tx');
  });
});
