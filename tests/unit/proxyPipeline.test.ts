// =====================================================
// PROXY PIPELINE — Unit tests
// =====================================================
// Verifies the routing decisions of src/lib/middleware/proxyPipeline.ts:
// rate-limit bucketing, platform-only redirects on tenant subdomains, and the
// storefront rewrite.
//
// ⚠️ SCOPE: these tests exercise the extracted module directly. They prove the
// DECISIONS are correct — not that Next.js calls this code at all. That is what
// tests/unit/middlewareComposition.test.ts and tests/unit/middlewareWiring.test.ts
// are for. Do not treat a green suite here as proof the pipeline runs in prod.
// =====================================================

import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { runProxyPipeline } from '../../src/lib/middleware/proxyPipeline';

// ── Mocks (must be before module imports — vi.mock is hoisted) ──

const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock('@/config/env', () => ({
  env: {
    featureSubdomainRewrite: true,
    nextPublicAppUrl: 'https://storelite.app',
  },
}));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: mockCheckRateLimit,
  getClientIdentifier: vi.fn(() => 'test-client-ip'),
  RATE_LIMITS: { auth: { bucket: 'auth' }, api: { bucket: 'api' } },
}));

// NOTE: extractTenantSlugFromHost / isTenantHost are NOT mocked —
// the real implementations are deterministic for the hosts used here
// and exercising them keeps the tests closer to production behavior.

// ── Helpers ──────────────────────────────────────────

const TENANT_HOST = 'tienda1.storelite.app';
const PLATFORM_HOST = 'storelite.app';

function createRequest(pathWithQuery: string, host: string = TENANT_HOST): NextRequest {
  return new NextRequest(`https://${host}${pathWithQuery}`);
}

// ── Suite ────────────────────────────────────────────

describe('proxy pipeline — platform routes on tenant subdomains', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: the rate limiter allows the request through.
    mockCheckRateLimit.mockReturnValue({ allowed: true, resetInMs: 60_000 });
  });

  describe('platform-only routes redirect to the platform domain', () => {
    test.each([
      ['/pricing', '/pricing'],
      ['/auth', '/auth'],
      ['/auth/customer', '/auth/customer'],
      ['/onboarding', '/onboarding'],
      ['/created', '/created'],
      ['/list-business', '/list-business'],
    ])('%s redirects to the platform domain', (path, expectedPath) => {
      const outcome = runProxyPipeline(createRequest(path));

      expect(outcome.kind).toBe('platformRedirect');
      if (outcome.kind !== 'platformRedirect') return;
      expect(outcome.location.href).toBe(`https://storelite.app${expectedPath}`);
    });

    test('/pricing preserves the query string in the redirect', () => {
      const outcome = runProxyPipeline(createRequest('/pricing?slug=mi-tienda&utm_source=email'));

      expect(outcome.kind).toBe('platformRedirect');
      if (outcome.kind !== 'platformRedirect') return;
      expect(outcome.location.href).toBe(
        'https://storelite.app/pricing?slug=mi-tienda&utm_source=email',
      );
    });
  });

  describe('prefix safety', () => {
    test('/pricingxyz is NOT treated as a platform route', () => {
      const outcome = runProxyPipeline(createRequest('/pricingxyz'));

      // It must flow through the regular tenant rewrite path.
      expect(outcome.kind).toBe('proceed');
      if (outcome.kind !== 'proceed') return;
      expect(outcome.rewriteUrl?.pathname).toBe('/tienda1/pricingxyz');
    });
  });

  describe('storefront behavior on tenant hosts is preserved', () => {
    test('/ keeps the slug rewrite (no redirect)', () => {
      const outcome = runProxyPipeline(createRequest('/'));

      expect(outcome.kind).toBe('proceed');
      if (outcome.kind !== 'proceed') return;
      expect(outcome.rewriteUrl?.pathname).toBe('/tienda1/');
    });

    test('/product/abc keeps the slug rewrite (no redirect)', () => {
      const outcome = runProxyPipeline(createRequest('/product/abc'));

      expect(outcome.kind).toBe('proceed');
      if (outcome.kind !== 'proceed') return;
      expect(outcome.rewriteUrl?.pathname).toBe('/tienda1/product/abc');
    });

    test('/terminos keeps the slug rewrite (no redirect)', () => {
      const outcome = runProxyPipeline(createRequest('/terminos'));

      expect(outcome.kind).toBe('proceed');
      if (outcome.kind !== 'proceed') return;
      expect(outcome.rewriteUrl?.pathname).toBe('/tienda1/terminos');
    });
  });

  describe('non-tenant hosts', () => {
    test('/pricing on the platform domain is not redirected by this logic', () => {
      const outcome = runProxyPipeline(createRequest('/pricing', PLATFORM_HOST));

      expect(outcome.kind).toBe('proceed');
      if (outcome.kind !== 'proceed') return;
      expect(outcome.rewriteUrl).toBeNull();
    });

    test('a tenant-looking host that is not a tenant host is not rewritten', () => {
      const outcome = runProxyPipeline(createRequest('/', 'evil-storelite.app'));

      expect(outcome.kind).toBe('proceed');
      if (outcome.kind !== 'proceed') return;
      expect(outcome.rewriteUrl).toBeNull();
    });
  });

  describe('API routes are never rewritten', () => {
    test('/api/order/lookup is not rewritten to /{slug}/api/...', () => {
      const outcome = runProxyPipeline(createRequest('/api/order/lookup'));

      expect(outcome.kind).toBe('proceed');
      if (outcome.kind !== 'proceed') return;
      expect(outcome.rewriteUrl).toBeNull();
    });
  });

  describe('rate limiting buckets', () => {
    test('/auth/* is charged against the auth bucket', () => {
      runProxyPipeline(createRequest('/auth/login'));

      expect(mockCheckRateLimit).toHaveBeenCalledWith('test-client-ip', { bucket: 'auth' });
    });

    test('/api/* is charged against the api bucket', () => {
      runProxyPipeline(createRequest('/api/products'));

      expect(mockCheckRateLimit).toHaveBeenCalledWith('test-client-ip', { bucket: 'api' });
    });

    test('the storefront is not rate limited at the edge', () => {
      runProxyPipeline(createRequest('/product/abc'));

      expect(mockCheckRateLimit).not.toHaveBeenCalled();
    });

    test('an exhausted bucket short-circuits before any tenancy work', () => {
      mockCheckRateLimit.mockReturnValue({ allowed: false, resetInMs: 42_000 });

      const outcome = runProxyPipeline(createRequest('/auth/login'));

      expect(outcome).toEqual({
        kind: 'rateLimited',
        retryAfterSeconds: 42,
        resetAfterSeconds: 42,
      });
    });
  });
});
