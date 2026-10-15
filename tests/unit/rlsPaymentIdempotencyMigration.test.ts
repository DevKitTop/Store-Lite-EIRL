import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Structural test for migration 0050 (C1 hardening residual).
 *
 * Migration 0049 enabled RLS on the five sensitive tables reachable through the
 * public anon key, but `payment_idempotency_keys` was left open. It has no
 * `business_id`/owner column — it is keyed by a client-supplied text key — so it
 * must be service-role only: RLS enabled with NO policy, which denies every
 * anon/authenticated PostgREST read or write while the Drizzle `postgres` role
 * (which bypasses RLS) keeps the app working.
 *
 * The migration is applied by an operator (not run by CI against a live DB), so
 * we assert its shape instead of executing it.
 */
describe('RLS payment_idempotency_keys migration (0050)', () => {
  const migrationPath = join(
    process.cwd(),
    'migrations',
    '0050_enable_rls_payment_idempotency_keys.sql',
  );
  let sql: string;

  beforeAll(() => {
    sql = readFileSync(migrationPath, 'utf8');
  });

  it('enables RLS on payment_idempotency_keys', () => {
    expect(sql).toContain(
      'ALTER TABLE "public"."payment_idempotency_keys" ENABLE ROW LEVEL SECURITY',
    );
  });

  it('is service-role only: no policy is created and no broad role is granted', () => {
    // RLS with zero policies denies anon/authenticated entirely.
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/\bTO\s+anon\b/i);
    expect(sql).not.toMatch(/\bTO\s+public\b/i);
  });

  it('uses the manual-migration statement-breakpoint convention', () => {
    expect(sql).toContain('--> statement-breakpoint');
  });
});
