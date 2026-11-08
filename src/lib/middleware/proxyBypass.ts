// =====================================================
// PROXY BYPASS — paths that must never be treated as app routes
// =====================================================
// Extracted from the proxy entry point so the rule is unit-testable
// without booting a server.
//
// Why PostHog needs an entry here: analytics is proxied through
// `/ingest/*` rewrites. Its capture endpoint (`/ingest/i/v0/e`) has no
// file extension, so the dotted-path shortcut below did not cover it and
// the request fell through to tenancy, which answered `302 /auth`. The
// SDK received HTML instead of `{"status":"Ok"}` and every event was lost.
//
// WARNING: this module must NOT be named middleware.ts / proxy.ts.
// Next.js treats those filenames as entry points.
// =====================================================

/** Prefixes owned by Next.js or the public asset handler. */
const BYPASS_PREFIXES = ['/_next', '/static'] as const;

/**
 * Third-party tunnels. Matched exactly or as a parent segment so lookalike
 * routes such as `/ingestion` keep normal behaviour.
 *
 * `/monitoring` is the Sentry tunnel route declared by `tunnelRoute` in
 * next.config.ts. Tenancy answered it with `302 /auth`, so every Sentry
 * envelope was redirected to the login page instead of being forwarded.
 */
const BYPASS_SEGMENTS = ['/ingest', '/monitoring'] as const;

/**
 * True when the request must skip rate limiting, tenancy, CSP and the
 * session layer: Next internals, static assets, and the PostHog proxy.
 */
export function shouldBypassProxy(pathname: string): boolean {
  if (BYPASS_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }

  if (
    BYPASS_SEGMENTS.some((segment) => pathname === segment || pathname.startsWith(`${segment}/`))
  ) {
    return true;
  }

  return pathname.includes('.');
}
