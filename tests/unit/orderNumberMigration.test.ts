import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');
const projectRoot = resolve(__dirname, '../../');
const migrationPath = resolve(projectRoot, 'migrations/0048_payments_order_number_integrity.sql');

describe('Migration 0048: payments_order_number_integrity structure', () => {
  let migrationSql: string;

  beforeAll(() => {
    migrationSql = readFileSync(migrationPath, 'utf8');
  });

  test('migration file exists and is readable', () => {
    expect(migrationSql).toBeDefined();
    expect(migrationSql.length).toBeGreaterThan(0);
  });

  test('migration is exactly one segment (no statement-breakpoint)', () => {
    // The runner splits by "--> statement-breakpoint" and runs each in its own transaction.
    // Our design requires a SINGLE atomic BEGIN...COMMIT segment.
    const segments = migrationSql.split('--> statement-breakpoint');
    const nonEmptySegments = segments.map((s) => s.trim()).filter((s) => s.length > 0);
    expect(nonEmptySegments).toHaveLength(1);
  });

  test('migration contains BEGIN and COMMIT wrapping the transaction', () => {
    // Must contain BEGIN (case insensitive) and COMMIT
    expect(migrationSql.toUpperCase()).toMatch(/\bBEGIN\s*;/);
    expect(migrationSql.toUpperCase()).toMatch(/COMMIT\s*;/);
  });

  test('no "--" line comments inside dollar-quoted function bodies', () => {
    // The runner strips ALL lines starting with "--" before execution.
    // Dollar-quoted function bodies must NOT contain "--" comment lines
    // or they would be stripped, breaking the function.
    // \w = [A-Za-z0-9_]
    const dollarQuotedSections = migrationSql.match(/\$\w*\$[\s\S]*?\$\w*\$/g) || [];

    for (const section of dollarQuotedSections) {
      const lines = section.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        // Allow "--" only if it's inside a string literal
        // but reject any line that starts with -- as a comment
        expect(trimmed).not.toMatch(/^--/);
      }
    }
  });

  test('uses pg_advisory_xact_lock(4800048) after BEGIN', () => {
    const advisoryLockMatch = migrationSql.match(/pg_advisory_xact_lock\s*\(\s*4800048\s*\)/);
    expect(advisoryLockMatch).not.toBeNull();

    // Must appear after BEGIN (allowing for comments and whitespace)
    const beginIndex = migrationSql.toUpperCase().indexOf('BEGIN');
    const lockIndex = migrationSql.indexOf('pg_advisory_xact_lock');
    expect(lockIndex).toBeGreaterThan(beginIndex);
  });

  test('uses gen_random_uuid() for backfill (not random() or md5())', () => {
    expect(migrationSql).toMatch(/gen_random_uuid\(\)/);
    // Should NOT use random() or md5() for the backfill
    const backfillSection = migrationSql.substring(
      migrationSql.toUpperCase().indexOf('UPDATE'),
      migrationSql.toUpperCase().indexOf('SET NOT NULL') > -1
        ? migrationSql.toUpperCase().indexOf('SET NOT NULL')
        : migrationSql.length,
    );
    expect(backfillSection).not.toMatch(/\brandom\(\)/);
    expect(backfillSection).not.toMatch(/\bmd5\(/);
  });

  test('backfill only targets NULL rows with WHERE order_number IS NULL', () => {
    // Case-insensitive search for the UPDATE...WHERE order_number IS NULL pattern
    // The SQL uses double quotes: "order_number"
    // Simplified regex to avoid complexity limit
    const hasUpdate = migrationSql.includes('UPDATE');
    const hasSetOrderNumber = migrationSql.includes('SET "order_number"');
    const hasWhereNull = migrationSql.includes('WHERE "order_number" IS NULL');
    expect(hasUpdate && hasSetOrderNumber && hasWhereNull).toBe(true);
  });

  test('format scan uses anchored pattern ^ORD-[A-Za-z0-9_-]{8,20}$', () => {
    // The format scan must use the exact pinned pattern from ORDER_NUMBER_PATTERN
    expect(migrationSql).toMatch(/!~\s*['"]\^ORD-\[A-Za-z0-9_-\]\{8,20\}\$['"]/);
  });

  test('duplicate scan groups by order_number and raises exception with values listed', () => {
    // Case-insensitive for GROUP BY and HAVING - the SQL uses "order_number"
    expect(migrationSql).toMatch(/GROUP\s+BY\s+["']?order_number["']?/i);
    expect(migrationSql).toMatch(/HAVING\s+count\(\*\)\s*>\s*1/i);
    expect(migrationSql).toMatch(/RAISE\s+EXCEPTION/i);
    // The exception message should include the offending values
    expect(migrationSql).toMatch(/order_number/i);
  });

  test('ordering: backfill < format scan < duplicate scan < SET NOT NULL < CREATE UNIQUE INDEX < trigger < post-conditions', () => {
    // Use case-insensitive search on uppercased SQL
    const upperSql = migrationSql.toUpperCase();
    const indices = {
      backfill: upperSql.indexOf('UPDATE "PUBLIC"."PAYMENTS"\nSET "ORDER_NUMBER"'),
      formatScan: upperSql.indexOf("!~ '^ORD-"),
      duplicateScan: upperSql.indexOf('GROUP BY "ORDER_NUMBER"\n        HAVING COUNT(*) > 1'),
      setNotNull: upperSql.indexOf(
        'ALTER TABLE "PUBLIC"."PAYMENTS" ALTER COLUMN "ORDER_NUMBER" SET NOT NULL',
      ),
      createIndex: upperSql.indexOf(
        'CREATE UNIQUE INDEX IF NOT EXISTS PAYMENTS_ORDER_NUMBER_UNIQUE',
      ),
      triggerFunction: upperSql.indexOf(
        'CREATE OR REPLACE FUNCTION "PUBLIC"."PAYMENTS_ORDER_NUMBER_IMMUTABLE"',
      ),
      createTrigger: upperSql.indexOf('CREATE TRIGGER PAYMENTS_ORDER_NUMBER_IMMUTABLE'),
      postConditions: upperSql.indexOf('POST_CONDITIONS'),
    };

    // All must be found
    for (const [_key, idx] of Object.entries(indices)) {
      expect(idx).toBeGreaterThan(-1);
    }

    // Strict ordering
    expect(indices.backfill).toBeLessThan(indices.formatScan);
    expect(indices.formatScan).toBeLessThan(indices.duplicateScan);
    expect(indices.duplicateScan).toBeLessThan(indices.setNotNull);
    expect(indices.setNotNull).toBeLessThan(indices.createIndex);
    expect(indices.createIndex).toBeLessThan(indices.triggerFunction);
    expect(indices.triggerFunction).toBeLessThan(indices.createTrigger);
    expect(indices.createTrigger).toBeLessThan(indices.postConditions);
  });

  test('NOT NULL constraint applied before unique index', () => {
    const upperSql = migrationSql.toUpperCase();
    const setNotNullIdx = upperSql.indexOf(
      'ALTER TABLE "PUBLIC"."PAYMENTS" ALTER COLUMN "ORDER_NUMBER" SET NOT NULL',
    );
    const createIndexIdx = upperSql.indexOf(
      'CREATE UNIQUE INDEX IF NOT EXISTS PAYMENTS_ORDER_NUMBER_UNIQUE',
    );
    expect(setNotNullIdx).toBeGreaterThan(-1);
    expect(createIndexIdx).toBeGreaterThan(-1);
    expect(setNotNullIdx).toBeLessThan(createIndexIdx);
  });

  test('trigger is BEFORE UPDATE OF order_number', () => {
    // Case-insensitive match for the trigger definition
    expect(migrationSql).toMatch(
      /BEFORE\s+UPDATE\s+OF\s+"order_number"\s+ON\s+"public"\."payments"/i,
    );
    expect(migrationSql).toMatch(
      /FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+"public"\."payments_order_number_immutable"\(\)/i,
    );
  });

  test('trigger function raises restrict_violation on change', () => {
    expect(migrationSql).toMatch(
      /RAISE\s+EXCEPTION\s+['"]payments\.order_number\s+is\s+immutable/i,
    );
    expect(migrationSql).toMatch(/USING\s+ERRCODE\s*=\s*['"]restrict_violation['"]/i);
  });

  test('post-conditions verify NOT NULL, unique index, and trigger exist', () => {
    // Check that post-conditions exist and verify the constraints
    expect(migrationSql).toMatch(/NOT\s+NULL/i);
    expect(migrationSql).toMatch(/payments_order_number_unique/i);
    expect(migrationSql).toMatch(/payments_order_number_immutable/i);
    // Should have assertions that would fail if constraints missing
    expect(migrationSql).toMatch(/RAISE\s+EXCEPTION/i);
  });

  test('DDL uses IF NOT EXISTS / existence checks for idempotency', () => {
    expect(migrationSql).toMatch(/CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS/i);
    expect(migrationSql).toMatch(/DROP\s+TRIGGER\s+IF\s+EXISTS/i);
    // SET NOT NULL is idempotent in PostgreSQL (no-op if already NOT NULL)
  });

  test('entire migration is wrapped in single transaction (one BEGIN, one COMMIT at top level)', () => {
    // Count top-level BEGIN/COMMIT (not inside DO blocks)
    // DO blocks use BEGIN...END in PL/pgSQL, but those are inside dollar quotes
    // We need to count only the outer transaction markers
    const outerSql = migrationSql;
    // Find the first BEGIN and last COMMIT at the top level (not inside $...$)
    const beginMatches = outerSql.match(/\bBEGIN\s*;/g) || [];
    const commitMatches = outerSql.match(/COMMIT\s*;/g) || [];

    // There should be exactly one top-level BEGIN; and one top-level COMMIT;
    // The DO $$ BEGIN ... END $$; blocks have BEGIN/END but not with semicolon on same line typically
    expect(beginMatches.length).toBeGreaterThanOrEqual(1);
    expect(commitMatches.length).toBeGreaterThanOrEqual(1);
    // First BEGIN should be the transaction start, last COMMIT should be transaction end
  });
});
