// =====================================================
// SUPABASE PROXY (updateProxy) — Unit tests
// =====================================================
// ⚠️ WIRING WARNING: `updateProxy` is NOT called by the running middleware.
// These tests prove the protection RULES are correct in isolation — they pass
// whether or not the function is ever invoked. Live wiring is covered by
// tests/unit/middlewareComposition.test.ts.
//
// Verifies the session-layer route protection rules:
// - /pricing is PUBLIC for anonymous visitors (SEO requirement:
//   crawlers must see plan prices without a session)
// - Protected routes still redirect anonymous users to /auth
// - Authenticated users are redirected from / to /onboarding
// - Legal pages (incl. /privacidad) stay public when reached via
//   tenant-host rewrites (/slug/privacidad)
// =====================================================

import type { NextResponse } from 'next/server';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { updateProxy } from '../../src/lib/supabase/proxy';

// ── Mocks (must be before module imports — vi.mock is hoisted) ──

const mockGetUser = vi.fn();
const mockFromSelectEq = vi.fn();

vi.mock('@/config/env', () => ({
  env: {
    sharedCookieDomain: undefined,
    featureSubdomainRewrite: true,
    nextPublicAppUrl: 'https://storelite.app',
  },
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
    },
    from: () => ({
      select: () => ({
        eq: mockFromSelectEq,
      }),
    }),
  })),
}));

// ── Helpers ──────────────────────────────────────────

function createRequest(pathWithQuery: string): NextRequest {
  return new NextRequest(`https://storelite.app${pathWithQuery}`);
}

function expectRedirectTo(response: NextResponse, expectedPath: string) {
  const location = response.headers.get('location');
  expect(location).not.toBeNull();
  expect(location).toBe(`https://storelite.app${expectedPath}`);
  return response;
}

async function callUpdateProxy(request: NextRequest): Promise<NextResponse> {
  return updateProxy(request);
}

// ── Suite ────────────────────────────────────────────

describe('updateProxy — route protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockFromSelectEq.mockResolvedValue({ data: [], error: null });
  });

  describe('anonymous users', () => {
    test('/pricing is PUBLIC — no redirect to /auth', async () => {
      const response = await callUpdateProxy(createRequest('/pricing'));

      expect(response.headers.get('location')).toBeNull();
      expect(response.status).not.toBe(301);
      expect(response.status).not.toBe(302);
      expect(response.status).not.toBe(307);
    });

    test('/pricing keeps its query string and does not redirect', async () => {
      const response = await callUpdateProxy(createRequest('/pricing?slug=mi-tienda'));

      expect(response.headers.get('location')).toBeNull();
    });

    test('/list-business still requires auth — redirected to /auth', async () => {
      const response = await callUpdateProxy(createRequest('/list-business'));

      expectRedirectTo(response, '/auth');
    });

    test('tenant-rewritten /slug/privacidad stays public (legal page)', async () => {
      const request = createRequest('/');
      // Simulate the root proxy mutation for tenant hosts.
      request.nextUrl.pathname = '/mi-tienda/privacidad';

      const response = await callUpdateProxy(request);

      expect(response.headers.get('location')).toBeNull();
    });
  });

  describe('authenticated users', () => {
    beforeEach(() => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    });

    test('/ still redirects to /onboarding (business flow preserved)', async () => {
      const response = await callUpdateProxy(createRequest('/'));

      expectRedirectTo(response, '/onboarding');
    });

    test('/pricing does NOT trigger the /onboarding redirect', async () => {
      const response = await callUpdateProxy(createRequest('/pricing'));

      expect(response.headers.get('location')).toBeNull();
    });
  });
});
