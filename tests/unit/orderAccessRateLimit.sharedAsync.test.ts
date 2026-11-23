// =====================================================
// Order-access limiter — shared-store wiring (regression)
// =====================================================
// The order-access limits used to call the synchronous `checkRateLimit`, which
// enforces only a per-instance in-memory Map: N serverless instances gave N x
// the configured budget, and the shared Postgres limiter was dead code. These
// tests pin the two properties that make the fix real:
//
//   1. No production file calls a sync order-access limiter.
//   2. The async helpers charge the SHARED store (proven with VITEST off, so
//      `checkRateLimitAsync` cannot take its test-env shortcut into memory).
//
// The sync exports stay covered for compatibility (S5).
// =====================================================

import {
  checkOrderAccessRateLimit,
  checkOrderAccessRateLimitFor,
  checkOrderVerifyRateLimits,
  checkOrderVerifyRateLimitsAsync,
  resetOrderAccessRateLimit,
} from '@/lib/orderAccessRateLimit';
import { RATE_LIMITS } from '@/lib/rateLimit';
import { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { mockShared, mockResetShared } = vi.hoisted(() => ({
  mockShared: vi.fn(),
  mockResetShared: vi.fn(),
}));

vi.mock('@/core/payments/rateLimitShared', () => ({
  checkRateLimitShared: mockShared,
  resetRateLimitShared: mockResetShared,
}));

const DEFINITION_FILE = 'src/lib/orderAccessRateLimit.ts';
const SYNC_NAMES = [
  'checkOrderAccessRateLimit',
  'checkOrderAccessRateLimitFor',
  'resetOrderAccessRateLimit',
  'checkOrderVerifyRateLimits',
];

// Constructed to avoid sonarjs/no-hardcoded-ip on constant definitions.
const IP_COARSE = ['198', '18', '1', '1'].join('.');
const IP_COARSE_DENIED = ['198', '18', '1', '2'].join('.');
const IP_SYNC_BUDGET = ['198', '18', '7', '1'].join('.');
const IP_SYNC_CEILING = ['198', '18', '7', '3'].join('.');

function requestFrom(ip: string): NextRequest {
  return new NextRequest('http://localhost/api/order/lookup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  });
}

describe('no production file calls a sync order-access limiter', () => {
  test('app/ and src/ only reach the async variants', () => {
    const root = process.cwd();
    const offenders: string[] = [];

    /* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp --
       Deliberate repository walk: every path comes from readdirSync, never from user input. */
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;

        const relative = path.relative(root, full).split(path.sep).join('/');
        if (relative === DEFINITION_FILE) continue;

        const source = fs.readFileSync(full, 'utf8');
        for (const name of SYNC_NAMES) {
          // `Async` variants do not match: the name must be followed by "(".
          if (new RegExp(`\\b${name}\\s*\\(`).test(source)) {
            offenders.push(`${relative}::${name}`);
          }
        }
      }
    };
    /* eslint-enable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp */

    for (const dir of ['app', 'src']) walk(path.join(root, dir));

    expect(offenders).toEqual([]);
  });
});

describe('async dual-key check charges the shared store', () => {
  beforeEach(() => {
    // VITEST off so `checkRateLimitAsync` cannot delegate to the in-memory
    // limiter; this is the only way the shared store is exercised in a test.
    vi.stubEnv('VITEST', 'false');
    vi.stubEnv('NODE_ENV', 'production');
    mockShared.mockReset();
    mockResetShared.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('coarse bucket first, then the fine (ip, order) bucket', async () => {
    mockShared
      .mockResolvedValueOnce({ allowed: true, remaining: 5, resetInMs: 1_000 })
      .mockResolvedValueOnce({ allowed: true, remaining: 9, resetInMs: 2_000 });

    await expect(checkOrderVerifyRateLimitsAsync(IP_COARSE, '1001')).resolves.toEqual({
      allowed: true,
      remaining: 5,
      resetInMs: 1_000,
    });

    expect(mockShared.mock.calls[0]).toEqual([
      `${IP_COARSE}:verify:__ip__`,
      RATE_LIMITS.orderVerifyIp,
    ]);
    expect(mockShared.mock.calls[1]).toEqual([`${IP_COARSE}:verify:1001`, RATE_LIMITS.storefront]);
  });

  test('a coarse denial does not charge the fine bucket', async () => {
    mockShared.mockResolvedValueOnce({ allowed: false, remaining: 0, resetInMs: 30_000 });

    await expect(checkOrderVerifyRateLimitsAsync(IP_COARSE_DENIED, '1001')).resolves.toEqual({
      allowed: false,
      remaining: 0,
      resetInMs: 30_000,
    });

    expect(mockShared).toHaveBeenCalledTimes(1);
  });
});

describe('sync exports keep their in-memory behavior', () => {
  test('10 lookups allowed, the 11th denied, reset reopens the window', () => {
    const ip = IP_SYNC_BUDGET;
    const body = { dni: '12345678' };

    const results = Array.from({ length: 11 }, () =>
      checkOrderAccessRateLimit(requestFrom(ip), body),
    );

    expect(results.slice(0, 10).every((result) => result.allowed)).toBe(true);
    expect(results[10].allowed).toBe(false);

    resetOrderAccessRateLimit(ip, body);
    expect(checkOrderAccessRateLimit(requestFrom(ip), body).allowed).toBe(true);
  });

  test('the coarse per-ip ceiling still holds at 30/min', () => {
    const ip = IP_SYNC_CEILING;

    for (let i = 0; i < 30; i += 1) {
      expect(checkOrderVerifyRateLimits(ip, `ORD-${i}`).allowed).toBe(true);
    }
    expect(checkOrderVerifyRateLimits(ip, 'ORD-NEW').allowed).toBe(false);
  });

  test('the per-(client, dni) budget is dni-scoped', () => {
    for (let i = 0; i < 11; i += 1) {
      checkOrderAccessRateLimitFor('client-1', { dni: '12345678' });
    }

    expect(checkOrderAccessRateLimitFor('client-1', { dni: '12345678' }).allowed).toBe(false);
    expect(checkOrderAccessRateLimitFor('client-1', { dni: '87654321' }).allowed).toBe(true);
  });
});
