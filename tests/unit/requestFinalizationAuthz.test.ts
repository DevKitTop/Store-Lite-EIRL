import { beforeEach, describe, expect, test, vi } from 'vitest';

// =====================================================
// requestFinalization — orders.manage authorization gate
// =====================================================
// `requestFinalization` had zero coverage before this suite. It must resolve the
// actor and check `orders.manage` before the payment read and outside the
// `env.orderFlowV2` branch, so an unauthorized caller can never drive the
// legacy inline UPDATE (spec R2 / design D4, D6).

const {
  mockEnv,
  mockSelect,
  mockFrom,
  mockWhere,
  mockLimit,
  mockTransition,
  mockCheckPermission,
  mockProfileFindFirst,
  mockChatSessionFindFirst,
  mockBusinessesFindFirst,
  mockInsert,
  mockUpdate,
  mockCreateBusinessNotification,
  mockSession,
} = vi.hoisted(() => {
  const env = { orderFlowV2: true };
  return {
    mockEnv: env,
    mockSelect: vi.fn(),
    mockFrom: vi.fn(),
    mockWhere: vi.fn(),
    mockLimit: vi.fn(),
    mockTransition: vi.fn(),
    mockCheckPermission: vi.fn(),
    mockProfileFindFirst: vi.fn(),
    mockChatSessionFindFirst: vi.fn(),
    mockBusinessesFindFirst: vi.fn(),
    mockInsert: vi.fn(),
    mockUpdate: vi.fn(),
    mockCreateBusinessNotification: vi.fn(),
    // Mutable holder so a single mock can simulate "signed in" and "signed out".
    mockSession: { user: { id: 'user_1' } as { id: string } | null },
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

// `@/lib/supabase/server` exports `createClient` — a bare `{ auth }` shape would
// still throw into the action's catch and leave the actor unresolved.
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: mockSession.user } }),
    },
  }),
}));

vi.mock('@/lib/permissions', () => ({
  checkPermission: mockCheckPermission,
}));

vi.mock('@/lib/notifications', () => ({
  createBusinessNotification: mockCreateBusinessNotification,
}));

vi.mock('@/lib/incompleteOrderRate', () => ({
  checkIncompleteOrderDeactivation: vi.fn(),
}));

vi.mock('@/lib/deactivation', () => ({
  processOrderCompletion: vi.fn(),
}));

vi.mock('@/core/database/client', () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    // getAuthenticatedUserId uses profiles.findFirst as an FK guard. Returning a
    // row keeps it off the db.insert auto-create branch.
    query: {
      profiles: { findFirst: mockProfileFindFirst },
      chatSessions: { findFirst: mockChatSessionFindFirst },
      businesses: { findFirst: mockBusinessesFindFirst },
    },
  },
}));

import { ORDER_STATUS_V2 } from '@/core/orders/orderStatus';
import { requestFinalization } from '@/features/dashboard/actions/finalizationActions';

const PAYMENT_ID = 'pay_123';
const BUSINESS_ID = 'biz_123';
const DENIAL = 'Pago no encontrado o no tienes permisos.';

/** Wire the reads so an unauthorized caller WOULD find a valid, actionable row. */
function stubPaymentRead(payment: Record<string, unknown> | null) {
  mockLimit.mockResolvedValue(payment ? [payment] : []);
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
  mockChatSessionFindFirst.mockResolvedValue(null);
  mockBusinessesFindFirst.mockResolvedValue({ id: BUSINESS_ID, slug: 'demo' });
}

function actionablePayment() {
  return {
    id: PAYMENT_ID,
    businessId: BUSINESS_ID,
    status: ORDER_STATUS_V2.IN_TRANSIT,
    version: 4,
    orderNumber: 'SL-0001',
    finalizationRequestedAt: null,
    trackingToken: 'tok_123',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.orderFlowV2 = true;
  mockSession.user = { id: 'user_1' };
  mockCheckPermission.mockResolvedValue(true);
  mockProfileFindFirst.mockResolvedValue({ id: 'user_1' });
  mockTransition.mockResolvedValue({
    success: true,
    payment: { version: 5 },
    eventId: 'evt_001',
  });
  mockCreateBusinessNotification.mockResolvedValue(undefined);
  mockInsert.mockReturnValue({ values: vi.fn(() => Promise.resolve([])) });
  mockUpdate.mockReturnValue({
    set: vi.fn(() => ({
      where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve([{ id: PAYMENT_ID }])) })),
    })),
  });
});

describe('requestFinalization authorization gate', () => {
  test('aborts before reading the payment when there is no session', async () => {
    mockSession.user = null;
    stubPaymentRead(actionablePayment());

    const result = await requestFinalization(PAYMENT_ID, BUSINESS_ID);

    expect(result).toEqual({ success: false, error: DENIAL });
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test('aborts before reading the payment when orders.manage is denied', async () => {
    mockCheckPermission.mockResolvedValue(false);
    stubPaymentRead(actionablePayment());

    const result = await requestFinalization(PAYMENT_ID, BUSINESS_ID);

    expect(result).toEqual({ success: false, error: DENIAL });
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test('proceeds to the state machine when orders.manage is granted', async () => {
    stubPaymentRead(actionablePayment());

    const result = await requestFinalization(PAYMENT_ID, BUSINESS_ID);

    expect(result.success).toBe(true);
    // The gate must ask for `orders.manage` on the caller's own business, in the
    // real (businessId, userId, permission) order.
    expect(mockCheckPermission).toHaveBeenCalledWith(BUSINESS_ID, 'user_1', 'orders.manage');
    // objectContaining is shallow, so `actor` deep-equals — proves the seller
    // id reaches the audit trail instead of falling back to undefined.
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: PAYMENT_ID,
        toStatus: ORDER_STATUS_V2.DELIVERED,
        actor: { type: 'seller', id: 'user_1' },
      }),
    );
  });

  test('denial outranks the not-found branch for an unknown payment', async () => {
    mockCheckPermission.mockResolvedValue(false);
    stubPaymentRead(null);

    const result = await requestFinalization('pay_missing', BUSINESS_ID);

    expect(result).toEqual({ success: false, error: DENIAL });
  });

  test('the legacy inline path is still guarded when the flow flag is off', async () => {
    mockEnv.orderFlowV2 = false;
    mockCheckPermission.mockResolvedValue(false);
    stubPaymentRead({ ...actionablePayment(), status: 'delivered' });

    const result = await requestFinalization(PAYMENT_ID, BUSINESS_ID);

    expect(result).toEqual({ success: false, error: DENIAL });
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
