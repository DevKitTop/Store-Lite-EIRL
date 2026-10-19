// =====================================================
// PROXY PIPELINE (rate limit + tenancy)
// =====================================================
// This module is deliberately NOT a Next.js entry point: it must not use a
// special filename (middleware.ts / proxy.ts). A second file with one of those
// names silently competes with the real entry point and Next.js picks one
// without warning — which is exactly how the previous root-level proxy.ts
// ended up never executing while looking authoritative.
//
// It is invoked by src/middleware.ts, which owns the HTTP layer (CSP/nonce,
// response construction) and the Supabase session layer.
//
// Pipeline order (matches the order in the entry point):
// 1. Edge rate limiting for /auth/* and /api/*
// 2. Platform-only routes arriving on a tenant subdomain -> 302 redirect
// 3. Subdomain storefront rewrite (Phase 2)
// =====================================

import { env } from '@/config/env';
import {
  checkRateLimit,
  getClientIdentifier,
  RATE_LIMITS,
  type RateLimitConfig,
} from '@/lib/rateLimit';
import { extractTenantSlugFromHost, isTenantHost } from '@/shared/utils/url';
import { type NextRequest } from 'next/server';

/**
 * Outcome of the pre-session part of the pipeline. The entry point owns the
 * translation to HTTP responses so this module stays free of response building.
 */
export type ProxyPipelineOutcome =
  | { kind: 'rateLimited'; retryAfterSeconds: number; resetAfterSeconds: number }
  | { kind: 'platformRedirect'; location: URL }
  | { kind: 'proceed'; rewriteUrl: URL | null };

/**
 * Runs the routing/abuse-control part of the middleware.
 *
 * ⚠️ Intentional side effect: when a tenant rewrite applies, it mutates
 * `request.nextUrl.pathname` to the internal `/{slug}/...` path so the
 * session layer (which runs afterwards) evaluates the real route instead of
 * the public one. The actual Next.js routing is done by the entry point with
 * `NextResponse.rewrite()` — `NextResponse.next()` is not enough, because
 * mutating `request.nextUrl` alone does not change what the App Router resolves.
 */
export function runProxyPipeline(request: NextRequest): ProxyPipelineOutcome {
  // ── 1. Rate limiting ──────────────────────────────────
  // Auth and API routes are rate-limited; the storefront is not.
  const rateLimitConfig = resolveRateLimitConfig(request.nextUrl.pathname);

  if (rateLimitConfig) {
    const result = checkRateLimit(getClientIdentifier(request), rateLimitConfig);

    if (!result.allowed) {
      const resetAfterSeconds = Math.ceil(result.resetInMs / 1000);
      return { kind: 'rateLimited', retryAfterSeconds: resetAfterSeconds, resetAfterSeconds };
    }
  }

  // ── 2. Platform-only routes on a tenant subdomain ──────
  const platformRedirect = getTenantPlatformRedirect(request);
  if (platformRedirect) {
    return { kind: 'platformRedirect', location: platformRedirect };
  }

  // ── 3. Subdomain storefront rewrite ────────────────────
  return { kind: 'proceed', rewriteUrl: getStorefrontRewriteUrl(request) };
}

/**
 * Maps a pathname to its rate limit bucket.
 * Only /auth/* and /api/* are limited at the edge.
 */
export function resolveRateLimitConfig(pathname: string): RateLimitConfig | null {
  if (pathname.startsWith('/auth/')) return RATE_LIMITS.auth;
  if (pathname.startsWith('/api/')) return RATE_LIMITS.api;
  return null;
}

/**
 * Real hostname of the request.
 *
 * In development `request.nextUrl.hostname` can be normalised to "localhost"
 * even when the browser sent "store-girl.localhost:3000" in the Host header.
 * Subdomain tenancy needs the real Host; using nextUrl.hostname makes the
 * pipeline blind to the subdomain and render the SaaS landing at "/" instead.
 */
export function getRequestHostname(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-host') ??
    request.headers.get('host') ??
    request.nextUrl.hostname
  );
}

/**
 * Route prefixes that only exist on the platform domain.
 * Matching is exact or by sub-path (/auth/customer yes, /authenticate no).
 */
const PLATFORM_ONLY_PREFIXES = [
  '/auth',
  '/pricing',
  '/created',
  '/list-business',
  '/onboarding',
] as const;

export function isPlatformOnlyPath(pathname: string): boolean {
  return PLATFORM_ONLY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * 302 redirect for platform-only routes requested through a tenant subdomain.
 *
 * Those routes do NOT exist under app/[slug]/..., so rewriting them to
 * /{slug}/... breaks: /auth stops being recognised as a public route (the
 * pathname mutation happens before it is evaluated) and the session layer
 * answers with a redirect to /auth → infinite loop; /pricing rewrites to a
 * non-existent route → 404. Redirecting to the platform domain preserves both
 * the pathname and the query string. Returns null when the request is not a
 * tenant request, the feature flag is off, or the path is a storefront route.
 */
function getTenantPlatformRedirect(request: NextRequest): URL | null {
  if (!env.featureSubdomainRewrite) return null;
  if (!isPlatformOnlyPath(request.nextUrl.pathname)) return null;

  const hostname = getRequestHostname(request);
  const slug = extractTenantSlugFromHost(hostname);
  if (!slug || !isTenantHost(hostname)) return null;

  return new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, env.nextPublicAppUrl);
}

/**
 * Rewrite target for a tenant subdomain's storefront, or null when the request
 * must not be rewritten (flag off, non-tenant host, /api/* route, or the slug
 * is already present in the path).
 *
 * ⚠️ Intentional side effect: mutates `request.nextUrl.pathname` to the internal
 * `/{slug}/...` path so the session layer evaluates the correct route.
 */
function getStorefrontRewriteUrl(request: NextRequest): URL | null {
  if (!env.featureSubdomainRewrite) return null;

  const hostname = getRequestHostname(request);
  const slug = extractTenantSlugFromHost(hostname);
  if (!slug || !isTenantHost(hostname)) return null;

  // /api/* routes live in app/api/... and must resolve at their canonical
  // path, not at /{slug}/api/... — rewriting them yields 404.
  if (request.nextUrl.pathname.startsWith('/api/')) return null;

  // Guard against double rewrite when the slug is already in the path.
  if (request.nextUrl.pathname.startsWith(`/${slug}`)) return null;

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = `/${slug}${request.nextUrl.pathname}`;

  request.nextUrl.pathname = rewriteUrl.pathname;

  return rewriteUrl;
}
