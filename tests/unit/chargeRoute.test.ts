// =====================================================
// POST /api/payment/charge — Unit tests
// =====================================================
// Verifies that buyer identity (antifraud_details) reaches
// the Culqi charge request body for the token flow.
// =====================================================

import { POST } from '@/app/api/payment/charge/route';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks (must be before module imports — vi.mock is hoisted) ──

const {
  mockBusinessFindFirst,
  mockBusinessSettingsFindFirst,
  mockPaymentsFindFirst,
  mockPaymentOrdersFindFirst,
  mockGetCulqiOrder,
  mockIsCulqiOrderPaid,
  CulqiReadErrorMock,
  mockProductsFindFirst,
  mockProductsSelectWhere,
  mockProductsSelectFrom,
  mockProductsSelect,
  mockTxReturning,
  mockTxValues,
  mockTxInsert,
  mockTxUpdateReturning,
  mockTxSet,
  mockTxWhere,
  mockTxUpdate,
  mockTransaction,
} = vi.hoisted(() => {
  const mockBusinessFindFirst = vi.fn();
  const mockBusinessSettingsFindFirst = vi.fn();
  const mockPaymentsFindFirst = vi.fn();
  const mockPaymentOrdersFindFirst = vi.fn();
  const mockGetCulqiOrder = vi.fn();
  const mockIsCulqiOrderPaid = vi.fn();
  const mockProductsFindFirst = vi.fn();

  class CulqiReadErrorMock extends Error {
    readonly kind: 'timeout' | 'transport';
    constructor(kind: 'timeout' | 'transport') {
      super(`CulqiReadError:${kind}`);
      this.name = 'CulqiReadError';
      this.kind = kind;
    }
  }

  const mockProductsSelectWhere = vi.fn();
  const mockProductsSelectFrom = vi.fn(() => ({ where: mockProductsSelectWhere }));
  const mockProductsSelect = vi.fn(() => ({ from: mockProductsSelectFrom }));

  const mockTxReturning = vi.fn();
  const mockTxValues = vi.fn(() => ({ returning: mockTxReturning }));
  const mockTxInsert = vi.fn(() => ({ values: mockTxValues }));
  const mockTxUpdateReturning = vi.fn();
  const mockTxSet = vi.fn(() => ({ where: mockTxWhere }));
  // `.where()` is chainable: the payment_orders flip continues into `.returning()`,
  // while the stock UPDATE stops at `.where()`.
  const mockTxWhere = vi.fn(() => ({ returning: mockTxUpdateReturning }));
  const mockTxUpdate = vi.fn(() => ({ set: mockTxSet }));
  const mockTransaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      insert: mockTxInsert,
      update: mockTxUpdate,
    }),
  );

  return {
    mockBusinessFindFirst,
    mockBusinessSettingsFindFirst,
    mockPaymentsFindFirst,
    mockPaymentOrdersFindFirst,
    mockGetCulqiOrder,
    mockIsCulqiOrderPaid,
    CulqiReadErrorMock,
    mockProductsFindFirst,
    mockProductsSelectWhere,
    mockProductsSelectFrom,
    mockProductsSelect,
    mockTxReturning,
    mockTxValues,
    mockTxInsert,
    mockTxUpdateReturning,
    mockTxSet,
    mockTxWhere,
    mockTxUpdate,
    mockTransaction,
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'buyer-user-id' } }, error: null }),
    },
  })),
}));

vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      businesses: { findFirst: mockBusinessFindFirst },
      businessSettings: { findFirst: mockBusinessSettingsFindFirst },
      payments: { findFirst: mockPaymentsFindFirst },
      paymentOrders: { findFirst: mockPaymentOrdersFindFirst },
      products: { findFirst: mockProductsFindFirst },
    },
    select: mockProductsSelect,
    transaction: mockTransaction,
  },
}));

vi.mock('@/core/payments/culqiOrders', () => ({
  // original-impl form so restoreMocks keeps these resolved values across tests
  getCulqiOrder: mockGetCulqiOrder,
  isCulqiOrderPaid: mockIsCulqiOrderPaid,
  CulqiReadError: CulqiReadErrorMock,
}));

vi.mock('@/core/entitlements/getBusinessEntitlements', () => ({
  // original-impl form so restoreMocks keeps this resolved value across tests
  getBusinessEntitlements: vi.fn(async () => ({ hasPaymentGateway: true })),
}));

vi.mock('@/core/payments/idempotency', () => ({
  // original-impl form so restoreMocks keeps these resolved values across tests
  reserveIdempotencyKey: mockReserveIdempotencyKey,
  completeIdempotencyKey: mockCompleteIdempotencyKey,
}));

vi.mock('@/core/payments/rateLimiter', () => ({
  paymentRateLimiter: { check: vi.fn(() => true) },
}));

const {
  mockDecrypt,
  mockReserveIdempotencyKey,
  mockCompleteIdempotencyKey,
  mockNotifyNewOrder,
  mockSendOrderStatusSms,
} = vi.hoisted(() => ({
  mockDecrypt: vi.fn(),
  mockReserveIdempotencyKey: vi.fn(async () => ({ type: 'reserved', key: 'idem-1' })),
  mockCompleteIdempotencyKey: vi.fn(async () => undefined),
  mockNotifyNewOrder: vi.fn(async () => undefined),
  mockSendOrderStatusSms: vi.fn(async () => undefined),
}));
vi.mock('@/utils/crypto', () => ({
  decrypt: mockDecrypt,
}));

vi.mock('@/lib/notifications', () => ({
  notifyNewOrder: mockNotifyNewOrder,
  notifyLowStock: vi.fn().mockResolvedValue(undefined),
  notifyOutOfStock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/twilio/orderSms', () => ({
  sendOrderStatusSms: mockSendOrderStatusSms,
}));

vi.mock('@/lib/email/orderEmails', () => ({
  sendOrderConfirmationEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/core/utils/trackingToken', () => ({
  generateTrackingToken: vi.fn(() => 'tt_test_token'),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Helpers ──────────────────────────────────────────

/**
 * Compile a Drizzle `where` node to SQL so a test can assert that BOTH columns
 * are constrained. `and(a, b)` wraps the predicates in parentheses; a single
 * `eq()` never does, so this distinguishes "scoped by both" from "scoped by one".
 */
function compileWhere(where: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(where as never);
}

function createValidPayload(overrides: Record<string, unknown> = {}) {
  return {
    token: 'tok_test_abc123',
    amount: 150000, // S/ 1500.00
    email: 'buyer@test.com',
    businessId: '550e8400-e29b-41d4-a716-446655440000',
    productId: '660e8400-e29b-41d4-a716-446655440001',
    ...overrides,
  };
}

/**
 * A `payment_orders` row as the gate sees it. The gate projects only
 * `amount`, `currency` and `metadata`, so the fixture mirrors that shape:
 * `amount` is decimal(10,2) in SOLES (create-order writes `String(amount/100)`),
 * and the product binding lives in `metadata.productId` (absent for a
 * product-less order).
 */
function createPaymentOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'po-1',
    businessId: '550e8400-e29b-41d4-a716-446655440000',
    culqiOrderId: 'ord_culqi_abc123',
    amount: '1500',
    currency: 'PEN',
    metadata: { productId: '660e8400-e29b-41d4-a716-446655440001' },
    ...overrides,
  };
}

function createOrderFlowPayload(overrides: Record<string, unknown> = {}) {
  return createValidPayload({
    token: undefined,
    culqiOrderId: 'ord_culqi_abc123',
    metadata: { shippingInfo: { phone: '999888777', courier: 'recojo' } },
    ...overrides,
  });
}

/**
 * The real client always sends `Idempotency-Key: charge-${token || culqiOrderId}`
 * (`paymentApi.ts:68`), so the order-flow request mirrors that deterministic key.
 */
function createOrderFlowRequest(payload: Record<string, unknown>) {
  return new Request('http://localhost/api/payment/charge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'charge-ord_culqi_abc123',
    },
    body: JSON.stringify(payload),
  });
}

function createCulqiChargeResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ch_abc123',
    outcome: { type: 'venta_exitosa', user_message: '', merchant_message: '' },
    reference_code: 'ref_xyz',
    ...overrides,
  };
}

// ── Suite ────────────────────────────────────────────

describe('POST /api/payment/charge', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock: business is active and not blocked
    mockBusinessFindFirst.mockResolvedValue({
      ownerId: 'owner-user-id',
      culqiBlocked: false,
      slug: 'test-slug',
      name: 'Test Store',
    });

    // Default mock: business settings have an encrypted key
    mockBusinessSettingsFindFirst.mockResolvedValue({
      culqiSecretKey: 'encrypted_sk_test_xxx',
    });

    // Default mock: decryption succeeds
    mockDecrypt.mockReturnValue('sk_test_abc123');

    // Default mock: Culqi charge succeeds
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => createCulqiChargeResponse(),
    });

    // Default mock: no existing payment (not a replay)
    mockPaymentsFindFirst.mockResolvedValue(null);
    mockPaymentOrdersFindFirst.mockResolvedValue(null);
    mockGetCulqiOrder.mockResolvedValue({ id: 'ord_culqi_abc123', status: 'paid', state: 'paid' });
    mockIsCulqiOrderPaid.mockReturnValue(true);

    // Default mock: product has stock above threshold (no low-stock alerts)
    mockProductsFindFirst.mockResolvedValue({
      id: '660e8400-e29b-41d4-a716-446655440001',
      title: 'Test Product',
      stock: 10,
      price: '50.00',
      secondPrice: null,
    });

    // Default mock: validateAmount price query — matches default amount 150000 (S/ 1500.00)
    mockProductsSelectWhere.mockResolvedValue([
      {
        id: '660e8400-e29b-41d4-a716-446655440001',
        price: '1500.00',
        secondPrice: null,
      },
    ]);

    // Default mock: DB insert succeeds
    mockTxReturning.mockResolvedValue([
      { id: 'pay-1', trackingToken: 'tt_test_token', buyerPhone: '999888777' },
    ]);
    mockTxUpdateReturning.mockResolvedValue([{ id: 'po-1' }]);

    vi.stubEnv('NODE_ENV', 'development');
  });

  // ============================================================
  // Buyer identity: antifraud_details reaches the Culqi body
  // ============================================================

  test('sends antifraud_details with split customerName, phone_number and real email', async () => {
    const request = new Request('http://localhost/api/payment/charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        createValidPayload({
          customerName: 'Juan Carlos Perez Gomez',
          metadata: {
            shippingInfo: { phone: '999888777', courier: 'recojo' },
          },
        }),
      ),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const culqiFetchCall = mockFetch.mock.calls[0];
    const culqiBody = JSON.parse(culqiFetchCall[1].body as string);
    expect(culqiBody.antifraud_details).toMatchObject({
      email: 'buyer@test.com',
      phone_number: '999888777',
      first_name: 'Juan',
      last_name: 'Carlos Perez Gomez',
    });
    // The top-level email is the real buyer email, not the fallback
    expect(culqiBody.email).toBe('buyer@test.com');
  });

  test('omits first_name/last_name keys when customerName is missing', async () => {
    const request = new Request('http://localhost/api/payment/charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload()),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const culqiFetchCall = mockFetch.mock.calls[0];
    const culqiBody = JSON.parse(culqiFetchCall[1].body as string);
    expect(culqiBody.antifraud_details).not.toHaveProperty('first_name');
    expect(culqiBody.antifraud_details).not.toHaveProperty('last_name');
    expect(culqiBody.antifraud_details).not.toHaveProperty('phone_number');
    expect(culqiBody.antifraud_details).toEqual({ email: 'buyer@test.com' });
  });

  test('uses cliente@culqi.com fallback email only when email is truly absent', async () => {
    const request = new Request('http://localhost/api/payment/charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload({ email: '' })),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const culqiFetchCall = mockFetch.mock.calls[0];
    const culqiBody = JSON.parse(culqiFetchCall[1].body as string);
    expect(culqiBody.email).toBe('cliente@culqi.com');
    // antifraud_details.email must NOT be set from the fallback
    expect(culqiBody.antifraud_details).not.toHaveProperty('email');
  });

  // ============================================================
  // Amount revalidation (fix-price-tampering)
  // ============================================================

  test('rejects tampered amount that does not match product price (400)', async () => {
    // Product price is 50.00 soles = 5000 cents
    mockProductsSelectWhere.mockResolvedValue([
      {
        id: '660e8400-e29b-41d4-a716-446655440001',
        price: '50.00',
        secondPrice: null,
      },
    ]);

    const request = new Request('http://localhost/api/payment/charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload({ amount: 1000 })), // tampered lower amount
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toBe('El monto no coincide con el precio del producto');

    // Culqi API MUST NOT be called
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('accepts correct amount that matches product price (200)', async () => {
    // Product price is 50.00 soles = 5000 cents
    mockProductsSelectWhere.mockResolvedValue([
      {
        id: '660e8400-e29b-41d4-a716-446655440001',
        price: '50.00',
        secondPrice: null,
      },
    ]);

    const request = new Request('http://localhost/api/payment/charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload({ amount: 5000 })),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    // Culqi API WAS called (charge proceeds)
    expect(mockFetch).toHaveBeenCalled();
  });

  // ============================================================
  // Order flow: verify the Culqi order before trusting the order flow
  // (R8 - R12)
  // ============================================================

  describe('order flow - Culqi order verification gate', () => {
    test('returns 404 when the culqiOrderId does not belong to this business', async () => {
      mockPaymentOrdersFindFirst.mockResolvedValue(null);

      const response = await POST(createOrderFlowRequest(createOrderFlowPayload()));

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe('Orden de pago no encontrada');

      // No side effects at all: no transaction, no idempotency key burned
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockReserveIdempotencyKey).not.toHaveBeenCalled();
      expect(mockGetCulqiOrder).not.toHaveBeenCalled();
    });

    test('scopes the payment_orders read to BOTH culqiOrderId and businessId', async () => {
      mockPaymentOrdersFindFirst.mockResolvedValue(null);

      await POST(createOrderFlowRequest(createOrderFlowPayload()));

      expect(mockPaymentOrdersFindFirst).toHaveBeenCalledTimes(1);
      const arg = mockPaymentOrdersFindFirst.mock.calls[0][0] as { where: unknown };
      const compiled = compileWhere(arg.where);
      expect(compiled.sql).toMatch(/culqi_order_id.* and .*business_id/);
      expect(compiled.params).toEqual(
        expect.arrayContaining(['ord_culqi_abc123', '550e8400-e29b-41d4-a716-446655440000']),
      );
    });

    test.each([
      ['pending', 'pending'],
      ['expired', 'expired'],
      ['cancelled', 'cancelled'],
    ])('returns 402 with the buyer retry text when Culqi reports %s', async (marker) => {
      mockPaymentOrdersFindFirst.mockResolvedValue(createPaymentOrderRow());
      mockGetCulqiOrder.mockResolvedValue({ id: 'ord_culqi_abc123', status: marker });
      mockIsCulqiOrderPaid.mockReturnValue(false);

      const response = await POST(createOrderFlowRequest(createOrderFlowPayload()));

      expect(response.status).toBe(402);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe(
        'Tu pago todavía se está confirmando con la pasarela. Esperá unos segundos e intentá de nuevo.',
      );
      expect(body.code).toBe('ORDER_NOT_PAID');
      // chargePayment throws `data.details || data.error` — a details key would
      // shadow the buyer-facing text.
      expect(body).not.toHaveProperty('details');

      // Zero side effects
      expect(mockTxInsert).not.toHaveBeenCalled();
      expect(mockTxUpdate).not.toHaveBeenCalled();
      expect(mockTxReturning).not.toHaveBeenCalled();
      expect(mockNotifyNewOrder).not.toHaveBeenCalled();
      expect(mockSendOrderStatusSms).not.toHaveBeenCalled();
    });

    test('maps an aborted Culqi read to 504 and reserves nothing', async () => {
      mockPaymentOrdersFindFirst.mockResolvedValue(createPaymentOrderRow());
      mockGetCulqiOrder.mockRejectedValue(new CulqiReadErrorMock('timeout'));

      const response = await POST(createOrderFlowRequest(createOrderFlowPayload()));

      expect(response.status).toBe(504);
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockReserveIdempotencyKey).not.toHaveBeenCalled();
    });

    test('maps a Culqi transport failure to 502 and reserves nothing', async () => {
      mockPaymentOrdersFindFirst.mockResolvedValue(createPaymentOrderRow());
      mockGetCulqiOrder.mockRejectedValue(new CulqiReadErrorMock('transport'));

      const response = await POST(createOrderFlowRequest(createOrderFlowPayload()));

      expect(response.status).toBe(502);
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockReserveIdempotencyKey).not.toHaveBeenCalled();
    });

    test('returns 500 without committing the flip when the payment_orders update affects no row', async () => {
      mockPaymentOrdersFindFirst.mockResolvedValue(createPaymentOrderRow());
      mockTxUpdateReturning.mockResolvedValue([]);

      const response = await POST(createOrderFlowRequest(createOrderFlowPayload()));

      expect(response.status).toBe(500);
      expect(mockTransaction).toHaveBeenCalledTimes(1);
      // No committed flip and no order created downstream
      expect(mockNotifyNewOrder).not.toHaveBeenCalled();
      expect(mockCompleteIdempotencyKey).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        200,
      );
    });

    test('scopes the payment_orders flip to BOTH culqiOrderId and businessId', async () => {
      mockPaymentOrdersFindFirst.mockResolvedValue(createPaymentOrderRow());
      mockTxUpdateReturning.mockResolvedValue([{ id: 'po-1' }]);

      const response = await POST(createOrderFlowRequest(createOrderFlowPayload()));

      expect(response.status).toBe(200);
      // First UPDATE in the transaction is the payment_orders flip; the second
      // one is the stock decrement.
      expect(mockTxUpdate).toHaveBeenCalledTimes(2);
      const flipped = mockTxSet.mock.calls[0][0] as Record<string, unknown>;
      expect(flipped.status).toBe('paid');
      const whereArg = mockTxWhere.mock.calls[0][0] as unknown;
      const compiled = compileWhere(whereArg);
      expect(compiled.sql).toMatch(/culqi_order_id.* and .*business_id/);
      expect(compiled.params).toEqual(
        expect.arrayContaining(['ord_culqi_abc123', '550e8400-e29b-41d4-a716-446655440000']),
      );
    });

    test('does not replay another tenant payment for the same culqiChargeId', async () => {
      mockPaymentOrdersFindFirst.mockResolvedValue(createPaymentOrderRow());
      mockTxUpdateReturning.mockResolvedValue([{ id: 'po-1' }]);
      // A single-column lookup WOULD return the other tenant's row. Scoping the
      // query by businessId means the params no longer identify that row.
      mockPaymentsFindFirst.mockImplementation((arg: { where: unknown }) => {
        const { params } = compileWhere(arg.where);
        if (!params.includes('550e8400-e29b-41d4-a716-446655440000')) {
          return Promise.resolve({
            id: 'pay-other-tenant',
            businessId: '99999999-e29b-41d4-a716-446655440099',
            trackingToken: 'tt_other',
            buyerEmail: 'victim@other.test',
          });
        }
        return Promise.resolve(null);
      });

      const response = await POST(createOrderFlowRequest(createOrderFlowPayload()));

      // The cross-tenant row is NOT returned; this tenant gets its own 200 insert
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.payment.id).toBe('pay-1');
      expect(body.replayed).toBeUndefined();
      const lookupArg = mockPaymentsFindFirst.mock.calls[0][0] as { where: unknown };
      const lookup = compileWhere(lookupArg.where);
      expect(lookup.sql).toMatch(/culqi_charge_id.* and .*business_id/);
      expect(lookup.params).toEqual(
        expect.arrayContaining(['ord_culqi_abc123', '550e8400-e29b-41d4-a716-446655440000']),
      );
    });

    test('returns a PII-free replay body on a same-tenant duplicate', async () => {
      mockPaymentOrdersFindFirst.mockResolvedValue(createPaymentOrderRow());
      mockPaymentsFindFirst.mockResolvedValue({
        id: 'pay-existing',
        businessId: '550e8400-e29b-41d4-a716-446655440000',
        trackingToken: 'tt_existing',
        orderNumber: 'ORD-12345678',
        amount: '50.00',
        currency: 'PEN',
        status: 'paid',
        buyerEmail: 'buyer@test.com',
        buyerDni: '12345678',
        buyerPhone: '999888777',
        shippingAddress: 'Av. Siempre Viva 742',
        shippingPhone: '999888777',
        metadata: { customerAuth: { authId: 'auth-1' } },
      });

      const response = await POST(createOrderFlowRequest(createOrderFlowPayload()));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.replayed).toBe(true);
      expect(body.payment).toEqual({
        id: 'pay-existing',
        trackingToken: 'tt_existing',
        orderNumber: 'ORD-12345678',
        amount: '50.00',
        currency: 'PEN',
        status: 'paid',
      });
      expect(body.payment).not.toHaveProperty('buyerEmail');
      expect(body.payment).not.toHaveProperty('buyerDni');
      expect(body.payment).not.toHaveProperty('buyerPhone');
      expect(body.payment).not.toHaveProperty('shippingAddress');
      expect(body.payment).not.toHaveProperty('metadata');
      // No second write on a replay
      expect(mockTxInsert).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Order flow: bind the verified payment to what gets recorded
  // (R13 — amount/product binding, the W1 underpayment gap)
  // ============================================================

  describe('order flow - binding the verified payment to the recorded transaction', () => {
    test('projects only the money and binding columns, never buyer PII', async () => {
      mockPaymentOrdersFindFirst.mockResolvedValue(createPaymentOrderRow());

      await POST(createOrderFlowRequest(createOrderFlowPayload()));

      expect(mockPaymentOrdersFindFirst).toHaveBeenCalledTimes(1);
      const arg = mockPaymentOrdersFindFirst.mock.calls[0][0] as {
        columns?: Record<string, boolean>;
      };
      expect(arg.columns).toEqual({
        amount: true,
        currency: true,
        metadata: true,
      });
      // The gate is scoped to the caller's own tenant and reads money fields
      // only — buyerEmail / buyerPhone are never pulled into memory.
      expect(arg.columns).not.toHaveProperty('buyerEmail');
      expect(arg.columns).not.toHaveProperty('buyerPhone');
    });

    test('accepts the exact decimal-string amount and rounds the float case (200)', async () => {
      // `payment_orders.amount` is decimal(10,2) in soles; the request is in
      // minor units. '1.00' must equal 100, and 10.99 * 100 = 1098.999... must
      // round to 1099 rather than be rejected as a float artifact.
      mockProductsSelectWhere.mockResolvedValue([
        {
          id: '660e8400-e29b-41d4-a716-446655440001',
          price: '10.99',
          secondPrice: null,
        },
      ]);
      mockPaymentOrdersFindFirst.mockResolvedValue(createPaymentOrderRow({ amount: '10.99' }));

      const response = await POST(createOrderFlowRequest(createOrderFlowPayload({ amount: 1099 })));

      expect(response.status).toBe(200);
      expect(mockTxInsert).toHaveBeenCalledTimes(1);
      // The recorded amount is the request amount, not the order's.
      const inserted = mockTxValues.mock.calls[0][0] as { amount: string };
      expect(inserted.amount).toBe('10.99');
    });

    test('accepts a plain integer decimal-string amount (200)', async () => {
      mockProductsSelectWhere.mockResolvedValue([
        {
          id: '660e8400-e29b-41d4-a716-446655440001',
          price: '1.00',
          secondPrice: null,
        },
      ]);
      mockPaymentOrdersFindFirst.mockResolvedValue(createPaymentOrderRow({ amount: '1' }));

      const response = await POST(createOrderFlowRequest(createOrderFlowPayload({ amount: 100 })));

      expect(response.status).toBe(200);
    });

    test('denies with ORDER_AMOUNT_MISMATCH when the request amount is not the order amount', async () => {
      // The underpayment attack: a Culqi order created for S/ 1.00, then
      // charged with S/ 1000.00 of the same business. Without this binding the
      // transaction would record S/ 1000.00 and decrement that product's stock.
      mockPaymentOrdersFindFirst.mockResolvedValue(createPaymentOrderRow({ amount: '1.00' }));

      const response = await POST(
        createOrderFlowRequest(createOrderFlowPayload({ amount: 150000 })),
      );

      expect(response.status).toBe(402);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe(
        'El monto de la orden no coincide con el pago solicitado. Contactá al negocio para resolverlo.',
      );
      expect(body.code).toBe('ORDER_AMOUNT_MISMATCH');
      expect(body).not.toHaveProperty('details');

      // No upstream round-trip, no write, no key burned.
      expect(mockGetCulqiOrder).not.toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockReserveIdempotencyKey).not.toHaveBeenCalled();
    });

    test.each([
      ['null', null],
      ['a non-numeric string', 'not-a-number'],
      ['an empty string', ''],
      ['NaN-producing text', 'abc'],
    ])('fails closed when the stored order amount is %s', async (_label, storedAmount) => {
      // `amount` is `.notNull()` in the schema, but the comparison must not
      // depend on that: a NaN would otherwise silently pass `!==`.
      mockPaymentOrdersFindFirst.mockResolvedValue(
        createPaymentOrderRow({ amount: storedAmount as unknown as string }),
      );

      const response = await POST(createOrderFlowRequest(createOrderFlowPayload()));

      expect(response.status).toBe(402);
      const body = await response.json();
      expect(body.code).toBe('ORDER_AMOUNT_MISMATCH');
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockReserveIdempotencyKey).not.toHaveBeenCalled();
    });

    test('denies with ORDER_CURRENCY_MISMATCH when the request currency differs from the order', async () => {
      mockPaymentOrdersFindFirst.mockResolvedValue(createPaymentOrderRow({ currency: 'USD' }));

      const response = await POST(
        createOrderFlowRequest(createOrderFlowPayload({ currency: 'PEN' })),
      );

      expect(response.status).toBe(402);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe(
        'La moneda de la orden no coincide con el pago solicitado. Contactá al negocio para resolverlo.',
      );
      expect(body.code).toBe('ORDER_CURRENCY_MISMATCH');
      expect(body).not.toHaveProperty('details');
      expect(mockGetCulqiOrder).not.toHaveBeenCalled();
      expect(mockReserveIdempotencyKey).not.toHaveBeenCalled();
    });

    test('denies with ORDER_PRODUCT_MISMATCH when the request product is not the ordered one', async () => {
      mockPaymentOrdersFindFirst.mockResolvedValue(
        createPaymentOrderRow({ metadata: { productId: '660e8400-e29b-41d4-a716-446655440009' } }),
      );

      const response = await POST(createOrderFlowRequest(createOrderFlowPayload()));

      expect(response.status).toBe(402);
      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toBe(
        'La orden no corresponde a este producto. Contactá al negocio para resolverlo.',
      );
      expect(body.code).toBe('ORDER_PRODUCT_MISMATCH');
      expect(body).not.toHaveProperty('details');
      expect(mockGetCulqiOrder).not.toHaveBeenCalled();
      expect(mockReserveIdempotencyKey).not.toHaveBeenCalled();
    });

    test.each([
      ['an empty object', {}],
      ['a null value', null],
      ['an absent key', { culqiRaw: { orderId: 'ord_culqi_abc123' } }],
      ['a non-object value', 'productId'],
      ['an array', [{ productId: 'x' }]],
    ])('allows a product-less order whose metadata is %s (200)', async (_label, metadata) => {
      // create-order permits a product-less order (createOrderRequestSchema
      // productId is optional), so metadata.productId is legitimately absent
      // and there is nothing to bind against.
      mockPaymentOrdersFindFirst.mockResolvedValue(
        createPaymentOrderRow({ metadata: metadata as unknown }),
      );

      const response = await POST(createOrderFlowRequest(createOrderFlowPayload()));

      expect(response.status).toBe(200);
    });

    test('denies a non-string metadata.productId rather than binding to it', async () => {
      mockPaymentOrdersFindFirst.mockResolvedValue(
        createPaymentOrderRow({
          metadata: { productId: { toString: () => 'x' } },
        }),
      );

      const response = await POST(createOrderFlowRequest(createOrderFlowPayload()));

      // A non-string binding cannot be a real product id; fail closed.
      expect(response.status).toBe(402);
      const body = await response.json();
      expect(body.code).toBe('ORDER_PRODUCT_MISMATCH');
    });

    test('keeps a matching binding on the happy path (200)', async () => {
      mockPaymentOrdersFindFirst.mockResolvedValue(
        createPaymentOrderRow({ metadata: { productId: '660e8400-e29b-41d4-a716-446655440001' } }),
      );

      const response = await POST(createOrderFlowRequest(createOrderFlowPayload()));

      expect(response.status).toBe(200);
      const inserted = mockTxValues.mock.calls[0][0] as { productId: string; amount: string };
      expect(inserted.productId).toBe('660e8400-e29b-41d4-a716-446655440001');
      expect(inserted.amount).toBe('1500');
    });
  });
});
