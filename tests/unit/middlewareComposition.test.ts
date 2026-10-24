// =====================================================
// MIDDLEWARE COMPOSITION — the wiring test
// =====================================================
// The previous architecture had a root-level proxy.ts that Next.js never
// executed. Every unit test of its helper functions passed anyway, because they
// imported the functions directly. Nothing caught the fact that the code was
// dead.
//
// These tests call the REAL entry point (`proxy()` from the root ./proxy.ts)
// and assert on the response that would go out. They fail if the tenancy,
// CSP/nonce and rate-limit layers ever stop being reachable from the entry —
// which is the only failure mode that matters.
// =====================================================

import type * as RateLimitModule from '@/lib/rateLimit';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const mockGetUser = vi.hoisted(() => vi.fn());
const mockCheckRateLimit = vi.hoisted(() => vi.fn());

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser: mockGetUser } })),
}));

// Keeps RATE_LIMITS and getClientIdentifier real so the bucket mapping is
// exercised; only the limiter decision is stubbed.
vi.mock('@/lib/rateLimit', async (importOriginal) => {
  const actual = await importOriginal<RateLimitModule>();
  return { ...actual, checkRateLimit: mockCheckRateLimit };
});

vi.mock('@/config/env', () => ({
  env: {
    featureSubdomainRewrite: true,
    nextPublicAppUrl: 'https://storelite.app',
    sharedCookieDomain: null,
  },
}));

import proxy from '../../proxy';

const TENANT_HOST = 'tienda1.storelite.app';
const PLATFORM_HOST = 'storelite.app';

function createRequest(path: string, host: string = TENANT_HOST): NextRequest {
  return new NextRequest(`https://${host}${path}`);
}

describe('middleware entry point — layers are reachable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockCheckRateLimit.mockReturnValue({ allowed: true, resetInMs: 60_000 });
  });

  describe('tenant subdomain rewrite (the feature that was dead)', () => {
    test('a tenant host request rewrites to /{slug} instead of serving the landing page', async () => {
      const response = await proxy(createRequest('/'));

      // Next signals a rewrite to the routing layer with x-middleware-rewrite.
      expect(response.headers.get('x-middleware-rewrite')).toContain('/tienda1');
      expect(response.headers.get('location')).toBeNull();
    });

    test('a tenant host does NOT redirect an anonymous visitor to /onboarding', async () => {
      const response = await proxy(createRequest('/'));

      expect(response.status).not.toBe(302);
      expect(response.status).not.toBe(307);
      expect(response.headers.get('location')).toBeNull();
    });

    test('storefront sub-paths keep the slug rewrite', async () => {
      const response = await proxy(createRequest('/product/abc'));

      expect(response.headers.get('x-middleware-rewrite')).toContain('/tienda1/product/abc');
    });

    test('a platform host is not rewritten', async () => {
      const response = await proxy(createRequest('/', PLATFORM_HOST));

      expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    });
  });

  describe('CSP + nonce are applied by the entry point', () => {
    test('a rendered page carries a per-request nonce in both request and response', async () => {
      const response = await proxy(createRequest('/', PLATFORM_HOST));

      const nonce = response.headers.get('x-nonce');
      const csp = response.headers.get('Content-Security-Policy');

      expect(nonce).toBeTruthy();
      expect(csp).toContain(`'nonce-${nonce}'`);
      expect(csp).toContain("'strict-dynamic'");
    });

    test('the nonce differs between requests', async () => {
      const first = await proxy(createRequest('/', PLATFORM_HOST));
      const second = await proxy(createRequest('/', PLATFORM_HOST));

      expect(first.headers.get('x-nonce')).not.toBe(second.headers.get('x-nonce'));
    });

    test('a rewritten storefront response also carries the CSP', async () => {
      const response = await proxy(createRequest('/'));

      expect(response.headers.get('Content-Security-Policy')).toContain("'strict-dynamic'");
    });
  });

  describe('rate limiting is reachable', () => {
    test('an exhausted auth bucket returns 429 with retry headers', async () => {
      mockCheckRateLimit.mockReturnValue({ allowed: false, resetInMs: 5_000 });

      const response = await proxy(createRequest('/auth/login'));

      expect(response.status).toBe(429);
      expect(response.headers.get('Retry-After')).toBe('5');
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
      await expect(response.json()).resolves.toEqual({
        error: 'Too many requests. Please try again later.',
      });
    });

    test('/api/* is rate limited too, but stays free of CSP and session work', async () => {
      const allowed = await proxy(createRequest('/api/order/lookup'));

      expect(mockCheckRateLimit).toHaveBeenCalled();
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get('Content-Security-Policy')).toBeNull();
      expect(allowed.headers.get('x-nonce')).toBeNull();

      mockCheckRateLimit.mockReturnValue({ allowed: false, resetInMs: 1_000 });
      const blocked = await proxy(createRequest('/api/order/lookup'));

      expect(blocked.status).toBe(429);
    });
  });

  describe('platform-only routes on a tenant host', () => {
    test('/pricing is redirected to the platform domain', async () => {
      const response = await proxy(createRequest('/pricing'));

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('https://storelite.app/pricing');
    });
  });

  describe('logged-out storefront gate (route protection)', () => {
    test('a logged-out request to /{slug}/dashboard redirects to /auth with the original path', async () => {
      const response = await proxy(createRequest('/tienda1/dashboard', PLATFORM_HOST));

      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      expect(location).toContain('/auth?redirect=');
      expect(new URL(location!).searchParams.get('redirect')).toBe('/tienda1/dashboard');
    });

    test('the gate evaluates the rewritten path on a tenant subdomain', async () => {
      const response = await proxy(createRequest('/dashboard'));

      const location = response.headers.get('location');
      expect(location).toContain('/auth?redirect=');
      expect(new URL(location!).searchParams.get('redirect')).toBe('/tienda1/dashboard');
    });

    test('the blocked redirect is never cacheable: no-store + Vary: Cookie', async () => {
      const response = await proxy(createRequest('/tienda1/dashboard', PLATFORM_HOST));

      expect(response.status).toBe(302);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('vary')?.toLowerCase()).toContain('cookie');
    });

    test('deny-by-default: an unknown multi-segment path lands on login, not 404', async () => {
      const response = await proxy(createRequest('/beta/foo', PLATFORM_HOST));

      expect(response.status).toBe(302);
      const location = response.headers.get('location');
      expect(location).toContain('/auth?redirect=');
      expect(new URL(location!).searchParams.get('redirect')).toBe('/beta/foo');
    });

    test('a logged-out request to /{slug}/order/verify/{orderNumber} is NOT redirected', async () => {
      const response = await proxy(createRequest('/tienda1/order/verify/ORD-45', PLATFORM_HOST));

      expect(response.headers.get('location')).toBeNull();
      expect(response.status).not.toBe(302);
    });

    test('a logged-in request to /{slug}/dashboard is NOT redirected', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

      const response = await proxy(createRequest('/tienda1/dashboard', PLATFORM_HOST));

      expect(response.headers.get('location')).toBeNull();
      expect(response.status).toBe(200);
    });

    test('/pricing stays reachable while logged out', async () => {
      const response = await proxy(createRequest('/pricing', PLATFORM_HOST));

      expect(response.headers.get('location')).toBeNull();
    });

    test('static assets are never bounced to login', async () => {
      const response = await proxy(createRequest('/tienda1/dashboard.png', PLATFORM_HOST));

      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
    });
  });
});
