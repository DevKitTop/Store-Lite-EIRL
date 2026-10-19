// =====================================================
// SECURITY HEADERS — Unit tests
// =====================================================
// Covers the CSP builder extracted from the middleware entry point.
// =====================================================

import { describe, expect, test } from 'vitest';
import { buildCsp, createCspNonce } from '../../src/lib/middleware/securityHeaders';

describe('createCspNonce', () => {
  test('produces a base64 value with no whitespace', () => {
    const nonce = createCspNonce();

    expect(nonce).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(nonce).not.toMatch(/\s/);
  });

  test('produces a different value on each call', () => {
    const nonces = new Set(Array.from({ length: 50 }, () => createCspNonce()));

    expect(nonces.size).toBe(50);
  });
});

describe('buildCsp', () => {
  const nonce = 'test-nonce-value';
  const prodCsp = buildCsp(nonce, false);
  const devCsp = buildCsp(nonce, true);

  test('binds the nonce and keeps strict-dynamic', () => {
    expect(prodCsp).toContain(`'nonce-${nonce}'`);
    expect(prodCsp).toContain("'strict-dynamic'");
  });

  test('allows unsafe-eval only outside production', () => {
    expect(prodCsp).not.toContain("'unsafe-eval'");
    expect(devCsp).toContain("'unsafe-eval'");
  });

  test('locks down the dangerous directives', () => {
    expect(prodCsp).toContain("default-src 'self'");
    expect(prodCsp).toContain("base-uri 'self'");
    expect(prodCsp).toContain("frame-ancestors 'none'");
  });

  test('keeps the third-party integrations the app depends on', () => {
    expect(prodCsp).toContain('https://checkout.culqi.com');
    expect(prodCsp).toContain('https://*.posthog.com');
    expect(prodCsp).toContain('wss://*.supabase.co');
    expect(prodCsp).toContain('https://connect.facebook.net');
  });

  test('does not collapse directives when a nonce is long', () => {
    const longCsp = buildCsp(createCspNonce(), false);

    expect(longCsp).toContain('; ');
    expect(longCsp).not.toMatch(/; {2,}/);
    expect(longCsp).not.toMatch(/\s{2,}/);
  });
});
