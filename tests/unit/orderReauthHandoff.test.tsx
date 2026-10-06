// =====================================================
// The re-authentication handoff, end to end (R20 / W1 / W3)
// =====================================================
// W1: `router.refresh()` does NOT re-trigger `OrderAuthGate`. Its `checkAuth`
// effect (`OrderAuthGate.tsx:217`) depends on `[storageKey, searchParams, token,
// pathname, router]` and none of those change on an in-place refresh — the URL
// is identical and `useRouter()` returns a stable reference — so `checkAuth`
// never re-runs, `isAuthenticated` stays `true`, and the buyer is never
// re-prompted. The unit test stubs `useRouter`, so it CANNOT detect this: a stub
// has no deps and no re-render, and `mockRefresh` returns a promise nobody
// awaits. This suite therefore pins the mechanism that actually heals the
// page — a real `window.location.reload()` — while leaving `useRouter` alone.
//
// The reload is observed by swapping `window.location` for a spy-bearing copy
// (`Object.defineProperty` works on jsdom 29; `vi.spyOn(window.location,
// 'reload')` does NOT, because Location's members are [Unforgeable]). The
// production code still calls `window.location.reload()` itself.
//
// W3: three of the four customer mutation surfaces read `res.error` and ignore
// `res.reason`, so a buyer whose cookie lapsed was stranded on a page whose gate
// still believes it is authenticated. Each of them now performs the same
// handoff: drop the stale `order_session_{token}` marker, refresh, reload.
// =====================================================

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { mockRefresh, overrides } = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
  overrides: {
    confirmFinalization: null as null | ((...a: unknown[]) => Promise<unknown>),
    rejectFinalization: null as null | ((...a: unknown[]) => Promise<unknown>),
    updateOrderStatus: null as null | ((...a: unknown[]) => Promise<unknown>),
    reportIssueV2: null as null | ((...a: unknown[]) => Promise<unknown>),
  },
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }) }));

vi.mock('@/shared/components/ui', () => ({
  Icon: ({ children }: { children?: unknown }) => children ?? null,
}));

vi.mock('@/features/dashboard/actions/finalizationActions', () => ({
  confirmFinalization: (...args: unknown[]) =>
    overrides.confirmFinalization
      ? overrides.confirmFinalization(...args)
      : Promise.resolve({ success: false, error: 'no script configured' }),
  rejectFinalization: (...args: unknown[]) =>
    overrides.rejectFinalization
      ? overrides.rejectFinalization(...args)
      : Promise.resolve({ success: false, error: 'no script configured' }),
}));

vi.mock('@/app/[slug]/(app)/order/[token]/actions', () => ({
  updateOrderStatus: (...args: unknown[]) =>
    overrides.updateOrderStatus
      ? overrides.updateOrderStatus(...args)
      : Promise.resolve({ success: false, error: 'no script configured' }),
  reportIssueV2: (...args: unknown[]) =>
    overrides.reportIssueV2
      ? overrides.reportIssueV2(...args)
      : Promise.resolve({ success: false, error: 'no script configured' }),
}));

import ActionModals from '@/app/[slug]/(app)/order/[token]/ActionModals';
import ConfirmationFlow from '@/app/[slug]/(app)/order/[token]/ConfirmationFlow';
import ReportFlow from '@/app/[slug]/(app)/order/[token]/ReportFlow';
import ReportV2Flow from '@/app/[slug]/(app)/order/[token]/ReportV2Flow';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const TOKEN = 'tok-handoff';
const PAYMENT_ID = 'pay_handoff';
const DENIED = 'Necesitás volver a verificar tu acceso al pedido.';

let reloadSpy: ReturnType<typeof vi.fn>;
let originalLocation: Location;
let alertSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  overrides.confirmFinalization = null;
  overrides.rejectFinalization = null;
  overrides.updateOrderStatus = null;
  overrides.reportIssueV2 = null;
  mockRefresh.mockReset();

  originalLocation = window.location;
  reloadSpy = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      href: originalLocation.href,
      origin: originalLocation.origin,
      pathname: originalLocation.pathname,
      search: originalLocation.search,
      hash: originalLocation.hash,
      reload: reloadSpy,
    },
  });
  alertSpy = vi.fn();
  Object.defineProperty(window, 'alert', { configurable: true, writable: true, value: alertSpy });

  localStorage.setItem(
    `order_session_${TOKEN}`,
    JSON.stringify({ dni: '87654321', expiresAt: Date.now() + 60 * 60 * 1000 }),
  );
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
  localStorage.clear();
});

const reauth = { success: false, error: DENIED, reason: 'reauth_required' };
const generic = {
  success: false,
  error: 'El pedido no está en estado de espera.',
  reason: 'order_not_actionable',
};

function seedAction<T extends keyof typeof overrides>(key: T, result: unknown) {
  overrides[key] = vi.fn(async () => result) as (typeof overrides)[T];
}

function sessionKey() {
  return `order_session_${TOKEN}`;
}

/**
 * The one assertion that matters for W1: the page was genuinely reloaded, not
 * merely refreshed in place.
 */
function expectFullReload() {
  expect(reloadSpy).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(sessionKey())).toBeNull();
}

// ── ConfirmationFlow ─────────────────────────────────

describe('ConfirmationFlow — re-auth handoff (W1)', () => {
  test('a lapsed cookie drops the marker and forces a REAL reload', async () => {
    seedAction('confirmFinalization', reauth);
    render(<ConfirmationFlow paymentId={PAYMENT_ID} trackingToken={TOKEN} businessName="Demo" />);

    fireEvent.click(screen.getByRole('button', { name: /todo correcto/ }));

    await waitFor(() => expect(reloadSpy).toHaveBeenCalled());
    // `refresh` alone cannot re-run `OrderAuthGate`'s effect, so it is not enough.
    expect(mockRefresh).toHaveBeenCalled();
    expectFullReload();
  });

  test('a non-auth refusal keeps the session and does NOT reload', async () => {
    seedAction('confirmFinalization', generic);
    render(<ConfirmationFlow paymentId={PAYMENT_ID} trackingToken={TOKEN} businessName="Demo" />);

    fireEvent.click(screen.getByRole('button', { name: /todo correcto/ }));

    await waitFor(() => expect(screen.getByText(generic.error)).toBeTruthy());
    expect(localStorage.getItem(sessionKey())).not.toBeNull();
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});

// ── ReportFlow (C1's caller) ─────────────────────────

describe('ReportFlow — re-auth handoff (C1 / W3)', () => {
  test('a lapsed cookie drops the marker and forces a REAL reload', async () => {
    seedAction('rejectFinalization', reauth);
    render(<ReportFlow paymentId={PAYMENT_ID} trackingToken={TOKEN} />);

    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'NOT_RECEIVED' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar/ }));

    await waitFor(() => expect(reloadSpy).toHaveBeenCalled());
    expectFullReload();
  });

  test('a non-auth refusal keeps the session and does NOT reload', async () => {
    seedAction('rejectFinalization', generic);
    render(<ReportFlow paymentId={PAYMENT_ID} trackingToken={TOKEN} />);

    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'NOT_RECEIVED' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar/ }));

    await waitFor(() => expect(screen.getByText(generic.error)).toBeTruthy());
    expect(localStorage.getItem(sessionKey())).not.toBeNull();
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});

// ── ReportV2Flow (W3) ────────────────────────────────

describe('ReportV2Flow — re-auth handoff (W3)', () => {
  test('a lapsed cookie drops the marker and forces a REAL reload', async () => {
    seedAction('reportIssueV2', reauth);
    render(<ReportV2Flow paymentId={PAYMENT_ID} trackingToken={TOKEN} />);

    fireEvent.click(screen.getByText(/Abrir reporte/));
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'INVALID_TRACKING' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar/ }));

    await waitFor(() => expect(reloadSpy).toHaveBeenCalled());
    expectFullReload();
  });

  test('a non-auth refusal keeps the session and does NOT reload', async () => {
    seedAction('reportIssueV2', generic);
    render(<ReportV2Flow paymentId={PAYMENT_ID} trackingToken={TOKEN} />);

    fireEvent.click(screen.getByText(/Abrir reporte/));
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'INVALID_TRACKING' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar/ }));

    await waitFor(() => expect(screen.getByText(generic.error)).toBeTruthy());
    expect(localStorage.getItem(sessionKey())).not.toBeNull();
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});

// ── ActionModals (W3) ────────────────────────────────

describe('ActionModals — re-auth handoff (W3)', () => {
  test('confirming the shipment with a lapsed cookie drops the marker and reloads', async () => {
    seedAction('updateOrderStatus', reauth);
    render(<ActionModals paymentId={PAYMENT_ID} trackingToken={TOKEN} orderNumber="SL-0001" />);

    fireEvent.click(screen.getByRole('button', { name: /CONFIRMAR/ }));

    await waitFor(() => expect(reloadSpy).toHaveBeenCalled());
    expectFullReload();
  });

  test('reporting with a lapsed cookie drops the marker and reloads', async () => {
    seedAction('updateOrderStatus', reauth);
    render(<ActionModals paymentId={PAYMENT_ID} trackingToken={TOKEN} orderNumber="SL-0001" />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'tracking roto' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar Reporte/ }));

    await waitFor(() => expect(reloadSpy).toHaveBeenCalled());
    expectFullReload();
  });

  test('a non-auth refusal alerts the error and keeps the buyer on the page', async () => {
    seedAction('updateOrderStatus', generic);
    render(<ActionModals paymentId={PAYMENT_ID} trackingToken={TOKEN} orderNumber="SL-0001" />);

    fireEvent.click(screen.getByRole('button', { name: /CONFIRMAR/ }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith(generic.error));
    expect(localStorage.getItem(sessionKey())).not.toBeNull();
    expect(reloadSpy).not.toHaveBeenCalled();
  });
});
