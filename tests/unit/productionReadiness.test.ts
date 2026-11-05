// =====================================================
// Production readiness gate
//
// The rollout order matters: migrations first, code second. Reversed, every
// path using the tenant runner answers 500 because `app_runtime` does not
// exist yet. This suite pins the conditions that decide whether the database
// is ready, so the gate is not "it looked fine".
//
// `evaluateReadiness` is pure on purpose: each rule below is one way the
// rollout breaks in production.
// =====================================================

import { describe, expect, it } from 'vitest';
import { evaluateReadiness, type ObservedState } from '../../scripts/check-production-readiness';

const GOVERNED_TABLES = [
  'payments',
  'business_team_members',
  'business_team_roles',
  'import_jobs',
  'import_rows',
  'products',
  'product_categories',
  'product_media',
];

const FUNCTIONS = [
  'accept_business_invitation',
  'business_private_settings',
  'business_team_directory',
  'businesses_for_user',
  'is_business_member',
  'is_business_owner',
  'is_product_member',
  'is_storage_path_owner',
  'public_business_by_slug',
];

function readyState(overrides: Partial<ObservedState> = {}): ObservedState {
  return {
    role: { bypassRls: false },
    rlsByTable: Object.fromEntries(GOVERNED_TABLES.map((table) => [table, true])),
    policyCountByTable: Object.fromEntries(GOVERNED_TABLES.map((table) => [table, 1])),
    grantedTables: [...GOVERNED_TABLES],
    functionIsDefiner: Object.fromEntries(FUNCTIONS.map((fn) => [fn, true])),
    encryptionKeyPresent: true,
    culqi: { plaintext: 0, devFallback: 0 },
    ...overrides,
  };
}

describe('evaluateReadiness', () => {
  it('passes when the database carries every governed object', () => {
    expect(evaluateReadiness(readyState())).toEqual({ ok: true, failures: [] });
  });

  it('fails when the runtime role is missing, which is what a wrong rollout order looks like', () => {
    const result = evaluateReadiness(readyState({ role: null }));

    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(/role app_runtime does not exist/);
  });

  it('fails when the runtime role can bypass RLS, because policies would be decorative', () => {
    const result = evaluateReadiness(readyState({ role: { bypassRls: true } }));

    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(/bypass RLS/);
  });

  it('fails when a governed table has RLS off', () => {
    const rlsByTable = { ...readyState().rlsByTable, products: false };

    const result = evaluateReadiness(readyState({ rlsByTable }));

    expect(result.failures).toContain('products: row level security is not enabled');
  });

  it('fails when a governed table has RLS on but no policy', () => {
    const policyCountByTable = { ...readyState().policyCountByTable, import_jobs: 0 };

    const result = evaluateReadiness(readyState({ policyCountByTable }));

    expect(result.failures).toContain(
      'import_jobs: has RLS but no policy, so every row is denied or open',
    );
  });

  it('fails when a governed table is not granted', () => {
    const grantedTables = readyState().grantedTables.filter((table) => table !== 'product_media');

    const result = evaluateReadiness(readyState({ grantedTables }));

    expect(result.failures).toContain('product_media: not granted to app_runtime');
  });

  it('fails when businesses is granted, because it carries columns no policy can hide', () => {
    const result = evaluateReadiness(
      readyState({ grantedTables: [...readyState().grantedTables, 'businesses'] }),
    );

    expect(result.ok).toBe(false);
    expect(result.failures).toContain('businesses: granted to app_runtime but must stay revoked');
  });

  it('fails when a governed function is missing or not SECURITY DEFINER', () => {
    const functionIsDefiner = { ...readyState().functionIsDefiner };
    delete functionIsDefiner.is_product_member;
    functionIsDefiner.public_business_by_slug = false;

    const result = evaluateReadiness(readyState({ functionIsDefiner }));

    expect(result.failures).toContain('is_product_member: function does not exist');
    expect(result.failures).toContain('public_business_by_slug: is not SECURITY DEFINER');
  });

  it('fails when ENCRYPTION_KEY is missing, because the first encrypt would throw', () => {
    const result = evaluateReadiness(readyState({ encryptionKeyPresent: false }));

    expect(result.failures).toContain('ENCRYPTION_KEY is not set; encrypting will fail at runtime');
  });

  it('fails when a stored Culqi key is plain text', () => {
    const result = evaluateReadiness(readyState({ culqi: { plaintext: 1, devFallback: 0 } }));

    expect(result.failures.join(' ')).toMatch(/1 Culqi secret key\(s\) stored as plain text/);
  });

  it('fails when a stored Culqi key was encrypted with the dev fallback', () => {
    const result = evaluateReadiness(readyState({ culqi: { plaintext: 0, devFallback: 2 } }));

    expect(result.failures.join(' ')).toMatch(
      /2 Culqi secret key\(s\) encrypted with the dev fallback/,
    );
  });
});
