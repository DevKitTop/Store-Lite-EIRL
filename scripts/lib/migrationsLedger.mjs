// =====================================================
// scripts/lib/migrationsLedger.mjs
// =====================================================
// Pure helpers for the migrations ledger guard (C9).
//
// Background: this repo has TWO parallel migration authoring streams sharing the
// `NNNN_` prefix namespace — Drizzle-generated names and hand-written
// descriptive names. The Drizzle journal only tracks part of them, so
// `drizzle-kit migrate` silently skips the rest. We cannot retro-fix the
// journal without the live database, so instead we freeze the current reality in
// an explicit ledger and fail CI when the tree drifts from it in a NEW way.
//
// Kept dependency-free and side-effect-free so it is trivially unit-testable.
// =====================================================

const PREFIX_RE = /^(\d{4})_/;

/** Leading 4-digit prefix of a migration file or journal tag, or null. */
export function parsePrefix(name) {
  const match = PREFIX_RE.exec(String(name));
  return match ? match[1] : null;
}

/** Map of prefix -> sorted file names, for every prefix used by more than one file. */
export function findDuplicatePrefixes(files) {
  const byPrefix = new Map();
  for (const file of files) {
    const prefix = parsePrefix(file);
    if (!prefix) continue;
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
    byPrefix.get(prefix).push(file);
  }

  const duplicates = {};
  for (const [prefix, group] of byPrefix) {
    if (group.length > 1) {
      duplicates[prefix] = [...group].sort();
    }
  }
  return duplicates;
}

/**
 * Snapshot the tree into a ledger: every sql file, how it is applied
 * (`journal` = reachable by drizzle-kit, `manual` = applied by hand), and the
 * collisions that already exist.
 */
export function buildLedger({ sqlFiles, journalTags, generatedAt = null }) {
  const journalSet = new Set(journalTags);
  const files = [...sqlFiles].sort().map((file) => ({
    file,
    prefix: parsePrefix(file),
    method: journalSet.has(file.replace(/\.sql$/, '')) ? 'journal' : 'manual',
  }));

  const sqlTags = new Set(files.map((f) => f.file.replace(/\.sql$/, '')));
  const danglingJournalTags = [...journalSet].filter((tag) => !sqlTags.has(tag)).sort();

  return {
    version: 1,
    generatedAt,
    counts: {
      sql: files.length,
      journal: journalTags.length,
      unjournaled: files.filter((f) => f.method === 'manual').length,
    },
    files,
    duplicatePrefixes: findDuplicatePrefixes(sqlFiles),
    danglingJournalTags,
  };
}

/**
 * Compare the working tree against a frozen ledger.
 * Returns `{ ok, failures: [{ code, message }] }`. Only NEW drift fails;
 * anything already recorded when the ledger was frozen is grandfathered.
 */
export function verifyLedger({ sqlFiles, journalTags, ledger }) {
  const failures = [];

  const diskSet = new Set(sqlFiles);
  const ledgerFiles = Array.isArray(ledger?.files) ? ledger.files : [];
  const ledgerSet = new Set(ledgerFiles.map((f) => f.file));

  for (const file of [...diskSet].sort()) {
    if (!ledgerSet.has(file)) {
      failures.push({
        code: 'UNREGISTERED_MIGRATION',
        message: `Migration "${file}" is not in the ledger. Run: pnpm check:migrations --update`,
      });
    }
  }

  for (const entry of ledgerFiles) {
    if (!diskSet.has(entry.file)) {
      failures.push({
        code: 'STALE_LEDGER_ENTRY',
        message: `Ledger lists "${entry.file}" but the file no longer exists.`,
      });
    }
  }

  const current = findDuplicatePrefixes(sqlFiles);
  const known = ledger?.duplicatePrefixes ?? {};
  for (const [prefix, group] of Object.entries(current)) {
    const knownGroup = known[prefix];
    if (!knownGroup || group.length > knownGroup.length) {
      failures.push({
        code: 'NEW_PREFIX_COLLISION',
        message: `Prefix ${prefix} is now shared by ${group.length} migrations (${group.join(', ')}). Use the next free prefix.`,
      });
    }
  }

  const diskTags = new Set(sqlFiles.map((f) => f.replace(/\.sql$/, '')));
  const dangling = [...new Set(journalTags)].filter((tag) => !diskTags.has(tag)).sort();
  for (const tag of dangling) {
    failures.push({
      code: 'DANGLING_JOURNAL_TAG',
      message: `Journal tag "${tag}" has no matching .sql file.`,
    });
  }

  return { ok: failures.length === 0, failures };
}
