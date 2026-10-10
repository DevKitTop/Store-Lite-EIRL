'use client';

import OrderAuthGate from '@/app/[slug]/(app)/order/[token]/OrderAuthGate';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// =====================================================
// R24 / R25 — OrderAuthGate must NOT honor `?dni=` and must
// render an explicit non-submittable state for a NULL orderNumber.
//
// This suite REPLACES the former positive test that asserted the
// forbidden auto-auth flow. The `?dni=` query param is now inert:
// the gate never reads it, never calls the server action for it, and
// never rewrites the URL.
// =====================================================

// ── Mocks ────────────────────────────────────────────

const {
  mockSearchParams,
  mockRouterReplace,
  mockRouterRefresh,
  mockVerifyOrderAccess,
  mockVerifyOrderByGoogleIdentity,
  mockGetSession,
} = vi.hoisted(() => ({
  mockSearchParams: new URLSearchParams(),
  mockRouterReplace: vi.fn(),
  mockRouterRefresh: vi.fn(),
  mockVerifyOrderAccess: vi.fn(),
  mockVerifyOrderByGoogleIdentity: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  // Kept so the test can PROVE the component ignores `?dni=` even when present.
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: mockRouterReplace, refresh: mockRouterRefresh }),
  usePathname: () => '/test-slug/order/abc123',
  useParams: () => ({ slug: 'test-slug', token: 'abc123' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
      setSession: vi.fn(),
    },
  }),
}));

vi.mock('@/app/[slug]/(app)/order/[token]/actions', () => ({
  verifyOrderAccess: mockVerifyOrderAccess,
  verifyOrderByGoogleIdentity: mockVerifyOrderByGoogleIdentity,
}));

vi.mock('@/shared/components/ui', () => ({
  Icon: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

// ── Setup ────────────────────────────────────────────

const DNI_IN_URL = '87654321';

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParams.delete('dni');
  mockSearchParams.set('dni', DNI_IN_URL);
  mockGetSession.mockResolvedValue({ data: { session: null } });
  mockVerifyOrderAccess.mockResolvedValue({ success: false });
  mockVerifyOrderByGoogleIdentity.mockResolvedValue({ success: false });
  localStorage.clear();
  sessionStorage.clear();
});

function renderGate(orderNumber: string | null) {
  return render(
    <OrderAuthGate
      token="abc123"
      businessName="Test Store"
      orderNumber={orderNumber}
      businessSlug="test-slug"
    >
      <div>Protected Content</div>
    </OrderAuthGate>,
  );
}

// ── R24 — the `?dni=` auto-auth flow is gone ─────────

describe('R24 — the ?dni= query param must not auto-authorize', () => {
  it('never calls verifyOrderAccess for the dni in the URL', async () => {
    renderGate('ORD-001');

    await waitFor(() => {
      expect(screen.getByText(/Verificá tu Identidad/i)).toBeInTheDocument();
    });

    // The forbidden flow would have called the action with the URL dni.
    expect(mockVerifyOrderAccess).not.toHaveBeenCalled();
  });

  it('never prefills the DNI input from the URL', async () => {
    renderGate('ORD-001');

    await waitFor(() => {
      expect(screen.getByText(/Verificá tu Identidad/i)).toBeInTheDocument();
    });

    const dniInput = screen.getByPlaceholderText('00000000') as HTMLInputElement;
    expect(dniInput.value).toBe('');
  });

  it('never rewrites the URL (no router.replace cleanup branch)', async () => {
    renderGate('ORD-001');

    await waitFor(() => {
      expect(screen.getByText(/Verificá tu Identidad/i)).toBeInTheDocument();
    });

    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('does not auto-authorize even when a session exists', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: { user: { id: 'u1', app_metadata: { provider: 'google' } } },
      },
    });
    mockVerifyOrderByGoogleIdentity.mockResolvedValue({ success: false });

    renderGate('ORD-001');

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalled();
    });

    // The Google auto-link may probe, but the DNI auto-auth action must not run.
    expect(mockVerifyOrderAccess).not.toHaveBeenCalled();
  });

  it('leaves the ?dni= param inert in the URL (not consumed and stripped)', async () => {
    renderGate('ORD-001');

    await waitFor(() => {
      expect(screen.getByText(/Verificá tu Identidad/i)).toBeInTheDocument();
    });

    expect(mockRouterReplace).not.toHaveBeenCalled();
    expect(mockSearchParams.get('dni')).toBe(DNI_IN_URL);
  });
});

// ── R25 — a NULL orderNumber gets an explicit dead-end state ─

describe('R25 — a NULL orderNumber renders a non-submittable state', () => {
  it('renders the explicit state BEFORE the spinner, with no form', () => {
    const { container } = renderGate(null);

    // Rendered synchronously: not the loading spinner, not the auth form.
    expect(screen.queryByText(/ESTABLECIENDO CONEXIÓN SEGURA/i)).not.toBeInTheDocument();
    expect(container.querySelector('form')).toBeNull();
    expect(screen.getByText(/no pudimos identificar tu pedido/i)).toBeInTheDocument();
  });

  it('names seller contact as the alternative and never points at Google', () => {
    renderGate(null);

    expect(screen.getByText(/vendedor/i)).toBeInTheDocument();
    expect(screen.queryByText(/Acceder con Google/i)).not.toBeInTheDocument();
  });

  it('does not consume the forbidden auto-auth path for a NULL order', () => {
    renderGate(null);

    expect(mockVerifyOrderAccess).not.toHaveBeenCalled();
    expect(mockVerifyOrderByGoogleIdentity).not.toHaveBeenCalled();
  });
});

// ── Regression — a numbered order still renders the manual DNI form ─

describe('OrderAuthGate — numbered orders keep the manual verification form', () => {
  it('renders the DNI + order number form and only calls the action on submit', async () => {
    renderGate('ORD-001');

    await waitFor(() => {
      expect(screen.getByText(/Verificá tu Identidad/i)).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText('00000000')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Ej: ORD-001234')).toBeInTheDocument();
    // Present but inert until the buyer submits.
    expect(mockVerifyOrderAccess).not.toHaveBeenCalled();
  });
});
