import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { mockCheckRateLimitShared } = vi.hoisted(() => ({
  mockCheckRateLimitShared: vi.fn(),
}));

vi.mock('@/core/payments/rateLimitShared', () => ({
  checkRateLimitShared: mockCheckRateLimitShared,
}));

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('check()', () => {
    test('allows requests within the limit', async () => {
      const { RateLimiter } = await import('@/core/payments/rateLimiter');
      const limiter = new RateLimiter(30_000, 3);

      expect(limiter.check('key-1')).toBe(true);
      expect(limiter.check('key-1')).toBe(true);
      expect(limiter.check('key-1')).toBe(true);
    });

    test('blocks requests after exceeding the limit', async () => {
      const { RateLimiter } = await import('@/core/payments/rateLimiter');
      const limiter = new RateLimiter(30_000, 3);

      expect(limiter.check('key-2')).toBe(true);
      expect(limiter.check('key-2')).toBe(true);
      expect(limiter.check('key-2')).toBe(true);
      expect(limiter.check('key-2')).toBe(false);
    });

    test('resets the sliding window after time passes', async () => {
      const { RateLimiter } = await import('@/core/payments/rateLimiter');
      const limiter = new RateLimiter(30_000, 2);

      expect(limiter.check('key-3')).toBe(true);
      expect(limiter.check('key-3')).toBe(true);
      expect(limiter.check('key-3')).toBe(false);

      // Advance past the window
      vi.advanceTimersByTime(30_001);

      expect(limiter.check('key-3')).toBe(true);
    });

    test('different keys have independent counters', async () => {
      const { RateLimiter } = await import('@/core/payments/rateLimiter');
      const limiter = new RateLimiter(30_000, 2);

      expect(limiter.check('key-a')).toBe(true);
      expect(limiter.check('key-a')).toBe(true);
      expect(limiter.check('key-a')).toBe(false); // key-a exhausted

      expect(limiter.check('key-b')).toBe(true); // key-b still available
      expect(limiter.check('key-b')).toBe(true);
      expect(limiter.check('key-b')).toBe(false); // key-b exhausted
    });

    test('partial window expiry allows some new requests', async () => {
      vi.setSystemTime(1_000_000_000_000);
      const { RateLimiter } = await import('@/core/payments/rateLimiter');
      const limiter = new RateLimiter(10_000, 3);

      // Make 3 requests at t=0, t=1000, t=2000
      expect(limiter.check('key-4')).toBe(true);
      vi.advanceTimersByTime(1_000);
      expect(limiter.check('key-4')).toBe(true);
      vi.advanceTimersByTime(1_000);
      expect(limiter.check('key-4')).toBe(true);

      // Blocked at t=2000
      expect(limiter.check('key-4')).toBe(false);

      // Advance to t=10000 — first request at t=0 falls out (> strict check)
      vi.advanceTimersByTime(8_000);
      // Only 1 slot freed: [1000, 2000] remain, 2 < 3
      expect(limiter.check('key-4')).toBe(true);
      // Now [1000, 2000, 10000], 3 >= 3
      expect(limiter.check('key-4')).toBe(false);
    });
  });

  describe('startCleanup / stopCleanup', () => {
    test('cleanup removes stale entries from store', async () => {
      const { RateLimiter } = await import('@/core/payments/rateLimiter');
      const limiter = new RateLimiter(30_000, 2);

      limiter.startCleanup(60_000);

      limiter.check('cleanup-key');
      limiter.check('cleanup-key');
      expect(limiter.check('cleanup-key')).toBe(false); // blocked

      // Advance past window (30s) + cleanup interval (60s)
      vi.advanceTimersByTime(90_001);

      // Cleanup has fired, old entries removed
      expect(limiter.check('cleanup-key')).toBe(true);
      limiter.stopCleanup();
    });

    test('stopCleanup clears the interval', async () => {
      const { RateLimiter } = await import('@/core/payments/rateLimiter');
      const clearSpy = vi.spyOn(globalThis, 'clearInterval');

      const limiter = new RateLimiter(30_000, 2);
      limiter.startCleanup(60_000);
      limiter.stopCleanup();

      expect(clearSpy).toHaveBeenCalledTimes(1);
      clearSpy.mockRestore();
    });
  });

  describe('checkAsync()', () => {
    beforeEach(() => {
      mockCheckRateLimitShared.mockReset();
    });

    test('denies without charging the local window when the shared store denies', async () => {
      const { RateLimiter } = await import('@/core/payments/rateLimiter');
      const limiter = new RateLimiter(30_000, 3);
      const memoryCheck = vi.spyOn(limiter, 'check');
      mockCheckRateLimitShared.mockResolvedValue({
        allowed: false,
        remaining: 0,
        resetInMs: 1_000,
      });

      await expect(limiter.checkAsync('shared-key')).resolves.toBe(false);
      expect(mockCheckRateLimitShared).toHaveBeenCalledWith('shared-key', {
        windowMs: 30_000,
        maxRequests: 3,
      });
      expect(memoryCheck).not.toHaveBeenCalled();
    });

    test('allows when the shared store allows and the local window has room', async () => {
      const { RateLimiter } = await import('@/core/payments/rateLimiter');
      const limiter = new RateLimiter(30_000, 3);
      mockCheckRateLimitShared.mockResolvedValue({
        allowed: true,
        remaining: 2,
        resetInMs: 1_000,
      });

      await expect(limiter.checkAsync('shared-key-2')).resolves.toBe(true);
    });

    test('enforces the per-instance backstop even when the shared store always allows', async () => {
      const { RateLimiter } = await import('@/core/payments/rateLimiter');
      const limiter = new RateLimiter(30_000, 1);
      mockCheckRateLimitShared.mockResolvedValue({
        allowed: true,
        remaining: 1,
        resetInMs: 1_000,
      });

      await expect(limiter.checkAsync('backstop-key')).resolves.toBe(true);
      await expect(limiter.checkAsync('backstop-key')).resolves.toBe(false);
    });

    test('falls back to the per-instance limiter when the shared store throws', async () => {
      const { RateLimiter } = await import('@/core/payments/rateLimiter');
      const limiter = new RateLimiter(30_000, 1);
      mockCheckRateLimitShared.mockRejectedValue(new Error('db down'));

      await expect(limiter.checkAsync('fallback-key')).resolves.toBe(true);
      await expect(limiter.checkAsync('fallback-key')).resolves.toBe(false);
    });
  });
});
