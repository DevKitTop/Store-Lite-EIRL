// =====================================================
// REDIRECT TARGET — open-redirect safety
// =====================================================
// Pure, zero-dependency URL-safety utilities for redirect
// targets (post-login return). Moved out of middleware to
// avoid dragging pipeline/env/rate limit into route bundles.
// =====================================

/** Maximum accepted length for a redirect target (defense against header bloat). */
export const MAX_REDIRECT_TARGET_LENGTH = 512;

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

/**
 * True when `value` has a hostile shape for a same-origin redirect target:
 * no leading slash, protocol-relative prefixes (`//host`, `/\host`), any
 * backslash, control characters / Unicode line separators (header injection),
 * or scheme smuggling (`:` before the first `/` after the leading one).
 */
function hasHostileShape(value: string): boolean {
  if (!value.startsWith('/')) return true;
  if (value.startsWith('//') || value.startsWith('/\\')) return true;
  if (value.includes('\\')) return true;

  for (let index = 0; index < value.length; index += 1) {
    if (DISALLOWED_CODEPOINTS.has(value.charCodeAt(index))) return true;
  }

  // Scheme smuggling: a ':' before the first '/' after the leading slash
  // ("/javascript:alert(1)", "/\x01javascript:..." — the latter is already
  // caught by the control-character check above).
  const afterLeadingSlash = value.slice(1);
  const nextSlashIndex = afterLeadingSlash.indexOf('/');
  const head =
    nextSlashIndex === -1 ? afterLeadingSlash : afterLeadingSlash.slice(0, nextSlashIndex);
  return head.includes(':');
}

/**
 * Validates a post-login return target and returns the ORIGINAL, un-decoded
 * `pathname + search` string, or null when the value is not safe.
 *
 * Validation is applied to both the raw value and its percent-DECODED form
 * (decoded exactly once), so encoded smuggling such as `/%2f%2fevil.com`
 * (→ `//evil.com`) or `/%5c%5cevil.com` (→ `/\evil.com`) is rejected even
 * though the raw text contains no literal slash or backslash in the second
 * position. A malformed percent sequence (e.g. `/%zz`) fails to decode and is
 * rejected outright.
 *
 * Rejects: empty values, anything without a leading slash, protocol-relative
 * URLs (`//host`, `/\host`), any backslash, control characters and Unicode
 * line separators (CRLF header injection), scheme smuggling (`:` before the
 * first `/` after the leading one), oversized values, and the login route in
 * ANY casing (redirect-loop guard — `/AUTH` loops just like `/auth`).
 */
export function sanitizeRedirectTarget(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.length > MAX_REDIRECT_TARGET_LENGTH) return null;
  if (hasHostileShape(raw)) return null;

  // Percent-encoded smuggling: validate the once-decoded form too. Returning
  // the value stays raw-only — consumers never see the decoded string.
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null; // malformed %-sequence (e.g. "/%zz")
  }
  if (hasHostileShape(decoded)) return null;

  // Never bounce back into login: /auth, /auth/... and /auth?... would loop.
  // Checked on BOTH forms and case-insensitively: the platform route is
  // case-insensitive at runtime, and a once-decoded value ("/Auth%2Fcallback"
  // → "/Auth/callback") would otherwise slip past a raw-only check.
  const pathOnly = (value: string) => value.split(/[?#]/, 1)[0].toLowerCase();
  const isLoginPath = (path: string) => path === '/auth' || path.startsWith('/auth/');
  if (isLoginPath(pathOnly(raw)) || isLoginPath(pathOnly(decoded))) return null;

  return raw;
}

/**
 * Extracts a redirect query parameter from a location search string.
 * Pure, client-side helper intended for use in event handlers (no Suspense).
 * An absent or empty param is normalized to null.
 */
export function extractRedirectFromSearch(search: string): string | null {
  if (!search) return null;
  const value = new URLSearchParams(search).get('redirect');
  return value || null;
}

/**
 * Builds the OAuth callback URL, carrying `redirectTarget` only when it passes
 * `sanitizeRedirectTarget`.
 *
 * Always returns a usable URL: an invalid or absent target degrades to the
 * plain callback, which lands on the normal post-login destination. Returning
 * null would let a single crafted `?redirect=` value break sign-in for that
 * user — a convenience parameter must never be able to do that.
 */
export function buildAuthCallbackUrl(
  authOrigin: string,
  redirectTarget: string | null | undefined,
): string {
  const base = `${authOrigin}/auth/callback`;
  const sanitized = sanitizeRedirectTarget(redirectTarget);
  if (!sanitized) return base;
  return `${base}?redirect=${encodeURIComponent(sanitized)}`;
}
