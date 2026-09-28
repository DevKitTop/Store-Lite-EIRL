// =====================================================
// POST /api/ticket/generate — owner-or-buyer access proof (C5 / D4 / R1-R3)
//
// The route used to accept any caller that knew an `orderNumber`. It now
// resolves one of two proofs before it may touch Supabase Storage or the
// payment row:
//   OWNER  — a session that owns the payment's business (`requireOwnedBusinessById`)
//   BUYER  — the caller's `trackingToken`, compared in constant time against
//            the value stored on THAT payment row; `forceRegenerate` is coerced
//            to false so a buyer can never overwrite an existing ticket.
//
// `db.update` and the Supabase Storage `upload` are the "did we write?"
// probes: every 401 must leave both untouched.
// =====================================================

import { POST } from '@/app/api/ticket/generate/route';
import { payments } from '@/core/database/schema';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────
// `@/features/storage/actions/authz` is mocked (repo convention — the same
// module is faked by 10 other suites) so this suite pins the ROUTE's branch
// resolution. The constant-time comparison itself is not mocked: it runs for
// real against `safeTokenEqual`, and `tokenCompare.test.ts` pins the digest
// contract that makes it length-safe.

const {
  mockRequireOwnedBusinessById,
  mockDbSelect,
  mockSelect,
  mockProductSelect,
  mockUpdate,
  mockStorageFrom,
  mockUpload,
  mockGetPublicUrl,
  mockQrToDataURL,
} = vi.hoisted(() => {
  const mockRequireOwnedBusinessById = vi.fn();
  const mockDbSelect = vi.fn();
  const mockSelect = vi.fn();
  const mockProductSelect = vi.fn();
  const mockUpdate = vi.fn();
  const mockUpload = vi.fn();
  const mockGetPublicUrl = vi.fn();
  const mockStorageFrom = vi.fn();
  const mockQrToDataURL = vi.fn();

  return {
    mockRequireOwnedBusinessById,
    mockDbSelect,
    mockSelect,
    mockProductSelect,
    mockUpdate,
    mockStorageFrom,
    mockUpload,
    mockGetPublicUrl,
    mockQrToDataURL,
  };
});

vi.mock('@/features/storage/actions/authz', () => ({
  requireOwnedBusinessById: mockRequireOwnedBusinessById,
}));

vi.mock('@/core/database/client', () => ({
  db: {
    select: mockDbSelect,
    update: () => ({
      set: () => ({
        where: mockUpdate,
      }),
    }),
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ storage: { from: mockStorageFrom } })),
}));

vi.mock('next/og', () => ({
  ImageResponse: class {
    async arrayBuffer() {
      return new ArrayBuffer(8);
    }
  },
}));

vi.mock('qrcode', () => ({
  default: { toDataURL: mockQrToDataURL },
}));

// ── Fixtures ─────────────────────────────────────────

const BUSINESS_ID = 'biz-owner-1';
const FOREIGN_BUSINESS_ID = 'biz-foreign-2';
const ORDER_NUMBER = 'ORD-BUYER-0001';
const TRACKING_TOKEN = 'tk_9f2c1b7e4a6d8f0a3b5c7d9e1f3a5b7c';
const WRONG_TOKEN = 'tk_00000000000000000000000000000000';
const EXISTING_TICKET_URL = 'https://supabase.co/tickets/ORD-BUYER-0001.png';
const GENERATED_TICKET_URL = 'https://supabase.co/storage/v1/object/public/tickets/new-ticket.png';

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    orderNumber: ORDER_NUMBER,
    amount: '100.00',
    currency: 'PEN',
    paymentMethod: 'card',
    buyerDni: '12345678',
    buyerPhone: '999999999',
    buyerEmail: 'buyer@example.com',
    shippingType: 'agencia',
    shippingAgency: 'Shalom',
    shippingDistrict: 'Lima',
    shippingProvince: 'Lima',
    shippingDepartment: 'Lima',
    metadata: { cartItems: [{ id: 'prod-1', quantity: 1, price: 100 }] },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ticketUrl: null,
    businessId: BUSINESS_ID,
    trackingToken: TRACKING_TOKEN,
    businessName: 'Test Store',
    businessSlug: 'test-store',
    businessRuc: '20500000000',
    businessAddress: 'Av. Siempre Viva 742',
    businessLogoUrl: null,
    ...overrides,
  };
}

function generateRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/ticket/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Owner session for `BUSINESS_ID`. */
function grantOwnership() {
  mockRequireOwnedBusinessById.mockResolvedValue({
    businessId: BUSINESS_ID,
    ownerId: 'user-1',
    slug: 'test-store',
  });
}

/** No session / not the owner — mirrors the real `No autorizado` throw. */
function refuseOwnership(message = 'No autorizado') {
  mockRequireOwnedBusinessById.mockRejectedValue(new Error(message));
}

/** No write of any kind may have happened. */
function expectNoWrites() {
  expect(mockUpload).not.toHaveBeenCalled();
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockStorageFrom).not.toHaveBeenCalled();
}

// ── Suite ────────────────────────────────────────────

describe('POST /api/ticket/generate — owner-or-buyer gate', () => {
  beforeEach(() => {
    // Every implementation is re-declared here: vitest.config.ts runs with
    // `restoreMocks: true`, so module-level implementations do not survive.
    mockDbSelect.mockImplementation(() => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: mockSelect }),
        }),
        where: () => mockProductSelect(),
      }),
    }));
    mockStorageFrom.mockImplementation(() => ({
      upload: mockUpload,
      getPublicUrl: mockGetPublicUrl,
    }));
    mockUpload.mockResolvedValue({ error: null });
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: GENERATED_TICKET_URL } });
    mockProductSelect.mockResolvedValue([]);
    mockQrToDataURL.mockResolvedValue('data:image/png;base64,QR');
  });

  // ── Ordering: validation and lookup precede any access proof ──────────

  test('400 when orderNumber is missing, before consulting authz or the database', async () => {
    const res = await POST(generateRequest({}));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Missing or invalid orderNumber');
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockRequireOwnedBusinessById).not.toHaveBeenCalled();
  });

  test('404 when the order is not found, before the access proof runs', async () => {
    mockSelect.mockResolvedValueOnce([]);

    const res = await POST(generateRequest({ orderNumber: 'ORD-NONEXISTENT' }));

    expect(res.status).toBe(404);
    expect(mockRequireOwnedBusinessById).not.toHaveBeenCalled();
    expectNoWrites();
  });

  // ── The lookup must carry the buyer proof ────────────────────────────

  test('the payment lookup reads payments.trackingToken', async () => {
    grantOwnership();
    mockSelect.mockResolvedValueOnce([paymentRow()]);

    await POST(generateRequest({ orderNumber: ORDER_NUMBER }));

    // The first `db.select` is the payment+business join; its projection is
    // the route's output shape, so the buyer's token has to be mapped through.
    const projection = mockDbSelect.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(projection.trackingToken).toBe(payments.trackingToken);
  });

  // ── OWNER branch ─────────────────────────────────────────────────────

  test('owner regenerates: 200 with a fresh publicUrl, upload and update performed', async () => {
    grantOwnership();
    mockSelect.mockResolvedValueOnce([paymentRow({ ticketUrl: EXISTING_TICKET_URL })]);

    const res = await POST(
      generateRequest({
        orderNumber: ORDER_NUMBER,
        forceRegenerate: true,
        trackingToken: WRONG_TOKEN,
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, publicUrl: GENERATED_TICKET_URL });
    expect(mockRequireOwnedBusinessById).toHaveBeenCalledWith(BUSINESS_ID);
    // An owner's own session is the proof — a stale body token is not consulted.
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  test('owner without forceRegenerate gets the existing ticket and writes nothing', async () => {
    grantOwnership();
    mockSelect.mockResolvedValueOnce([paymentRow({ ticketUrl: EXISTING_TICKET_URL })]);

    const res = await POST(generateRequest({ orderNumber: ORDER_NUMBER }));

    expect(res.status).toBe(200);
    expect((await res.json()).publicUrl).toBe(EXISTING_TICKET_URL);
    expectNoWrites();
  });

  test("the ownership check is asked about the payment row's own business", async () => {
    grantOwnership();
    mockSelect.mockResolvedValueOnce([paymentRow({ ticketUrl: EXISTING_TICKET_URL })]);

    await POST(generateRequest({ orderNumber: ORDER_NUMBER }));

    // Guards against the caller-supplied value being substituted for the
    // resolved one — the id that reaches the gate must be the row's.
    expect(mockRequireOwnedBusinessById).toHaveBeenCalledWith(BUSINESS_ID);
  });

  // ── BUYER branch ─────────────────────────────────────────────────────

  test('buyer with a matching token and no forceRegenerate gets the existing ticket', async () => {
    refuseOwnership();
    mockSelect.mockResolvedValueOnce([paymentRow({ ticketUrl: EXISTING_TICKET_URL })]);

    const res = await POST(
      generateRequest({ orderNumber: ORDER_NUMBER, trackingToken: TRACKING_TOKEN }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).publicUrl).toBe(EXISTING_TICKET_URL);
    expectNoWrites();
  });

  test('buyer never overwrites: forceRegenerate is coerced to false', async () => {
    refuseOwnership();
    mockSelect.mockResolvedValueOnce([paymentRow({ ticketUrl: EXISTING_TICKET_URL })]);

    const res = await POST(
      generateRequest({
        orderNumber: ORDER_NUMBER,
        forceRegenerate: true,
        trackingToken: TRACKING_TOKEN,
      }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).publicUrl).toBe(EXISTING_TICKET_URL);
    expectNoWrites();
  });

  test('buyer generates the first ticket when the row has none', async () => {
    refuseOwnership();
    mockSelect.mockResolvedValueOnce([paymentRow({ ticketUrl: null })]);

    const res = await POST(
      generateRequest({
        orderNumber: ORDER_NUMBER,
        forceRegenerate: true,
        trackingToken: TRACKING_TOKEN,
      }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).publicUrl).toBe(GENERATED_TICKET_URL);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  // ── Refusals ─────────────────────────────────────────────────────────

  test('401 for a wrong token, without touching storage or the payment row', async () => {
    refuseOwnership();
    mockSelect.mockResolvedValueOnce([paymentRow({ ticketUrl: EXISTING_TICKET_URL })]);

    const res = await POST(
      generateRequest({
        orderNumber: ORDER_NUMBER,
        forceRegenerate: true,
        trackingToken: WRONG_TOKEN,
      }),
    );

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('No autorizado');
    expectNoWrites();
  });

  test('401 for a wrong token of a different length — the whole value is compared', async () => {
    refuseOwnership();
    mockSelect.mockResolvedValueOnce([paymentRow({ ticketUrl: EXISTING_TICKET_URL })]);

    const res = await POST(
      generateRequest({ orderNumber: ORDER_NUMBER, trackingToken: `${TRACKING_TOKEN}x` }),
    );

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('No autorizado');
    expectNoWrites();
  });

  test('401 when no proof is presented at all', async () => {
    refuseOwnership();
    mockSelect.mockResolvedValueOnce([paymentRow({ ticketUrl: EXISTING_TICKET_URL })]);

    const res = await POST(generateRequest({ orderNumber: ORDER_NUMBER }));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('No autorizado');
    expectNoWrites();
  });

  test('401 when the body token is not a usable string', async () => {
    refuseOwnership();
    mockSelect.mockResolvedValueOnce([paymentRow({ ticketUrl: EXISTING_TICKET_URL })]);

    const res = await POST(generateRequest({ orderNumber: ORDER_NUMBER, trackingToken: '' }));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('No autorizado');
    expectNoWrites();
  });

  test('401 when the row has no stored token, so an empty body token cannot claim it', async () => {
    // `safeTokenEqual('', '')` is true by contract (two identical digests), so
    // the gate must not rely on the comparison to reject blank proofs — a row
    // without a token is not claimable by anybody.
    refuseOwnership();
    mockSelect.mockResolvedValueOnce([paymentRow({ ticketUrl: null, trackingToken: null })]);

    const res = await POST(generateRequest({ orderNumber: ORDER_NUMBER, trackingToken: '' }));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('No autorizado');
    expectNoWrites();
  });

  test("401 for a foreign order: another business' ticket is never exposed or rewritten", async () => {
    refuseOwnership();
    mockSelect.mockResolvedValueOnce([
      paymentRow({
        businessId: FOREIGN_BUSINESS_ID,
        ticketUrl: EXISTING_TICKET_URL,
        trackingToken: TRACKING_TOKEN,
      }),
    ]);

    // The caller has no proof for B's order: no session, and no token at all.
    const res = await POST(generateRequest({ orderNumber: ORDER_NUMBER, forceRegenerate: true }));

    expect(res.status).toBe(401);
    expect(await res.json()).not.toHaveProperty('publicUrl');
    expectNoWrites();
  });
});
