// =====================================================
// order/[token]/page.tsx — PII-free public projection (R14)
// =====================================================
// Design D11 / D12, spec R14 (api-access-control).
//
// The C4 exposure: this page used to fetch the WHOLE `payments` row, so anyone
// holding a tracking URL saw the buyer's email, DNI, phone and shipping address
// in the SSR payload. Slices A and B-i landed the money gate and the signed
// cookie; THIS suite is where the cookie becomes real access control.
//
// R14 is asserted STRUCTURALLY, on the `columns` argument actually handed to
// `db.query.payments.findFirst` — not on rendered markup. A rendered-markup
// assertion would only prove that the guards happen to hide the values today,
// and would pass unchanged if the projection were removed while some other
// guard still suppressed the output.
//
// The server component is INVOKED, never RENDERED (`await OrderTrackingPage(...)`
// inside try/catch). It is an async function returning a React element tree, so
// awaiting it runs the fetch and every data read above the JSX while leaving the
// ~15 child components unexecuted — that is what keeps this file at 4 mocks
// instead of 20.
//
// Mutations that MUST break this suite:
//   (a) adding any PII key (or `metadata`) to the allowlist  → case 1 fails
//   (b) dropping the cookie check so the full row is always read → case 1 fails
//   (c) leaving `generateMetadata` unprojected                 → case 3 fails
// =====================================================

import OrderTrackingPage, { generateMetadata } from '@/app/[slug]/(app)/order/[token]/page';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Expected contract, written out independently of the page ──
// Kept as a literal (not imported from the page) on purpose: if the test read
// the production constant, mutation (a) below could never be detected.

const PUBLIC_ORDER_COLUMNS = {
  id: true,
  businessId: true,
  productId: true,
  trackingToken: true,
  orderNumber: true,
  status: true,
  amount: true,
  currency: true,
  paymentMethod: true,
  shippingType: true,
  sellerNote: true,
  courierName: true,
  trackingNumber: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
};

/** Both paths MUST keep the public storefront relations loaded (R14). */
const PUBLIC_ORDER_RELATIONS = { product: true, business: true };

/** R14's excluded set, verbatim from the spec's bullet list. */
const FORBIDDEN_COLUMNS = [
  'buyerEmail',
  'buyerPhone',
  'buyerDni',
  'shippingAddress',
  'shippingDistrict',
  'shippingProvince',
  'shippingDepartment',
  'shippingAgency',
  'shippingReference',
  'shippingPhone',
  'shippingUbigeo',
  'pickupCode',
  'ticketUrl',
  'ticketImageUrl',
  'deliveryCodeHash',
  'deliveryCodeExpiresAt',
  'metadata',
];

// ── Mocks ────────────────────────────────────────────

const { mockFindFirstPayments, mockVerifyOrderAccessCookie, notFoundSpy } = vi.hoisted(() => {
  const notFoundSpy = vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  });
  return {
    mockFindFirstPayments: vi.fn(),
    mockVerifyOrderAccessCookie: vi.fn(),
    notFoundSpy,
  };
});

vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      payments: { findFirst: (...args: unknown[]) => mockFindFirstPayments(...args) },
      businesses: { findFirst: vi.fn() },
      businessTeamMembers: { findFirst: vi.fn() },
    },
  },
}));

vi.mock('@/lib/orderAccessCookie', () => ({
  verifyOrderAccessCookie: (...args: unknown[]) => mockVerifyOrderAccessCookie(...args),
}));

vi.mock('next/navigation', () => ({
  notFound: (...args: unknown[]) => notFoundSpy(...args),
}));

// No signed-in user: keeps the seller/team block and the `metadata` pre-auth
// branch out of the way, so the only thing under test is the fetch shape.
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

// ── Fixtures ─────────────────────────────────────────

const SLUG = 'mi-tienda';
const TOKEN = 'track-token-abc123';

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    businessId: 'biz-1',
    productId: 'prod-1',
    trackingToken: TOKEN,
    orderNumber: 'ORD-1',
    status: 'paid',
    amount: '150.00',
    currency: 'PEN',
    paymentMethod: 'card',
    shippingType: 'delivery',
    sellerNote: null,
    courierName: null,
    trackingNumber: null,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-02T10:00:00Z'),
    completedAt: null,
    business: { id: 'biz-1', name: 'Mi Tienda', slug: SLUG },
    product: { id: 'prod-1', name: 'Zapatos' },
    ...overrides,
  };
}

/** The full argument object the page handed to `findFirst`, by call index. */
function recordedArg(callIndex = 0): Record<string, unknown> {
  const call = mockFindFirstPayments.mock.calls.at(callIndex);
  return (call?.[0] ?? {}) as Record<string, unknown>;
}

/** The `columns` argument the page recorded, or `undefined` when it sent none. */
function recordedColumns(callIndex = 0): Record<string, unknown> | undefined {
  return recordedArg(callIndex).columns as Record<string, unknown> | undefined;
}

/** Runs the component to completion, swallowing its `notFound()` throw. */
async function invokePage() {
  try {
    await OrderTrackingPage({ params: Promise.resolve({ slug: SLUG, token: TOKEN }) });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'NEXT_NOT_FOUND') throw error;
  }
}

beforeEach(() => {
  // vitest.config.ts sets clearMocks/restoreMocks → impls are re-declared per test
  mockFindFirstPayments.mockImplementation(async () => paymentRow());
  mockVerifyOrderAccessCookie.mockImplementation(async () => false);
});

// ── Tests ────────────────────────────────────────────

describe('order page — PII-free public projection (R14)', () => {
  it('reads an explicit PII-free allowlist when no access cookie is present', async () => {
    mockVerifyOrderAccessCookie.mockImplementation(async () => false);

    await invokePage();

    expect(mockVerifyOrderAccessCookie).toHaveBeenCalledWith(TOKEN);
    expect(recordedColumns()).toEqual(PUBLIC_ORDER_COLUMNS);
  });

  it('keeps every buyer-PII and metadata column out of the public projection', async () => {
    mockVerifyOrderAccessCookie.mockImplementation(async () => false);

    await invokePage();

    const columns = recordedColumns() ?? {};
    const selected = Object.keys(columns);
    expect(selected.length).toBeGreaterThan(0);
    for (const forbidden of FORBIDDEN_COLUMNS) {
      expect(selected).not.toContain(forbidden);
    }
    // `with` must be a SIBLING of `columns`: nested inside it, drizzle would read
    // `with` as a column name and strip the relations from the row.
    expect(columns).not.toHaveProperty('with');
    expect(recordedArg().with).toEqual(PUBLIC_ORDER_RELATIONS);
  });

  it('reads the full row when a valid access cookie is present', async () => {
    mockVerifyOrderAccessCookie.mockImplementation(async () => true);

    await invokePage();

    const arg = recordedArg();
    expect(arg.columns).toBeUndefined();
    expect(arg.with).toEqual(PUBLIC_ORDER_RELATIONS);
  });

  it('projects the metadata fetch too — no unprojected second read of the row', async () => {
    mockFindFirstPayments.mockImplementation(async () => paymentRow());

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: SLUG, token: TOKEN }),
    });

    expect(metadata.title).toBe('Seguimiento: Mi Tienda');
    const columns = recordedColumns();
    expect(columns).toBeDefined();
    for (const forbidden of FORBIDDEN_COLUMNS) {
      expect(Object.keys(columns ?? {})).not.toContain(forbidden);
    }
  });

  it('still calls notFound() for a token shorter than the minimum length', async () => {
    try {
      await OrderTrackingPage({ params: Promise.resolve({ slug: SLUG, token: 'abc' }) });
      expect.unreachable('a short token must not render the page');
    } catch (error) {
      expect((error as Error).message).toBe('NEXT_NOT_FOUND');
    }

    expect(mockFindFirstPayments).not.toHaveBeenCalled();
  });

  it('still calls notFound() when the business slug does not match the URL', async () => {
    mockFindFirstPayments.mockImplementation(async () => paymentRow());

    try {
      await OrderTrackingPage({ params: Promise.resolve({ slug: 'otra-tienda', token: TOKEN }) });
      expect.unreachable('a slug mismatch must not render the page');
    } catch (error) {
      expect((error as Error).message).toBe('NEXT_NOT_FOUND');
    }

    expect(notFoundSpy).toHaveBeenCalled();
  });
});
