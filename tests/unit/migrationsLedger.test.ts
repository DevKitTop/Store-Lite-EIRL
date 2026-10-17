import { describe, expect, it } from 'vitest';

// The migrations ledger guard is plain ESM tooling (no bundler), so it is
// imported dynamically to keep vitest's static analysis out of the way.
const mod = await import('../../scripts/lib/migrationsLedger.mjs');
const { parsePrefix, findDuplicatePrefixes, buildLedger, verifyLedger } = mod;

const SQL = [
  '0000_superb_master_mold.sql',
  '0000_special_crystal.sql',
  '0001_puzzling_hairball.sql',
  '0048_payments_order_number_integrity.sql',
  '0048_whatsapp_connection_status.sql',
  '0049_enable_rls_sensitive_tables.sql',
];

const JOURNAL = ['0000_superb_master_mold', '0001_puzzling_hairball'];

describe('parsePrefix', () => {
  it('returns the leading zero-padded numeric prefix', () => {
    expect(parsePrefix('0048_whatsapp_connection_status.sql')).toBe('0048');
  });

  it('accepts an extension-less tag', () => {
    expect(parsePrefix('0024_messy_nehzno')).toBe('0024');
  });

  it('returns null when there is no numeric prefix', () => {
    expect(parsePrefix('readme.sql')).toBeNull();
  });
});

describe('findDuplicatePrefixes', () => {
  it('groups files that share a prefix', () => {
    const dupes = findDuplicatePrefixes(SQL);
    expect(dupes['0000']).toEqual(['0000_special_crystal.sql', '0000_superb_master_mold.sql']);
    expect(dupes['0048']).toEqual([
      '0048_payments_order_number_integrity.sql',
      '0048_whatsapp_connection_status.sql',
    ]);
  });

  it('omits prefixes that are unique', () => {
    const dupes = findDuplicatePrefixes(SQL);
    expect(dupes['0001']).toBeUndefined();
    expect(dupes['0049']).toBeUndefined();
  });
});

describe('buildLedger', () => {
  it('classifies each file as journaled or manual and records collisions', () => {
    const ledger = buildLedger({ sqlFiles: SQL, journalTags: JOURNAL, generatedAt: 'X' });

    expect(ledger.counts).toEqual({ sql: 6, journal: 2, unjournaled: 4 });
    expect(ledger.files).toHaveLength(6);

    const byFile = Object.fromEntries(ledger.files.map((f) => [f.file, f]));
    expect(byFile['0000_superb_master_mold.sql'].method).toBe('journal');
    expect(byFile['0049_enable_rls_sensitive_tables.sql'].method).toBe('manual');

    expect(ledger.duplicatePrefixes['0000']).toHaveLength(2);
    expect(ledger.duplicatePrefixes['0048']).toHaveLength(2);
  });

  it('sorts files deterministically', () => {
    const ledger = buildLedger({ sqlFiles: SQL, journalTags: JOURNAL, generatedAt: 'X' });
    const files = ledger.files.map((f) => f.file);
    expect(files).toEqual([...files].sort());
  });

  it('flags a journal tag that has no matching sql file', () => {
    const ledger = buildLedger({
      sqlFiles: SQL,
      journalTags: [...JOURNAL, '0999_ghost'],
      generatedAt: 'X',
    });
    expect(ledger.danglingJournalTags).toEqual(['0999_ghost']);
  });
});

describe('verifyLedger', () => {
  const ledger = buildLedger({ sqlFiles: SQL, journalTags: JOURNAL, generatedAt: 'X' });

  it('passes when the tree matches the ledger exactly', () => {
    const result = verifyLedger({ sqlFiles: SQL, journalTags: JOURNAL, ledger });
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails on an unregistered new migration', () => {
    const result = verifyLedger({
      sqlFiles: [...SQL, '0051_brand_new.sql'],
      journalTags: JOURNAL,
      ledger,
    });
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.code)).toContain('UNREGISTERED_MIGRATION');
  });

  it('fails on a stale ledger entry whose file is gone', () => {
    const result = verifyLedger({
      sqlFiles: SQL.filter((f) => f !== '0049_enable_rls_sensitive_tables.sql'),
      journalTags: JOURNAL,
      ledger,
    });
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.code)).toContain('STALE_LEDGER_ENTRY');
  });

  it('fails on a NEW prefix collision that the ledger does not record', () => {
    const result = verifyLedger({
      sqlFiles: [...SQL, '0049_another_one.sql'],
      journalTags: JOURNAL,
      ledger: {
        ...ledger,
        files: [
          ...ledger.files,
          { file: '0049_another_one.sql', prefix: '0049', method: 'manual' },
        ],
      },
    });
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.code)).toContain('NEW_PREFIX_COLLISION');
  });

  it('does not fail on grandfathered collisions already in the ledger', () => {
    const result = verifyLedger({ sqlFiles: SQL, journalTags: JOURNAL, ledger });
    expect(result.failures.map((f) => f.code)).not.toContain('NEW_PREFIX_COLLISION');
  });

  it('fails on a dangling journal tag', () => {
    const result = verifyLedger({
      sqlFiles: SQL,
      journalTags: [...JOURNAL, '0999_ghost'],
      ledger,
    });
    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.code)).toContain('DANGLING_JOURNAL_TAG');
  });
});
