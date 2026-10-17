import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: { query: { businessSettings: { findFirst: vi.fn() } } },
}));

vi.mock('@/core/database/client', () => ({ db: mockDb }));
vi.mock('@/core/database/schema', () => ({
  businessSettings: { businessId: 'businessSettings.businessId', culqiSecretKey: 'culqiSecretKey' },
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn((...a) => a) }));
vi.mock('@/utils/crypto', () => ({ decrypt: vi.fn((v: string) => v.replace(/^enc:/, '')) }));

import { resolveCulqiSecretKey } from '@/core/payments/culqiSecretKey';

const findFirst = mockDb.query.businessSettings.findFirst as ReturnType<typeof vi.fn>;
const originalEnv = process.env.NODE_ENV;

function setEnv(value: string | undefined) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.env as any).NODE_ENV = value;
}

describe('resolveCulqiSecretKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnv('test');
  });

  afterEach(() => {
    setEnv(originalEnv);
  });

  it('returns a 400 error when the business has no configured key', async () => {
    findFirst.mockResolvedValueOnce(null);
    const { secretKey, error } = await resolveCulqiSecretKey('b1');
    expect(secretKey).toBe('');
    expect(error?.status).toBe(400);
  });

  it('decrypts the stored ciphertext before returning it (dev/test key)', async () => {
    findFirst.mockResolvedValueOnce({ culqiSecretKey: 'enc:sk_test_123' });
    const { secretKey, error } = await resolveCulqiSecretKey('b1');
    expect(error).toBeNull();
    expect(secretKey).toBe('sk_test_123');
  });

  it('rejects a non-live key in production', async () => {
    setEnv('production');
    findFirst.mockResolvedValueOnce({ culqiSecretKey: 'enc:sk_test_123' });
    const { secretKey, error } = await resolveCulqiSecretKey('b1');
    expect(secretKey).toBe('');
    expect(error?.status).toBe(400);
  });

  it('accepts a live key in production', async () => {
    setEnv('production');
    findFirst.mockResolvedValueOnce({ culqiSecretKey: 'enc:sk_live_abc' });
    const { secretKey, error } = await resolveCulqiSecretKey('b1');
    expect(error).toBeNull();
    expect(secretKey).toBe('sk_live_abc');
  });

  it('rejects a live key outside production', async () => {
    setEnv('development');
    findFirst.mockResolvedValueOnce({ culqiSecretKey: 'enc:sk_live_abc' });
    const { secretKey, error } = await resolveCulqiSecretKey('b1');
    expect(secretKey).toBe('');
    expect(error?.status).toBe(400);
  });
});
