#!/usr/bin/env node
// =====================================================
// scripts/migrations-check.mjs
// =====================================================
// Guard against NEW migration drift (C9).
//
//   node scripts/migrations-check.mjs            # verify (CI)
//   node scripts/migrations-check.mjs --update   # re-freeze the ledger
//
// Why this exists: this repo authors migrations through two parallel streams
// (drizzle-kit generate + hand-written SQL) that share the `NNNN_` prefix
// namespace. The drizzle journal only tracks part of them, so
// `drizzle-kit migrate` silently skips the rest. We cannot repair the journal
// without the live database, so instead we freeze today's reality in
// `migrations/ledger.json` and fail CI on any NEW unregistered file, stale
// entry, prefix collision, or dangling journal tag.
// =====================================================

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildLedger, verifyLedger } from './lib/migrationsLedger.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
const JOURNAL_PATH = path.join(MIGRATIONS_DIR, 'meta', '_journal.json');
const LEDGER_PATH = path.join(MIGRATIONS_DIR, 'ledger.json');

function listSqlFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

function readJournalTags() {
  if (!existsSync(JOURNAL_PATH)) return [];
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf-8'));
  return (journal.entries ?? []).map((e) => e.tag);
}

function main() {
  const update = process.argv.includes('--update');

  const sqlFiles = listSqlFiles();
  const journalTags = readJournalTags();

  if (update) {
    const ledger = buildLedger({
      sqlFiles,
      journalTags,
      generatedAt: new Date().toISOString(),
    });
    writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`, 'utf-8');
    console.log(
      `migrations ledger written: ${ledger.counts.sql} sql, ${ledger.counts.journal} journaled, ` +
        `${ledger.counts.unjournaled} manual-only.`,
    );
    return;
  }

  if (!existsSync(LEDGER_PATH)) {
    console.error('Missing migrations/ledger.json. Run: pnpm check:migrations --update');
    process.exit(1);
  }

  const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf-8'));
  const result = verifyLedger({ sqlFiles, journalTags, ledger });

  if (!result.ok) {
    console.error(`migrations ledger check FAILED (${result.failures.length}):`);
    for (const failure of result.failures) {
      console.error(`  [${failure.code}] ${failure.message}`);
    }
    process.exit(1);
  }

  console.log(
    `migrations ledger check OK — ${ledger.counts.sql} sql files, ` +
      `${ledger.counts.unjournaled} manual-only, ${Object.keys(ledger.duplicatePrefixes).length} grandfathered prefix collisions.`,
  );
}

main();
