import { readFileSync } from 'fs';
import { join } from 'path';

describe('order-number integrity migration (0048)', () => {
  const migrationPath = join(process.cwd(), 'migrations', '0048_payments_order_number_integrity.sql');
  let sql: string;

  beforeAll(() => {
    sql = readFileSync(migrationPath, 'utf8');
  });

  it('has exactly one transaction block with BEGIN and COMMIT', () => {
    // Count top-level statements, not inside DO  blocks
    const doBlocks = sql.match(/\$\$[\s\S]*?\$\$/g) || [];
    let withoutDo = sql;
    for (const block of doBlocks) {
      withoutDo = withoutDo.replace(block, '/*do-block*/');
    }
    const beginCount = (withoutDo.match(/\bBEGIN\b/gi) || []).length;
    const commitCount = (withoutDo.match(/\bCOMMIT\b/gi) || []).length;
    expect(beginCount).toBe(1);
    expect(commitCount).toBe(1);
  });

  it('uses advisory lock to prevent concurrent runs', () => {
    expect(sql).toMatch(/pg_advisory_xact_lock\s*\(\s*4800048\s*\)/);
  });

  it('backfills only NULL rows', () => {
    expect(sql).toMatch(/WHERE\s+order_number\s+IS\s+NULL/i);
  });

  it('enforces format validation with the correct pattern', () => {
    expect(sql).toMatch(/\^ORD-\[A-Za-z0-9_-]\{8,20\}\$/);
  });

  it('prevents mutation via immutable trigger', () => {
    expect(sql).toMatch(/prevent_order_number_update/);
    expect(sql).toMatch(/BEFORE UPDATE OF order_number/i);
  });

  it('creates unique index if not exists', () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS payments_order_number_unique/i);
  });

  it('sets NOT NULL constraint', () => {
    expect(sql).toMatch(/ALTER TABLE payments ALTER COLUMN order_number SET NOT NULL/i);
  });

  it('includes post-conditions verification', () => {
    expect(sql).toMatch(/Post-condition/i);
  });
});
