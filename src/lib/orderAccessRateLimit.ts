// =====================================================
// C11 — AUTH-INTENT RATE LIMIT FOR DNI + ORDER-NUMBER LOOKUPS
// =====================================================
// The unauthenticated storefront surface (POST /api/order/lookup) turns
// `{ dni, orderNumber }` into a tracking token, so it is a guessing oracle.
//
// Keyed `(IP, dni)` instead of IP alone (design.md D2):
//   * per-IP only  → one attacker locks out a whole NAT / mobile egress
//   * per-dni only → meaningless, dni is attacker-supplied
// The per-IP backstop for enumeration across many dnis is the proxy's
// `RATE_LIMITS.api` bucket on `/api/*` (proxy.ts:38-44).
//
// The check MUST run before zod validation: after zod, a brute-forcer would
// only pay for well-formed guesses and the limit would never bite.
// =====================================================

import { checkRateLimit, getClientIdentifier, RATE_LIMITS, resetRateLimit } from '@/lib/rateLimit';
import { type NextRequest } from 'next/server';

/** Bucket segment used when the body carries no usable `dni`. */
const MISSING_DNI = '__missing__';

/** Bounds the limiter store key — `dni` is attacker-controlled and unbounded. */
const MAX_DNI_KEY_LENGTH = 64;

/**
 * Composes the limiter identifier for a DNI+orderNumber request.
 * `dni` is read from the RAW body (pre-zod) and truncated to 64 chars;
 * anything missing, empty or non-string collapses into one per-IP bucket.
 */
export function buildOrderAccessIdentifier(clientIp: string, rawBody: unknown): string {
  const dni = (rawBody as { dni?: unknown } | null | undefined)?.dni;
  const segment =
    typeof dni === 'string' && dni.length > 0 ? dni.slice(0, MAX_DNI_KEY_LENGTH) : MISSING_DNI;

  return `${clientIp}:dni:${segment}`;
}

/** Result of an auth-intent limiter check — the shared primitive's own shape. */
export interface OrderAccessRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
}

/**
 * Counts a lookup against the `(clientId, dni)` bucket using the existing
 * `RATE_LIMITS.auth` primitive (src/lib/rateLimit.ts:25,53).
 * `checkRateLimit` appends `:${windowMs}` internally, so composite keys compose
 * safely.
 *
 * Takes the already-resolved client id so callers WITHOUT a `NextRequest` (a
 * `'use server'` action reads `await headers()`) can charge the SAME bucket the
 * route charges, instead of growing a second counter store.
 */
export function checkOrderAccessRateLimitFor(
  clientId: string,
  rawBody: unknown,
): OrderAccessRateLimitResult {
  return checkRateLimit(buildOrderAccessIdentifier(clientId, rawBody), RATE_LIMITS.auth);
}

/**
 * Refunds the `(clientId, dni)` bucket charged by `checkOrderAccessRateLimitFor`.
 * Scoped by construction: a different `dni` composes a different key, so a
 * verified buyer never clears somebody else's budget.
 */
export function resetOrderAccessRateLimit(clientId: string, rawBody: unknown): void {
  resetRateLimit(buildOrderAccessIdentifier(clientId, rawBody), RATE_LIMITS.auth);
}

/**
 * Counts the request against the `(IP, dni)` bucket.
 * `NextRequest`-only entry point — delegates so the identifier is composed in
 * exactly one place.
 */
export function checkOrderAccessRateLimit(
  request: NextRequest,
  rawBody: unknown,
): OrderAccessRateLimitResult {
  return checkOrderAccessRateLimitFor(getClientIdentifier(request), rawBody);
}
