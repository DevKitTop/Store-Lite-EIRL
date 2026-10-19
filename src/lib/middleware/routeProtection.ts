// =====================================================
// ROUTE PROTECTION — pure storefront gate decisions
// =====================================================
// Decision module for the logged-out storefront gate in the root proxy.ts.
// Deliberately free of request/response objects and Supabase so the rules can
// be tested in isolation and reused by the auth callback (post-login return).
//
// The platform-path list is NOT duplicated here: `isPlatformOnlyPath` is
// imported from the pipeline so both layers stay in sync when a platform
// route is added.
// =====================================

import { isPlatformOnlyPath } from './proxyPipeline';

/** Maximum accepted length for a redirect target (defense against header bloat). */
const MAX_REDIRECT_TARGET_LENGTH = 512;

/**
 * C0 controls (incl. CR/LF), DEL, and the Unicode line/paragraph separators.
 * The separators are built via String.fromCharCode so no literal U+2028/U+2029
 * ever appears in the source (they are valid in JS strings but break tooling
 * that splits on visual lines).
 */
const DISALLOWED_CODEPOINTS = new Set<number>([
  ...Array.from({ length: 0x20 }, (_, index) => index),
  0x7f,
  ...Array.from(String.fromCharCode(0x2028, 0x2029), (char) => char.charCodeAt(0)),
]);

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

/**
 * Validates a post-login return target and returns it as a same-origin
 * relative `pathname + search` string, or null when the value is not safe.
 *
 * Rejects: empty values, anything without a leading slash, protocol-relative
 * URLs (`//host`, `/\host`), any backslash, control characters and Unicode
 * line separators (CRLF header injection), scheme smuggling (`:` before the
 * first `/` after the leading one), oversized values, and the login route
 * itself (redirect-loop guard).
 */
export function sanitizeRedirectTarget(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.length > MAX_REDIRECT_TARGET_LENGTH) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (raw.includes('\\')) return null;

  for (let index = 0; index < raw.length; index += 1) {
    if (DISALLOWED_CODEPOINTS.has(raw.charCodeAt(index))) return null;
  }

  // Scheme smuggling: a ':' before the first '/' after the leading slash
  // ("/javascript:alert(1)", "/\x01javascript:..." — the latter is already
  // caught by the control-character check above).
  const afterLeadingSlash = raw.slice(1);
  const nextSlashIndex = afterLeadingSlash.indexOf('/');
  const head =
    nextSlashIndex === -1 ? afterLeadingSlash : afterLeadingSlash.slice(0, nextSlashIndex);
  if (head.includes(':')) return null;

  // Never bounce back into login: /auth, /auth/... and /auth?... would loop.
  const pathPart = raw.split(/[?#]/, 1)[0];
  if (pathPart === '/auth' || pathPart.startsWith('/auth/')) return null;

  return raw;
}
