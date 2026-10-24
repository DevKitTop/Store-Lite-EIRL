import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Structural test for migration 0049 (C1 hardening).
 *
 * The migration is applied by an operator (not run by CI against a live DB),
 * so we assert its shape: a SECURITY DEFINER membership helper (to avoid RLS
 * policy recursion through business_team_members), RLS enabled on the five
 * sensitive tables, the expected membership policies, messages scoped through
 * chat_sessions, and no anon/public policy ever created.
 */
describe('RLS sensitive tables migration (0049)', () => {
  const migrationPath = join(process.cwd(), 'migrations', '0049_enable_rls_sensitive_tables.sql');
  let sql: string;

  beforeAll(() => {
    sql = readFileSync(migrationPath, 'utf8');
  });

  const sensitiveTables = ['businesses', 'payments', 'payment_orders', 'chat_sessions', 'messages'];

  it('defines a SECURITY DEFINER membership helper (recursion-safe)', () => {
    expect(sql).toContain('FUNCTION public.is_business_member');
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    // Empty search_path is the strictest setting (Supabase-recommended): every
    // relation in the body is schema-qualified, so nothing resolves through the
    // writable public schema.
    expect(sql).toMatch(/SET\s+search_path\s*=\s*''/);
    // The helper resolves membership from the caller's auth.uid().
    expect(sql).toMatch(/business_team_members[\s\S]*?auth\.uid\(\)/i);
  });

  it('enables RLS on each of the five sensitive tables', () => {
    for (const table of sensitiveTables) {
      expect(sql).toContain(`ALTER TABLE "public"."${table}" ENABLE ROW LEVEL SECURITY`);
    }
  });

  it('creates a membership SELECT policy for each table', () => {
    for (const table of sensitiveTables) {
      expect(sql).toContain(`CREATE POLICY "${table}_select_member"`);
    }
  });

  it('routes every policy through the membership helper', () => {
    // 1 occurrence for the function definition + 1 per policy.
    const helperCalls = sql.match(/public\.is_business_member\(/g) || [];
    expect(helperCalls.length).toBe(sensitiveTables.length + 1);
  });

  it('scopes messages through the parent chat_sessions row (no business_id column)', () => {
    expect(sql).toMatch(
      /CREATE POLICY "messages_select_member"[\s\S]*?public\.is_business_member\([\s\S]*?SELECT\s+cs\.business_id\s+FROM\s+"public"\."chat_sessions"\s+cs\s+WHERE\s+cs\.id\s*=\s*session_id/i,
    );
  });

  it('never grants access to anon or public roles', () => {
    expect(sql).not.toMatch(/\bTO\s+anon\b/i);
    expect(sql).not.toMatch(/\bTO\s+public\b/i);
  });

  it('is idempotent: drops existing policies before creating them', () => {
    for (const table of sensitiveTables) {
      expect(sql).toContain(`DROP POLICY IF EXISTS "${table}_select_member"`);
    }
  });
});
