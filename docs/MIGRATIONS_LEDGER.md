# Migrations Ledger — drift audit and guard (C9)

> Status: **open risk, now contained.** The drift is documented and frozen; CI
> fails on any NEW drift. The durable fix needs live-database access and is
> described at the end — it is deliberately **not** applied here.

## 1. What was found

Read-only audit of `migrations/` on 2026-10-17:

| Fact | Value |
| --- | --- |
| `.sql` migration files | **78** |
| Entries in `migrations/meta/_journal.json` | **24** (idx 0–24, **idx 11 missing**) |
| Files reachable by `drizzle-kit migrate` | **24** |
| Files **not** in the journal (invisible to drizzle-kit) | **54** |
| Duplicate numeric prefixes | **21** (e.g. `0000`, `0013` ×3, `0019` ×4) |
| Dangling journal tags (tag with no `.sql`) | **0** |
| `meta/*_snapshot.json` files | 24 (stop at `0025`) |

## 2. Root cause

Two migration authoring streams share the `NNNN_` prefix namespace:

1. **Drizzle-generated** — random names (`0000_superb_master_mold.sql`), tracked
   in `_journal.json`.
2. **Hand-written** — descriptive names (`0002_add_product_fields.sql`), created
   directly and applied by hand.

Nothing enforces a single sequence, so prefixes collide freely and the journal
only ever tracked stream (1) plus a few hand-picked hand-written files.

## 3. Why this is dangerous (the real bug)

`package.json` exposes `"db:migrate": "drizzle-kit migrate"`, and
`docs/DATABASE_GUIDELINES.md` states that every schema change must ship a
drizzle-kit migration "to ensure parity between environments".

In practice:

- **`pnpm db:migrate` is unsafe here.** `drizzle-kit migrate` iterates
  `_journal.json` and applies only entries whose hash is absent from
  `drizzle.__drizzle_migrations`. Because the journal stops at `0024`, it would
  apply 24 entries and **silently skip 54 files** — including everything from
  `0025` to `0050`. A fresh environment would come up with a schema that looks
  migrated but is not.
- **`pnpm db:generate` is also unsafe.** `drizzle-kit generate` diffs the
  TypeScript schema against the newest snapshot (`0025`) and would emit a single
  migration re-creating objects that hand-written migrations `0026`–`0050`
  already applied — which then fails on any environment where they ran.
- **There is no single source of truth.** Actual application happened through
  Supabase MCP (`apply_migration`), which records into
  `supabase_migrations.schema_migrations` — a *different* ledger from
  `drizzle.__drizzle_migrations`. Neither ledger is complete on its own.

## 4. What this change does

It does **not** touch `_journal.json`, does not renumber any file, and does not
claim a "true" historical order (that is not recoverable from the repo). It:

1. Freezes the current reality in `migrations/ledger.json` — every `.sql` file
   with `method: "journal"` (reachable by drizzle-kit) or `method: "manual"`
   (applied by hand), plus the 21 collisions that already exist.
2. Adds `scripts/migrations-check.mjs` and wires it into CI
   (`pnpm check:migrations`). Any **new** drift fails the build:
   - `UNREGISTERED_MIGRATION` — a new `.sql` not in the ledger.
   - `STALE_LEDGER_ENTRY` — a ledger entry whose file was deleted.
   - `NEW_PREFIX_COLLISION` — a prefix reused by one more file than before.
   - `DANGLING_JOURNAL_TAG` — a journal tag with no `.sql`.

Existing drift is grandfathered so CI stays green; it only stops the situation
from getting worse.

## 5. Rules going forward

- **Never** run `pnpm db:migrate` against an environment whose migration state
  you have not verified. Prefer applying the specific file and recording it.
- **Never** edit `migrations/meta/_journal.json` by hand. It is a drizzle-kit
  artifact; hand-editing it without matching snapshots corrupts `generate`.
- **New migrations use the next free prefix.** Check with
  `node scripts/migrations-check.mjs` (or CI) before pushing — a reused prefix
  fails the build.
- **New migrations must be registered:** `pnpm check:migrations --update` after
  adding the file, and state in the PR how it was applied.

## 6. Recommended durable fix (needs live DB access — not done here)

1. Query the live database for the applied set:
   `select version, name from supabase_migrations.schema_migrations order by version;`
   and `select * from drizzle.__drizzle_migrations;`
2. Build a single authoritative ledger table (`public.schema_migrations`) from
   the union, reconciled against the objects that actually exist.
3. Adopt one runner that applies pending `.sql` files in ledger order and
   records each in that table — making application idempotent and reproducible
   regardless of the drizzle journal.
4. Only then decide whether to keep drizzle-kit for generation, and if so,
   regenerate a coherent journal + snapshots from the reconciled state.

Until step 4, treat `db:migrate` and `db:generate` as **unreliable** in this
repository.

## 7. Verification

```bash
pnpm check:migrations            # must print OK
pnpm exec vitest run tests/unit/migrationsLedger.test.ts
```
