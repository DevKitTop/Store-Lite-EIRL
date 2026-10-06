import { createHash, timingSafeEqual } from 'node:crypto';

/** SHA-256 digest of a token — always 32 bytes, whatever the input length. */
function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Constant-time comparison for caller-supplied tokens (design D1).
 *
 * Used by the buyer branch of `POST /api/ticket/generate`, where the caller's
 * `trackingToken` must be compared against the value stored on the payment row
 * without leaking the answer through response time.
 *
 * Both sides are digested with SHA-256 first, so the buffers handed to
 * `timingSafeEqual` are always 32 bytes. That removes the length precondition
 * (`timingSafeEqual` throws when its inputs differ in length) and makes the
 * comparison runtime independent of the input values.
 *
 * Deliberately NOT the same as the Culqi webhook's `safeTimingEquals`
 * (`app/api/webhooks/culqi/route.ts:13`): that one verifies an HMAC digest and
 * early-returns on a length mismatch, which is correct for webhook signatures
 * and wrong for a stored opaque token.
 *
 * Server-only: importing `node:crypto` makes any client bundle fail at build,
 * so this module is safe to import from route handlers.
 *
 * @param a - Token presented by the caller
 * @param b - Token read from the database
 * @returns `true` when both digests match
 */
export function safeTokenEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}
