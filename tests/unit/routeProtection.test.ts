// =====================================================
// ROUTE PROTECTION — unit tests
// =====================================================
// Verifies the pure decision module used by the logged-out storefront gate in
// the root proxy.ts: the public allow-list, the login redirect builder, and
// the open-redirect sanitizer.
//
// ⚠️ SCOPE: these tests exercise the module directly. They prove the DECISIONS
// are correct — not that the middleware applies them. That is what
// tests/unit/middlewareComposition.test.ts is for.
// =====================================================

import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks (must be before module imports — vi.mock is hoisted) ──
// routeProtection reuses the pipeline's platform-path list, so importing it
// transitively pulls in env + rateLimit the same way proxyPipeline.test.ts does.

vi.mock('@/config/env', () => ({
  env: {
    featureSubdomainRewrite: false,
    nextPublicAppUrl: 'https://storelite.app',
  },
}));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: vi.fn(),
  getClientIdentifier: vi.fn(() => 'test-client-ip'),
  RATE_LIMITS: { auth: { bucket: 'auth' }, api: { bucket: 'api' } },
}));

import {
  buildLoginRedirectPath,
  isPublicStorefrontPath,
  sanitizeRedirectTarget,
} from '../../src/lib/middleware/routeProtection';

beforeEach(() => {
  vi.clearAllMocks();
});

// ── isPublicStorefrontPath ────────────────────────────

describe('isPublicStorefrontPath — storefront allow-list', () => {
  describe('public paths a logged-out visitor must reach', () => {
    test.each([
      ['/tienda1', 'storefront home'],
      ['/tienda1/product/abc', 'product detail'],
      ['/tienda1/product/abc/gallery/2', 'product sub-path (prefix rule)'],
      ['/tienda1/order/tok123', 'order tracking by token'],
      ['/tienda1/order/verify/ORD-45', 'order verification — 4 segments, must stay public'],
      ['/tienda1/devoluciones', 'legal: returns policy'],
      ['/tienda1/libro-reclamaciones', 'legal: complaint book'],
      ['/tienda1/terminos', 'legal: terms'],
      ['/tienda1/privacidad', 'legal: privacy'],
      ['/tienda1/robots.txt', 'storefront robots'],
      ['/tienda1/sitemap.xml', 'storefront sitemap'],
    ])('%s is public (%s)', (pathname) => {
      expect(isPublicStorefrontPath(pathname)).toBe(true);
    });
  });

  describe('protected storefront paths (seller-only)', () => {
    test.each([
      ['/tienda1/dashboard'],
      ['/tienda1/dashboard/penalties'],
      ['/tienda1/dashboard/whatsapp'],
      ['/tienda1/settings'],
      ['/tienda1/storage'],
      ['/tienda1/notifications'],
      ['/tienda1/chat'],
      ['/tienda1/ayuda'],
      ['/tienda1/soporte'],
    ])('%s is NOT public', (pathname) => {
      expect(isPublicStorefrontPath(pathname)).toBe(false);
    });
  });

  describe('platform paths are not storefront paths', () => {
    test.each([
      ['/'],
      ['/pricing'],
      ['/auth'],
      ['/auth/callback'],
      ['/onboarding'],
      ['/list-business'],
      ['/api/x'],
    ])('%s is NOT a public storefront path', (pathname) => {
      expect(isPublicStorefrontPath(pathname)).toBe(false);
    });
  });
});

// ── buildLoginRedirectPath ────────────────────────────

describe('buildLoginRedirectPath', () => {
  test('encodes pathname + search as a redirect query parameter', () => {
    const original = new URL('https://storelite.app/tienda1/dashboard');

    expect(buildLoginRedirectPath(original)).toBe('/auth?redirect=%2Ftienda1%2Fdashboard');
  });

  test('round-trips a path with an encoded query string', () => {
    const original = new URL('https://tienda1.storelite.app/tienda1/product/abc?q=1%202&tab=x');
    const built = buildLoginRedirectPath(original);

    expect(built.startsWith('/auth?redirect=')).toBe(true);
    expect(new URL(built, 'https://storelite.app').searchParams.get('redirect')).toBe(
      '/tienda1/product/abc?q=1%202&tab=x',
    );
  });
});

// ── sanitizeRedirectTarget ────────────────────────────

describe('sanitizeRedirectTarget — open-redirect defense', () => {
  describe('accepts safe same-origin relative targets', () => {
    test.each([
      ['/tienda1/dashboard'],
      ['/dashboard?tab=x'],
      ['/tienda1/product/abc?q=1%202'],
      ['/tienda1/order/verify/ORD-45'],
    ])('%s is returned as-is', (raw) => {
      expect(sanitizeRedirectTarget(raw)).toBe(raw);
    });
  });

  describe('rejects absolute and protocol-relative URLs', () => {
    // Assembled at runtime: sonarjs flags clear-text "http://" and
    // "javascript:" literals even inside test fixtures.
    const insecureHttpUrl = ['http', '://evil.com/path'].join('');
    const javascriptScheme = ['java', 'script:alert(1)'].join('');

    test.each([
      ['//evil.com', 'protocol-relative URL'],
      ['//evil.com/path', 'protocol-relative URL with path'],
      ['https://evil.com', 'absolute https URL'],
      [insecureHttpUrl, 'absolute http URL'],
      [javascriptScheme, 'javascript scheme without leading slash'],
      ['/\\evil.com', 'backslash protocol-relative smuggling'],
      ['/path\\with\\backslash', 'backslash anywhere in the path'],
    ])('rejects %s (%s)', (raw) => {
      expect(sanitizeRedirectTarget(raw)).toBeNull();
    });
  });

  describe('rejects percent-encoded hostile shapes (checked after one decode)', () => {
    test.each([
      ['/%2f%2fevil.com', 'encoded protocol-relative //evil.com'],
      ['/%2F%2Fevil.com', 'encoded protocol-relative, uppercase hex'],
      ['/%5c%5cevil.com', 'encoded backslash protocol-relative'],
      ['/%5Cevil.com', 'encoded single-backslash form'],
      ['/%zz', 'malformed percent sequence'],
    ])('rejects %s (%s)', (raw) => {
      expect(sanitizeRedirectTarget(raw)).toBeNull();
    });
  });

  describe('accepts legitimately encoded paths (original returned, never the decoded form)', () => {
    test.each([['/tienda1/product/a%20b'], ['/tienda1/dashboard?a=1%202']])(
      'accepts %s and returns it unchanged',
      (raw) => {
        expect(sanitizeRedirectTarget(raw)).toBe(raw);
      },
    );
  });

  describe('rejects scheme smuggling after the leading slash', () => {
    test.each([
      ['/javascript:alert(1)'],
      ['/?next=javascript:alert(1)'],
      ['/tienda1;javascript:alert(1)'],
    ])('rejects %s', (raw) => {
      expect(sanitizeRedirectTarget(raw)).toBeNull();
    });
  });

  describe('rejects control characters and line separators', () => {
    test('rejects CRLF injection', () => {
      expect(sanitizeRedirectTarget('/path\r\nSet-Cookie: injected=1')).toBeNull();
    });

    test('rejects a bare CR', () => {
      expect(sanitizeRedirectTarget('/path\rmore')).toBeNull();
    });

    test('rejects U+2028 / U+2029 without literal separators in the source', () => {
      const lineSeparator = String.fromCharCode(0x2028);
      const paragraphSeparator = String.fromCharCode(0x2029);

      expect(sanitizeRedirectTarget(`/path${lineSeparator}x`)).toBeNull();
      expect(sanitizeRedirectTarget(`/path${paragraphSeparator}x`)).toBeNull();
    });
  });

  describe('rejects empty, non-relative and oversized values', () => {
    test.each([
      [null, 'null'],
      [undefined, 'undefined'],
      ['', 'empty string'],
      ['dashboard', 'missing leading slash'],
      ['tienda1/dashboard', 'relative path without leading slash'],
    ])('rejects %s (%s)', (raw) => {
      expect(sanitizeRedirectTarget(raw)).toBeNull();
    });

    test('rejects targets longer than 512 characters', () => {
      const overLimit = `/${'a'.repeat(512)}`;

      expect(overLimit.length).toBe(513);
      expect(sanitizeRedirectTarget(overLimit)).toBeNull();
    });

    test('accepts targets up to the 512-character limit', () => {
      const atLimit = `/${'a'.repeat(511)}`;

      expect(atLimit.length).toBe(512);
      expect(sanitizeRedirectTarget(atLimit)).toBe(atLimit);
    });
  });

  describe('rejects the login route to prevent redirect loops', () => {
    test.each([['/auth'], ['/auth/callback'], ['/auth?redirect=%2Fauth']])('rejects %s', (raw) => {
      expect(sanitizeRedirectTarget(raw)).toBeNull();
    });

    test.each([
      ['/AUTH', 'uppercase login route'],
      ['/Auth/callback', 'mixed-case auth callback'],
      ['/AUTH/CALLBACK', 'fully uppercase auth callback'],
    ])('rejects %s (case-insensitive loop guard)', (raw) => {
      expect(sanitizeRedirectTarget(raw)).toBeNull();
    });

    test('does not reject lookalike platform paths', () => {
      expect(sanitizeRedirectTarget('/authorize')).toBe('/authorize');
      expect(sanitizeRedirectTarget('/authentication-helper')).toBe('/authentication-helper');
    });
  });
});
