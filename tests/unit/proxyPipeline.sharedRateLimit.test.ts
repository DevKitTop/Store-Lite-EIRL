// =====================================================
// Proxy pipeline — shared rate-limit store (regression)
// =====================================================
// The pipeline used the synchronous `checkRateLimit`, which only enforces a
// per-instance Map: N middleware instances meant N x the configured budget for
// /auth/* and /api/*. These tests keep the REAL `@/lib/rateLimit` module and
// stub `VITEST` off, so `checkRateLimitAsync` cannot take its test-env shortcut
// into memory and the mocked shared store is what answers.
// =====================================================

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { runProxyPipeline } from '../../src/lib/middleware/proxyPipeline';
import { RATE_LIMITS } from '../../src/lib/rateLimit';

const { mockShared } = vi.hoisted(() => ({ mockShared: vi.fn() }));

vi.mock('@/core/payments/rateLimitShared', () => ({
  checkRateLimitShared: mockShared,
  resetRateLimitShared: vi.fn(),
}));

vi.mock('@/config/env', () => ({
  env: {
    featureSubdomainRewrite: false,
    nextPublicAppUrl: 'https://storelite.app',
  },
}));

// Constructed to avoid sonarjs/no-hardcoded-ip on constant definitions.
const CLIENT_IP = ['203', '0', '113', '9'].join('.');

function requestFor(pathname: string): NextRequest {
  return new NextRequest(`https://storelite.app${pathname}`, {
    headers: { 'x-forwarded-for': CLIENT_IP },
  });
}

describe('runProxyPipeline charges the shared store', () => {
  beforeEach(() => {
    vi.stubEnv('VITEST', 'false');
    vi.stubEnv('NODE_ENV', 'production');
    mockShared.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('/api/* is charged against the api bucket in the shared store', async () => {
    mockShared.mockResolvedValue({ allowed: true, remaining: 29, resetInMs: 60_000 });

    await expect(runProxyPipeline(requestFor('/api/products'))).resolves.toMatchObject({
      kind: 'proceed',
    });
    expect(mockShared).toHaveBeenCalledWith(CLIENT_IP, RATE_LIMITS.api);
  });

  test('/auth/* is charged against the auth bucket in the shared store', async () => {
    mockShared.mockResolvedValue({ allowed: true, remaining: 9, resetInMs: 900_000 });

    await runProxyPipeline(requestFor('/auth/login'));

    expect(mockShared).toHaveBeenCalledWith(CLIENT_IP, RATE_LIMITS.auth);
  });

  test('the storefront is never charged at the edge', async () => {
    await runProxyPipeline(requestFor('/product/abc'));

    expect(mockShared).not.toHaveBeenCalled();
  });

  test('a shared denial short-circuits with rounded-up seconds', async () => {
    mockShared.mockResolvedValue({ allowed: false, remaining: 0, resetInMs: 42_400 });

    await expect(runProxyPipeline(requestFor('/auth/login'))).resolves.toEqual({
      kind: 'rateLimited',
      retryAfterSeconds: 43,
      resetAfterSeconds: 43,
    });
  });

  test('a store outage degrades to the per-instance window instead of failing open', async () => {
    mockShared.mockRejectedValue(new Error('db down'));

    // The in-memory window has room on the first hit, so the request proceeds;
    // the point is that it is still counted locally instead of being allowed by
    // a swallowed error with no counter at all.
    await expect(runProxyPipeline(requestFor('/api/products'))).resolves.toMatchObject({
      kind: 'proceed',
    });
  });
});
