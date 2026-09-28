import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────
// All mock objects created via vi.hoisted() so they exist before vi.mock factories run
const {
  mockEnv,
  mockFrom,
  mockWhere,
  mockLimit,
  mockTransition,
  mockCheckPermission,
  mockProfileFindFirst,
} = vi.hoisted(() => {
  const env = { orderFlowV2: true };
  return {
    mockEnv: env,
    mockFrom: vi.fn(),
    mockWhere: vi.fn(),
    mockLimit: vi.fn(),
    mockTransition: vi.fn(),
    mockCheckPermission: vi.fn(),
    mockProfileFindFirst: vi.fn(),
  };
});

vi.mock('@/config/env', () => ({
  env: mockEnv,
}));

vi.mock('@/core/orders/orderService', () => ({
  transition: mockTransition,
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// The module exports `createClient`, not a bare `{ auth }` shape.
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'user_1' } } }),
    },
  }),
}));

vi.mock('@/lib/permissions', () => ({
  checkPermission: mockCheckPermission,
}));

vi.mock('@/core/database/client', () => ({
  db: {
    select: vi.fn(() => ({ from: mockFrom })),
    // getAuthenticatedUserId hits profiles.findFirst as an FK guard; without it the
    // call throws into the catch and the resolved actor comes back null.
    query: { profiles: { findFirst: mockProfileFindFirst } },
  },
}));

import { confirmPickedUp, markReadyForPickup } from '@/features/dashboard/actions/ticketActions';

// ── Helpers ──────────────────────────────────────────

function mockDbPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay_123',
    status: 'PREPARING_ORDER',
    businessId: 'biz_123',
    version: 1,
    pickupCode: 'SL-ABCD1234-EFGH5678',
    ...overrides,
  };
}

function setupDbSelect(payment: Record<string, unknown>) {
  vi.clearAllMocks();
  mockLimit.mockResolvedValue([payment]);
  mockWhere.mockReturnValue({ limit: mockLimit });
  // Both markReadyForPickup (no innerJoin) and confirmPickedUp (uses innerJoin) use this mock.
  // provide innerJoin so confirmPickedUp can chain: .from().innerJoin().where().limit()
  mockFrom.mockReturnValue({
    where: mockWhere,
    innerJoin: vi.fn(() => ({ where: mockWhere })),
  });
}

describe('markReadyForPickup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.orderFlowV2 = true;
    mockCheckPermission.mockResolvedValue(true);
    mockProfileFindFirst.mockResolvedValue({ id: 'user_1' });
  });

  test('calls transition with READY_FOR_PICKUP', async () => {
    setupDbSelect(mockDbPayment());

    mockTransition.mockResolvedValue({ success: true, payment: {}, eventId: 'evt_001' });

    const result = await markReadyForPickup('pay_123', 'biz_123');

    expect(result.success).toBe(true);
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'pay_123',
        toStatus: 'READY_FOR_PICKUP',
        actor: { type: 'seller', id: 'user_1' },
      }),
    );
  });

  test('returns error when V2 flow is disabled', async () => {
    mockEnv.orderFlowV2 = false;
    setupDbSelect(mockDbPayment());

    const result = await markReadyForPickup('pay_123', 'biz_123');

    expect(result.success).toBe(false);
    expect(result.error).toContain('orderFlowV2');
    expect(mockTransition).not.toHaveBeenCalled();
  });
});

describe('confirmPickedUp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv.orderFlowV2 = true;
    mockCheckPermission.mockResolvedValue(true);
    mockProfileFindFirst.mockResolvedValue({ id: 'user_1' });
  });

  test('validates pickup code and transitions to PICKED_UP then auto-completes to COMPLETED', async () => {
    setupDbSelect(mockDbPayment({ pickupCode: 'SL-ABCD1234-EFGH5678' }));

    mockTransition.mockResolvedValue({
      success: true,
      payment: { version: 1 },
      eventId: 'evt_002',
    });

    const result = await confirmPickedUp('pay_123', 'biz_123', 'SL-ABCD1234-EFGH5678');

    expect(result.success).toBe(true);
    expect(result.autoCompletePending).toBeUndefined();
    expect(mockTransition).toHaveBeenCalledTimes(2);
    expect(mockTransition).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        paymentId: 'pay_123',
        toStatus: 'PICKED_UP',
        actor: { type: 'seller', id: 'user_1' },
      }),
    );
    expect(mockTransition).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        paymentId: 'pay_123',
        toStatus: 'COMPLETED',
        actor: { type: 'system' },
      }),
    );
  });

  test('rejects wrong pickup code', async () => {
    setupDbSelect(mockDbPayment({ pickupCode: 'SL-ABCD1234-EFGH5678' }));

    const result = await confirmPickedUp('pay_123', 'biz_123', 'WRONG-CODE');

    expect(result.success).toBe(false);
    expect(result.error).toContain('no coincide');
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test('rejects missing pickup code', async () => {
    setupDbSelect(mockDbPayment({ pickupCode: null }));

    const result = await confirmPickedUp('pay_123', 'biz_123', 'SL-ABCD1234-EFGH5678');

    expect(result.success).toBe(false);
    expect(result.error).toContain('no tiene un código');
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test('returns error when V2 flow is disabled', async () => {
    mockEnv.orderFlowV2 = false;
    setupDbSelect(mockDbPayment({ pickupCode: 'SL-ABCD1234-EFGH5678' }));

    const result = await confirmPickedUp('pay_123', 'biz_123', 'SL-ABCD1234-EFGH5678');

    expect(result.success).toBe(false);
    expect(result.error).toContain('orderFlowV2');
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test('returns autoCompletePending when auto-complete to COMPLETED fails', async () => {
    setupDbSelect(mockDbPayment({ pickupCode: 'SL-ABCD1234-EFGH5678' }));

    // First call succeeds, second call (auto-complete) fails
    mockTransition
      .mockResolvedValueOnce({ success: true, payment: { version: 1 }, eventId: 'evt_002' })
      .mockResolvedValueOnce({ success: false, error: 'Some error' });

    const result = await confirmPickedUp('pay_123', 'biz_123', 'SL-ABCD1234-EFGH5678');

    expect(result.success).toBe(true);
    expect(result.autoCompletePending).toBe(true);
    expect(mockTransition).toHaveBeenCalledTimes(2);
  });
});
