// =====================================================
// checkRateLimitAsync — shared module cannot be evaluated
// =====================================================
// `getShared()` used to swallow an import-time failure (for example a missing
// DATABASE_URL) and return an `allowed: true` stub, so every limit silently
// disappeared. It must throw instead, so the caller falls back to the
// per-instance window and requests are still counted.
// =====================================================

import { checkRateLimitAsync } from '@/lib/rateLimit';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('@/core/payments/rateLimitShared', () => {
  throw new Error('shared module failed to evaluate');
});

const CONFIG = { windowMs: 60_000, maxRequests: 2 };

describe('checkRateLimitAsync — shared module evaluation failure', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('falls back to the per-instance window instead of allowing everything', async () => {
    vi.stubEnv('VITEST', 'false');
    vi.stubEnv('NODE_ENV', 'production');

    // maxRequests = 2: the first two are allowed, the third is denied by the
    // local window. Under the old allow-stub, all three would have passed.
    await expect(checkRateLimitAsync('client-a', CONFIG)).resolves.toMatchObject({
      allowed: true,
    });
    await expect(checkRateLimitAsync('client-a', CONFIG)).resolves.toMatchObject({
      allowed: true,
    });
    await expect(checkRateLimitAsync('client-a', CONFIG)).resolves.toMatchObject({
      allowed: false,
    });
  });
});
