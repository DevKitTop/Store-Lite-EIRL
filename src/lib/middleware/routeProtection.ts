// =====================================================
// ROUTE PROTECTION — pure storefront gate decisions
// =====================================================
// Decision module for the logged-out storefront gate in the root proxy.ts.
// Deliberately free of request/response objects and Supabase so the rules can
// be tested in isolation.
//
// The platform-path list is NOT duplicated here: `isPlatformOnlyPath` is
// imported from the pipeline so both layers stay in sync when a platform
// route is added.
//
// The redirect-target sanitizer is NOT defined here either: it lives in
// `@/shared/utils/redirectTarget` so the auth callback can re-validate the
// `?redirect=` param without importing this module — which would drag the
// middleware pipeline, the rate limiter and the env config into that route's
// bundle. Re-exported below to keep a single import surface for the gate.
// =====================================

import { sanitizeRedirectTarget } from '@/shared/utils/redirectTarget';
import { isPlatformOnlyPath } from './proxyPipeline';

export { sanitizeRedirectTarget };

/** `/{slug}/product/...` and `/{slug}/order/...` are public at ANY depth. */
const PUBLIC_PREFIX_SEGMENTS = new Set(['product', 'order']);

/** Public storefront pages that exist exactly at `/{slug}/{page}`. */
const PUBLIC_EXACT_SEGMENTS = new Set([
  'devoluciones',
  'libro-reclamaciones',
  'terminos',
  'privacidad',
  'robots.txt',
  'sitemap.xml',
]);

/**
 * True only for storefront paths (first segment is a tenant slug) that a
 * logged-out visitor must be able to reach. Everything else — including
 * platform paths, which the caller can tell apart because this returns false
 * for them — returns false.
 *
 * NOTE: `/{slug}/order/...` matches by PREFIX on purpose. Order verification
 * lives at `/{slug}/order/verify/{orderNumber}` (4 segments); a segment-count
 * rule would silently lock paying customers out of their own order status.
 *
 * NOTE: static assets such as `/{slug}/robots.txt` also appear here for
 * completeness of the allow-list, although the entry point already skips any
 * path containing a dot before the session layer runs.
 */
export function isPublicStorefrontPath(pathname: string): boolean {
  if (isPlatformOnlyPath(pathname)) return false;

  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return false;
  if (segments.length === 1) return true;

  const second = segments[1];
  if (PUBLIC_PREFIX_SEGMENTS.has(second)) return true;
  if (segments.length === 2 && PUBLIC_EXACT_SEGMENTS.has(second)) return true;

  return false;
}

/**
 * Builds the login path for a blocked request: `/auth?redirect=<target>`,
 * where `<target>` is the encoded `pathname + search` of the original URL.
 * The target is sanitized first (defense in depth) and falls back to `/` if
 * it somehow fails validation.
 */
export function buildLoginRedirectPath(originalUrl: URL): string {
  const safeTarget = sanitizeRedirectTarget(`${originalUrl.pathname}${originalUrl.search}`) ?? '/';
  return `/auth?redirect=${encodeURIComponent(safeTarget)}`;
}
