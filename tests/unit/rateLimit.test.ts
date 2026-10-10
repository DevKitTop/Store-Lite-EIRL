// =====================================================
// src/lib/rateLimit.ts — shared limiter primitives (R9 / R10, design D1 + D4)
// =====================================================
// NOTE ON THE NAME: `tests/unit/rateLimiter.test.ts` already exists and covers a
// DIFFERENT module (`@/core/payments/rateLimiter`, a payments-specific helper).
// This file covers the shared in-memory limiter at `src/lib/rateLimit.ts`.
// Both suites are intentional — do not merge or rename them.
//
// The store lives in module scope for 15 minutes, so every test burns its OWN
// identifier. A shared identifier would inherit an exhausted bucket and pass (or
// fail) for the wrong reason (planner note N3).
//
// No mocks: this suite pins the REAL sliding window and the REAL header chain.
// `vi.mock('@/lib/rateLimit')` here would prove nothing about the primitives the
// buyer order gate depends on.
// =====================================================

import {
  checkRateLimit,
  getClientIdentifier,
  getClientIdentifierFromHeaders,
  RATE_LIMITS,
  resetRateLimit,
} from '@/lib/rateLimit';
import { NextRequest } from 'next/server';
import { describe, expect, test } from 'vitest';

/** RATE_LIMITS.auth — 10 requests / 15 min. Pinned so the ceiling under test is real. */
const AUTH_MAX = RATE_LIMITS.auth.maxRequests;

/**
 * Minimal structural stand-in for `Headers` / `ReadonlyHeaders`: only `get`.
 * A plain object is the point — the server action that calls
 * `getClientIdentifierFromHeaders(await headers())` never has a `NextRequest`,
 * so the parameter MUST be structural (design D4).
 */
function headerBag(headers: Record<string, string>) {
  const entries = new Map(Object.entries(headers));
  return { get: (name: string) => entries.get(name) ?? null };
}

// ── Suite: resetRateLimit (R10, design D1) ───────────

describe('resetRateLimit', () => {
  test('gives an exhausted identifier a fresh budget (symmetry with checkRateLimit)', () => {
    const identifier = 'symmetry-203.0.113.1';

    for (let attempt = 1; attempt <= AUTH_MAX; attempt += 1) {
      expect(checkRateLimit(identifier, RATE_LIMITS.auth)).toMatchObject({
        allowed: true,
        remaining: AUTH_MAX - attempt,
      });
    }
    expect(checkRateLimit(identifier, RATE_LIMITS.auth)).toMatchObject({
      allowed: false,
      remaining: 0,
    });

    resetRateLimit(identifier, RATE_LIMITS.auth);

    // A reset bucket is indistinguishable from a brand-new one: full budget.
    expect(checkRateLimit(identifier, RATE_LIMITS.auth)).toMatchObject({
      allowed: true,
      remaining: AUTH_MAX - 1,
    });
  });

  test('is a no-op on an unknown identifier and leaves other buckets intact', () => {
    const neighbour = 'symmetry-203.0.113.2';
    for (let attempt = 0; attempt < AUTH_MAX; attempt += 1) {
      checkRateLimit(neighbour, RATE_LIMITS.auth);
    }

    // Never charged — must not throw and must not resurrect anything.
    expect(() => resetRateLimit('symmetry-never-charged', RATE_LIMITS.auth)).not.toThrow();

    expect(checkRateLimit(neighbour, RATE_LIMITS.auth)).toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });
});

// ── Suite: getClientIdentifierFromHeaders (D4) ──────

describe('getClientIdentifierFromHeaders', () => {
  test('accepts a plain `{ get }` object and prefers the first x-forwarded-for token', () => {
    const bag = headerBag({
      'x-forwarded-for': '203.0.113.9, 70.41.3.18, 150.172.238.178',
      'x-real-ip': '198.51.100.4',
      'cf-connecting-ip': '198.51.100.5',
    });

    expect(getClientIdentifierFromHeaders(bag)).toBe('203.0.113.9');
  });

  test('falls back to x-real-ip, then cf-connecting-ip', () => {
    expect(
      getClientIdentifierFromHeaders(
        headerBag({ 'x-real-ip': '198.51.100.4', 'cf-connecting-ip': '198.51.100.5' }),
      ),
    ).toBe('198.51.100.4');

    expect(getClientIdentifierFromHeaders(headerBag({ 'cf-connecting-ip': '198.51.100.5' }))).toBe(
      '198.51.100.5',
    );
  });

  test('returns the "unknown" sentinel when no client header is present', () => {
    expect(getClientIdentifierFromHeaders(headerBag({}))).toBe('unknown');
  });

  test('resolves the same client as getClientIdentifier (one chain, two entry points)', () => {
    // getClientIdentifier delegates to getClientIdentifierFromHeaders, so the
    // priority chain is pinned once and shared by the proxy, the lookup route
    // and the buyer gate. Drift between the two would be a silent security hole.
    const headers = {
      'x-forwarded-for': '203.0.113.9, 70.41.3.18',
      'x-real-ip': '198.51.100.4',
    };
    const request = new NextRequest('http://localhost/api/order/lookup', { headers });

    expect(getClientIdentifierFromHeaders(headerBag(headers))).toBe(getClientIdentifier(request));
  });
});
