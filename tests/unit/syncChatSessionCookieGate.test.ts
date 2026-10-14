// =====================================================
// syncChatSession — gated on the signed access cookie (R19 / NEW-2)
// =====================================================
// `syncChatSession` inserts/updates `chatSessions` + `messages` and was the only
// mutation in `order/[token]/actions.ts` WITHOUT a proof: `updateOrderStatus`
// and `reportIssueV2` both run `requireOrderAccess(trackingToken)` before the
// first DB read; this one did not, so an anonymous caller could create or hijack
// a chat session for an arbitrary `paymentId`.
//
// This suite deliberately does NOT mock `@/lib/orderAccessGate` or
// `@/lib/orderAccessCookie`: the REAL HMAC, payload layout and expiry run here,
// and a valid cookie is minted through the production signer
// (`setOrderAccessCookie`), so no test can agree with a broken scheme.
// =====================================================

import { setOrderAccessCookie } from '@/lib/orderAccessCookie';
import { ORDER_ACCESS_DENIED_ERROR } from '@/lib/orderAccessGate';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockEnv,
  mockChatSessionsFindFirst,
  mockPaymentsFindFirst,
  mockSelect,
  mockInsert,
  mockUpdate,
  cookieStore,
  cookiesApi,
  mockCookiesFn,
  orderLog,
} = vi.hoisted(() => {
  const cookiesMap = new Map<string, string>();
  const cookiesApi = {
    get: (name: string) =>
      cookiesMap.has(name) ? { name, value: cookiesMap.get(name) as string } : undefined,
    set: (opts: { name: string; value: string }) => {
      cookiesMap.set(opts.name, opts.value);
    },
  };
  return {
    mockEnv: { orderAccessCookieSecret: 'sync-chat-test-secret', orderFlowV2: true },
    mockChatSessionsFindFirst: vi.fn(),
    mockPaymentsFindFirst: vi.fn(),
    mockSelect: vi.fn(),
    mockInsert: vi.fn(),
    mockUpdate: vi.fn(),
    cookieStore: cookiesMap,
    cookiesApi,
    // Every `cookies()` entry records the gate marker: across this action the
    // gate is the only caller, so its position in `orderLog` is the gate's
    // position in the action — which makes the ordering assertion falsifiable.
    mockCookiesFn: vi.fn(),
    orderLog: [] as string[],
  };
});

vi.mock('@/config/env', () => ({ env: mockEnv }));

vi.mock('next/headers', () => ({
  cookies: mockCookiesFn,
  headers: vi.fn(async () => ({ get: () => null })),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/core/orders/orderService', () => ({ transition: vi.fn() }));

vi.mock('@/lib/orderAccessRateLimit', () => ({
  checkOrderAccessRateLimitFor: vi.fn(async () => ({ allowed: true })),
  resetOrderAccessRateLimit: vi.fn(),
}));

vi.mock('@/lib/rateLimit', () => ({
  getClientIdentifierFromHeaders: vi.fn(() => 'test-client'),
}));

vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      chatSessions: { findFirst: mockChatSessionsFindFirst },
      payments: { findFirst: mockPaymentsFindFirst },
    },
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  },
}));

import { syncChatSession } from '@/app/[slug]/(app)/order/[token]/actions';

const PAYMENT_ID = 'pay-sync';
const TOKEN_A = 'tok-a-sync';
const TOKEN_B = 'tok-b-sync';
const BUSINESS_ID = 'biz-sync';

function syncParams(trackingToken: string) {
  return {
    buyerName: 'Ana',
    paymentId: PAYMENT_ID,
    trackingToken,
  };
}

beforeEach(() => {
  cookieStore.clear();
  orderLog.length = 0;
  mockEnv.orderAccessCookieSecret = 'sync-chat-test-secret';

  mockCookiesFn.mockImplementation(async () => {
    orderLog.push('gate');
    return cookiesApi;
  });

  // The verified order behind the token. Authorization derives tenant + buyer
  // identity from THIS row, never from the client payload.
  mockPaymentsFindFirst.mockImplementation(async () => {
    orderLog.push('db');
    return { id: PAYMENT_ID, businessId: BUSINESS_ID, buyerDni: null };
  });

  // An exact active session for this paymentId → the reuse fast-path, so a
  // successful call never reaches `insert`/`update`.
  mockChatSessionsFindFirst.mockImplementation(async () => {
    orderLog.push('db');
    return { id: 'sess-1', guestId: 'guest-1', paymentId: PAYMENT_ID };
  });

  mockSelect.mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn() }) });
  mockInsert.mockReturnValue({
    values: vi.fn(() => ({
      returning: vi.fn(async () => [{ id: 'sess-new', guestId: 'guest-new' }]),
    })),
  });
  mockUpdate.mockReturnValue({
    set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  });
});

describe('NEW-2 — syncChatSession requires the signed access cookie', () => {
  test('no cookie: refuses with reauth_required and never touches the database', async () => {
    const result = await syncChatSession(syncParams(TOKEN_A));

    expect(result).toEqual({
      success: false,
      error: ORDER_ACCESS_DENIED_ERROR,
      reason: 'reauth_required',
    });
    expect(mockPaymentsFindFirst).not.toHaveBeenCalled();
    expect(mockChatSessionsFindFirst).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test("another order's cookie: refuses and never touches the database", async () => {
    await setOrderAccessCookie(TOKEN_A);
    orderLog.length = 0;

    const result = await syncChatSession(syncParams(TOKEN_B));

    expect(result.success).toBe(false);
    expect(result.reason).toBe('reauth_required');
    expect(mockPaymentsFindFirst).not.toHaveBeenCalled();
    expect(mockChatSessionsFindFirst).not.toHaveBeenCalled();
  });

  test('a valid cookie for this order authorizes and returns the session', async () => {
    await setOrderAccessCookie(TOKEN_A);
    orderLog.length = 0;

    const result = await syncChatSession(syncParams(TOKEN_A));

    expect(result).toEqual({ success: true, sessionId: 'sess-1', guestId: 'guest-1' });
    expect(mockChatSessionsFindFirst).toHaveBeenCalledTimes(1);
  });

  test('reads the cookie BEFORE the first DB read', async () => {
    await setOrderAccessCookie(TOKEN_A);
    orderLog.length = 0;

    await syncChatSession(syncParams(TOKEN_A));

    expect(orderLog).toContain('db');
    expect(orderLog.indexOf('gate')).toBeGreaterThanOrEqual(0);
    expect(orderLog.indexOf('gate')).toBeLessThan(orderLog.indexOf('db'));
  });

  test('a verifying cookie that resolves to no order refuses with order_not_found (NEW-2 IDOR)', async () => {
    await setOrderAccessCookie(TOKEN_A);
    // The (paymentId, trackingToken) lookup finds nothing — e.g. the caller
    // holds a real cookie for order A but passes order B's paymentId.
    mockPaymentsFindFirst.mockResolvedValueOnce(null);
    orderLog.length = 0;

    const result = await syncChatSession(syncParams(TOKEN_A));

    expect(result).toEqual({
      success: false,
      error: ORDER_ACCESS_DENIED_ERROR,
      reason: 'order_not_found',
    });
    // No sessionId/guestId is disclosed and the chat tables are never touched.
    expect(mockChatSessionsFindFirst).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('derives the guest identity from the verified order, not the client', async () => {
    await setOrderAccessCookie(TOKEN_A);
    // The order carries the buyer's DNI; the client sends none (the param no
    // longer exists), so `dni-{verified}` is the only thread it can reach.
    mockPaymentsFindFirst.mockResolvedValueOnce({
      id: PAYMENT_ID,
      businessId: BUSINESS_ID,
      buyerDni: '77777777',
    });
    // No prior session → the create path runs and mints the order-derived guestId.
    mockChatSessionsFindFirst.mockResolvedValue(null);

    const result = await syncChatSession(syncParams(TOKEN_A));

    expect(result).toEqual({ success: true, sessionId: 'sess-new', guestId: 'dni-77777777' });
  });
});
