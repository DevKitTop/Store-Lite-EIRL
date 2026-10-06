// =====================================================
// ORDER ACCESS COOKIE — the signed full-access marker (R13 / R18)
// =====================================================
// `/{slug}/order/{token}` renders from a `payments` row that carries buyer PII
// (`buyerEmail`, `buyerPhone`, `buyerDni`, the shipping address, the pickup
// code, the ticket images). The tracking token alone must NOT unlock all of
// that, so the page serves a projection instead — unless the request carries
// proof that THIS browser already proved it owns this order.
//
// That proof is this cookie: it is minted only on the success arms of
// `verifyOrderAccess` / `verifyOrderByGoogleIdentity` and it is signed, so the
// server can tell "this browser completed the DNI gate" from "somebody typed
// the URL from the URL bar".
//
// Three decisions carry the weight (design D7-D9):
//
//   * THE TOKEN IS INSIDE THE SIGNED PAYLOAD. Signing only `{exp}` would let a
//     single valid cookie unlock every order whose token the caller happens to
//     know — the URL is guessable-ish and shared over WhatsApp. Signing
//     `v1|{token}|{exp}` means a cookie is only ever valid for the one order it
//     was minted for.
//   * `safeTokenEqual`, NOT `timingSafeEqual`. The attacker controls this
//     cookie's length, and raw `timingSafeEqual` THROWS when its two buffers
//     differ in length — a 500 that is also an oracle for "how far did you get".
//     `safeTokenEqual` (`src/lib/tokenCompare.ts`) digests both sides to 32
//     bytes first, which removes the precondition entirely.
//   * AN UNSET SECRET VERIFIES NOTHING. `env.orderAccessCookieSecret` defaults
//     to `''` — deliberately NOT the `|| 'dev-fallback-…'` shape that
//     `otpHashSecret` uses. An OTP hash is integrity-only; this cookie is an
//     ACCESS DECISION, and a known fallback would make an unset production
//     secret silently authorize every request.
//
// Server-only: `node:crypto` makes any client bundle fail at build, which is the
// intended failure mode — this marker is worthless without a server.
// =====================================================

import { env } from '@/config/env';
import { safeTokenEqual } from '@/lib/tokenCompare';
import { cookies } from 'next/headers';
import { createHmac } from 'node:crypto';

/**
 * 1 hour, matching `OrderAuthGate`'s `SESSION_TTL` (`OrderAuthGate.tsx:20`).
 * A short, self-healing window is deliberate: a leaked cookie stops working on
 * its own instead of needing revocation.
 */
const MAX_AGE_SECONDS = 60 * 60;

/** Bumped if the payload layout ever changes, so old cookies fail closed. */
const PAYLOAD_VERSION = 'v1';

/** Shared attribute set for BOTH the set and the delete (design D8). */
function cookieAttributes(maxAge: number) {
  return {
    httpOnly: true,
    maxAge,
    sameSite: 'lax' as const,
    // Route is `/{slug}/order/{token}`, so no narrower fixed path can match,
    // and `/{slug}` would add a segment to the sign/verify contract.
    path: '/',
    // No `domain`: host-only, mirroring `buildCookieAttributes` in
    // consentClient.ts — the marker must not reach sibling tenant subdomains.
    secure: process.env.NODE_ENV === 'production',
  };
}

/**
 * Cookie name for an order's access marker. Pure and sync so a caller can name
 * the cookie without entering a request scope (and so it is trivially testable).
 */
export function orderAccessCookieName(trackingToken: string): string {
  return `order_access_${trackingToken}`;
}

/** base64url HMAC-SHA256 over `{version}|{trackingToken}|{expMs}`. */
function sign(secret: string, trackingToken: string, expMs: number): string {
  return createHmac('sha256', secret)
    .update(`${PAYLOAD_VERSION}|${trackingToken}|${expMs}`, 'utf8')
    .digest('base64url');
}

/**
 * Mints the marker for a buyer who just passed `verifyOrderAccess` or
 * `verifyOrderByGoogleIdentity`.
 *
 * Call ONLY from an existing success arm: a refusal must leave the cookie store
 * untouched (R13), which includes not clearing a previously valid marker.
 */
export async function setOrderAccessCookie(trackingToken: string): Promise<void> {
  const cookieStore = await cookies();
  const expMs = Date.now() + MAX_AGE_SECONDS * 1000;
  const value = `${expMs}.${sign(env.orderAccessCookieSecret, trackingToken, expMs)}`;

  cookieStore.set({
    name: orderAccessCookieName(trackingToken),
    value,
    ...cookieAttributes(MAX_AGE_SECONDS),
  });
}

/**
 * Reports whether this request carries a live, untampered access marker for
 * THIS order.
 *
 * Fails closed on every branch — absent, malformed, tampered, expired, or signed
 * with an empty/unknown secret. The signature is checked BEFORE the expiry so an
 * attacker-supplied `expMs` never gets to decide anything.
 */
export async function verifyOrderAccessCookie(trackingToken: string): Promise<boolean> {
  // R18: no secret, no access. Checked first so an unset deployment never even
  // reads the cookie — and so this is unconditional, not a fallback path.
  const secret = env.orderAccessCookieSecret;
  if (!secret) return false;

  const cookieStore = await cookies();
  const raw = cookieStore.get(orderAccessCookieName(trackingToken))?.value;
  if (!raw) return false;

  const separator = raw.indexOf('.');
  if (separator <= 0) return false;

  const expMs = Number(raw.slice(0, separator));
  const signature = raw.slice(separator + 1);
  if (!Number.isSafeInteger(expMs) || signature.length === 0) return false;

  // The signature covers the token, so a marker minted for another order — even
  // with a valid expiry — never verifies here.
  if (!safeTokenEqual(signature, sign(secret, trackingToken, expMs))) return false;

  return Date.now() < expMs;
}

/**
 * Revokes the marker for an order — the logout path (R16).
 *
 * The attributes MUST repeat the ones used by `setOrderAccessCookie` byte for
 * byte: a delete that does not match its set is silently ignored by the browser,
 * which would leave a full-access cookie on disk after logout.
 */
export async function deleteOrderAccessCookie(trackingToken: string): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set({
    name: orderAccessCookieName(trackingToken),
    value: '',
    ...cookieAttributes(0),
  });
}
