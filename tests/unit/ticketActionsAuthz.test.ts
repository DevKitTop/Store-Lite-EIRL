import { beforeEach, describe, expect, test, vi } from 'vitest';

// =====================================================
// TICKET ACTIONS — orders.manage authorization gate
// =====================================================
// Every seller order action must resolve the actor and check `orders.manage`
// BEFORE the first DB read and OUTSIDE the `env.orderFlowV2` branch, so an
// unauthorized caller can never reach the payment row (spec R2) and an
// unresolved actor is a hard abort (spec R3 / design D6).

const {
  mockEnv,
  mockSelect,
  mockFrom,
  mockWhere,
  mockLimit,
  mockTransition,
  mockCheckPermission,
  mockProfileFindFirst,
  mockUpload,
  mockGetPublicUrl,
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
    mockUpload: vi.fn(),
    mockGetPublicUrl: vi.fn(),
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

vi.mock('@/core/database/client', () => ({
  db: {
    select: mockSelect,
    // getAuthenticatedUserId uses profiles.findFirst as an FK guard. Returning a
    // row keeps it off the db.insert auto-create branch.
    query: { profiles: { findFirst: mockProfileFindFirst } },
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
      }),
    },
  }),
}));

import { ORDER_STATUS, ORDER_STATUS_V2 } from '@/core/orders/orderStatus';
import {
  confirmPickedUp,
  markReadyForPickup,
  notifyDelivery,
  prepareOrder,
  uploadTicketAndUpdatePayment,
} from '@/features/dashboard/actions/ticketActions';

const PAYMENT_ID = 'pay_123';
const BUSINESS_ID = 'biz_123';
const PICKUP_CODE = 'SL-ABCD1234-EFGH5678';
const TICKET_BASE64 = 'data:image/png;base64,aGk=';
const DENIAL = 'No tienes permisos para este pedido';

// Actions under test, each with the payment row it must read and the V2 status
// its authorized transition targets.
const ACTIONS = [
  {
    name: 'uploadTicketAndUpdatePayment',
    invoke: () => uploadTicketAndUpdatePayment(PAYMENT_ID, TICKET_BASE64, BUSINESS_ID),
    payment: () => ({ trackingToken: 'tok_123', businessId: BUSINESS_ID, version: 1 }),
    toStatus: ORDER_STATUS_V2.WAITING_CUSTOMER_CONFIRMATION,
  },
  {
    name: 'notifyDelivery',
    invoke: () => notifyDelivery(PAYMENT_ID, BUSINESS_ID),
    payment: () => ({ status: ORDER_STATUS.DELIVERED, businessId: BUSINESS_ID, version: 1 }),
    toStatus: ORDER_STATUS_V2.IN_TRANSIT,
  },
  {
    name: 'prepareOrder',
    invoke: () => prepareOrder(PAYMENT_ID, BUSINESS_ID),
    payment: () => ({
      status: ORDER_STATUS.VALIDANDO,
      businessId: BUSINESS_ID,
      version: 1,
    }),
    toStatus: ORDER_STATUS_V2.PREPARING_ORDER,
  },
  {
    name: 'markReadyForPickup',
    invoke: () => markReadyForPickup(PAYMENT_ID, BUSINESS_ID),
    payment: () => ({
      status: ORDER_STATUS_V2.PREPARING_ORDER,
      businessId: BUSINESS_ID,
      version: 1,
    }),
    toStatus: ORDER_STATUS_V2.READY_FOR_PICKUP,
  },
  {
    name: 'confirmPickedUp',
    invoke: () => confirmPickedUp(PAYMENT_ID, BUSINESS_ID, PICKUP_CODE),
    payment: () => ({
      status: ORDER_STATUS_V2.READY_FOR_PICKUP,
      businessId: BUSINESS_ID,
      version: 1,
      pickupCode: PICKUP_CODE,
      trackingToken: 'tok_123',
      businessSlug: 'demo',
    }),
    toStatus: ORDER_STATUS_V2.PICKED_UP,
  },
];

/** Wire the payment read so an unauthorized caller WOULD find a valid row. */
function stubPaymentRead(payment: Record<string, unknown> | null) {
  mockLimit.mockResolvedValue(payment ? [payment] : []);
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockFrom.mockReturnValue({
    where: mockWhere,
    innerJoin: vi.fn(() => ({ where: mockWhere })),
  });
  mockSelect.mockReturnValue({ from: mockFrom });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnv.orderFlowV2 = true;
  mockSession.user = { id: 'user_1' };
  mockCheckPermission.mockResolvedValue(true);
  mockProfileFindFirst.mockResolvedValue({ id: 'user_1' });
  mockTransition.mockResolvedValue({
    success: true,
    payment: { version: 1 },
    eventId: 'evt_001',
  });
  mockUpload.mockResolvedValue({ data: {}, error: null });
  mockGetPublicUrl.mockReturnValue({ data: { publicUrl: 'https://cdn.test/ticket.jpg' } });
});

describe.each(ACTIONS)('$name authorization gate', (action) => {
  test('aborts before reading the payment when there is no session', async () => {
    mockSession.user = null;
    stubPaymentRead(action.payment());

    const result = await action.invoke();

    expect(result).toEqual({ success: false, error: DENIAL });
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test('aborts before reading the payment when orders.manage is denied', async () => {
    mockCheckPermission.mockResolvedValue(false);
    stubPaymentRead(action.payment());

    const result = await action.invoke();

    expect(result).toEqual({ success: false, error: DENIAL });
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test('proceeds to the state machine when orders.manage is granted', async () => {
    stubPaymentRead(action.payment());

    const result = await action.invoke();

    expect(result.success).toBe(true);
    // The gate must ask for `orders.manage` on the caller's own business, in the
    // real (businessId, userId, permission) order.
    expect(mockCheckPermission).toHaveBeenCalledWith(BUSINESS_ID, 'user_1', 'orders.manage');
    // objectContaining is shallow, so `actor` deep-equals — proves the seller
    // id reaches the audit trail instead of falling back to undefined.
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: PAYMENT_ID,
        toStatus: action.toStatus,
        actor: { type: 'seller', id: 'user_1' },
      }),
    );
  });
});

describe('gate precedence', () => {
  test('denial outranks the orderFlowV2 error when the flow flag is off', async () => {
    mockEnv.orderFlowV2 = false;
    mockCheckPermission.mockResolvedValue(false);
    stubPaymentRead(
      ACTIONS.find((a) => a.name === 'markReadyForPickup')!.payment() as Record<string, unknown>,
    );

    const result = await markReadyForPickup(PAYMENT_ID, BUSINESS_ID);

    expect(result).toEqual({ success: false, error: DENIAL });
    expect(result.error).not.toContain('orderFlowV2');
  });

  test('denial outranks the not-found branch for an unknown payment', async () => {
    mockCheckPermission.mockResolvedValue(false);
    stubPaymentRead(null);

    const result = await markReadyForPickup('pay_missing', BUSINESS_ID);

    expect(result).toEqual({ success: false, error: DENIAL });
    expect(result.error).not.toContain('Pedido no encontrado');
  });

  test('the legacy inline path is still guarded when the flow flag is off', async () => {
    mockEnv.orderFlowV2 = false;
    mockCheckPermission.mockResolvedValue(false);
    stubPaymentRead({
      status: ORDER_STATUS.DELIVERED,
      businessId: BUSINESS_ID,
      version: 1,
    });

    const result = await notifyDelivery(PAYMENT_ID, BUSINESS_ID);

    expect(result).toEqual({ success: false, error: DENIAL });
    expect(mockSelect).not.toHaveBeenCalled();
  });
});
