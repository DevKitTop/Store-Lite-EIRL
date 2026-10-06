// =====================================================
// WhatsAppConnectModal — direct unit regression coverage
// =====================================================
// Covers two verify-phase fixes:
// 1. Poll cadence: the status-poll effect must NOT be torn down and
//    re-created on every countdown tick (1s). Over a N-second window
//    the status endpoint must be hit exactly once immediately + once
//    per 5s poll interval, NOT ~1 request per second.
// 2. Expired state: when expiresAt is in the past the modal renders
//    the expired UI and never starts polling.

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppConnectModal } from '@/features/whatsapp/components/WhatsAppConnectModal';

const FAR_FUTURE = '2099-12-31T23:59:59.000Z';
const PAST = '2020-01-01T00:00:00.000Z';

/** Stub global fetch; returns the given status payload. */
function stubStatusFetch(status: string) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ status }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderModal(expiresAt: string) {
  return render(
    <WhatsAppConnectModal
      phoneNumberId="pn-1001"
      code="ABC-123"
      expiresAt={expiresAt}
      onClose={vi.fn()}
      onSuccess={vi.fn()}
    />,
  );
}

describe('WhatsAppConnectModal polling cadence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('polls at the 5s cadence without re-firing on countdown ticks', async () => {
    // Mock only the timer APIs — Date stays real so nothing depends on
    // a frozen clock; the countdown simply never expires (far-future
    // expiresAt).
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    const fetchMock = stubStatusFetch('pending');

    renderModal(FAR_FUTURE);

    // Initial check fires immediately on mount: exactly 1 call.
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 30s under a pending status = 30 countdown ticks (setInterval 1s)
    // + 6 status polls (setInterval 5s at t=5,10,15,20,25,30).
    // Expected total: 1 initial + 6 polls = 7.
    // Pre-fix the poll effect depended on timeLeft, so every 1s tick
    // tore down and re-ran it → far more than 7 requests.
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it('hits the endpoint once immediately plus once per 5s window', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    const fetchMock = stubStatusFetch('pending');

    renderModal(FAR_FUTURE);
    await act(async () => {});

    // 11s window: 1 initial + polls at t=5s and t=10s = 3 calls.
    await act(async () => {
      vi.advanceTimersByTime(11_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('WhatsAppConnectModal expired state', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders the expired UI for a past expiresAt and never starts the 5s poll interval', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    });
    const fetchMock = stubStatusFetch('pending');

    renderModal(PAST);

    expect(screen.getByText('Código Expirado')).toBeInTheDocument();
    expect(
      screen.getByText('El código de vinculación ha expirado. Intenta nuevamente.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Expira en/)).not.toBeInTheDocument();

    // The countdown effect sets status = 'expired' on mount, which gates
    // the poll. The single call below is the pre-existing mount-time
    // initial check (countdown + poll effects run in the same first
    // commit, before the status update applies); after that the poll
    // effect early-returns and the 5s interval must never fire.
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});