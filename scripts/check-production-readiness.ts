/**
 * Production readiness check for the tenancy rollout.
 *
 * Read-only. Answers one question: is this database ready for the code on
 * `develop`? The code assumes things the migrations create â€” the `app_runtime`
 * role, RLS on the tables the runner touches, the governed functions, the
 * grants â€” and fails at request time if any of them is missing. Checking before
 * deploying turns a 500 in front of a customer into a line in a report.
 *
 * It also inspects the stored Culqi keys, because a key that is really plain
 * text (written with the old zero-byte fallback) is both a leak and, once the
 * code requires ENCRYPTION_KEY, a broken payment path.
 *
 * Exit code is 1 when any check fails, so it can gate a workflow.
 *
 * Usage: pnpm tsx scripts/check-production-readiness.ts
 */
import 'dotenv/config';
import postgres from 'postgres';
import { isDevFallbackCiphertext, isEncryptedCulqiKey } from './encrypt-legacy-culqi-keys';

/** Tables the tenant runner reads or writes. All must have RLS enabled. */
const GOVERNED_TABLES = [
  'payments',
  'business_team_members',
  'business_team_roles',
  'import_jobs',
  'import_rows',
  'products',
  'product_categories',
  'product_media',
] as const;

/**
 * Tables that must be granted, and the one that must not.
 *
 * `businesses` holds `tax_id`, `verification_data` and the legal
 * representative's details. It is revoked from the runtime role on purpose, and
 * a grant reappearing there would expose all of it: RLS filters rows, never
 * columns.
 */
const REQUIRED_GRANTS = GOVERNED_TABLES;
const FORBIDDEN_GRANTS = ['businesses'] as const;

/**
 * Every governed function, by exact signature.
 *
 * By signature and not by name: `is_business_member` has two overloads, and the
 * single-argument one exists since the baseline. Matching on the name alone
 * would let the two-argument version be missing while the check passed — the
 * one the policies call.
 */
const GOVERNED_FUNCTIONS = [
  'accept_business_invitation(uuid, text, uuid)',
  'business_private_settings(text, uuid)',
  'business_team_directory(uuid, uuid)',
  'businesses_for_user(uuid)',
  'is_business_member(uuid)',
  'is_business_member(uuid, uuid)',
  'is_business_owner(uuid, uuid)',
  'is_product_member(uuid)',
  'is_storage_path_owner(text)',
  'public_business_by_slug(text)',
] as const;

/**
 * Signature without whitespace, because `oid::regprocedure::text` renders
 * arguments as `(uuid,text,uuid)` - no space after the comma. Comparing against
 * a hand-written `(uuid, text, uuid)` matched nothing, which made every function
 * look missing and turned the gate into a false negative.
 */
export function signatureKey(signature: string): string {
  return signature.replace(/\s+/g, '');
}

export interface ObservedState {
  /** null when the role does not exist. */
  role: { bypassRls: boolean } | null;
  /**
   * Whether the login role this check runs as can `set role app_runtime`.
   *
   * Migrations create the role; they do not, by themselves, let the
   * application assume it. Without membership every governed request fails
   * with `permission denied to set role` before any policy is evaluated.
   */
  canAssumeRuntimeRole: boolean;
  rlsByTable: Record<string, boolean>;
  policyCountByTable: Record<string, number>;
  grantedTables: string[];
  functionIsDefiner: Record<string, boolean>;
  encryptionKeyPresent: boolean;
  /** null when the settings could not be inspected. */
  culqi: { plaintext: number; devFallback: number } | null;
}

export interface ReadinessResult {
  ok: boolean;
  failures: string[];
}

/**
 * Pure evaluation, so the rules are testable without a database.
 *
 * Exported for the suite: a check that cannot fail proves nothing, and these
 * are the exact conditions the rollout depends on.
 */
export function evaluateReadiness(observed: ObservedState): ReadinessResult {
  const failures: string[] = [];

  if (!observed.role) {
    failures.push('role app_runtime does not exist (migration 0005 not applied)');
  } else if (observed.role.bypassRls) {
    failures.push('role app_runtime can bypass RLS; every policy would be decorative');
  }

  if (observed.role && !observed.canAssumeRuntimeRole) {
    failures.push(
      'the login role cannot set role app_runtime; every governed request would fail (migration 0017)',
    );
  }

  for (const table of GOVERNED_TABLES) {
    if (!observed.rlsByTable[table]) {
      failures.push(`${table}: row level security is not enabled`);
    }
    if ((observed.policyCountByTable[table] ?? 0) === 0) {
      failures.push(`${table}: has RLS but no policy, so every row is denied or open`);
    }
  }

  for (const table of REQUIRED_GRANTS) {
    if (!observed.grantedTables.includes(table)) {
      failures.push(`${table}: not granted to app_runtime`);
    }
  }

  for (const table of FORBIDDEN_GRANTS) {
    if (observed.grantedTables.includes(table)) {
      failures.push(`${table}: granted to app_runtime but must stay revoked`);
    }
  }

  for (const fn of GOVERNED_FUNCTIONS) {
    const definer = observed.functionIsDefiner[signatureKey(fn)];

    if (definer === undefined) {
      failures.push(`${fn}: function does not exist`);
    } else if (!definer) {
      failures.push(`${fn}: is not SECURITY DEFINER`);
    }
  }

  if (!observed.encryptionKeyPresent) {
    failures.push('ENCRYPTION_KEY is not set; encrypting will fail at runtime');
  }

  if (observed.culqi) {
    if (observed.culqi.plaintext > 0) {
      failures.push(
        `${observed.culqi.plaintext} Culqi secret key(s) stored as plain text; run the rekey script`,
      );
    }
    if (observed.culqi.devFallback > 0) {
      failures.push(
        `${observed.culqi.devFallback} Culqi secret key(s) encrypted with the dev fallback key; run the rekey script`,
      );
    }
  }

  return { ok: failures.length === 0, failures };
}

async function observe(sql: postgres.Sql): Promise<ObservedState> {
  const [role] = await sql<{ rolbypassrls: boolean }[]>`
    select rolbypassrls from pg_roles where rolname = 'app_runtime'  `;

  const [assume] = await sql<{ ok: boolean }[]>`
    select pg_has_role(current_user, 'app_runtime', 'member') as ok
  `;

  const rlsRows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
    select relname, relrowsecurity from pg_class
    where relnamespace = 'public'::regnamespace and relname = any(${sql.array(GOVERNED_TABLES as unknown as string[])})
  `;
  const policyRows = await sql<{ tablename: string; n: number }[]>`
    select tablename, count(*)::int as n from pg_policies
    where schemaname = 'public' and tablename = any(${sql.array(GOVERNED_TABLES as unknown as string[])})
    group by tablename
  `;
  const grantRows = await sql<{ table_name: string }[]>`
    select distinct table_name from information_schema.role_table_grants
    where grantee = 'app_runtime'
  `;
  const functionNames = GOVERNED_FUNCTIONS.map((fn) => fn.slice(0, fn.indexOf('(')));
  const functionRows = await sql<{ signature: string; prosecdef: boolean }[]>`
    select oid::regprocedure::text as signature, prosecdef from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = any(${sql.array(functionNames)})
  `;

  const keyRows = await sql<{ culqi_secret_key: string }[]>`
    select culqi_secret_key from public.business_settings where culqi_secret_key is not null
  `;

  const culqi = { plaintext: 0, devFallback: 0 };
  for (const row of keyRows) {
    if (!isEncryptedCulqiKey(row.culqi_secret_key)) {
      culqi.plaintext += 1;
    } else if (isDevFallbackCiphertext(row.culqi_secret_key)) {
      culqi.devFallback += 1;
    }
  }

  return {
    role: role ? { bypassRls: role.rolbypassrls } : null,
    canAssumeRuntimeRole: assume?.ok === true,
    rlsByTable: Object.fromEntries(rlsRows.map((row) => [row.relname, row.relrowsecurity])),
    policyCountByTable: Object.fromEntries(policyRows.map((row) => [row.tablename, row.n])),
    grantedTables: grantRows.map((row) => row.table_name),
    functionIsDefiner: Object.fromEntries(
      functionRows.map((row) => [signatureKey(row.signature), row.prosecdef]),
    ),
    encryptionKeyPresent: Boolean(process.env.ENCRYPTION_KEY?.trim()),
    culqi,
  };
}

async function main() {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL or POSTGRES_URL is required.');
  }

  const sql = postgres(connectionString, { max: 1, prepare: false, ssl: 'require' });

  try {
    const observed = await observe(sql);
    const result = evaluateReadiness(observed);

    console.log(
      `Governed tables: ${GOVERNED_TABLES.length} Â· functions: ${GOVERNED_FUNCTIONS.length} Â· ` +
        `granted tables: ${observed.grantedTables.length}`,
    );

    if (result.ok) {
      console.log('READY: no blockers found.');
      return;
    }

    console.log(`NOT READY: ${result.failures.length} blocker(s).`);
    for (const failure of result.failures) {
      console.log(`  - ${failure}`);
    }
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1]?.includes('check-production-readiness')) {
  main().catch((error: unknown) => {
    console.error('Failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
