// =====================================================
// Order MUTATIONS gated on the signed access cookie (R19 / R20)
// =====================================================
// The three customer mutations — `updateOrderStatus`, `reportIssueV2` and
// `confirmFinalization` — were gated on `callerProof`, which lives in
// `localStorage` and is therefore forgeable by anyone who can reach the page.
// The signed httpOnly cookie (`orderAccessCookie.ts`) is the only value the
// buyer cannot forge, so it becomes the primary gate and `callerProof` demotes
// to defense-in-depth (R19).
//
// The suite deliberately does NOT mock `@/lib/orderAccessGate` or
// `@/lib/orderAccessCookie`: the REAL HMAC, the REAL payload layout and the
// REAL expiry check run here. A valid cookie is minted through the production
// mint path (`setOrderAccessCookie`), so no test re-implements the signing
// scheme and therefore none of them can agree with a broken one.
//
// What was wrong before this suite existed:
//   * with no cookie at all, all three mutations ran straight through to the
//     state machine — `confirmFinalization` had NO proof parameter at all;
//   * the DB read happened before any authorization, so an unauthorized
//     mutation still made the server touch `payments`.
// =====================================================

import { ORDER_STATUS_V2 } from '@/core/orders/orderStatus';
import { setOrderAccessCookie } from '@/lib/orderAccessCookie';
import { ORDER_ACCESS_DENIED_ERROR } from '@/lib/orderAccessGate';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockEnv,
  mockSelect,
  mockFrom,
  mockWhere,
  mockLimit,
  mockFindFirst,
  mockTransition,
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
    mockEnv: { orderAccessCookieSecret: 'r19-test-secret', orderFlowV2: true },
    mockSelect: vi.fn(),
    mockFrom: vi.fn(),
    mockWhere: vi.fn(),
    mockLimit: vi.fn(),
    mockFindFirst: vi.fn(),
    mockTransition: vi.fn(),
    cookieStore: cookiesMap,
    cookiesApi,
    // Every `cookies()` entry records the cookie-gate marker: across these three
    // actions the gate is the ONLY caller, so its position in `orderLog` is the
    // gate's position in the action. This is what makes the call-order
    // assertion below falsifiable rather than decorative.
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

vi.mock('@/core/orders/orderService', () => ({ transition: mockTransition }));

vi.mock('@/core/database/client', () => ({
  db: {
    select: mockSelect,
    // `verifyCallerProof` (actions.ts:23) and `getAuthenticatedUserId` read here.
    query: {
      payments: { findFirst: mockFindFirst },
      profiles: { findFirst: vi.fn(async () => ({ id: 'user_1' })) },
      chatSessions: { findFirst: vi.fn(async () => null) },
      businesses: { findFirst: vi.fn(async () => ({ id: 'biz_123', slug: 'demo' })) },
    },
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock('@/lib/permissions', () => ({ checkPermission: vi.fn(async () => true) }));
vi.mock('@/lib/notifications', () => ({ createBusinessNotification: vi.fn() }));
vi.mock('@/lib/incompleteOrderRate', () => ({ checkIncompleteOrderDeactivation: vi.fn() }));
vi.mock('@/lib/deactivation', () => ({ processOrderCompletion: vi.fn() }));

import { reportIssueV2, updateOrderStatus } from '@/app/[slug]/(app)/order/[token]/actions';
import { confirmFinalization } from '@/features/dashboard/actions/finalizationActions';

// ── Fixtures ─────────────────────────────────────────

const PAYMENT_ID = 'pay_r19';
const TOKEN_A = 'tok-a-r19';
const TOKEN_B = 'tok-b-r19';
const DNI = '87654321';

/**
 * A row that every mutation would happily act on if the gate let it through.
 * DELIVERED is inside CONFIRMABLE_STATUSES (`orderStatus.ts:77-81`), so
 * `confirmFinalization` would otherwise refuse for a status reason and the
 * gate-ordering assertions would pass for the wrong cause.
 */
function actionablePayment() {
  return {
    id: PAYMENT_ID,
    businessId: 'biz_123',
    orderNumber: 'SL-0001',
    status: ORDER_STATUS_V2.DELIVERED,
    version: 3,
  };
}

beforeEach(() => {
  cookieStore.clear();
  orderLog.length = 0;
  mockEnv.orderAccessCookieSecret = 'r19-test-secret';
  mockEnv.orderFlowV2 = true;

  mockCookiesFn.mockImplementation(async () => {
    orderLog.push('gate');
    return cookiesApi;
  });

  mockSelect.mockImplementation(() => {
    orderLog.push('db');
    return { from: mockFrom };
  });
  mockLimit.mockResolvedValue([actionablePayment()]);
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockFrom.mockReturnValue({ where: mockWhere });

  mockFindFirst.mockResolvedValue({ id: PAYMENT_ID, buyerDni: DNI, metadata: null });
  mockTransition.mockResolvedValue({ success: true, payment: { version: 4 }, eventId: 'evt_1' });
});

/**
 * Mints a genuinely valid cookie through the production signer, then rewinds the
 * call-order log so the mint itself never counts as the gate running inside the
 * action under test.
 */
async function mintValidCookie(trackingToken: string) {
  await setOrderAccessCookie(trackingToken);
  orderLog.length = 0;
}

// ── R19 — the cookie is the authority ─────────────────

describe('R19 — a mutation with no access cookie refuses and writes nothing', () => {
  test('updateOrderStatus refuses before the DB read and never transitions', async () => {
    const result = await updateOrderStatus(PAYMENT_ID, TOKEN_A, 'delivered');

    expect(result).toEqual({
      success: false,
      error: ORDER_ACCESS_DENIED_ERROR,
      reason: 'reauth_required',
    });
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test('reportIssueV2 refuses before the DB read and never transitions', async () => {
    const result = await reportIssueV2(PAYMENT_ID, TOKEN_A, 'se rompió');

    expect(result).toEqual({
      success: false,
      error: ORDER_ACCESS_DENIED_ERROR,
      reason: 'reauth_required',
    });
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test('confirmFinalization refuses before the DB read and never transitions', async () => {
    const result = await confirmFinalization(PAYMENT_ID, TOKEN_A);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('reauth_required');
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockTransition).not.toHaveBeenCalled();
  });

  // R19 says callerProof "MUST NOT be the primary gate". Its absence must not
  // authorize — and its PRESENCE must not authorize either, or a forged
  // localStorage value buys a mutation on its own.
  test('a matching callerProof does not substitute for the cookie', async () => {
    const result = await updateOrderStatus(PAYMENT_ID, TOKEN_A, 'delivered', {
      callerProof: { dni: DNI },
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('reauth_required');
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test('a matching callerProof does not substitute for the cookie on reportIssueV2', async () => {
    const result = await reportIssueV2(PAYMENT_ID, TOKEN_A, 'se rompió', { dni: DNI });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('reauth_required');
    expect(mockTransition).not.toHaveBeenCalled();
  });
});

describe('R19 — a tampered cookie is refused', () => {
  test('a valid signature over the wrong expiry is refused (attacker-chosen expMs)', async () => {
    // Minted for real, then the expiry rewritten: the payload is covered by the
    // HMAC, so the rewrite invalidates the signature.
    await setOrderAccessCookie(TOKEN_A);
    const forged = cookieStore.get(`order_access_${TOKEN_A}`) as string;
    const [, signature] = forged.split('.');
    cookieStore.set(`order_access_${TOKEN_A}`, `${8_000_000_000_000}.${signature}`);
    orderLog.length = 0;

    const result = await updateOrderStatus(PAYMENT_ID, TOKEN_A, 'delivered');

    expect(result.success).toBe(false);
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test('a truncated cookie with no signature separator is refused', async () => {
    cookieStore.set(`order_access_${TOKEN_A}`, '1234567890');
    orderLog.length = 0;

    const result = await updateOrderStatus(PAYMENT_ID, TOKEN_A, 'delivered');

    expect(result.success).toBe(false);
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test('an attacker-guessable signature is refused', async () => {
    cookieStore.set(`order_access_${TOKEN_A}`, `${8_000_000_000_000}.notarealsignature`);
    orderLog.length = 0;

    const result = await reportIssueV2(PAYMENT_ID, TOKEN_A, 'se rompió');

    expect(result.success).toBe(false);
    expect(mockTransition).not.toHaveBeenCalled();
  });
});

describe('R19 — a valid cookie authorizes, with or without a callerProof', () => {
  test('a valid cookie plus a matching callerProof proceeds', async () => {
    await mintValidCookie(TOKEN_A);

    const result = await updateOrderStatus(PAYMENT_ID, TOKEN_A, 'delivered', {
      callerProof: { dni: DNI },
    });

    expect(result).toEqual({ success: true });
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: PAYMENT_ID, actor: { type: 'customer' } }),
    );
  });

  test('a valid cookie with NO callerProof still proceeds — the cookie is the authority', async () => {
    await mintValidCookie(TOKEN_A);

    const result = await updateOrderStatus(PAYMENT_ID, TOKEN_A, 'delivered');

    expect(result).toEqual({ success: true });
    // A missing proof must not deny, so the proof check is never even consulted.
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockTransition).toHaveBeenCalledTimes(1);
  });

  test('another order\u2019s cookie does not authorize (the token is inside the signature)', async () => {
    await mintValidCookie(TOKEN_A);

    const result = await updateOrderStatus(PAYMENT_ID, TOKEN_B, 'delivered');

    expect(result.success).toBe(false);
    expect(result.reason).toBe('reauth_required');
    expect(mockTransition).not.toHaveBeenCalled();
  });
});

describe('R19 — the gate runs BEFORE the first DB read (all three actions)', () => {
  test('updateOrderStatus reads the cookie before it touches the database', async () => {
    await mintValidCookie(TOKEN_A);

    await updateOrderStatus(PAYMENT_ID, TOKEN_A, 'delivered');

    expect(orderLog).toContain('db');
    // The gate must actually have run: `indexOf` alone returns -1 when it did
    // not, and -1 < 0 would pass vacuously.
    expect(orderLog.indexOf('gate')).toBeGreaterThanOrEqual(0);
    expect(orderLog.indexOf('gate')).toBeLessThan(orderLog.indexOf('db'));
  });

  test('reportIssueV2 reads the cookie before it touches the database', async () => {
    await mintValidCookie(TOKEN_A);

    await reportIssueV2(PAYMENT_ID, TOKEN_A, 'se rompió');

    expect(orderLog).toContain('db');
    // The gate must actually have run: `indexOf` alone returns -1 when it did
    // not, and -1 < 0 would pass vacuously.
    expect(orderLog.indexOf('gate')).toBeGreaterThanOrEqual(0);
    expect(orderLog.indexOf('gate')).toBeLessThan(orderLog.indexOf('db'));
  });

  test('confirmFinalization reads the cookie before it touches the database', async () => {
    await mintValidCookie(TOKEN_A);

    await confirmFinalization(PAYMENT_ID, TOKEN_A);

    expect(orderLog).toContain('db');
    // The gate must actually have run: `indexOf` alone returns -1 when it did
    // not, and -1 < 0 would pass vacuously.
    expect(orderLog.indexOf('gate')).toBeGreaterThanOrEqual(0);
    expect(orderLog.indexOf('gate')).toBeLessThan(orderLog.indexOf('db'));
  });
});

describe('R20 — every refusal carries a machine-readable reason', () => {
  test('updateOrderStatus reports reauth_required, not a bare boolean', async () => {
    const result = await updateOrderStatus(PAYMENT_ID, TOKEN_A, 'delivered');

    expect(result.reason).toBe('reauth_required');
  });

  test('reportIssueV2 reports reauth_required, not a bare boolean', async () => {
    const result = await reportIssueV2(PAYMENT_ID, TOKEN_A, 'se rompió');

    expect(result.reason).toBe('reauth_required');
  });

  test('confirmFinalization reports reauth_required, not a bare boolean', async () => {
    const result = await confirmFinalization(PAYMENT_ID, TOKEN_A);

    expect(result.reason).toBe('reauth_required');
  });
});

describe('R19 — a lapsed cookie reads as re-authentication, not a generic denial', () => {
  test('the same signature expires with the clock and stops authorizing', async () => {
    await mintValidCookie(TOKEN_A);
    expect((await updateOrderStatus(PAYMENT_ID, TOKEN_A, 'delivered')).success).toBe(true);

    // 1h TTL (`orderAccessCookie.ts:47`), jumped past without touching the value.
    // The instant is captured BEFORE the spy is installed — `Date.now()` passed
    // straight into `mockReturnValue` would read the mock's own `undefined`
    // and mint a NaN expiry, which would fail for the wrong reason.
    const afterTtl = Date.now() + 2 * 60 * 60 * 1000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(afterTtl);
    const result = await updateOrderStatus(PAYMENT_ID, TOKEN_A, 'delivered');
    nowSpy.mockRestore();

    expect(result.reason).toBe('reauth_required');
    expect(mockTransition).toHaveBeenCalledTimes(1);
  });

  test('an empty secret denies everything (R18 fails closed, so R19 fails with it)', async () => {
    await mintValidCookie(TOKEN_A);
    mockEnv.orderAccessCookieSecret = '';

    const result = await updateOrderStatus(PAYMENT_ID, TOKEN_A, 'delivered');

    expect(result.reason).toBe('reauth_required');
    expect(mockTransition).not.toHaveBeenCalled();
  });
});
