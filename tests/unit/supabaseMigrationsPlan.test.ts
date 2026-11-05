// =====================================================
// Which migration files get applied
//
// The bug this guards: every hand-written SQL migration was invisible to
// `drizzle-kit migrate`, so a local database had the tables and none of the
// functions. The first storefront page failed with
// "select * from public.public_business_by_slug(...)".
//
// Getting the selection wrong is silent in both directions: skipping a file
// leaves the error, and including the baseline on a populated database would
// re-create the schema under a running app.
// =====================================================

import { describe, expect, it } from 'vitest';
import { migrationNumber, selectMigrations } from '../../scripts/db-migrate-supabase';

const FILES = [
  '0017_grant_runtime_role_to_app_login.sql',
  '0001_public_baseline.sql',
  '0005_tenant_runtime_role.sql',
  '0002_forward_code_requirements.sql',
  '0010_removed.sql.bak',
  'notes.txt',
];

describe('migrationNumber', () => {
  it('reads the numeric prefix of a SQL migration', () => {
    expect(migrationNumber('0005_tenant_runtime_role.sql')).toBe(5);
  });

  it('ignores files without the NNNN_ SQL shape', () => {
    expect(migrationNumber('0010_removed.sql.bak')).toBeNull();
    expect(migrationNumber('notes.txt')).toBeNull();
    expect(migrationNumber('README.md')).toBeNull();
  });
});

describe('selectMigrations', () => {
  it('applies everything after the baseline by default, in numeric order', () => {
    expect(selectMigrations(FILES)).toEqual([
      '0002_forward_code_requirements.sql',
      '0005_tenant_runtime_role.sql',
      '0017_grant_runtime_role_to_app_login.sql',
    ]);
  });

  it('includes the baseline only when asked, for an empty database', () => {
    expect(selectMigrations(FILES, { includeBaseline: true })).toEqual([
      '0001_public_baseline.sql',
      '0002_forward_code_requirements.sql',
      '0005_tenant_runtime_role.sql',
      '0017_grant_runtime_role_to_app_login.sql',
    ]);
  });

  it('honours --from so a single missed step can be applied alone', () => {
    expect(selectMigrations(FILES, { from: 17 })).toEqual([
      '0017_grant_runtime_role_to_app_login.sql',
    ]);
  });

  it('does not silently drop a file that has a number', () => {
    // The local bug was a missing file, not a failing one: every numbered
    // migration in the directory must appear in the plan.
    const numbered = FILES.filter((file) => migrationNumber(file) !== null);
    const planned = selectMigrations(FILES, { includeBaseline: true });

    expect(planned).toHaveLength(numbered.length);
  });
});
