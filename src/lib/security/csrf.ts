/**
 * Same-origin checks for cookie-authenticated, state-changing route handlers.
 *
 * Web Push subscription endpoints carry capability URLs, so a cross-site
 * request must never be able to create or revoke one. This is the minimum
 * Origin / Sec-Fetch-Site baseline from the PWA T2.2 design. It is shared with
 * T2.8 so both mutation surfaces enforce the same rule.
 */

function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/** Origins that are allowed to call cookie-authenticated mutation routes. */
export function getAllowedOrigins(): Set<string> {
  const configured = [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXT_PUBLIC_AUTH_ORIGIN].filter(
    (value): value is string => Boolean(value),
  );

  const origins = configured
    .map(normalizeOrigin)
    .filter((value): value is string => value !== null);
  return new Set(origins);
}

/**
 * Rejects cross-site mutations. `Sec-Fetch-Site` wins when present; `same-site`
 * is intentionally rejected (only `same-origin` is considered safe here).
 * Origin/Referer are the fallback for clients that omit Fetch Metadata.
 */
export function isSameOriginRequest(request: Request): boolean {
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite) {
    return fetchSite === 'same-origin';
  }

  const allowed = getAllowedOrigins();
  const origin = normalizeOrigin(request.headers.get('origin'));
  if (origin) {
    return allowed.has(origin);
  }

  const referer = normalizeOrigin(request.headers.get('referer'));
  if (referer) {
    return allowed.has(referer);
  }

  return false;
}

/** JSON mutation routes must reject other content types before parsing. */
export function isJsonRequest(request: Request): boolean {
  const contentType = request.headers.get('content-type');
  if (!contentType) return false;
  return contentType.split(';')[0]?.trim().toLowerCase() === 'application/json';
}
