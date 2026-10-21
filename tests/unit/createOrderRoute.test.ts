// =====================================================
// POST /api/payment/create-order — Integration tests
// =====================================================

import { POST } from '@/app/api/payment/create-order/route';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────

const {
  mockBusinessFindFirst,
  mockBusinessSettingsFindFirst,
  mockSubscriptionFindFirst,
  mockReturning,
  mockValues,
  mockInsert,
} = vi.hoisted(() => {
  const mockBusinessFindFirst = vi.fn();
  const mockBusinessSettingsFindFirst = vi.fn();
  const mockSubscriptionFindFirst = vi.fn();
  const mockReturning = vi.fn();
  const mockValues = vi.fn(() => ({ returning: mockReturning }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));

  return {
    mockBusinessFindFirst,
    mockBusinessSettingsFindFirst,
    mockSubscriptionFindFirst,
    mockReturning,
    mockValues,
    mockInsert,
  };
});
const mockSelectCulqiBlocked = vi.fn();

// validateAmount query result (product rows for price revalidation)
let mockValidateRows: { id: string; price: string; secondPrice: string | null }[] = [];

// `where` result doubles as a thenable (awaited by validateAmount) and carries
// `.limit` used by the culqiBlocked query: `db.select(...).from(...).where(...).limit(1)`.
const { mockSelectWhere, mockSelectFrom, mockSelect } = vi.hoisted(() => {
  const mockSelectWhere = vi.fn(() => ({
    then: (onFulfilled: (rows: unknown) => unknown) =>
      Promise.resolve(mockValidateRows).then(onFulfilled),
    limit: mockSelectCulqiBlocked,
  }));
  const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
  const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

  return { mockSelectWhere, mockSelectFrom, mockSelect };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } }, error: null }),
    },
  })),
}));

vi.mock('@/core/database/client', () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
    query: {
      businesses: { findFirst: mockBusinessFindFirst },
      businessSettings: { findFirst: mockBusinessSettingsFindFirst },
      businessSubscriptions: { findFirst: mockSubscriptionFindFirst },
    },
  },
}));

const mockDecrypt = vi.hoisted(() => vi.fn());
vi.mock('@/utils/crypto', () => ({
  decrypt: mockDecrypt,
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Helpers ──────────────────────────────────────────

function createValidPayload(overrides: Record<string, unknown> = {}) {
  return {
    amount: 5000,
    email: 'buyer@test.com',
    businessId: '550e8400-e29b-41d4-a716-446655440000',
    ...overrides,
  };
}

function createCulqiOrderResponse(overrides: Record<string, unknown> = {}) {
  return {
    object: 'order',
    id: 'ord_culqi_abc123',
    amount: 5000,
    currency_code: 'PEN',
    payment_method: 'pago_efectivo',
    order_number: 'ORD-test1234',
    client_details: { email: 'buyer@test.com' },
    expiration_date: Math.floor(Date.now() / 1000) + 259200,
    status: 'pending',
    cip_code: '1234567890',
    cip_cc_agent: 'BCP',
    cip_cc_user: '12345678',
    ...overrides,
  };
}

// ── Suite ────────────────────────────────────────────

describe('POST /api/payment/create-order', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock: business is active
    mockBusinessFindFirst.mockResolvedValue({ isActive: true });

    // Default mock: business has an active subscription (lite_pago)
    mockSubscriptionFindFirst.mockResolvedValue({
      planType: 'lite_pago',
      planEndDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 días
    });

    // Default mock: culqiBlocked check — business is NOT blocked
    mockSelectCulqiBlocked.mockResolvedValue([{ culqiBlocked: false }]);

    // Default mock: validateAmount product query (matching productId when present)
    mockValidateRows = [
      {
        id: '660e8400-e29b-41d4-a716-446655440001',
        price: '50.00',
        secondPrice: null,
      },
    ];
    mockSelectWhere.mockClear();

    // Default mock: business settings found
    mockBusinessSettingsFindFirst.mockResolvedValue({
      culqiSecretKey: 'encrypted_sk_test_xxx',
    });

    // Default mock: decryption succeeds
    mockDecrypt.mockReturnValue('sk_test_abc123');

    // Default mock: Culqi API succeeds — PagoEfectivo
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => createCulqiOrderResponse(),
    });

    // Default mock: DB insert succeeds
    mockReturning.mockResolvedValue([
      {
        id: 'order-payment-uuid',
        culqiOrderId: 'ord_culqi_abc123',
        status: 'pending',
        paymentCode: null,
        qrUrl: null,
        expirationDate: new Date(Date.now() + 259200000),
      },
    ]);

    vi.stubEnv('NODE_ENV', 'development');
  });

  // ============================================================
  // RED-GREEN: Invalid input returns 400
  // ============================================================

  test('returns 400 for missing businessId', async () => {
    const request = new Request('http://localhost/api/payment/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: 5000, email: 'buyer@test.com' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('returns 400 for invalid email', async () => {
    const request = new Request('http://localhost/api/payment/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload({ email: 'not-an-email' })),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('returns 400 for amount less than 100', async () => {
    const request = new Request('http://localhost/api/payment/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload({ amount: 50 })),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  // ============================================================
  // Business settings errors
  // ============================================================

  test('returns 400 when business has no culqi secret key', async () => {
    mockBusinessSettingsFindFirst.mockResolvedValue(null);

    const request = new Request('http://localhost/api/payment/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload()),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('returns 400 when key environment mismatches (dev with sk_live)', async () => {
    mockDecrypt.mockReturnValue('sk_live_real_key');

    const request = new Request('http://localhost/api/payment/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload()),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  // ============================================================
  // Successful order creation
  // ============================================================

  test('returns success with culqiOrderId, paymentCode, qrUrl for PagoEfectivo', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () =>
        createCulqiOrderResponse({
          id: 'ord_abc123',
          cip_code: '9876543210',
        }),
    });

    mockReturning.mockResolvedValue([
      {
        id: 'order-uuid-1',
        culqiOrderId: 'ord_abc123',
        status: 'pending',
        paymentCode: '9876543210',
        qrUrl: null,
        expirationDate: new Date(Date.now() + 259200000),
      },
    ]);

    const request = new Request('http://localhost/api/payment/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload()),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.culqiOrderId).toBe('ord_abc123');
    expect(body.paymentCode).toBe('9876543210');
    expect(body.qrUrl).toBeNull();
    expect(body).toHaveProperty('expirationDate');
  });

  test('returns qrUrl for Billetera Móvil', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () =>
        createCulqiOrderResponse({
          payment_method: 'billetera_movil',
          cip_code: undefined,
          action: { qr: { image_url: 'https://culqi.com/qr/abc123' } },
        }),
    });

    mockReturning.mockResolvedValue([
      {
        id: 'order-uuid-2',
        culqiOrderId: 'ord_culqi_abc123',
        status: 'pending',
        paymentCode: null,
        qrUrl: 'https://culqi.com/qr/abc123',
        expirationDate: new Date(Date.now() + 259200000),
      },
    ]);

    const request = new Request('http://localhost/api/payment/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload()),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.qrUrl).toBe('https://culqi.com/qr/abc123');
    expect(body.paymentCode).toBeNull();
  });

  test('sends client_details with first_name/last_name when customerName is provided', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => createCulqiOrderResponse(),
    });

    mockReturning.mockResolvedValue([
      {
        id: 'order-uuid-3',
        culqiOrderId: 'ord_culqi_abc123',
        status: 'pending',
        paymentCode: null,
        qrUrl: null,
        expirationDate: new Date(Date.now() + 259200000),
      },
    ]);

    const request = new Request('http://localhost/api/payment/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        createValidPayload({ customerName: 'Juan Carlos Perez Gomez', phone: '999888777' }),
      ),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    // Inspeccionar el body enviado a Culqi
    const culqiFetchCall = mockFetch.mock.calls[0];
    const culqiBody = JSON.parse(culqiFetchCall[1].body as string);
    expect(culqiBody.client_details).toMatchObject({
      email: 'buyer@test.com',
      phone: '999888777',
      first_name: 'Juan',
      last_name: 'Carlos Perez Gomez',
    });
  });

  // ============================================================
  // Culqi API failure
  // ============================================================

  test('returns Culqi error and does NOT insert when Culqi API fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        user_message: 'Monto inválido',
        merchant_message: 'Invalid amount',
      }),
    });

    const request = new Request('http://localhost/api/payment/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload()),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('details');

    // MUST NOT persist any row
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('handles Culqi network timeout (AbortError)', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValue(abortError);

    const request = new Request('http://localhost/api/payment/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload()),
    });

    const response = await POST(request);
    // Network timeout should return 504
    expect(response.status).toBe(504);

    const body = await response.json();
    expect(body).toHaveProperty('error');

    // MUST NOT persist any row
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('handles generic network error', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const request = new Request('http://localhost/api/payment/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload()),
    });

    const response = await POST(request);
    expect(response.status).toBe(502);

    const body = await response.json();
    expect(body).toHaveProperty('error');

    // MUST NOT persist any row
    expect(mockInsert).not.toHaveBeenCalled();
  });

  // ============================================================
  // Amount revalidation (fix-price-tampering)
  // ============================================================

  test('rejects tampered amount that does not match product price (400)', async () => {
    // Product price is 50.00 soles = 5000 cents
    mockValidateRows = [
      {
        id: '660e8400-e29b-41d4-a716-446655440001',
        price: '50.00',
        secondPrice: null,
      },
    ];

    const request = new Request('http://localhost/api/payment/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        createValidPayload({
          productId: '660e8400-e29b-41d4-a716-446655440001',
          amount: 1000, // tampered lower amount
        }),
      ),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe('El monto no coincide con el precio del producto');

    // Culqi API MUST NOT be called
    expect(mockFetch).not.toHaveBeenCalled();
    // No order persisted
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('accepts correct amount that matches product price', async () => {
    // Product price is 50.00 soles = 5000 cents
    mockValidateRows = [
      {
        id: '660e8400-e29b-41d4-a716-446655440001',
        price: '50.00',
        secondPrice: null,
      },
    ];

    const request = new Request('http://localhost/api/payment/create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        createValidPayload({
          productId: '660e8400-e29b-41d4-a716-446655440001',
          amount: 5000,
        }),
      ),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);

    // Culqi API WAS called (order proceeds)
    expect(mockFetch).toHaveBeenCalled();
  });

  // ============================================================
  // Cart snapshot: reconciliation + persistence (R1/R2/A1, slice 2)
  // ============================================================

  describe('cart snapshot reconciliation and persistence', () => {
    const PRODUCT_A = '660e8400-e29b-41d4-a716-446655440001';
    const PRODUCT_B = '770e8400-e29b-41d4-a716-446655440002';
    // A = S/ 50.00, B = S/ 30.00 → cart {A×2, B×1} = 13000 cents
    const cartRows = [
      { id: PRODUCT_A, price: '50.00', secondPrice: null },
      { id: PRODUCT_B, price: '30.00', secondPrice: null },
    ];

    function post(body: Record<string, unknown>) {
      return POST(
        new Request('http://localhost/api/payment/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
    }

    test('reconciles the full cart total against every line (200 when the sum matches)', async () => {
      mockValidateRows = cartRows;

      const response = await post(
        createValidPayload({
          productId: PRODUCT_A,
          amount: 13000,
          cartItems: [
            { id: PRODUCT_A, quantity: 2 },
            { id: PRODUCT_B, quantity: 1 },
          ],
        }),
      );

      // Only a reconciliation that consumes EVERY cart line can accept the sum
      // (a productId-only check would compute 5000 and reject this request).
      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalled();
    });

    test('rejects a line quantity that does not match the amount paid (400, no Culqi, no insert)', async () => {
      mockValidateRows = cartRows;

      // Amount equals the single-product price (5000) while the cart declares
      // A×3 + B×1 = 18000: paying for one unit but claiming three.
      const response = await post(
        createValidPayload({
          productId: PRODUCT_A,
          amount: 5000,
          cartItems: [
            { id: PRODUCT_A, quantity: 3 },
            { id: PRODUCT_B, quantity: 1 },
          ],
        }),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('El monto no coincide con el precio del producto');
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    test('reconciles a cart-only order that has no top-level productId', async () => {
      mockValidateRows = cartRows;

      // No productId: the first cart line is the reconciliation anchor, so a
      // tampered amount must still be rejected before Culqi.
      const response = await post(
        createValidPayload({
          amount: 1000,
          cartItems: [
            { id: PRODUCT_A, quantity: 2 },
            { id: PRODUCT_B, quantity: 1 },
          ],
        }),
      );

      expect(response.status).toBe(400);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });

    test('persists the cart snapshot in payment_orders.metadata alongside culqiRaw', async () => {
      mockValidateRows = cartRows;

      const response = await post(
        createValidPayload({
          productId: PRODUCT_A,
          amount: 13000,
          cartItems: [
            { id: PRODUCT_A, quantity: 2 },
            { id: PRODUCT_B, quantity: 1 },
          ],
        }),
      );
      expect(response.status).toBe(200);

      const persisted = mockValues.mock.calls[0][0] as Record<string, unknown>;
      expect(persisted.metadata).toEqual({
        culqiRaw: {
          orderId: 'ord_culqi_abc123',
          orderNumber: 'ORD-test1234',
          createdAt: expect.any(String),
        },
        cartItems: [
          { id: PRODUCT_A, quantity: 2 },
          { id: PRODUCT_B, quantity: 1 },
        ],
      });
      // The snapshot lives in its own key; it must never be aliased into the
      // product binding the charge-route gate reads.
      expect(persisted.metadata).not.toHaveProperty('productId');
    });

    test('sends a byte-identical Culqi order body with or without the snapshot', async () => {
      mockValidateRows = [{ id: PRODUCT_A, price: '50.00', secondPrice: null }];

      const FIXED_UUID = '123e4567-e89b-42d3-a456-426614174000';
      const uuidSpy = vi
        .spyOn(crypto, 'randomUUID')
        .mockReturnValue(FIXED_UUID as `${string}-${string}-${string}-${string}-${string}`);
      // order_number and expiration_date are time/uuid-derived: pin both so the
      // two bodies are comparable byte for byte.
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-15T10:00:00.000Z'));

      try {
        const base = createValidPayload({ productId: PRODUCT_A, amount: 5000 });

        const plain = await post(base);
        expect(plain.status).toBe(200);

        const withSnapshot = await post({
          ...base,
          cartItems: [{ id: PRODUCT_A, quantity: 1 }],
        });
        expect(withSnapshot.status).toBe(200);
      } finally {
        vi.useRealTimers();
        uuidSpy.mockRestore();
      }

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const plainBody = mockFetch.mock.calls[0][1].body as string;
      const snapshotBody = mockFetch.mock.calls[1][1].body as string;
      expect(JSON.parse(snapshotBody)).toEqual(JSON.parse(plainBody));
      // The snapshot is a DB-only contract: it never rides along to Culqi.
      expect(snapshotBody).not.toContain('cartItems');
    });
  });
});
