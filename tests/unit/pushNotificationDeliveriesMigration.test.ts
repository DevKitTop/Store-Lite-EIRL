import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Structural test for manual migration 0058 (PWA P2, T2.5).
 *
 * The migration is applied by an operator, so we assert its shape: durable
 * delivery rows, unique fan-out key, server-only RLS, bounded outcome fields,
 * and additive/idempotent statements only.
 */
describe('Push notification deliveries migration (0058)', () => {
  const migrationPath = join(process.cwd(), 'migrations', '0058_push_notification_deliveries.sql');
  let sql: string;

  beforeAll(() => {
    sql = readFileSync(migrationPath, 'utf8');
  });

  it('creates a durable delivery table with source, recipient and subscription fields', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "public"\."push_notification_deliveries"/);
    for (const column of [
      'notification_id',
      'recipient_user_id',
      'push_subscription_id',
      'status',
      'attempt_count',
      'next_attempt_at',
      'last_attempt_at',
      'lease_expires_at',
      'last_error_class',
      'created_at',
      'updated_at',
    ]) {
      expect(sql).toContain(`"${column}"`);
    }
  });

  it('enforces one delivery per notification, recipient and subscription', () => {
    expect(sql).toContain(
      'CONSTRAINT "push_notification_deliveries_unique" UNIQUE ("notification_id", "recipient_user_id", "push_subscription_id")',
    );
  });

  it('delegates notifications and subscriptions with cascade delete', () => {
    expect(sql).toMatch(
      /"notification_id" uuid NOT NULL REFERENCES "public"\."notifications"\("id"\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /"push_subscription_id" uuid NOT NULL REFERENCES "public"\."push_subscriptions"\("id"\) ON DELETE CASCADE/,
    );
  });

  it('enables RLS with no client policies and never grants anon or public access', () => {
    expect(sql).toContain(
      'ALTER TABLE "public"."push_notification_deliveries" ENABLE ROW LEVEL SECURITY',
    );
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/\bTO\s+anon\b/i);
    expect(sql).not.toMatch(/\bTO\s+public\b/i);
  });

  it('adds indexes for ready delivery polling and source lookups', () => {
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS "idx_push_deliveries_ready"/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS "idx_push_deliveries_notification"/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS "idx_push_deliveries_subscription"/);
  });

  it('is additive and idempotent (no destructive statements)', () => {
    const statements = sql.replace(/--[^\n]*/g, '');
    expect(statements).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(statements).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(statements).not.toMatch(/\bALTER\s+COLUMN\b/i);
    expect(statements).toContain('CREATE TABLE IF NOT EXISTS');
  });
});
