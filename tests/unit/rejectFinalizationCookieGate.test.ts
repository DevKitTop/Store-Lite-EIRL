// =====================================================
// rejectFinalization — gated on the signed access cookie (R19 / R20)
// =====================================================
// C1 (verify report #1187): `rejectFinalization` is a customer order mutation
// exported from a `'use server'` file, so it IS an HTTP endpoint — but it ran
// no authorization at all. Its only check was the exact pre-R19 predicate the
// slice exists to kill:
//
//   where(and(eq(payments.id, paymentId), eq(payments.trackingToken, token)))
//
// `trackingToken` is the order page's URL segment, so anyone holding
// (paymentId, token) could flip a buyer's order to ISSUE_REPORTED / DISPUTED,
// clear `completedAt`, notify the seller and inject a chat message into the
// buyer's own session. The audit missed this action for the same reason it
// missed `confirmFinalization`: neither takes a `callerProof` parameter, so a
// signature scan for "actions with an optional proof argument" skips both.
//
// Like the existing gate suites, this file does NOT mock `@/lib/orderAccessGate`
// or `@/lib/orderAccessCookie`. The REAL HMAC, payload layout and expiry check
// run, and a valid cookie is minted through the production signer
// (`setOrderAccessCookie`), so no test here can agree with a broken signature.
//
// CALL-ORDER INSTRUMENT — deliberately wider than its predecessor. The
// `orderMutationCookieGate` instrument pushed `'db'` from `db.select()` only, so
// a gate placed after a `db.query.*.findFirst` read would still have passed its
// ordering assertion. Here every DB entry point pushes: `db.select`,
// `db.update`, `db.insert`, and every `db.query.<table>.findFirst`.
// =====================================================

import { ORDER_STATUS_V2 } from '@/core/orders/orderStatus';
import { setOrderAccessCookie } from '@/lib/orderAccessCookie';
import { ORDER_ACCESS_DENIED_ERROR } from '@/lib/orderAccessGate';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockEnv, orderLog, cookiesMap, cookiesApi, mocks } = vi.hoisted(() => {
  const orderLog: string[] = [];
  const cookiesMap = new Map<string, string>();
  const cookiesApi = {
    get: (name: string) =>
      cookiesMap.has(name) ? { name, value: cookiesMap.get(name) as string } : undefined,
    set: (opts: { name: string; value: string }) => {
      cookiesMap.set(opts.name, opts.value);
    },
  };
  return {
    orderLog,
    cookiesMap,
    cookiesApi,
    mockEnv: { orderAccessCookieSecret: 'c1-test-secret', orderFlowV2: true },
    mocks: {
      // The cookie gate is the only caller of `cookies()` in this action, so its
      // position in `orderLog` IS the gate's position in the action.
      cookies: vi.fn(),
      select: vi.fn(),
      from: vi.fn(),
      update: vi.fn(),
      insert: vi.fn(),
      where: vi.fn(),
      limit: vi.fn(),
      paymentsFindFirst: vi.fn(),
      profilesFindFirst: vi.fn(),
      chatSessionsFindFirst: vi.fn(),
      businessesFindFirst: vi.fn(),
      transition: vi.fn(),
      notify: vi.fn(),
    },
  };
});

vi.mock('@/config/env', () => ({ env: mockEnv }));

vi.mock('next/headers', () => ({
  cookies: mocks.cookies,
  headers: vi.fn(async () => ({ get: () => null })),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@/core/orders/orderService', () => ({ transition: mocks.transition }));

// Every DB entry point records `db`, not just `db.select` — see the header.
vi.mock('@/core/database/client', () => ({
  db: {
    select: (...args: unknown[]) => {
      orderLog.push('db');
      return mocks.select(...args);
    },
    update: (...args: unknown[]) => {
      orderLog.push('db');
      return mocks.update(...args);
    },
    insert: (...args: unknown[]) => {
      orderLog.push('db');
      return mocks.insert(...args);
    },
    query: {
      payments: {
        findFirst: (...args: unknown[]) => {
          orderLog.push('db');
          return mocks.paymentsFindFirst(...args);
        },
      },
      profiles: { findFirst: (...args: unknown[]) => mocks.profilesFindFirst(...args) },
      chatSessions: {
        findFirst: (...args: unknown[]) => {
          orderLog.push('db');
          return mocks.chatSessionsFindFirst(...args);
        },
      },
      businesses: {
        findFirst: (...args: unknown[]) => {
          orderLog.push('db');
          return mocks.businessesFindFirst(...args);
        },
      },
    },
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock('@/lib/permissions', () => ({ checkPermission: vi.fn(async () => true) }));
vi.mock('@/lib/notifications', () => ({ createBusinessNotification: mocks.notify }));
vi.mock('@/lib/incompleteOrderRate', () => ({ checkIncompleteOrderDeactivation: vi.fn() }));
vi.mock('@/lib/deactivation', () => ({ processOrderCompletion: vi.fn() }));

import { rejectFinalization } from '@/features/dashboard/actions/finalizationActions';

// ── Fixtures ─────────────────────────────────────────

const PAYMENT_ID = 'pay_c1';
const TOKEN = 'tok-c1';
const REASON = 'NOT_RECEIVED';

/**
 * DELIVERED is inside CONFIRMABLE_STATUSES (`orderStatus.ts:77-81`), so a
 * fixture outside that list would refuse for a status reason and every
 * gate-ordering assertion would pass for the wrong cause.
 */
const REJECTABLE = {
  id: PAYMENT_ID,
  businessId: 'biz_123',
  orderNumber: 'SL-0001',
  status: ORDER_STATUS_V2.DELIVERED,
  version: 3,
};

function stubPaymentRow(row: Record<string, unknown> | null) {
  mocks.limit.mockResolvedValue(row ? [row] : []);
}

beforeEach(() => {
  cookiesMap.clear();
  orderLog.length = 0;
  mockEnv.orderAccessCookieSecret = 'c1-test-secret';
  mockEnv.orderFlowV2 = true;

  mocks.cookies.mockImplementation(async () => {
    orderLog.push('gate');
    return cookiesApi;
  });

  mocks.select.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue({ where: mocks.where });
  mocks.where.mockReturnValue({ limit: mocks.limit });
  mocks.limit.mockResolvedValue([REJECTABLE]);
  mocks.chatSessionsFindFirst.mockResolvedValue(null);
  mocks.businessesFindFirst.mockResolvedValue({ id: 'biz_123', slug: 'demo' });
  mocks.insert.mockReturnValue({ values: vi.fn(async () => undefined) });
  mocks.transition.mockResolvedValue({ success: true, payment: { version: 4 }, eventId: 'evt_1' });
  mocks.notify.mockResolvedValue(undefined);
});

/** Mints a genuinely valid cookie, then rewinds the log past the mint itself. */
async function mintValidCookie() {
  await setOrderAccessCookie(TOKEN);
  orderLog.length = 0;
}

const reject = () => rejectFinalization(PAYMENT_ID, TOKEN, REASON);

// ── C1 — the action is gated ─────────────────────────

describe('rejectFinalization — no cookie means no mutation (R19)', () => {
  test('refuses with a typed reason and writes nothing', async () => {
    const result = await reject();

    expect(result).toEqual({
      success: false,
      error: ORDER_ACCESS_DENIED_ERROR,
      reason: 'reauth_required',
    });
    // The vulnerable version transitioned to ISSUE_REPORTED, notified the seller
    // and injected a chat message into the buyer's own session.
    expect(mocks.transition).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test('refuses BEFORE any database read — no select, no update, no findFirst', async () => {
    await reject();

    // `db` is pushed by select, update, insert AND query.*.findFirst, so this is
    // not merely "the payment select was skipped".
    expect(orderLog).not.toContain('db');
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test('a localStorage-shaped proof forwarded as an extra argument buys nothing', async () => {
    // `rejectFinalization` has NO proof parameter — that is precisely why the
    // original audit missed it. JS still lets a caller append arguments, so the
    // security property is that the sibling actions' proof object authorizes
    // nothing here either. Cast: the signature genuinely has no such parameter.
    const withProof = rejectFinalization as unknown as (
      paymentId: string,
      token: string,
      reason: string,
      proof: { dni: string },
    ) => Promise<Awaited<ReturnType<typeof reject>>>;

    const result = await withProof(PAYMENT_ID, TOKEN, REASON, { dni: '87654321' });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('reauth_required');
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  test('a lapsed cookie is refused as re-authentication, not as a generic denial', async () => {
    await mintValidCookie();
    // Captured BEFORE the spy is installed: `Date.now()` passed straight into
    // `mockReturnValue` reads the mock's own `undefined` and mints a NaN expiry,
    // which would make this pass for the wrong reason.
    const afterTtl = Date.now() + 2 * 60 * 60 * 1000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(afterTtl);

    const result = await reject();
    nowSpy.mockRestore();

    expect(result.reason).toBe('reauth_required');
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  test('a tampered cookie is refused the same way', async () => {
    await mintValidCookie();
    const forged = cookiesMap.get(`order_access_${TOKEN}`) as string;
    const [, signature] = forged.split('.');
    cookiesMap.set(`order_access_${TOKEN}`, `${8_000_000_000_000}.${signature}`);
    orderLog.length = 0;

    const result = await reject();

    expect(result.reason).toBe('reauth_required');
    expect(mocks.transition).not.toHaveBeenCalled();
  });
});

describe('rejectFinalization — a verifying cookie authorizes (R19 / R20)', () => {
  test('a valid cookie proceeds to ISSUE_REPORTED', async () => {
    await mintValidCookie();

    const result = await reject();

    expect(result.success).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(mocks.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: PAYMENT_ID,
        toStatus: ORDER_STATUS_V2.ISSUE_REPORTED,
        actor: { type: 'customer' },
      }),
    );
  });

  test('the gate runs before the first DB read — non-vacuous ordering', async () => {
    await mintValidCookie();

    await reject();

    // Both needles must be present before the comparison, or `indexOf` returns
    // -1 and `-1 < 0` passes for the wrong reason.
    expect(orderLog).toContain('gate');
    expect(orderLog).toContain('db');
    expect(orderLog.indexOf('gate')).toBeGreaterThanOrEqual(0);
    expect(orderLog.indexOf('gate')).toBeLessThan(orderLog.indexOf('db'));
  });

  test('a missing order refuses as order_not_found, and no re-mint can conjure it', async () => {
    await mintValidCookie();
    stubPaymentRow(null);

    const result = await reject();

    expect(result.success).toBe(false);
    expect(result.reason).toBe('order_not_found');
    expect(result.reason).not.toBe('reauth_required');
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  test('a non-confirmable order refuses as order_not_actionable', async () => {
    await mintValidCookie();
    stubPaymentRow({ ...REJECTABLE, status: ORDER_STATUS_V2.ISSUE_REPORTED });

    const result = await reject();

    // The cookie already proved ownership, so this is about the ORDER's state.
    expect(result.reason).toBe('order_not_actionable');
    expect(result.reason).not.toBe('reauth_required');
    expect(mocks.transition).not.toHaveBeenCalled();
  });

  test('a transition the state machine rejects is order_not_actionable, never a bare boolean', async () => {
    await mintValidCookie();
    mocks.transition.mockResolvedValue({ success: false, error: 'Transición no permitida' });

    const result = await reject();

    expect(result.success).toBe(false);
    expect(result.reason).toBe('order_not_actionable');
  });

  test('an unexpected failure is labelled generic, not mislabelled as re-authentication', async () => {
    await mintValidCookie();
    mocks.limit.mockRejectedValue(new Error('connection reset'));

    const result = await reject();

    expect(result.success).toBe(false);
    // A dead socket is not an authorization problem: sending the buyer round the
    // re-mint loop for it would be a lie they can act on.
    expect(result.reason).toBe('generic');
    expect(result.reason).not.toBe('reauth_required');
  });
});
