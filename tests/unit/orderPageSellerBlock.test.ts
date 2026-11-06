// =====================================================
// order/[token]/page.tsx — the seller block
// =====================================================
// The block exists so a seller cannot open their own order's customer page and
// self-confirm. It used to short-circuit on "this user owns a business":
//
//   const sellerBusiness = await db.query.businesses.findFirst({
//     where: eq(businesses.ownerId, user.id),
//   });
//   const teamMembership = sellerBusiness ? null : await ...   // ← skipped
//   if ((sellerBusiness && sellerBusiness.id === order.businessId) || teamMembership)
//
// Owning a different business made `sellerBusiness` truthy, skipped the
// membership test, and failed the id comparison — so a member of THIS business
// walked straight through.
//
// The page is INVOKED, not rendered: awaiting it runs every data read and
// returns the element tree with the child components unexecuted.
// =====================================================

import OrderTrackingPage from '@/app/[slug]/(app)/order/[token]/page';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_BUSINESS_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const SLUG = 'mi-tienda';
const TOKEN = 'track-token-abc123';

const mocks = vi.hoisted(() => ({
  paymentsFindFirst: vi.fn(),
  businessesFindFirst: vi.fn(),
  membersFindFirst: vi.fn(),
  getUser: vi.fn(),
  isBusinessOwner: vi.fn(),
  verifyCookie: vi.fn(),
}));

vi.mock('@/config/env', () => ({
  env: { orderFlowV2: true, orderAccessCookieSecret: 'page-seller-block-secret' },
}));

vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      payments: { findFirst: mocks.paymentsFindFirst },
      businesses: { findFirst: mocks.businessesFindFirst },
      businessTeamMembers: { findFirst: mocks.membersFindFirst },
    },
  },
}));

vi.mock('@/lib/orderAccessCookie', () => ({
  verifyOrderAccessCookie: mocks.verifyCookie,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));

vi.mock('@/lib/permissions/checkPermission', () => ({
  isBusinessOwner: mocks.isBusinessOwner,
}));

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

vi.mock('@/lib/storage/signedTicket', () => ({
  getSignedTicketUrl: async () => null,
  getSignedTicketUrls: async (values: unknown[]) => values.map(() => null),
}));

function orderRow() {
  return {
    id: 'payment-1',
    businessId: BUSINESS_ID,
    productId: 'product-1',
    trackingToken: TOKEN,
    orderNumber: '2001',
    status: 'PAID',
    amount: '100.00',
    currency: 'PEN',
    paymentMethod: 'culqi',
    shippingType: 'envio',
    sellerNote: null,
    courierName: null,
    trackingNumber: null,
    pickupCode: null,
    ticketImageUrl: null,
    metadata: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    completedAt: null,
    business: { id: BUSINESS_ID, name: 'Mi Tienda', slug: SLUG, logoUrl: null },
    product: { id: 'product-1', title: 'Producto', price: '100.00' },
  };
}

async function render() {
  return OrderTrackingPage({ params: Promise.resolve({ slug: SLUG, token: TOKEN }) });
}

/** The refusal screen is the only tree carrying this heading. */
function isSellerRefusal(tree: unknown): boolean {
  return JSON.stringify(tree).includes('Acceso No Permitido');
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.paymentsFindFirst.mockResolvedValue(orderRow());
  mocks.verifyCookie.mockResolvedValue(false);
  mocks.businessesFindFirst.mockResolvedValue({ id: OTHER_BUSINESS_ID });
  mocks.membersFindFirst.mockResolvedValue(null);
  mocks.isBusinessOwner.mockResolvedValue(false);
});

describe('order page — seller block', () => {
  it('refuses a team member even when they own another business', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    mocks.membersFindFirst.mockResolvedValue({ id: 'membership-1' });

    const tree = await render();

    expect(isSellerRefusal(tree)).toBe(true);
  });

  it('refuses the owner of the business', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    mocks.isBusinessOwner.mockResolvedValue(true);

    const tree = await render();

    expect(isSellerRefusal(tree)).toBe(true);
  });

  it('lets a customer through', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });

    const tree = await render();

    expect(isSellerRefusal(tree)).toBe(false);
  });

  it('lets an anonymous visitor through the seller block', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const tree = await render();

    expect(isSellerRefusal(tree)).toBe(false);
    expect(mocks.membersFindFirst).not.toHaveBeenCalled();
  });

  it('asks about the order business, not about some business the user owns', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });

    await render();

    expect(mocks.isBusinessOwner).toHaveBeenCalledWith(BUSINESS_ID, USER_ID);
    const where = mocks.membersFindFirst.mock.calls[0]?.[0]?.where;
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const { params } = new PgDialect().sqlToQuery(where as never);
    expect(params).toContain(BUSINESS_ID);
    expect(params).not.toContain(OTHER_BUSINESS_ID);
  });
});
