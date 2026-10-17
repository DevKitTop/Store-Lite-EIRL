// =====================================================
// IN-MEMORY RATE LIMITER (Edge Runtime)
// =====================================================
// Simple sliding window rate limiter for MVP.
// Zero external dependencies, works in Edge Runtime.
//
// Future: swap the Map store with Upstash Redis for
// production multi-instance support.
// =====================================================

import { type NextRequest } from 'next/server';

export interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests allowed in window
}

interface RateLimitEntry {
  count: number;
  resetAt: number; // Timestamp when the window resets
}

// Per-path-type rate limit configs
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  auth: { windowMs: 15 * 60 * 1000, maxRequests: 10 }, // 10 requests per 15min
  api: { windowMs: 60 * 1000, maxRequests: 30 }, // 30 requests per minute
  storefront: { windowMs: 60 * 1000, maxRequests: 60 }, // 60 requests per minute
  /**
   * Coarse backstop for the order-verification page, charged per IP ACROSS all
   * order numbers (see `orderAccessRateLimit.ts`). `storefront` above cannot do
   * this job: its key embeds the attacker-controlled `orderNumber`, so rotating
   * that segment mints a fresh budget every request.
   *
   * Why 30/min. A real buyer opening the printed-ticket URL loads this page a
   * handful of times a minute at most (open, reload after a print hiccup, show a
   * colleague), so 30/min is roughly 6-30x one human's ceiling. It also keeps a
   * small shared-NAT office — the realistic worst case, since several desks
   * egress from one address — functional at about six concurrent users. Against
   * the measured 200 requests/min scrape rate it removes ~85% of throughput, and
   * the load-bearing part is not the number at all: the ceiling now exists and is
   * INDEPENDENT of `orderNumber`.
   *
   * This is a throttle, not a wall — see the open findings below.
   */
  orderVerifyIp: { windowMs: 60 * 1000, maxRequests: 30 }, // 30 requests per minute
};

// In-memory store (per-edge-instance).
//
// KNOWN LIMITATION — ACCEPTED, tracked (audit finding W-I1).
// On a multi-instance deployment each instance keeps its own counters, so the
// effective limit is roughly N x the configured value. This is a deliberate MVP
// decision, not an oversight: the money path is protected by idempotency
// (reserve-before-external-call), and adding a shared store requires provisioning
// a third-party service that cannot be verified from this repo.
//
// REVISIT TRIGGER — before scaling beyond one instance for these routes, before a
// public beta at volume, or on observed enumeration/card-testing abuse.
// See the "Decision - W-I1" section in
// docs/PREPRODUCTION_READINESS_2026-10_VERIFICATION.md.
//
// Fix path: Vercel WAF rate limiting, or a shared store (Upstash Redis / Vercel KV)
// behind the existing checkRateLimit/resetRateLimit signatures (no call-site changes).
const store = new Map<string, RateLimitEntry>();

// Periodic cleanup to prevent memory leaks
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt <= now) {
      store.delete(key);
    }
  }
}

/**
 * Simple sliding window rate limiter for Edge Runtime.
 * Returns { allowed: boolean, remaining: number, resetAt: number }
 */
export function checkRateLimit(
  identifier: string, // e.g. IP or userId
  config: RateLimitConfig,
): { allowed: boolean; remaining: number; resetInMs: number } {
  cleanup();

  const now = Date.now();
  const key = `${identifier}:${config.windowMs}`;
  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    // New window
    store.set(key, { count: 1, resetAt: now + config.windowMs });
    return { allowed: true, remaining: config.maxRequests - 1, resetInMs: config.windowMs };
  }

  entry.count += 1;
  if (entry.count > config.maxRequests) {
    return { allowed: false, remaining: 0, resetInMs: entry.resetAt - now };
  }

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetInMs: entry.resetAt - now,
  };
}

/**
 * Clears the window for an identifier, giving it a full budget again.
 *
 * The store key is private, so the signature mirrors `checkRateLimit` — callers
 * pass `(identifier, config)` and this module composes `${identifier}:${windowMs}`.
 * Resetting is idempotent: `Map.delete` on a missing key is a no-op, so a bucket
 * already reaped by `cleanup()` needs no guard.
 */
export function resetRateLimit(identifier: string, config: RateLimitConfig): void {
  store.delete(`${identifier}:${config.windowMs}`);
}

/**
 * Minimal shape needed to read a client header. `ReadonlyHeaders` (from
 * `await headers()` inside a server action) satisfies it structurally — no cast
 * and no new import.
 */
export interface ClientHeaderReader {
  get(name: string): string | null;
}

/**
 * Count of trusted proxy hops in front of the app. Vercel's edge terminates
 * exactly one hop, so the client address is the RIGHTMOST `x-forwarded-for`
 * entry; a client can only append entries to the LEFT. Overridable via
 * `TRUSTED_PROXY_COUNT` for topologies that add more trusted hops.
 */
function trustedProxyCount(): number {
  const parsed = Number.parseInt(process.env.TRUSTED_PROXY_COUNT ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

/**
 * Resolves the client IP without trusting spoofable, client-supplied
 * `x-forwarded-for` entries.
 *
 * `x-forwarded-for` is comma-separated, oldest-first: the leftmost tokens are
 * written by whoever sent the request (attacker-controlled), and each trusted
 * proxy appends the address it saw on the right. Only the entries written by
 * `TRUSTED_PROXY_COUNT` trusted hops from the RIGHT are trustworthy. Falls back
 * to `x-real-ip` (set by the edge, not the client), then `cf-connecting-ip`,
 * then the `'unknown'` sentinel.
 */
export function getClientIp(headers: ClientHeaderReader): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length > 0) {
      // Never fall back to index 0: if the configured hop count exceeds the
      // entries we actually received (misconfiguration), clamp to the RIGHTMOST
      // entry — the closest-to-us, least-spoofable one — instead of the
      // leftmost, which is attacker-controlled.
      const index = parts.length - trustedProxyCount();
      return parts[index >= 0 ? index : parts.length - 1];
    }
  }
  return headers.get('x-real-ip') ?? headers.get('cf-connecting-ip') ?? 'unknown';
}

/**
 * Extracts a client identifier from any header reader.
 * Priority: trusted x-forwarded-for hop > x-real-ip > cf-connecting-ip > fallback
 */
export function getClientIdentifierFromHeaders(headers: ClientHeaderReader): string {
  return getClientIp(headers);
}

/**
 * Extracts a client identifier from the request.
 * Priority: trusted rightmost x-forwarded-for hop > x-real-ip > cf-connecting-ip > 'unknown'
 */
export function getClientIdentifier(request: NextRequest): string {
  return getClientIdentifierFromHeaders(request.headers);
}
