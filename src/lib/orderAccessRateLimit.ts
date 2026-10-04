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

// =====================================================
// R23 — RATE LIMIT FOR VERIFY PAGE (IP, orderNumber) + COARSE PER-IP BACKSTOP
// =====================================================
// The verify page is a Server Component with no `NextRequest`, so the client
// identity MUST come from `await headers()`. The key is `(IP, orderNumber)`
// through the established primitive `RATE_LIMITS.storefront` (60/min).
// No second counter store is introduced.
//
// ⚠️ THE FINE BUCKET ALONE IS BYPASSABLE, and this was measured, not assumed.
// With the key `(IP, orderNumber)` the attacker controls half of it. Rotating
// `orderNumber` from a single IP served 200/200 requests without the budget ever
// being exhausted; rotating the `x-forwarded-for` header did the same. R23 keeps
// the fine bucket because the spec mandates it, but the page ALSO has to satisfy
// a coarse per-IP bucket whose key contains no order number at all. Rotating
// `orderNumber` then buys the attacker nothing, because that bucket never moved.
//
// Two open findings are deliberately NOT closed here, and this limit must never be
// described as if it did close them (tasks.md:202-208):
//   * W-A3 — `getClientIdentifierFromHeaders` reads the LEFTMOST, client-supplied
//     `x-forwarded-for` hop and `proxy.ts` never rewrites it, so the coarse
//     bucket is still per-request spoofable by header rotation.
//   * W-I1 — the store is an in-memory `Map` per instance: neither shared nor
//     persistent across them.
// =====================================================

/**
 * Leading discriminator for every verify-page limiter key.
 *
 * It MUST sit BEFORE the client IP, not after it. Both the IP and the order
 * number are attacker-controlled (`x-forwarded-for` and the URL segment), so a
 * trailing discriminator is injectable. Concrete collision against a trailing
 * shape (`${ip}:order:${order}:order-verify` vs `${ip}:ip:order-verify`):
 * an attacker who sends `x-forwarded-for: A:ip` while browsing order number `ip`
 * builds the fine key `A:ip:order:ip:order-verify`, which is byte-identical to
 * the coarse key that plain IP `A:ip:order` would build. One request would then
 * charge a single shared counter twice, silently halving both ceilings.
 *
 * Anchoring a fixed word in the FIRST position makes that unrepresentable: a
 * coarse key is `order-verify:ip:${ip}` and a fine key is
 * `order-verify:order:${ip}:${order}`, so positions 1 and 2 are the fixed pair
 * `order-verify` + a literal discriminator. No attacker-supplied segment can
 * occupy either slot, because an IP containing `:` can only shift what follows
 * it, never what precedes it. Pinned behaviourally by
 * `orderAccessRateLimit.test.ts` ("no coarse/fine collision for hostile input").
 */
const ORDER_VERIFY_KEY_PREFIX = 'order-verify';

/** Bounds the limiter store key — `orderNumber` is attacker-controlled from the URL. */
const MAX_ORDER_NUMBER_KEY_LENGTH = 64;

/**
 * Composes the per-`(IP, orderNumber)` limiter identifier (R23).
 * `orderNumber` is read from the URL params and truncated to 64 chars.
 *
 * NOTE: this composes the FULL key. Callers must pass the RAW client IP — passing
 * an already-composed identifier here double-composes it. The page did exactly
 * that before this slice; `checkOrderVerifyRateLimits` now takes the raw IP so
 * there is no way to get it wrong.
 */
export function buildOrderVerifyIdentifier(clientIp: string, orderNumber: string): string {
  const segment =
    typeof orderNumber === 'string' && orderNumber.length > 0
      ? orderNumber.slice(0, MAX_ORDER_NUMBER_KEY_LENGTH)
      : '__missing__';

  return `${ORDER_VERIFY_KEY_PREFIX}:order:${clientIp}:${segment}`;
}

/**
 * Composes the coarse per-IP limiter identifier — the backstop for the bypass
 * above. Contains no order number, so it is stable across an enumeration run.
 */
export function buildOrderVerifyIpIdentifier(clientIp: string): string {
  return `${ORDER_VERIFY_KEY_PREFIX}:ip:${clientIp}`;
}

/** Result of a verify page rate limit check — reuses the shared primitive's shape. */
export interface OrderVerifyRateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInMs: number;
}

/**
 * Counts a verify page request against the `(clientIp, orderNumber)` bucket
 * using the shared `RATE_LIMITS.storefront` primitive (60/min).
 * No second counter store is introduced.
 */
export function checkOrderVerifyRateLimitFor(
  clientIp: string,
  orderNumber: string,
): OrderVerifyRateLimitResult {
  return checkRateLimit(buildOrderVerifyIdentifier(clientIp, orderNumber), RATE_LIMITS.storefront);
}

/**
 * Counts a verify page request against the COARSE per-IP bucket only.
 * Exported for symmetry with `checkOrderVerifyRateLimitFor`; the page should
 * prefer `checkOrderVerifyRateLimits`, which charges both atomically.
 */
export function checkOrderVerifyIpRateLimitFor(clientIp: string): OrderVerifyRateLimitResult {
  return checkRateLimit(buildOrderVerifyIpIdentifier(clientIp), RATE_LIMITS.orderVerifyIp);
}

/**
 * Charges BOTH buckets for one verify page request and reports the effective
 * verdict. This is the entry point the page MUST use: keeping the ordering
 * inside this function is what makes the pair atomic per request, where two
 * exported primitives would leave the order up to each caller.
 *
 * ORDERING — coarse first, deliberately, and the tradeoff is real.
 *
 * `checkRateLimit` is CHARGE-THEN-DECIDE: it increments the counter and only
 * then compares it against `maxRequests` (rateLimit.ts:87-89). A refusal
 * therefore still costs one unit for the remainder of the window — it is not a
 * free probe, and no code path here rolls the increment back. Given that, the
 * exact charging table is:
 *
 *   | outcome            | coarse bucket | fine bucket |
 *   |--------------------|---------------|-------------|
 *   | both pass          | charged       | charged     |
 *   | fine refuses       | charged       | charged     |
 *   | coarse refuses     | charged       | UNTOUCHED   |
 *
 *   * Coarse-first is what buys the middle-row saving: a coarse refusal does
 *     NOT consume per-order budget. Charging fine first would let a rotating
 *     attacker mint and burn a distinct per-order bucket on every one of the
 *     requests the coarse bucket was about to refuse anyway, filling the store
 *     with charges that bought the attacker nothing.
 *   * The accepted cost is the mirror image: a FINE refusal spends coarse
 *     budget too. A client hammering one already-exhausted order still walks
 *     down the shared per-IP ceiling. That is tolerable precisely because
 *     coarse (30/min) is the LOOSER of the two — it is the cheap ceiling, and
 *     spending it is what the ceiling is for.
 *   * Note this matches `/api/order/lookup`, which likewise charges first and
 *     refunds nothing (route.ts:21-35): a 429 there is also a charged request.
 *     R23 §3's "order-independent" clause constrains the RENDERED state, not
 *     the accounting — and this function charges nothing that reaches markup,
 *     since both verdicts render the same neutral page.
 *
 * When both pass, the tighter `remaining` and the later reset win, so the page's
 * copy never promises more headroom than actually exists.
 */
export function checkOrderVerifyRateLimits(
  clientIp: string,
  orderNumber: string,
): OrderVerifyRateLimitResult {
  const coarse = checkOrderVerifyIpRateLimitFor(clientIp);
  if (!coarse.allowed) return coarse;

  const fine = checkOrderVerifyRateLimitFor(clientIp, orderNumber);
  if (!fine.allowed) return fine;

  return {
    allowed: true,
    remaining: Math.min(coarse.remaining, fine.remaining),
    resetInMs: Math.max(coarse.resetInMs, fine.resetInMs),
  };
}

/**
 * Counts the request against the `(IP, orderNumber)` bucket.
 * `NextRequest`-only entry point — delegates so the identifier is composed in
 * exactly one place.
 */
export function checkOrderVerifyRateLimit(
  request: NextRequest,
  orderNumber: string,
): OrderVerifyRateLimitResult {
  return checkOrderVerifyRateLimitFor(getClientIdentifier(request), orderNumber);
}
