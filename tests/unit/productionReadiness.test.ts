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
import {
  evaluateReadiness,
  signatureKey,
  type ObservedState,
} from '../../scripts/check-production-readiness';

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

// Exact signatures: `is_business_member` has two overloads and the one the
// policies call is the two-argument version created in 0011.
const FUNCTIONS = [
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
];

function readyState(overrides: Partial<ObservedState> = {}): ObservedState {
  return {
    role: { bypassRls: false },
    canAssumeRuntimeRole: true,
    rlsByTable: Object.fromEntries(GOVERNED_TABLES.map((table) => [table, true])),
    policyCountByTable: Object.fromEntries(GOVERNED_TABLES.map((table) => [table, 1])),
    grantedTables: [...GOVERNED_TABLES],
    functionIsDefiner: Object.fromEntries(FUNCTIONS.map((fn) => [signatureKey(fn), true])),
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
    let functionIsDefiner = { ...readyState().functionIsDefiner };
    const withoutProductMember = Object.fromEntries(
      Object.entries(functionIsDefiner).filter(
        ([signature]) => signature !== signatureKey('is_product_member(uuid)'),
      ),
    );
    functionIsDefiner = withoutProductMember;
    functionIsDefiner[signatureKey('public_business_by_slug(text)')] = false;

    const result = evaluateReadiness(readyState({ functionIsDefiner }));

    expect(result.failures).toContain('is_product_member(uuid): function does not exist');
    expect(result.failures).toContain('public_business_by_slug(text): is not SECURITY DEFINER');
  });

  it('fails when only the single-argument is_business_member exists', () => {
    // The baseline ships the one-argument overload. Matching by name would let
    // the two-argument version - the one the policies call - be missing while
    // this check passed. That is how the first version of this script lied.
    let functionIsDefiner = { ...readyState().functionIsDefiner };
    const withoutMemberOverload = Object.fromEntries(
      Object.entries(functionIsDefiner).filter(
        ([signature]) => signature !== signatureKey('is_business_member(uuid, uuid)'),
      ),
    );
    functionIsDefiner = withoutMemberOverload;

    const result = evaluateReadiness(readyState({ functionIsDefiner }));

    expect(result.ok).toBe(false);
    expect(result.failures).toContain('is_business_member(uuid, uuid): function does not exist');
  });

  it('fails when the login role cannot assume app_runtime', () => {
    // Creating the role is not the same as letting the application use it.
    // Production failed exactly here: every governed request was denied before
    // any policy ran.
    const result = evaluateReadiness(readyState({ canAssumeRuntimeRole: false }));

    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(/cannot set role app_runtime/);
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
