// =====================================================
// WhatsAppCoexistenceModal — Meta Embedded Signup modal
// =====================================================
// Covers the spec state machine (idle → connecting → pending → connected |
// error-retry; cancel → idle), the eligibility copy (Business App 2.24.17+
// only, one-time link, 14-day rule, no personal WhatsApp), and the slice-3
// contract: on FINISH the modal EMITS {businessId, wabaId, phoneNumberId}
// via onFinish (the POST /connect/complete wiring is slice 4).

import { WhatsAppCoexistenceModal } from '@/features/whatsapp/components/WhatsAppCoexistenceModal';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Meta partner envs are present when the coexistence modal is mounted
// (slice 4 branches on them) — mirror that here, otherwise launch() would
// hit the missing-env guard and never call FB.login.
vi.mock('@/config/env', () => ({
  env: {
    ycloudFbAppId: 'app-111',
    ycloudFbConfigId: 'config-222',
    ycloudFbSolutionId: 'solution-333',
  },
}));

const FB_ORIGIN = 'https://www.facebook.com';
const BUSINESS_ID = 'biz-77';

function renderModal(
  overrides: Partial<{
    connectionStatus: 'pending' | 'connected' | 'failed';
    errorMessage?: string | null;
    onRetry?: () => void;
  }> = {},
) {
  return render(
    <WhatsAppCoexistenceModal
      businessId={BUSINESS_ID}
      onClose={vi.fn()}
      onFinish={vi.fn()}
      {...overrides}
    />,
  );
}

/** Dispatches a WA_EMBEDDED_SIGNUP postMessage from the allowlisted origin
 *  using the REAL Meta wire shape: data is a JSON string, `event` UPPERCASE. */
function dispatchEmbeddedSignup(event: string, inner?: unknown) {
  window.dispatchEvent(
    new MessageEvent('message', {
      origin: FB_ORIGIN,
      data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event, data: inner ?? null }),
    }),
  );
}

describe('WhatsAppCoexistenceModal', () => {
  beforeEach(() => {
    (window as { FB?: { init: ReturnType<typeof vi.fn>; login: ReturnType<typeof vi.fn> } }).FB = {
      init: vi.fn(),
      login: vi.fn(),
    };
  });

  afterEach(() => {
    delete (window as { FB?: unknown }).FB;
    vi.unstubAllGlobals();
  });

  it('renders the eligibility rules and does not offer personal WhatsApp', () => {
    renderModal();

    expect(screen.getByText('Conecta tu WhatsApp')).toBeInTheDocument();
    expect(
      screen.getByText(/WhatsApp Business App versión 2\.24\.17 o superior/),
    ).toBeInTheDocument();
    expect(screen.getByText('enlace de vinculación')).toBeInTheDocument();
    expect(screen.getByText(/de un solo uso/)).toBeInTheDocument();
    expect(screen.getByText(/al menos una vez cada 14 días/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar con Meta' })).toBeInTheDocument();

    // Requirement: the modal MUST NOT offer personal WhatsApp.
    expect(screen.queryByText(/personal/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /personal/i })).not.toBeInTheDocument();
  });

  it('closes when the close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <WhatsAppCoexistenceModal businessId={BUSINESS_ID} onClose={onClose} onFinish={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('launches FB.login and shows the connecting state on "Continuar con Meta"', async () => {
    const user = userEvent.setup();
    const login = vi.fn();
    (window as { FB?: { init: ReturnType<typeof vi.fn>; login: typeof login } }).FB = {
      init: vi.fn(),
      login,
    };
    renderModal();

    await user.click(screen.getByRole('button', { name: 'Continuar con Meta' }));

    expect(login).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Conectando con Meta…')).toBeInTheDocument();
  });

  it('on FINISH emits the payload via onFinish (no fetch) and goes pending', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const onFinish = vi.fn();
    render(
      <WhatsAppCoexistenceModal businessId={BUSINESS_ID} onClose={vi.fn()} onFinish={onFinish} />,
    );

    await act(async () => {
      dispatchEmbeddedSignup('FINISH', {
        business_id: 'meta-biz-9',
        waba_id: 'waba-8',
        phone_number_id: 'pn-7',
      });
    });

    // Session businessId from props wins over the payload's business_id.
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish).toHaveBeenCalledWith({
      businessId: BUSINESS_ID,
      wabaId: 'waba-8',
      phoneNumberId: 'pn-7',
    });
    expect(screen.getByText(/Vinculando tu número/)).toBeInTheDocument();

    // Slice-3 boundary: the modal EMITS, it does not POST yet.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows error-retry on ERROR and re-launches FB.login from the retry button', async () => {
    const user = userEvent.setup();
    const login = vi.fn();
    (window as { FB?: { init: ReturnType<typeof vi.fn>; login: typeof login } }).FB = {
      init: vi.fn(),
      login,
    };
    renderModal();

    await act(async () => {
      dispatchEmbeddedSignup('ERROR', { error: { message: 'WABA no encontrado' } });
    });

    expect(screen.getByText('No se pudo completar la vinculación')).toBeInTheDocument();
    expect(screen.getByText('WABA no encontrado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();

    expect(login).toHaveBeenCalledTimes(0);

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(login).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Conectando con Meta…')).toBeInTheDocument();
  });

  it('returns to idle when the popup sends cancel', async () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Continuar con Meta' })).toBeInTheDocument();

    await act(async () => {
      dispatchEmbeddedSignup('FINISH', {
        business_id: 'meta-biz-9',
        waba_id: 'waba-8',
        phone_number_id: 'pn-7',
      });
    });
    expect(screen.getByText(/Vinculando tu número/)).toBeInTheDocument();

    await act(async () => {
      dispatchEmbeddedSignup('CANCEL');
    });

    expect(screen.getByRole('button', { name: 'Continuar con Meta' })).toBeInTheDocument();
    expect(screen.queryByText(/Vinculando tu número/)).not.toBeInTheDocument();
  });

  it('renders the connected success UI when connectionStatus is connected', () => {
    renderModal({ connectionStatus: 'connected' });

    expect(screen.getByText('¡WhatsApp Conectado!')).toBeInTheDocument();
    expect(screen.getByText(/Tu número quedó vinculado/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continuar con Meta' })).not.toBeInTheDocument();
  });

  it('renders error-retry when connectionStatus is failed', () => {
    renderModal({ connectionStatus: 'failed' });

    expect(screen.getByText('No se pudo completar la vinculación')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('prefers the parent-provided bind error over the local message', () => {
    renderModal({
      connectionStatus: 'failed',
      errorMessage: 'PAYMENT_METHOD_REQUIRED: Agrega un método de pago',
    });

    expect(screen.getByText('No se pudo completar la vinculación')).toBeInTheDocument();
    expect(screen.getByText(/PAYMENT_METHOD_REQUIRED/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});
