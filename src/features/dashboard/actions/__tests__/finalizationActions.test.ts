import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted for ALL mocks that are referenced inside vi.mock factories
const mocks = vi.hoisted(() => ({
  paymentsFindFirst: vi.fn(),
  businessesFindFirst: vi.fn(),
  chatSessionsFindFirst: vi.fn(),
  businessNotificationsCreate: vi.fn(),
  transition: vi.fn(() => Promise.resolve({ success: true, error: undefined })),
  selectLimit: vi.fn(() => Promise.resolve([])),
  selectWhere: vi.fn(() => ({
    limit: mocks.selectLimit,
  })),
  selectFrom: vi.fn(() => ({
    where: mocks.selectWhere,
  })),
  select: vi.fn(() => ({
    from: mocks.selectFrom,
  })),
  insert: vi.fn(() => ({
    values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([])) })),
  })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(undefined)) })),
  })),
  checkIncompleteOrderDeactivation: vi.fn(),
  processOrderCompletion: vi.fn(),
  revalidatePath: vi.fn(),
  // R19: `confirmFinalization` is gated on the signed access cookie, so this
  // harness has to hold a real one — minted through the production signer.
  cookieStore: new Map<string, string>(),
  mockCookiesFn: vi.fn(),
}));

vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      payments: { findFirst: mocks.paymentsFindFirst },
      businesses: { findFirst: mocks.businessesFindFirst },
      chatSessions: { findFirst: mocks.chatSessionsFindFirst },
    },
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
  },
}));

vi.mock('@/core/orders/orderService', () => ({
  transition: mocks.transition,
}));

vi.mock('@/lib/notifications', () => ({
  createBusinessNotification: mocks.businessNotificationsCreate,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: null } })),
    },
  })),
}));

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock('@/config/env', () => ({
  env: {
    orderFlowV2: true,
    // R19/R18: without a secret the gate fails closed and denies EVERY buyer.
    orderAccessCookieSecret: 'finalization-actions-test-secret',
  },
}));

// R19: the cookie store `verifyOrderAccessCookie` reads through.
vi.mock('next/headers', () => ({
  cookies: mocks.mockCookiesFn,
  headers: vi.fn(async () => ({ get: () => null })),
}));

vi.mock('@/lib/incompleteOrderRate', () => ({
  checkIncompleteOrderDeactivation: mocks.checkIncompleteOrderDeactivation,
}));

vi.mock('@/lib/deactivation', () => ({
  processOrderCompletion: mocks.processOrderCompletion,
}));

// Import after mocks
import { ORDER_STATUS_V2 } from '@/core/orders/orderStatus';
import { setOrderAccessCookie } from '@/lib/orderAccessCookie';
import { autoFinalizeExpiredPayments, confirmFinalization } from '../finalizationActions';

const VALID_TOKEN = 'valid-token';
const INVALID_TOKEN = 'invalid-token';

/** Gives this harness a genuinely valid marker, minted by the production signer. */
async function mintCookie(token: string) {
  mocks.mockCookiesFn.mockImplementation(async () => ({
    get: (name: string) =>
      mocks.cookieStore.has(name)
        ? { name, value: mocks.cookieStore.get(name) as string }
        : undefined,
    set: (opts: { name: string; value: string }) => {
      mocks.cookieStore.set(opts.name, opts.value);
    },
  }));
  await setOrderAccessCookie(token);
}

function resetMocks() {
  mocks.paymentsFindFirst.mockReset();
  mocks.businessesFindFirst.mockReset();
  mocks.chatSessionsFindFirst.mockReset();
  mocks.businessNotificationsCreate.mockReset();
  mocks.transition.mockReset();
  mocks.selectLimit.mockReset();
  mocks.selectWhere.mockReset();
  mocks.selectFrom.mockReset();
  mocks.select.mockReset();
  mocks.insert.mockReset();
  mocks.update.mockReset();
  mocks.checkIncompleteOrderDeactivation.mockReset();
  mocks.processOrderCompletion.mockReset();
  mocks.revalidatePath.mockReset();
}

describe('confirmFinalization', () => {
  beforeEach(async () => {
    resetMocks();
    mocks.transition.mockResolvedValue({ success: true, error: undefined });
    process.env.ENABLE_AUTO_DEACTIVATION = 'true';
    mocks.cookieStore.clear();
    // R19: every case below needs an authorized buyer, so mint both tokens.
    await mintCookie(VALID_TOKEN);
    await mintCookie(INVALID_TOKEN);
  });

  afterEach(() => {
    delete process.env.ENABLE_AUTO_DEACTIVATION;
  });

  it('refuses before the payment read when there is no access cookie (R19)', async () => {
    mocks.cookieStore.clear();

    const result = await confirmFinalization('payment-1', VALID_TOKEN);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('reauth_required');
    expect(mocks.selectLimit).not.toHaveBeenCalled();
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  it('rejects invalid token', async () => {
    mocks.selectLimit.mockResolvedValue([] as any);

    const result = await confirmFinalization('payment-1', INVALID_TOKEN);

    expect(result.success).toBe(false);
    expect(result.error).toContain('token inválido');
    expect(result.reason).toBe('order_not_found');
  });

  it('rejects invalid status', async () => {
    mocks.selectLimit.mockResolvedValue([
      {
        id: 'payment-1',
        trackingToken: 'valid-token',
        status: ORDER_STATUS_V2.PREPARING_ORDER,
        businessId: 'biz-1',
        orderNumber: 'ORD-123',
        version: 1,
      },
    ] as any);

    const result = await confirmFinalization('payment-1', 'valid-token');

    expect(result.success).toBe(false);
    expect(result.error).toContain('espera de confirmación');
  });

  it('confirms finalization successfully (V2 flow)', async () => {
    mocks.selectLimit.mockResolvedValue([
      {
        id: 'payment-1',
        trackingToken: 'valid-token',
        status: ORDER_STATUS_V2.DELIVERED,
        businessId: 'biz-1',
        orderNumber: 'ORD-123',
        version: 1,
      },
    ] as any);
    mocks.businessesFindFirst.mockResolvedValue({
      id: 'biz-1',
      slug: 'test-slug',
    });
    mocks.chatSessionsFindFirst.mockResolvedValue(null);
    mocks.businessNotificationsCreate.mockResolvedValue(undefined);

    const result = await confirmFinalization('payment-1', 'valid-token');

    expect(result.success).toBe(true);
    expect(result.data?.status).toBe('finalizado');
  });

  describe('incomplete order rate integration', () => {
    beforeEach(() => {
      resetMocks();
      mocks.transition.mockResolvedValue({ success: true, error: undefined });
      process.env.ENABLE_AUTO_DEACTIVATION = 'true';
    });

    afterEach(() => {
      delete process.env.ENABLE_AUTO_DEACTIVATION;
    });

    it('calls checkIncompleteOrderDeactivation after successful order completion', async () => {
      mocks.checkIncompleteOrderDeactivation.mockResolvedValue({
        shouldDeactivate: false,
        rate: {
          exceedsThreshold: false,
          incompleteRate: 2000,
          totalOrders: 10,
          incompleteOrders: 2,
        },
      });
      mocks.processOrderCompletion.mockResolvedValue(undefined);

      mocks.selectLimit.mockResolvedValue([
        {
          id: 'payment-1',
          trackingToken: 'valid-token',
          status: ORDER_STATUS_V2.DELIVERED,
          businessId: 'biz-1',
          orderNumber: 'ORD-123',
          version: 1,
        },
      ] as any);
      mocks.businessesFindFirst.mockResolvedValue({
        id: 'biz-1',
        slug: 'test-slug',
      });
      mocks.chatSessionsFindFirst.mockResolvedValue(null);
      mocks.businessNotificationsCreate.mockResolvedValue(undefined);

      const result = await confirmFinalization('payment-1', 'valid-token');

      expect(result.success).toBe(true);
      expect(mocks.checkIncompleteOrderDeactivation).toHaveBeenCalledWith('biz-1');
      expect(mocks.processOrderCompletion).not.toHaveBeenCalled(); // shouldDeactivate is false
    });

    it('triggers deactivation when incomplete order rate exceeds threshold', async () => {
      mocks.checkIncompleteOrderDeactivation.mockResolvedValue({
        shouldDeactivate: true,
        rate: {
          exceedsThreshold: true,
          incompleteRate: 5000,
          totalOrders: 10,
          incompleteOrders: 5,
        },
      });
      mocks.processOrderCompletion.mockResolvedValue(undefined);

      mocks.selectLimit.mockResolvedValue([
        {
          id: 'payment-1',
          trackingToken: 'valid-token',
          status: ORDER_STATUS_V2.DELIVERED,
          businessId: 'biz-1',
          orderNumber: 'ORD-123',
          version: 1,
        },
      ] as any);
      mocks.businessesFindFirst.mockResolvedValue({
        id: 'biz-1',
        slug: 'test-slug',
      });
      mocks.chatSessionsFindFirst.mockResolvedValue(null);
      mocks.businessNotificationsCreate.mockResolvedValue(undefined);

      const result = await confirmFinalization('payment-1', 'valid-token');

      expect(result.success).toBe(true);
      expect(mocks.checkIncompleteOrderDeactivation).toHaveBeenCalledWith('biz-1');
      expect(mocks.processOrderCompletion).toHaveBeenCalledWith('biz-1');
    });

    it('does not call checkIncompleteOrderDeactivation when feature flag disabled', async () => {
      process.env.ENABLE_AUTO_DEACTIVATION = 'false';
      mocks.checkIncompleteOrderDeactivation.mockResolvedValue({
        shouldDeactivate: true,
        rate: { exceedsThreshold: true },
      });
      mocks.processOrderCompletion.mockResolvedValue(undefined);

      mocks.selectLimit.mockResolvedValue([
        {
          id: 'payment-1',
          trackingToken: 'valid-token',
          status: ORDER_STATUS_V2.DELIVERED,
          businessId: 'biz-1',
          orderNumber: 'ORD-123',
          version: 1,
        },
      ] as any);
      mocks.businessesFindFirst.mockResolvedValue({
        id: 'biz-1',
        slug: 'test-slug',
      });
      mocks.chatSessionsFindFirst.mockResolvedValue(null);
      mocks.businessNotificationsCreate.mockResolvedValue(undefined);

      const result = await confirmFinalization('payment-1', 'valid-token');

      expect(result.success).toBe(true);
      expect(mocks.checkIncompleteOrderDeactivation).not.toHaveBeenCalled();
      expect(mocks.processOrderCompletion).not.toHaveBeenCalled();
    });
  });
});

describe('autoFinalizeExpiredPayments', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('returns early when orderFlowV2 is enabled', async () => {
    const result = await autoFinalizeExpiredPayments();

    expect(result.success).toBe(true);
    expect(result.processedCount).toBe(0);
  });
});
