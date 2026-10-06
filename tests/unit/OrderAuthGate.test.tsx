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

describe('OrderAuthGate — auto-auth with dni query param', () => {
  it('settles to unauthenticated state when auto-auth fails', async () => {
    // Simulate ?dni= query param that will fail
    mockSearchParams.set('dni', '12345678');
    mockVerifyOrderAccess.mockResolvedValue({ success: false });

    render(
      <OrderAuthGate token="abc123" businessName="Test Store" orderNumber="">
        <div>Protected Content</div>
      </OrderAuthGate>,
    );

    // Should initially show establishing connection state
    // But after failed auto-auth, should settle to unauthenticated form (not stay in loading)
    await waitFor(() => {
      // Should not still show "ESTABLECIENDO CONEXIÓN SEGURA"
      expect(screen.queryByText(/ESTABLECIENDO CONEXIÓN SEGURA/i)).not.toBeInTheDocument();
    });

    // Should show the auth form when not authenticated
    await waitFor(() => {
      expect(screen.getByText(/Verificá tu Identidad/i)).toBeInTheDocument();
    });
  });
});
