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

// In-memory store (per-edge-instance). For MVP this is fine.
// Future: swap with Upstash Redis for production multi-instance support.
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
 * Extracts a client identifier from any header reader.
 * Priority: x-forwarded-for > x-real-ip > cf-connecting-ip > fallback
 */
export function getClientIdentifierFromHeaders(headers: ClientHeaderReader): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headers.get('x-real-ip') ??
    headers.get('cf-connecting-ip') ??
    'unknown'
  );
}

/**
 * Extracts a client identifier from the request.
 * Priority: x-forwarded-for > x-real-ip > cf-connecting-ip > fallback
 */
export function getClientIdentifier(request: NextRequest): string {
  return getClientIdentifierFromHeaders(request.headers);
}
