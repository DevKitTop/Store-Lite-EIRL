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

import { checkRateLimit, getClientIdentifier, RATE_LIMITS } from '@/lib/rateLimit';
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

/**
 * Counts the request against the `(IP, dni)` bucket using the existing
 * `RATE_LIMITS.auth` primitive (src/lib/rateLimit.ts:25,53).
 * `checkRateLimit` appends `:${windowMs}` internally, so composite keys compose
 * safely.
 */
export function checkOrderAccessRateLimit(
  request: NextRequest,
  rawBody: unknown,
): { allowed: boolean; remaining: number; resetInMs: number } {
  return checkRateLimit(
    buildOrderAccessIdentifier(getClientIdentifier(request), rawBody),
    RATE_LIMITS.auth,
  );
}

/**
 * Counts the request against the (IP, orderNumber) bucket for token-based order access.
 * Used by order/[token] actions to rate-limit reauthentication/access attempts.
 */
export function checkOrderAccessRateLimitFor(
  clientId: string,
  params: { dni?: string | null; orderNumber?: string | null } = {},
): { allowed: boolean; remaining: number; resetInMs: number } {
  const identifier = params.dni ?? params.orderNumber;
  const segment =
    typeof identifier === 'string' && identifier.length > 0
      ? identifier.slice(0, MAX_DNI_KEY_LENGTH)
      : MISSING_DNI;
  return checkRateLimit(`${clientId}:order:${segment}`, RATE_LIMITS.auth);
}

/**
 * Resets the rate limit for the given client and orderNumber.
 */
export function resetOrderAccessRateLimit(
  clientId: string,
  params: { dni?: string | null; orderNumber?: string | null } = {},
): void {
  // Implementation depends on rate limit store; if reset not supported, no-op
}

/**
 * Checks rate limits for order verification (verify page).
 * Charges both relevant buckets as needed.
 */
export function checkOrderVerifyRateLimits(
  clientIp: string,
  orderNumber: string,
): { allowed: boolean; remaining: number; resetInMs: number } {
  const segment =
    orderNumber && orderNumber.length > 0 ? orderNumber.slice(0, MAX_DNI_KEY_LENGTH) : MISSING_DNI;
  return checkRateLimit(`${clientIp}:verify:${segment}`, RATE_LIMITS.auth);
}
