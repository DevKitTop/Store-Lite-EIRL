// =====================================================
// POST /api/payment/update-ticket - response shape and access oracle
//
// Two things this route used to do that the browser never needed:
//
//   1. It answered with the whole `payments` row after the update. Every
//      column of it: buyer_email, buyer_phone, shipping_address and the
//      metadata jsonb. The only caller (`ticketGenerator.ts`) reads
//      `response.ok` and throws the body away - so the PII was shipped to a
//      browser that does not use it, for no reason.
//
//   2. It distinguished "no such order" (404) from "that order belongs to a
//      business you do not own" (401). To a caller who owns some business,
//      that difference turns the endpoint into an order-number oracle: probe
//      a number, and 401 vs 404 tells you whether it exists somewhere else.
//      Both cases now answer the same 404, the same choice the imports job
//      route already made.
//
// The probes are `db.update` and the response body: every rejected request
// must leave the row untouched.
// =====================================================

import { POST } from '@/app/api/payment/update-ticket/route';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetUser,
  mockRequireOwnedBusinessById,
  mockLimit,
  mockReturning,
  mockSet,
  mockWhere,
  mockUpdate,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockRequireOwnedBusinessById: vi.fn(),
  mockLimit: vi.fn(),
  mockReturning: vi.fn(),
  mockSet: vi.fn(),
  mockWhere: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mockGetUser } }),
}));

vi.mock('@/features/storage/actions/authz', () => ({
  requireOwnedBusinessById: mockRequireOwnedBusinessById,
}));

vi.mock('@/core/database/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mockLimit }) }) }),
    update: (table: unknown) => {
      mockUpdate(table);
      return { set: mockSet };
    },
  },
}));

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_BUSINESS_ID = '99999999-9999-4999-8999-999999999999';
const ORDER_NUMBER = 'ORD-2026-000123';
const TICKET_URL =
  'https://project.supabase.co/storage/v1/object/public/tickets/ORD-2026-000123.png';

/** The full row the old route returned, PII included. */
const FULL_PAYMENT_ROW = {
  id: '22222222-2222-4222-8222-222222222222',
  orderNumber: ORDER_NUMBER,
  businessId: BUSINESS_ID,
  amount: '100.00',
  currency: 'PEN',
  buyerEmail: 'buyer@example.test',
  buyerPhone: '999999999',
  buyerDni: '12345678',
  shippingAddress: 'Av. Siempre Viva 742',
  metadata: { customerAuth: { token: 'secret-cart-token' } },
  ticketUrl: TICKET_URL,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

function request(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/payment/update-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const SIGNED_IN = { data: { user: { id: 'user-1' } } };

describe('POST /api/payment/update-ticket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue(SIGNED_IN);
    mockLimit.mockResolvedValue([{ businessId: BUSINESS_ID }]);
    mockRequireOwnedBusinessById.mockResolvedValue({
      businessId: BUSINESS_ID,
      ownerId: 'user-1',
      slug: 'tienda',
    });
    mockSet.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ returning: mockReturning });
    mockReturning.mockResolvedValue([{ id: FULL_PAYMENT_ROW.id }]);
  });

  it('rejects a caller with no session and writes nothing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(request({ orderNumber: ORDER_NUMBER, ticketUrl: TICKET_URL }));

    expect(response.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects a request missing the order number without writing', async () => {
    const response = await POST(request({ ticketUrl: TICKET_URL }));

    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects an empty ticket URL without writing', async () => {
    const response = await POST(request({ orderNumber: ORDER_NUMBER, ticketUrl: '   ' }));

    expect(response.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('answers 404 for an order number that does not exist', async () => {
    mockLimit.mockResolvedValue([]);

    const response = await POST(request({ orderNumber: ORDER_NUMBER, ticketUrl: TICKET_URL }));

    expect(response.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('answers the same 404 when the order belongs to another business', async () => {
    mockLimit.mockResolvedValue([{ businessId: OTHER_BUSINESS_ID }]);
    mockRequireOwnedBusinessById.mockRejectedValue(new Error('No autorizado'));

    const response = await POST(request({ orderNumber: ORDER_NUMBER, ticketUrl: TICKET_URL }));

    // Not 401: a difference here would tell an attacker that this order
    // number exists, and only the ownership check stopped them.
    expect(response.status).toBe(404);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('answers 404 when the update matches no row', async () => {
    mockReturning.mockResolvedValue([]);

    const response = await POST(request({ orderNumber: ORDER_NUMBER, ticketUrl: TICKET_URL }));

    expect(response.status).toBe(404);
  });

  it('writes the ticket URL for the owner and answers success only', async () => {
    const response = await POST(
      request({ orderNumber: ORDER_NUMBER, ticketUrl: `  ${TICKET_URL}  ` }),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(mockRequireOwnedBusinessById).toHaveBeenCalledWith(BUSINESS_ID);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ ticketUrl: TICKET_URL }));
    expect(body).toEqual({ success: true });
  });

  it('never puts buyer data in the response, even when the row carries it', async () => {
    mockReturning.mockResolvedValue([FULL_PAYMENT_ROW]);

    const response = await POST(request({ orderNumber: ORDER_NUMBER, ticketUrl: TICKET_URL }));
    const raw = await response.text();

    expect(raw).not.toContain('buyer@example.test');
    expect(raw).not.toContain('999999999');
    expect(raw).not.toContain('secret-cart-token');
    expect(raw).not.toContain('Av. Siempre Viva');
  });
});
