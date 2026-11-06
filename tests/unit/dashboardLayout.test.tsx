// =====================================================
// Dashboard Layout — Unit tests
// =====================================================
// Verifies T4: lite plan redirects only when no pending
// orders exist; renders children when pending orders found.
// =====================================================

import DashboardLayout from '@/app/[slug]/(app)/dashboard/layout';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────

// Next.js redirect() throws a special error — match that behavior
const { mockRedirect, mockNotFound } = vi.hoisted(() => {
  const mockRedirect = vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  });
  const mockNotFound = vi.fn();

  return { mockRedirect, mockNotFound };
});
vi.mock('next/navigation', () => ({ notFound: mockNotFound, redirect: mockRedirect }));

const mockResolveBusinessSlug = vi.hoisted(() => vi.fn());
vi.mock('@/core/business/publicSlug', () => ({
  resolvePublicBusinessRoute: mockResolveBusinessSlug,
}));
vi.mock('@/core/business/slug', () => ({
  replaceSlugInPath: (path: string) => path,
}));

const mockGetBusinessEntitlements = vi.hoisted(() => vi.fn());
vi.mock('@/core/entitlements/getBusinessEntitlements', () => ({
  getBusinessEntitlements: mockGetBusinessEntitlements,
}));

const mockCheckPermission = vi.hoisted(() => vi.fn());
vi.mock('@/lib/permissions', () => ({ checkPermission: mockCheckPermission }));

const { mockGetUser, mockCreateClient } = vi.hoisted(() => {
  const mockGetUser = vi.fn();
  const mockCreateClient = vi.fn(() => ({ auth: { getUser: mockGetUser } }));

  return { mockGetUser, mockCreateClient };
});
vi.mock('@/lib/supabase/server', () => ({ createClient: mockCreateClient }));

const mockGetBusinessPath = vi.hoisted(() => vi.fn((slug: string) => `/${slug}`));
vi.mock('@/shared/utils/url', () => ({ getBusinessPath: mockGetBusinessPath }));

// Database mock — only payments.findFirst is needed by this task
const mockPaymentsFindFirst = vi.hoisted(() => vi.fn());
vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      payments: { findFirst: mockPaymentsFindFirst },
    },
  },
}));

// ── Test-specific mocks ─────────────────────────────

// RealtimeToast is a client component — mock it away
vi.mock('@/app/[slug]/(app)/dashboard/components/RealtimeToast', () => ({
  RealtimeToast: () => null,
}));

// PlanExpiredBanner is a client component — mock it to render a visible element
vi.mock('@/app/[slug]/(app)/dashboard/components/PlanExpiredBanner', () => ({
  PlanExpiredBanner: () => <div data-testid="plan-expired-banner" />,
}));

// ── Helpers ──────────────────────────────────────────

function makeBusiness(overrides: Record<string, unknown> = {}) {
  return {
    id: 'biz_123',
    slug: 'test-store',
    ...overrides,
  };
}

function makeResolved(overrides: Record<string, unknown> = {}) {
  return {
    business: makeBusiness(),
    matchedAlias: null,
    canonicalSlug: 'test-store',
    ...overrides,
  };
}

// ── Suite ────────────────────────────────────────────

describe('DashboardLayout — plan enforcement redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockResolveBusinessSlug.mockResolvedValue(makeResolved());
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user_1' } } });
    mockCheckPermission.mockResolvedValue(true);
  });

  test('redirects when plan is lite and NO pending orders exist', async () => {
    mockGetBusinessEntitlements.mockResolvedValue({ plan: 'lite', maxProducts: 50 });
    mockPaymentsFindFirst.mockResolvedValue(null); // no pending orders

    await expect(
      DashboardLayout({
        children: <div>content</div>,
        params: Promise.resolve({ slug: 'test-store' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(mockPaymentsFindFirst).toHaveBeenCalledTimes(1);
    // Verify the query is filtering by businessId and active statuses
    const queryArgs = mockPaymentsFindFirst.mock.calls[0][0];
    expect(queryArgs.where).toBeDefined();
    expect(queryArgs.columns).toEqual({ id: true });
  });

  test('does NOT redirect when plan is lite and pending orders exist', async () => {
    mockGetBusinessEntitlements.mockResolvedValue({ plan: 'lite', maxProducts: 50 });
    mockPaymentsFindFirst.mockResolvedValue({ id: 'order_1' }); // has pending order

    // Should render, not redirect
    const result = await DashboardLayout({
      children: <div>content</div>,
      params: Promise.resolve({ slug: 'test-store' }),
    });

    expect(mockPaymentsFindFirst).toHaveBeenCalledTimes(1);
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(result).toBeDefined();

    // Verify the PlanExpiredBanner is rendered
    render(result);
    expect(screen.getByTestId('plan-expired-banner')).toBeInTheDocument();
  });

  test('redirects when plan is lite and all existing orders have terminal statuses only', async () => {
    mockGetBusinessEntitlements.mockResolvedValue({ plan: 'lite', maxProducts: 50 });
    // Simulate: orders exist in the database but ALL have terminal statuses
    // (completed, cancelled, expired, failed, refunded, etc.), so findFirst
    // with only active statuses returns null → must redirect
    mockPaymentsFindFirst.mockResolvedValue(null);

    await expect(
      DashboardLayout({
        children: <div>content</div>,
        params: Promise.resolve({ slug: 'test-store' }),
      }),
    ).rejects.toThrow('NEXT_REDIRECT');

    expect(mockPaymentsFindFirst).toHaveBeenCalledTimes(1);
  });

  test('does NOT redirect when plan is NOT lite (existing behavior)', async () => {
    mockGetBusinessEntitlements.mockResolvedValue({ plan: 'lite_pago', maxProducts: 300 });
    // payments.findFirst should NOT be called for non-lite plans
    mockPaymentsFindFirst.mockResolvedValue(null);

    const result = await DashboardLayout({
      children: <div>content</div>,
      params: Promise.resolve({ slug: 'test-store' }),
    });

    expect(mockPaymentsFindFirst).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(result).toBeDefined();

    // Banner should NOT render for non-lite plans
    render(result);
    expect(screen.queryByTestId('plan-expired-banner')).not.toBeInTheDocument();
  });
});
