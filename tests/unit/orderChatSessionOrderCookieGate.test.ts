// =====================================================
// Order-bound chat sessions require the signed order-access cookie
// =====================================================
// `resolveSessionActor` authorized a guest on a bare `guestId === guestId`
// match. For order-bound sessions (`chatSessions.paymentId != null`) the
// guestId is `dni-{buyerDni}` — guessable from a DNI + a public businessId — so
// `fetchMessages`/`sendMessage` and the unauthenticated `getActiveChatSession`
// let anyone read (and write) a buyer's order chat.
//
// The fix: an order-bound session must ALSO carry a valid signed order-access
// cookie (R19), read server-side from the request. Anonymous storefront
// sessions (`paymentId == null`) keep their guestId-only path.
//
// Like `syncChatSessionCookieGate.test.ts`, this suite runs the REAL HMAC and
// mints cookies through the production signer, so no test can agree with a
// broken scheme.
// =====================================================

import { setOrderAccessCookie } from '@/lib/orderAccessCookie';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockEnv,
  mockChatSessionsFindFirst,
  mockPaymentsFindFirst,
  mockMessagesFindMany,
  cookieStore,
  cookiesApi,
  mockCookiesFn,
} = vi.hoisted(() => {
  const map = new Map<string, string>();
  return {
    mockEnv: { orderAccessCookieSecret: 'order-chat-gate-secret', orderFlowV2: true },
    mockChatSessionsFindFirst: vi.fn(),
    mockPaymentsFindFirst: vi.fn(),
    mockMessagesFindMany: vi.fn(),
    cookieStore: map,
    cookiesApi: {
      get: (name: string) => (map.has(name) ? { name, value: map.get(name) as string } : undefined),
      set: (o: { name: string; value: string }) => {
        map.set(o.name, o.value);
      },
    },
    mockCookiesFn: vi.fn(),
  };
});

vi.mock('@/config/env', () => ({ env: mockEnv }));

vi.mock('next/headers', () => ({ cookies: mockCookiesFn }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  })),
}));

vi.mock('@/lib/notifications', () => ({ notifyNewMessage: vi.fn() }));

vi.mock('@/lib/permissions', () => ({ checkPermission: vi.fn(async () => true) }));

vi.mock('@/lib/posthogServer', () => ({ getPostHogClient: vi.fn(() => null) }));

vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      chatSessions: { findFirst: mockChatSessionsFindFirst },
      payments: { findFirst: mockPaymentsFindFirst },
      businesses: { findFirst: vi.fn() },
      businessTeamMembers: { findFirst: vi.fn() },
      messages: { findMany: mockMessagesFindMany },
    },
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

import { fetchMessages, getActiveChatSession } from '@/features/chat/actions/chatActions';

const ORDER_TOKEN = 'order-tok-abc';
const PAYMENT_ID = 'pay-1';
const BUSINESS_ID = 'biz-1';
const ORDER_GUEST_ID = 'dni-12345678';
const STORE_GUEST_ID = 'user-uuid-1';

function orderSession() {
  return {
    id: 'sess-order',
    businessId: BUSINESS_ID,
    guestId: ORDER_GUEST_ID,
    paymentId: PAYMENT_ID,
  };
}

function storefrontSession() {
  return {
    id: 'sess-store',
    businessId: BUSINESS_ID,
    guestId: STORE_GUEST_ID,
    paymentId: null,
  };
}

beforeEach(() => {
  cookieStore.clear();
  mockEnv.orderAccessCookieSecret = 'order-chat-gate-secret';
  mockCookiesFn.mockImplementation(async () => cookiesApi);
  mockChatSessionsFindFirst.mockResolvedValue(null);
  mockPaymentsFindFirst.mockResolvedValue({ trackingToken: ORDER_TOKEN });
  mockMessagesFindMany.mockResolvedValue([]);
});

describe('fetchMessages — order-bound sessions need the order-access cookie', () => {
  test('refuses an order-bound session without the cookie and never reads messages', async () => {
    mockChatSessionsFindFirst.mockResolvedValue(orderSession());

    const result = await fetchMessages('sess-order', ORDER_GUEST_ID);

    expect(result.success).toBe(false);
    expect(result.messages).toEqual([]);
    expect(mockMessagesFindMany).not.toHaveBeenCalled();
  });

  test('allows an order-bound session when the signed cookie is present', async () => {
    await setOrderAccessCookie(ORDER_TOKEN);
    mockChatSessionsFindFirst.mockResolvedValue(orderSession());
    mockMessagesFindMany.mockResolvedValue([{ id: 'm1', sessionId: 'sess-order' }]);

    const result = await fetchMessages('sess-order', ORDER_GUEST_ID);

    expect(result.success).toBe(true);
    expect(result.messages).toHaveLength(1);
    expect(mockMessagesFindMany).toHaveBeenCalledTimes(1);
  });

  test('keeps the anonymous storefront path open (paymentId == null)', async () => {
    mockChatSessionsFindFirst.mockResolvedValue(storefrontSession());

    const result = await fetchMessages('sess-store', STORE_GUEST_ID);

    expect(result.success).toBe(true);
    expect(mockMessagesFindMany).toHaveBeenCalledTimes(1);
  });
});

describe('getActiveChatSession — order-bound sessions are not disclosed without the cookie', () => {
  test('refuses an order-bound session without the cookie (no session leaked)', async () => {
    mockChatSessionsFindFirst.mockResolvedValue(orderSession());

    const result = await getActiveChatSession(ORDER_GUEST_ID, BUSINESS_ID);

    expect(result.success).toBe(false);
    expect((result as { session?: unknown }).session).toBeUndefined();
  });

  test('discloses an order-bound session when the signed cookie is present', async () => {
    await setOrderAccessCookie(ORDER_TOKEN);
    mockChatSessionsFindFirst.mockResolvedValue(orderSession());

    const result = await getActiveChatSession(ORDER_GUEST_ID, BUSINESS_ID);

    expect(result.success).toBe(true);
  });

  test('keeps the anonymous storefront path open (paymentId == null)', async () => {
    mockChatSessionsFindFirst.mockResolvedValue(storefrontSession());

    const result = await getActiveChatSession(STORE_GUEST_ID, BUSINESS_ID);

    expect(result.success).toBe(true);
  });
});
