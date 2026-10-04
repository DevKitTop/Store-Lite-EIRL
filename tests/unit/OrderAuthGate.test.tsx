'use client';

import OrderAuthGate from '@/app/[slug]/(app)/order/[token]/OrderAuthGate';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────

const {
  mockSearchParams,
  mockRouterReplace,
  mockVerifyOrderAccess,
  mockVerifyOrderByGoogleIdentity,
} = vi.hoisted(() => ({
  mockSearchParams: new URLSearchParams(),
  mockRouterReplace: vi.fn(),
  mockVerifyOrderAccess: vi.fn(),
  mockVerifyOrderByGoogleIdentity: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: mockRouterReplace }),
  usePathname: () => '/test-slug/order/abc123',
  useParams: () => ({ slug: 'test-slug', token: 'abc123' }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParams.delete('dni');
  localStorage.clear();
  sessionStorage.clear();
});

// ── Tests ────────────────────────────────────────────

describe('OrderAuthGate — R24: ?dni= parameter is ignored', () => {
  it('does NOT call verifyOrderAccess when ?dni= is present in URL', async () => {
    mockSearchParams.set('dni', '87654321');

    render(
      <OrderAuthGate token="abc123" businessName="Test Store" orderNumber="ORD-123">
        <div>Protected Content</div>
      </OrderAuthGate>,
    );

    // Should NOT call verifyOrderAccess with the dni from URL
    await waitFor(() => {
      expect(mockVerifyOrderAccess).not.toHaveBeenCalled();
    });

    // Should show the auth form (not auto-authenticate)
    await waitFor(() => {
      expect(screen.getByText(/Verificá tu Identidad/i)).toBeInTheDocument();
    });
  });

  it('does NOT prefill the DNI input with ?dni= value', async () => {
    mockSearchParams.set('dni', '87654321');

    render(
      <OrderAuthGate token="abc123" businessName="Test Store" orderNumber="ORD-123">
        <div>Protected Content</div>
      </OrderAuthGate>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Verificá tu Identidad/i)).toBeInTheDocument();
    });

    const dniInput = screen.getByPlaceholderText('00000000') as HTMLInputElement;
    expect(dniInput.value).toBe('');
  });

  it('does NOT call router.replace to clean up ?dni= from URL', async () => {
    mockSearchParams.set('dni', '87654321');

    render(
      <OrderAuthGate token="abc123" businessName="Test Store" orderNumber="ORD-123">
        <div>Protected Content</div>
      </OrderAuthGate>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Verificá tu Identidad/i)).toBeInTheDocument();
    });

    expect(mockRouterReplace).not.toHaveBeenCalled();
  });

  it('does NOT consume rate-limit budget for ?dni= parameter', async () => {
    mockSearchParams.set('dni', '87654321');

    render(
      <OrderAuthGate token="abc123" businessName="Test Store" orderNumber="ORD-123">
        <div>Protected Content</div>
      </OrderAuthGate>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Verificá tu Identidad/i)).toBeInTheDocument();
    });

    // verifyOrderAccess should never be called, so no rate-limit token consumed
    expect(mockVerifyOrderAccess).not.toHaveBeenCalled();
  });

  it('R15 server-side bare-DNI denial still holds — verifyOrderAccess not called without orderNumber', async () => {
    mockSearchParams.set('dni', '87654321');

    render(
      <OrderAuthGate token="abc123" businessName="Test Store" orderNumber="ORD-123">
        <div>Protected Content</div>
      </OrderAuthGate>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Verificá tu Identidad/i)).toBeInTheDocument();
    });

    // The auto-auth path is gone; only the manual form calls verifyOrderAccess
    // and it requires BOTH dni AND orderNumber
    expect(mockVerifyOrderAccess).not.toHaveBeenCalled();
  });
});

describe('OrderAuthGate — R25: NULL orderNumber renders explicit non-submittable state', () => {
  it('renders explicit "no existe" state when orderNumber is null', async () => {
    render(
      <OrderAuthGate token="abc123" businessName="Test Store" orderNumber={null}>
        <div>Protected Content</div>
      </OrderAuthGate>,
    );

    await waitFor(() => {
      // Should NOT show the DNI form (which would always fail)
      expect(screen.queryByPlaceholderText('00000000')).not.toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Ej: ORD-001234')).not.toBeInTheDocument();
    });

    // Should show explicit state naming seller contact as alternative
    await waitFor(() => {
      expect(screen.getByText(/no existe/i)).toBeInTheDocument();
      expect(screen.getByText(/contact.{0,5}al vendedor/i)).toBeInTheDocument();
    });

    // Should have link back to storefront
    await waitFor(() => {
      expect(screen.getByText(/volver a la tienda/i)).toBeInTheDocument();
    });
  });

  it('does NOT render a submittable DNI form for NULL orderNumber', async () => {
    render(
      <OrderAuthGate token="abc123" businessName="Test Store" orderNumber={null}>
        <div>Protected Content</div>
      </OrderAuthGate>,
    );

    await waitFor(() => {
      expect(screen.getByText(/no existe/i)).toBeInTheDocument();
    });

    // No form that can be submitted
    expect(
      screen.queryByRole('button', { name: /acceder al seguimiento/i }),
    ).not.toBeInTheDocument();
  });

  it('numbered orders keep the working DNI + orderNumber form', async () => {
    render(
      <OrderAuthGate token="abc123" businessName="Test Store" orderNumber="ORD-123">
        <div>Protected Content</div>
      </OrderAuthGate>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Verificá tu Identidad/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText('00000000')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Ej: ORD-001234')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /acceder al seguimiento/i })).toBeInTheDocument();
    });
  });
});
