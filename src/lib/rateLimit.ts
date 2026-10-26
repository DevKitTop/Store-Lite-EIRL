// =====================================================
// RATE LIMITER (Shared store with in-memory fallback)
// =====================================================
// Uses Postgres-backed shared windows when available,
// falls back to in-memory for Edge/test environments.
// =====================================================

// (imports moved to lazy loader)
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
   */
  orderVerifyIp: { windowMs: 60 * 1000, maxRequests: 30 }, // 30 requests per minute
};

const isTestEnv = () => process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

async function getShared() {
  try {
    const mod = await import('@/core/payments/rateLimitShared');
    return mod;
  } catch {
    return {
      checkRateLimitShared: async () => ({ allowed: true, remaining: 100, resetInMs: 60000 }),
      resetRateLimitShared: async () => {},
    };
  }
}

// In-memory store (fallback)
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
 * Simple sliding window rate limiter.
 * Tries shared Postgres store first, falls back to in-memory.
 */
export function checkRateLimit(
  identifier: string, // e.g. IP or userId
  config: RateLimitConfig,
): { allowed: boolean; remaining: number; resetInMs: number } {
  // Try shared store synchronously via async? but signature is sync - use in-memory fallback for sync calls
  // For server actions/routes that can be async, prefer checkRateLimitShared, but keep sync compat
  cleanup();

  const now = Date.now();
  const key = `${identifier}:${config.windowMs}`;
  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    // New window
    store.set(key, { count: 1, resetAt: now + config.windowMs });
    // Fire and forget to sync to shared store
    if (!isTestEnv()) {
      getShared()
        .then((s) => {
          if (typeof s.checkRateLimitShared === 'function') {
            s.checkRateLimitShared(identifier, config).catch(() => {});
          }
        })
        .catch(() => {});
    }
    return { allowed: true, remaining: config.maxRequests - 1, resetInMs: config.windowMs };
  }

  entry.count += 1;
  if (!isTestEnv()) {
    getShared()
      .then((s) => {
        if (typeof s.checkRateLimitShared === 'function') {
          s.checkRateLimitShared(identifier, config).catch(() => {});
        }
      })
      .catch(() => {});
  }
  if (entry.count > config.maxRequests) {
    return { allowed: false, remaining: 0, resetInMs: entry.resetAt - now };
  }

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetInMs: entry.resetAt - now,
  };
}

export async function checkRateLimitAsync(
  identifier: string,
  config: RateLimitConfig,
): Promise<{ allowed: boolean; remaining: number; resetInMs: number }> {
  if (isTestEnv()) {
    return checkRateLimit(identifier, config);
  }
  try {
    const s = await getShared();
    if (typeof s.checkRateLimitShared === 'function') {
      return await s.checkRateLimitShared(identifier, config);
    }
  } catch {
    // ignore
  }
  return checkRateLimit(identifier, config);
}

/**
 * Clears the window for an identifier.
 */
export function resetRateLimit(identifier: string, config: RateLimitConfig): void {
  store.delete(`${identifier}:${config.windowMs}`);
  if (!isTestEnv()) {
    getShared()
      .then((s) => {
        if (typeof s.resetRateLimitShared === 'function') {
          s.resetRateLimitShared(identifier, config).catch(() => {});
        }
      })
      .catch(() => {});
  }
}

export async function resetRateLimitAsync(
  identifier: string,
  config: RateLimitConfig,
): Promise<void> {
  resetRateLimit(identifier, config);
  if (!isTestEnv()) {
    try {
      const s = await getShared();
      if (typeof s.resetRateLimitShared === 'function') {
        await s.resetRateLimitShared(identifier, config).catch(() => {});
      }
    } catch {
      // ignore
    }
  }
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
