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
 * Segment of the coarse verify bucket. Fixed, so the key is INDEPENDENT of the
 * attacker-controlled `orderNumber` — rotating that segment cannot mint a fresh
 * budget. This is the property `RATE_LIMITS.storefront` cannot provide.
 */
const VERIFY_IP_SEGMENT = '__ip__';

/** Normalizes an attacker-supplied identifier to a bounded, safe key segment. */
function normalizeSegment(value: unknown): string {
  return typeof value === 'string' && value.length > 0
    ? value.slice(0, MAX_DNI_KEY_LENGTH)
    : MISSING_DNI;
}

/**
 * Composes the limiter identifier for a DNI+orderNumber request.
 * `dni` is read from the RAW body (pre-zod) and truncated to 64 chars;
 * anything missing, empty or non-string collapses into one per-IP bucket.
 */
export function buildOrderAccessIdentifier(clientIp: string, rawBody: unknown): string {
  const dni = (rawBody as { dni?: unknown } | null | undefined)?.dni;
  return `${clientIp}:dni:${normalizeSegment(dni)}`;
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
 * Counts the request against the `(clientId, dni)` bucket for token-based order
 * access. Used by the `order/[token]` actions to rate-limit reauthentication /
 * access attempts on the SAME shared auth-intent primitive as
 * `POST /api/order/lookup`.
 *
 * `dni` is preferred; `orderNumber` is the fallback so a caller that supplies
 * only one of the two still lands in a deterministic bucket.
 */
export function checkOrderAccessRateLimitFor(
  clientId: string,
  params: { dni?: string | null; orderNumber?: string | null } = {},
): { allowed: boolean; remaining: number; resetInMs: number } {
  const identifier = params.dni ?? params.orderNumber;
  return checkRateLimit(`${clientId}:dni:${normalizeSegment(identifier)}`, RATE_LIMITS.auth);
}

/**
 * Refunds the caller's own `(clientId, dni)` budget after a VERIFIED access, so
 * a successful buyer starts a fresh window. The reset is scoped to exactly the
 * key `checkOrderAccessRateLimitFor` charged — a sibling `dni` keeps whatever
 * budget it had (design D8), and a failed guess is never refunded because the
 * reset only runs on the success path.
 */
export function resetOrderAccessRateLimit(
  clientId: string,
  params: { dni?: string | null; orderNumber?: string | null } = {},
): void {
  const identifier = params.dni ?? params.orderNumber;
  resetRateLimit(`${clientId}:dni:${normalizeSegment(identifier)}`, RATE_LIMITS.auth);
}

/**
 * Coarse, per-IP identifier for the order-verification page. Deliberately
 * ignores `orderNumber`, so one IP shares a single budget across every order it
 * probes.
 */
export function buildOrderVerifyIpIdentifier(clientIp: string): string {
  return `${clientIp}:verify:${VERIFY_IP_SEGMENT}`;
}

/**
 * Fine identifier for the order-verification page, keyed `(IP, orderNumber)`.
 */
export function buildOrderVerifyIdentifier(clientIp: string, orderNumber: string): string {
  return `${clientIp}:verify:${normalizeSegment(orderNumber)}`;
}

/**
 * Dual-key throttle for the order-verification page (R23):
 *   1. a coarse per-IP ceiling (`RATE_LIMITS.orderVerifyIp`) charged on EVERY
 *      request, independent of the order number, and
 *   2. a fine per-`(IP, orderNumber)` bucket (`RATE_LIMITS.storefront`).
 * The coarse bucket is spent first and short-circuits: once it is exhausted the
 * fine bucket is not charged, so rotating `orderNumber` cannot escape.
 */
export function checkOrderVerifyRateLimits(
  clientIp: string,
  orderNumber: string,
): { allowed: boolean; remaining: number; resetInMs: number } {
  const coarse = checkRateLimit(buildOrderVerifyIpIdentifier(clientIp), RATE_LIMITS.orderVerifyIp);
  if (!coarse.allowed) {
    return { allowed: false, remaining: 0, resetInMs: coarse.resetInMs };
  }

  const fine = checkRateLimit(
    buildOrderVerifyIdentifier(clientIp, orderNumber),
    RATE_LIMITS.storefront,
  );
  if (!fine.allowed) {
    return { allowed: false, remaining: 0, resetInMs: fine.resetInMs };
  }

  return {
    allowed: true,
    remaining: Math.min(coarse.remaining, fine.remaining),
    resetInMs: Math.min(coarse.resetInMs, fine.resetInMs),
  };
}
