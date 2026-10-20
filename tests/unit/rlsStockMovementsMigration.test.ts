import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Structural test for migration 0051 — the `stock_movements` fulfillment ledger.
 *
 * The ledger is the completion marker for NEW-8 (design D1/D2): one row per
 * claimed paid sale, unique `(source_type, source_id)`. It is written ONLY by
 * the Drizzle `postgres` role (which bypasses RLS), so like migration 0050 it
 * must be service-role only: RLS enabled with ZERO policies. Every anon /
 * authenticated PostgREST access is then denied without any policy code.
 *
 * The migration is applied by an operator (not run by CI against a live DB), so
 * we assert its shape instead of executing it.
 */
describe('RLS stock_movements ledger migration (0051)', () => {
  const migrationPath = join(process.cwd(), 'migrations', '0051_stock_movements_ledger.sql');
  const ledgerPath = join(process.cwd(), 'migrations', 'ledger.json');
  let sql: string;
  let flat: string;

  beforeAll(() => {
    sql = readFileSync(migrationPath, 'utf8');
    // Collapse whitespace so assertions pin semantics, not indentation.
    flat = sql.replace(/\s+/g, ' ');
  });

  it('is registered in migrations/ledger.json', () => {
    // CI runs `pnpm check:migrations`; an unregistered manual migration is an
    // UNREGISTERED_MIGRATION failure. Freeze the new file in the ledger.
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as {
      files: { file: string; prefix: string }[];
    };
    const entry = ledger.files.find((f) => f.file === '0051_stock_movements_ledger.sql');
    expect(entry).toBeDefined();
    expect(entry?.prefix).toBe('0051');
  });

  it('creates the stock_movements table idempotently', () => {
    expect(flat).toContain('CREATE TABLE IF NOT EXISTS "public"."stock_movements"');
  });

  it('enforces one claim per source row via a unique (source_type, source_id)', () => {
    // The CAS unit is the pair: `ON CONFLICT DO NOTHING` on this constraint is
    // what makes the first claim win and every later claim observe 0 rows.
    expect(flat).toMatch(/UNIQUE \("source_type", "source_id"\)/i);
  });

  it('constrains source_type and outcome to the allowed values', () => {
    expect(flat).toMatch(/CHECK \("source_type" IN \('payments', 'payment_orders'\)\)/i);
    expect(flat).toMatch(/CHECK \("outcome" IN \('fulfilled', 'partial', 'no_product'\)\)/i);
  });

  it('scopes every ledger row to a business with a NOT NULL FK', () => {
    expect(flat).toMatch(/"business_id" uuid NOT NULL REFERENCES "public"\."businesses"\("id"\)/i);
  });

  it('defines the ledger payload columns with their defaults', () => {
    expect(flat).toMatch(/"items" jsonb NOT NULL DEFAULT '\[\]'/i);
    expect(flat).toMatch(/"fallback_qty1" boolean NOT NULL DEFAULT false/i);
    expect(flat).toMatch(/"created_at" timestamp with time zone NOT NULL DEFAULT now\(\)/i);
  });

  it('enables RLS with zero policies (0050 pattern)', () => {
    expect(flat).toContain('ALTER TABLE "public"."stock_movements" ENABLE ROW LEVEL SECURITY');
    // RLS with zero policies denies anon/authenticated entirely.
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).not.toMatch(/\bTO\s+anon\b/i);
    expect(sql).not.toMatch(/\bTO\s+public\b/i);
  });

  it('uses the manual-migration statement-breakpoint convention', () => {
    expect(sql).toContain('--> statement-breakpoint');
  });
});
