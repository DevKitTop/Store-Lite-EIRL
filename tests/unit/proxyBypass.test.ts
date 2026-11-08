// =====================================================
// PROXY BYPASS — Unit tests
// =====================================================
// The proxy entry point skips paths that must never be treated as
// storefront routes. PostHog ingestion lives under /ingest, and its
// capture endpoint (/ingest/i/v0/e) has no file extension, so it used to
// fall through to the tenancy layer and get redirected to /auth.
// =====================================================

import { describe, expect, test } from 'vitest';
import { shouldBypassProxy } from '../../src/lib/middleware/proxyBypass';

describe('shouldBypassProxy', () => {
  test('lets the PostHog capture endpoint reach the /ingest rewrite', () => {
    expect(shouldBypassProxy('/ingest/i/v0/e')).toBe(true);
    expect(shouldBypassProxy('/ingest/i/v0/e/')).toBe(true);
  });

  test('lets PostHog remote config and static assets through', () => {
    expect(shouldBypassProxy('/ingest/array/phc_token/config.js')).toBe(true);
    expect(shouldBypassProxy('/ingest/static/web-vitals.js')).toBe(true);
  });

  test('still skips Next internals and dotted asset paths', () => {
    expect(shouldBypassProxy('/_next/static/chunks/main.js')).toBe(true);
    expect(shouldBypassProxy('/static/logo.png')).toBe(true);
    expect(shouldBypassProxy('/favicon.ico')).toBe(true);
  });

  test('does not bypass real storefront and API routes', () => {
    expect(shouldBypassProxy('/')).toBe(false);
    expect(shouldBypassProxy('/demo-store')).toBe(false);
    expect(shouldBypassProxy('/auth')).toBe(false);
    expect(shouldBypassProxy('/api/checkout')).toBe(false);
  });

  test('does not bypass lookalike prefixes', () => {
    expect(shouldBypassProxy('/ingestion')).toBe(false);
    expect(shouldBypassProxy('/ingestible')).toBe(false);
  });
});
