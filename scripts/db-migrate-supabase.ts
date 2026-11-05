/**
 * Applies `supabase/migrations/*.sql` to a database.
 *
 * Why this exists: the repo authors migrations in two streams. `drizzle-kit`
 * tracks its own journal and silently skips every hand-written SQL file, so
 * these were never applied outside the environments where someone ran them by
 * hand. A fresh clone, or a local Supabase without a reset, has the tables but
 * not the functions - and the first storefront page fails with
 * "select * from public.public_business_by_slug(...)".
 *
 * Every file is written to be re-runnable (`create or replace`,
 * `if not exists`, `drop policy if exists`), so re-applying is safe and this
 * script needs no ledger of its own.
 *
 * The baseline is skipped by default: it creates the application schema, and a
 * database that already serves the app has it. Pass `--include-baseline` for a
 * truly empty database.
 *
 * Usage:
 *   pnpm db:migrate:supabase
 *   pnpm db:migrate:supabase --from 0005
 *   pnpm db:migrate:supabase --include-baseline
 */
import 'dotenv/config';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');
const BASELINE_PREFIX = '0001';

/** Numeric prefix of a migration file, or null when it has none. */
export function migrationNumber(file: string): number | null {
  const match = /^(\d{4})_.*\.sql$/.exec(file);
  return match ? Number(match[1]) : null;
}

/**
 * Files to apply, in numeric order.
 *
 * Pure, so a test can prove the two things that matter: nothing is skipped
 * silently, and the baseline is only included when asked for.
 */
export function selectMigrations(
  files: string[],
  options: { includeBaseline?: boolean; from?: number } = {},
): string[] {
  const numbered = files
    .map((file) => ({ file, number: migrationNumber(file) }))
    .filter((entry): entry is { file: string; number: number } => entry.number !== null);

  const includeBaseline = options.includeBaseline === true;
  const from = options.from ?? (includeBaseline ? 0 : Number(BASELINE_PREFIX));

  return numbered
    .filter((entry) => entry.number >= from)
    .filter((entry) => includeBaseline || entry.number !== Number(BASELINE_PREFIX))
    .sort((a, b) => a.number - b.number)
    .map((entry) => entry.file);
}

function parseArgs(argv: string[]): { includeBaseline: boolean; from?: number } {
  const includeBaseline = argv.includes('--include-baseline');
  const fromIndex = argv.indexOf('--from');
  const from =
    fromIndex > -1 && argv[fromIndex + 1] ? Number.parseInt(argv[fromIndex + 1], 10) : undefined;

  if (from !== undefined && Number.isNaN(from)) {
    throw new Error('--from expects a migration number, e.g. --from 0005');
  }

  return { includeBaseline, from };
}

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL or POSTGRES_URL is required.');
  }

  const options = parseArgs(process.argv.slice(2));
  const files = selectMigrations(readdirSync(MIGRATIONS_DIR), options);

  if (files.length === 0) {
    console.log('No migrations matched.');
    return;
  }

  const sql = postgres(connectionString, { max: 1, prepare: false, onnotice: () => {} });

  try {
    for (const file of files) {
      const ddl = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(ddl);
        });
        console.log(`OK   ${file}`);
      } catch (error) {
        const code = (error as { code?: string }).code ?? '';
        console.log(`FAIL ${file}: ${(error as Error).message} (${code})`);
        process.exitCode = 1;
        return;
      }
    }

    console.log(`Applied ${files.length} migration(s).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1]?.includes('db-migrate-supabase')) {
  main().catch((error: unknown) => {
    console.error('Failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
