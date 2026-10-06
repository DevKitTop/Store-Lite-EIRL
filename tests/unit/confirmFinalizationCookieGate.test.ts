// =====================================================
// confirmFinalization — typed refusal reasons (R20)
// =====================================================
// R19 made the signed cookie the gate. R20 is the other half: a refusal must
// carry a machine-readable `reason`, and that reason has to be TRUE.
//
// The split that matters:
//   * `reauth_required` — this browser no longer proves it owns the order. It is
//     RECOVERABLE: the client drops its session marker and `OrderAuthGate`
//     re-mints with DNI + order number. TTL is 1h (`orderAccessCookie.ts:47`),
//     so a buyer can always land here mid-confirmation.
//   * `order_not_actionable` — the cookie already proved ownership; the ORDER's
//     status is wrong. Labelling this `reauth_required` sends the buyer round a
//     re-mint loop that can never succeed. Mislabelling it is the real bug.
//
// This file also pins the client half (A.8): `ConfirmationFlow` owns the clear +
// refresh handoff. `localStorage` is client-side and therefore unreachable from
// a server action, which is exactly why the clear has to happen here.
// `OrderAuthGate` needs ZERO changes — its `:380-382` string is for a failed
// form submit, not a reason renderer.
// =====================================================

import type * as FinalizationActionsModule from '@/features/dashboard/actions/finalizationActions';
import { setOrderAccessCookie } from '@/lib/orderAccessCookie';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockEnv,
  mockSelect,
  mockFrom,
  mockWhere,
  mockLimit,
  mockTransition,
  cookieStore,
  cookiesApi,
  mockCookiesFn,
  mockRefresh,
  mockPush,
  // Indirection so the component can be handed a scripted result while the
  // action tests below still run the REAL implementation (same pattern as
  // `realLimiter` in verifyOrderAccess.test.ts:93).
  confirmOverride,
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
    mockEnv: { orderAccessCookieSecret: 'r20-test-secret', orderFlowV2: true },
    mockSelect: vi.fn(),
    mockFrom: vi.fn(),
    mockWhere: vi.fn(),
    mockLimit: vi.fn(),
    mockTransition: vi.fn(),
    cookieStore: cookiesMap,
    cookiesApi,
    mockCookiesFn: vi.fn(),
    mockRefresh: vi.fn(),
    mockPush: vi.fn(),
    confirmOverride: { current: null as null | ((...a: unknown[]) => Promise<unknown>) },
  };
});

vi.mock('@/config/env', () => ({ env: mockEnv }));

vi.mock('next/headers', () => ({
  cookies: mockCookiesFn,
  headers: vi.fn(async () => ({ get: () => null })),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}));

vi.mock('@/shared/components/ui', () => ({
  Icon: ({ children }: { children?: unknown }) => children ?? null,
}));

vi.mock('@/core/orders/orderService', () => ({ transition: mockTransition }));

vi.mock('@/core/database/client', () => ({
  db: {
    select: mockSelect,
    query: {
      payments: { findFirst: vi.fn(async () => null) },
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

// The component imports the real action; swap in a scripted result only while a
// component test asks for one.
vi.mock('@/features/dashboard/actions/finalizationActions', async (importOriginal) => {
  const actual = await importOriginal<typeof FinalizationActionsModule>();
  return {
    ...actual,
    confirmFinalization: (...args: unknown[]) =>
      confirmOverride.current
        ? confirmOverride.current(...args)
        : actual.confirmFinalization(...args),
  };
});

import ConfirmationFlow from '@/app/[slug]/(app)/order/[token]/ConfirmationFlow';
import { ORDER_STATUS_V2 } from '@/core/orders/orderStatus';
import { confirmFinalization } from '@/features/dashboard/actions/finalizationActions';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';

const PAYMENT_ID = 'pay_r20';
const TOKEN = 'tok-r20';
const CONFIRM_LABEL = /todo correcto/;

// ── Fixtures ─────────────────────────────────────────

/**
 * CONFIRMABLE_STATUSES is `[not_delivered, en_reparto, DELIVERED]`
 * (`orderStatus.ts:77-81`), so a fixture outside that list would refuse for the
 * wrong reason and make the "mislabelling" assertions meaningless.
 */
const CONFIRMABLE = {
  id: PAYMENT_ID,
  businessId: 'biz_123',
  orderNumber: 'SL-0001',
  status: ORDER_STATUS_V2.DELIVERED,
  version: 3,
};

function stubPaymentRow(row: Record<string, unknown> | null) {
  mockLimit.mockResolvedValue(row ? [row] : []);
  mockWhere.mockReturnValue({ limit: mockLimit });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
}

beforeEach(() => {
  cookieStore.clear();
  localStorage.clear();
  mockEnv.orderAccessCookieSecret = 'r20-test-secret';
  mockEnv.orderFlowV2 = true;
  confirmOverride.current = null;

  mockCookiesFn.mockImplementation(async () => cookiesApi);
  stubPaymentRow(CONFIRMABLE);
  mockTransition.mockResolvedValue({ success: true, payment: { version: 4 }, eventId: 'evt_1' });
});

// ── R20 — re-authentication is distinguishable ───────

describe('confirmFinalization — a lapsed cookie is re-authentication (R20)', () => {
  test('refuses with reauth_required, writes nothing, and the buyer can re-mint and retry', async () => {
    await setOrderAccessCookie(TOKEN);
    // The same valid signature, read after its 1h TTL has passed. The instant is
    // captured BEFORE the spy is installed — `Date.now()` passed straight into
    // `mockReturnValue` would read the mock's own `undefined` and yield NaN.
    const afterTtl = Date.now() + 2 * 60 * 60 * 1000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(afterTtl);

    const refused = await confirmFinalization(PAYMENT_ID, TOKEN);

    expect(refused.success).toBe(false);
    expect(refused.reason).toBe('reauth_required');
    expect(mockTransition).not.toHaveBeenCalled();

    // Recoverable: re-mint with DNI + order number, then the same call succeeds.
    await setOrderAccessCookie(TOKEN);
    nowSpy.mockRestore();

    const retried = await confirmFinalization(PAYMENT_ID, TOKEN);

    expect(retried.success).toBe(true);
    expect(retried.reason).toBeUndefined();
  });

  test('a tampered cookie is also re-authentication, not a generic denial', async () => {
    cookieStore.set(`order_access_${TOKEN}`, '9999999999999.forged');

    const result = await confirmFinalization(PAYMENT_ID, TOKEN);

    expect(result.reason).toBe('reauth_required');
    expect(mockTransition).not.toHaveBeenCalled();
  });
});

describe('confirmFinalization — a non-authentication failure is NOT mislabelled (R20)', () => {
  test('a verifying cookie on a non-confirmable order refuses as order_not_actionable', async () => {
    await setOrderAccessCookie(TOKEN);
    stubPaymentRow({ ...CONFIRMABLE, status: ORDER_STATUS_V2.ISSUE_REPORTED });

    const result = await confirmFinalization(PAYMENT_ID, TOKEN);

    // The cookie is valid here, so this is about the ORDER's state.
    // `reauth_required` would send the buyer into a re-mint loop that cannot fix
    // a status.
    expect(result.success).toBe(false);
    expect(result.reason).toBe('order_not_actionable');
    expect(result.reason).not.toBe('reauth_required');
    expect(mockTransition).not.toHaveBeenCalled();
  });

  test('a missing order refuses as order_not_found, and no re-mint can conjure it', async () => {
    await setOrderAccessCookie(TOKEN);
    stubPaymentRow(null);

    const result = await confirmFinalization(PAYMENT_ID, TOKEN);

    expect(result.reason).toBe('order_not_found');
    expect(result.reason).not.toBe('reauth_required');
    expect(mockTransition).not.toHaveBeenCalled();
  });

  // W2: the two remaining refusal paths of this action. Both are reachable with
  // a VERIFYING cookie, so neither may be reported as `reauth_required`.
  test('a transition the state machine rejects is order_not_actionable', async () => {
    await setOrderAccessCookie(TOKEN);
    mockTransition.mockResolvedValue({ success: false, error: 'Transición no permitida' });

    const result = await confirmFinalization(PAYMENT_ID, TOKEN);

    expect(result.success).toBe(false);
    expect(result.reason).toBe('order_not_actionable');
  });

  test('an unexpected throw is generic, not mislabelled as re-authentication', async () => {
    await setOrderAccessCookie(TOKEN);
    mockLimit.mockRejectedValue(new Error('socket hang up'));

    const result = await confirmFinalization(PAYMENT_ID, TOKEN);

    expect(result.reason).toBe('generic');
    expect(result.reason).not.toBe('reauth_required');
  });
});

describe('ConfirmationFlow — the reauth handoff (R20 / A.8)', () => {
  function renderFlow() {
    // `createElement`, not JSX: this suite stays a `.ts` file per the task list.
    return render(
      createElement(ConfirmationFlow, {
        paymentId: PAYMENT_ID,
        trackingToken: TOKEN,
        businessName: 'Demo',
      }),
    );
  }

  function seedSession() {
    const key = `order_session_${TOKEN}`;
    localStorage.setItem(
      key,
      JSON.stringify({ dni: '87654321', expiresAt: Date.now() + 60 * 60 * 1000 }),
    );
    return key;
  }

  test('reauth_required clears the session marker and refreshes so the gate re-mints', async () => {
    const key = seedSession();
    confirmOverride.current = async () => ({
      success: false,
      error: 'Necesitás volver a verificar tu acceso al pedido.',
      reason: 'reauth_required',
    });

    renderFlow();
    fireEvent.click(screen.getByRole('button', { name: CONFIRM_LABEL }));

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    // The stale session is what strands the buyer: `OrderAuthGate` reads it at
    // :163 and would pass on it, so it MUST be dropped here. `localStorage` is
    // unreachable from the server action — this is why the clear lives client-side.
    expect(localStorage.getItem(key)).toBeNull();
    expect(screen.getByText('Necesitás volver a verificar tu acceso al pedido.')).toBeTruthy();
  });

  test('a generic refusal shows the error but keeps the session and does not refresh', async () => {
    const key = seedSession();
    confirmOverride.current = async () => ({
      success: false,
      error: 'El pedido no está en estado de espera de confirmación.',
      reason: 'order_not_actionable',
    });

    renderFlow();
    fireEvent.click(screen.getByRole('button', { name: CONFIRM_LABEL }));

    await waitFor(() =>
      expect(
        screen.getByText('El pedido no está en estado de espera de confirmación.'),
      ).toBeTruthy(),
    );
    // Clearing here would be wrong: the buyer proved ownership, and re-minting
    // cannot fix an order that is not confirmable.
    expect(localStorage.getItem(key)).not.toBeNull();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  test('the happy path still reports success and refreshes', async () => {
    confirmOverride.current = async () => ({ success: true });

    renderFlow();
    fireEvent.click(screen.getByRole('button', { name: CONFIRM_LABEL }));

    await waitFor(() => expect(screen.getByText('Confirmado')).toBeTruthy());
    expect(mockRefresh).toHaveBeenCalled();
  });
});
