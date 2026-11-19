import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Structural test for manual migration 0057 (PWA P2, T2.1).
 *
 * The migration is applied by an operator (never by CI against a live DB), so
 * we assert its shape: per-user/device subscription table, unique constraint on
 * (user_id, endpoint), owner-only RLS policies, no anon/public grants, and
 * additive/idempotent statements only.
 */
describe('Push subscriptions migration (0057)', () => {
  const migrationPath = join(process.cwd(), 'migrations', '0057_push_subscriptions.sql');
  let sql: string;

  beforeAll(() => {
    sql = readFileSync(migrationPath, 'utf8');
  });

  it('creates the push_subscriptions table with per-device columns', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "public"\."push_subscriptions"/);
    for (const column of [
      'user_id',
      'endpoint',
      'p256dh',
      'auth',
      'expiration_time',
      'user_agent',
      'last_seen_at',
      'revoked_at',
      'invalidated_at',
      'failure_count',
      'last_failure_code',
    ]) {
      expect(sql).toContain(`"${column}"`);
    }
  });

  it('enforces one subscription row per user/device endpoint', () => {
    expect(sql).toContain(
      'CONSTRAINT "push_subscriptions_user_id_endpoint_unique" UNIQUE ("user_id", "endpoint")',
    );
  });

  it('delegates ownership to profiles with cascade delete', () => {
    expect(sql).toMatch(
      /"user_id" uuid NOT NULL REFERENCES "public"\."profiles"\("id"\) ON DELETE CASCADE/,
    );
  });

  it('enables RLS and creates owner-only policies for all CRUD operations', () => {
    expect(sql).toContain('ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY');
    for (const op of ['select', 'insert', 'update', 'delete']) {
      expect(sql).toContain(`CREATE POLICY "push_subscriptions_${op}_owner"`);
      expect(sql).toContain(`DROP POLICY IF EXISTS "push_subscriptions_${op}_owner"`);
    }
    // SELECT/INSERT/DELETE have one check each; UPDATE has USING + WITH CHECK.
    const policyChecks = sql.match(/"user_id" = auth\.uid\(\)/g) || [];
    expect(policyChecks.length).toBe(5);
  });

  it('never grants access to anon or public roles', () => {
    expect(sql).not.toMatch(/\bTO\s+anon\b/i);
    expect(sql).not.toMatch(/\bTO\s+public\b/i);
  });

  it('is additive and idempotent (no destructive statements)', () => {
    const statements = sql.replace(/--[^\n]*/g, '');
    expect(statements).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(statements).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(statements).toContain('CREATE TABLE IF NOT EXISTS');
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_user_id"/);
  });
});
