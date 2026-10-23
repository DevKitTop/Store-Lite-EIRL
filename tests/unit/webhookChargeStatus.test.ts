// =====================================================
// Webhook charge.paid / charge.failed — resolve-then-adopt (design D13/D14)
// =====================================================
// The webhook used to UPSERT on `payments.culqi_charge_id`. The order flow
// stored the Culqi ORDER id (`ord_...`) in that column, so the upsert never
// matched the order-flow row and created a SECOND `payments` row for the SAME
// sale — two rows, two claim keys, two stock decrements.
//
// The contract these tests lock in (design D13/D14):
//   - the sale's row is resolved by `culqi_charge_id` FIRST and by
//     `culqi_order_id` SECOND — each column only ever holds an id of its own
//     kind, so there is no "either column matches" fallback;
//   - a resolved row is ADOPTED: the charge id the row lacks is backfilled,
//     the ARBITER never changes, and no second row is created;
//   - only when NO row resolves is a row INSERTED, arbitrated on the arbiter of
//     the sale's NATURE (order-backed => `culqi_order_id`, token-backed =>
//     `culqi_charge_id`);
//   - the ORDER link is resolved BEFORE any row is touched; a charge that
//     cannot be attributed fails CLOSED (no row, 200, loud warning).
// =====================================================

import { POST } from '@/app/api/webhooks/culqi/route';
import type * as StockFulfillmentModule from '@/core/payments/stockFulfillment';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockUpdate,
  mockSet,
  mockWhere,
  mockReturning,
  mockPaymentsFindFirst,
  mockBusinessesFindFirst,
  mockInsert,
  mockValues,
  mockOnConflictDoUpdate,
  mockPaymentOrdersFindFirst,
  mockTransaction,
  mockFulfillPaidSale,
  mockGetCulqiCharge,
  mockResolveCulqiSecretKey,
} = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
  mockWhere: vi.fn(),
  mockReturning: vi.fn(),
  mockPaymentsFindFirst: vi.fn(),
  mockBusinessesFindFirst: vi.fn(),
  mockInsert: vi.fn(),
  mockValues: vi.fn(),
  mockOnConflictDoUpdate: vi.fn(),
  mockPaymentOrdersFindFirst: vi.fn(),
  mockTransaction: vi.fn(),
  mockFulfillPaidSale: vi.fn(),
  mockGetCulqiCharge: vi.fn(),
  mockResolveCulqiSecretKey: vi.fn(),
}));

vi.mock('@/core/database/client', () => ({
  db: {
    update: mockUpdate,
    insert: mockInsert,
    transaction: mockTransaction,
    query: {
      payments: { findFirst: mockPaymentsFindFirst },
      businesses: { findFirst: mockBusinessesFindFirst },
      paymentOrders: { findFirst: mockPaymentOrdersFindFirst },
    },
  },
}));

vi.mock('@/core/payments/stockFulfillment', async (importOriginal) => {
  const actual = await importOriginal<typeof StockFulfillmentModule>();
  return { ...actual, fulfillPaidSale: mockFulfillPaidSale, emitFulfillmentAlerts: vi.fn() };
});

vi.mock('@/core/utils/trackingToken', () => ({
  generateTrackingToken: () => 'tt_webhook_fixed',
}));

vi.mock('@/core/payments/orderNumber', () => ({
  resolveOrderNumber: () => 'ORD-WEBHOOK01',
}));

vi.mock('@/core/payments/culqiCharges', () => ({
  getCulqiCharge: mockGetCulqiCharge,
  isCulqiChargePaid: vi.fn(() => false),
}));

vi.mock('@/core/payments/culqiSecretKey', () => ({
  resolveCulqiSecretKey: mockResolveCulqiSecretKey,
}));

// ── Fixtures ──────────────────────────────────────────

const BIZ = '550e8400-e29b-41d4-a716-446655440000';
const PROD = '660e8400-e29b-41d4-a716-446655440001';
const OWNER = '770e8400-e29b-41d4-a716-446655440002';
const PAY_UUID = '880e8400-e29b-41d4-a716-446655440003';
const PO_UUID = '990e8400-e29b-41d4-a716-446655440004';
const CHARGE_ID = 'chr_abc123';
const ORDER_ID = 'ord_culqi_abc123';
const CART = [{ id: PROD, quantity: 2 }];

// ── Helpers ──────────────────────────────────────────

let eventCounter = 0;

function createChargeEvent(
  type: 'charge.paid' | 'charge.failed',
  data: Record<string, unknown> = {},
) {
  eventCounter += 1;
  return {
    id: `charge-event-${eventCounter}`,
    type,
    data: {
      id: CHARGE_ID,
      amount: 150000,
      currency_code: 'PEN',
      email: 'buyer@test.com',
      reference_code: 'ref_xyz',
      metadata: {
        businessId: BIZ,
        productId: PROD,
        platform: 'store-lite',
      },
      ...data,
    },
  };
}

function createWebhookRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/webhooks/culqi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Culqi: 'ignored' },
    body: JSON.stringify(body),
  });
}

function compile(node: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(node as never);
}

/**
 * The `payments` lookup is KIND-CORRECT: the writer and the identity resolver
 * ask for a CHARGE id or for an ORDER id, and the two must resolve different
 * rows. The mock answers by the kind of the compiled WHERE clause.
 */
function stubPaymentsLookup(rows: { charge?: unknown; order?: unknown }) {
  mockPaymentsFindFirst.mockImplementation(async (args: { where: unknown }) => {
    const { sql } = compile(args.where);
    if (sql.includes('culqi_order_id')) return rows.order ?? undefined;
    if (sql.includes('culqi_charge_id')) return rows.charge ?? undefined;
    return undefined;
  });
}

/** The order-flow row: it carries the ORDER id and NO charge id. */
function orderFlowPaymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PAY_UUID,
    businessId: BIZ,
    productId: PROD,
    culqiChargeId: null,
    culqiOrderId: ORDER_ID,
    metadata: { cartItems: CART },
    status: 'pending',
    updatedAt: new Date(),
    ...overrides,
  };
}

/** The order row the sale hangs from. */
function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PO_UUID,
    businessId: BIZ,
    metadata: { cartItems: CART },
    culqiOrderId: ORDER_ID,
    ...overrides,
  };
}

// ── Suite ────────────────────────────────────────────

describe('POST /api/webhooks/culqi — charge.paid / charge.failed (design D13/D14)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhere });
    // New code uses `.returning()` for the affected-row assertion (R5/D9).
    mockWhere.mockReturnValue({ returning: mockReturning });
    mockReturning.mockResolvedValue([{ id: PAY_UUID }]);

    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
    // `.onConflictDoUpdate().returning()` returns the row id.
    mockOnConflictDoUpdate.mockReturnValue({ returning: mockReturning });

    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ query: { payments: { findFirst: mockPaymentsFindFirst } } }),
    );

    // Default: no existing row, owner resolvable, no linked order.
    stubPaymentsLookup({});
    mockBusinessesFindFirst.mockResolvedValue({ ownerId: OWNER });
    mockPaymentOrdersFindFirst.mockResolvedValue(undefined);

    // The charge read is best effort: no secret key means no order link.
    mockResolveCulqiSecretKey.mockResolvedValue({ secretKey: '', error: null });
    mockGetCulqiCharge.mockResolvedValue({});

    mockFulfillPaidSale.mockResolvedValue({
      outcome: 'fulfilled',
      claimed: [{ sourceType: 'payment_orders', id: PO_UUID }],
      items: [],
      oversold: [],
      b1: false,
    });

    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CULQI_WEBHOOK_SECRET', '');
  });

  // ============================================================
  // Adopt the row that resolves
  // ============================================================

  test('updates an existing payment row and does not insert', async () => {
    stubPaymentsLookup({
      charge: {
        id: PAY_UUID,
        businessId: BIZ,
        productId: PROD,
        culqiChargeId: CHARGE_ID,
        culqiOrderId: null,
        metadata: {},
        status: 'pending',
        updatedAt: new Date(),
      },
    });

    const response = await POST(createWebhookRequest(createChargeEvent('charge.paid')));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid' }));
    expect(mockInsert).not.toHaveBeenCalled();
    // The owner lookup is only needed when inserting.
    expect(mockBusinessesFindFirst).not.toHaveBeenCalled();
  });

  // ============================================================
  // THE REGRESSION: an order-backed sale must never get a second row
  // ============================================================

  test('adopts the order-flow row instead of creating a second row for the same sale', async () => {
    stubPaymentsLookup({ order: orderFlowPaymentRow() });
    mockPaymentOrdersFindFirst.mockResolvedValue(orderRow());

    const response = await POST(
      createWebhookRequest(createChargeEvent('charge.paid', { order_id: ORDER_ID })),
    );

    expect(response.status).toBe(200);

    // ONE row for the sale: no insert at all.
    expect(mockInsert).not.toHaveBeenCalled();

    // The adopted row is backfilled with the charge id it lacked (A3) and the
    // status is applied.
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'paid', culqiChargeId: CHARGE_ID }),
    );

    // The fulfilment uses the CANONICAL identity (D11): the order row AND the
    // sale's payments row, so the claim set collides with the charge route's.
    expect(mockFulfillPaidSale).toHaveBeenCalledTimes(1);
    const [identity] = mockFulfillPaidSale.mock.calls[0];
    expect(identity.paymentOrderId).toBe(PO_UUID);
    expect(identity.paymentId).toBe(PAY_UUID);
    expect(identity.businessId).toBe(BIZ);
    expect(identity.culqiOrderId).toBe(ORDER_ID);
    expect(identity.culqiChargeId).toBe(CHARGE_ID);
  });

  test('never overwrites a non-null id with null when adopting a row', async () => {
    stubPaymentsLookup({
      order: orderFlowPaymentRow({ culqiChargeId: 'chr_previous' }),
    });
    mockPaymentOrdersFindFirst.mockResolvedValue(orderRow());

    await POST(createWebhookRequest(createChargeEvent('charge.paid', { order_id: ORDER_ID })));

    expect(mockSet).toHaveBeenCalledWith(expect.not.objectContaining({ culqiChargeId: CHARGE_ID }));
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid' }));
  });

  // ============================================================
  // Fail closed when the charge cannot be attributed (D14/A2)
  // ============================================================

  test('creates no row and warns when the charge cannot be attributed to a sale', async () => {
    stubPaymentsLookup({});
    mockPaymentOrdersFindFirst.mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await POST(
      createWebhookRequest(
        createChargeEvent('charge.paid', {
          metadata: {},
          order_id: undefined,
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    // NO row created and NO row written — the sale is healed by the order flip
    // and the reconcile backstop, both of which resolve by ORDER id.
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockFulfillPaidSale).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('is not attributable to a sale'));

    warnSpy.mockRestore();
  });

  test('reads the charge for its order link when the payload omits order_id', async () => {
    stubPaymentsLookup({});
    mockResolveCulqiSecretKey.mockResolvedValue({ secretKey: 'sk_test', error: null });
    mockGetCulqiCharge.mockResolvedValue({ id: CHARGE_ID, order_id: ORDER_ID });
    mockPaymentOrdersFindFirst.mockResolvedValue(orderRow());

    await POST(createWebhookRequest(createChargeEvent('charge.paid')));

    // The charge object is the authoritative source of the order link (A2).
    expect(mockGetCulqiCharge).toHaveBeenCalledWith(CHARGE_ID, 'sk_test');
    // The order link resolved ⇒ the sale is order-backed ⇒ the arbiter is
    // `culqi_order_id`.
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ culqiOrderId: ORDER_ID, culqiChargeId: CHARGE_ID }),
    );
    const conflict = mockOnConflictDoUpdate.mock.calls[0][0];
    expect((conflict.target as { name: string }).name).toBe('culqi_order_id');
  });

  // ============================================================
  // Insert: the arbiter of the sale's NATURE (D13/I3)
  // ============================================================

  test('inserts a complete row arbitrated on the charge id for a token-backed sale', async () => {
    stubPaymentsLookup({});
    mockPaymentOrdersFindFirst.mockResolvedValue(undefined);

    const response = await POST(createWebhookRequest(createChargeEvent('charge.paid')));

    expect(response.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BIZ,
        productId: PROD,
        sellerUserId: OWNER,
        amount: '1500',
        currency: 'PEN',
        culqiChargeId: CHARGE_ID,
        // A token-backed sale carries NO order id: the column holds an order
        // id of its own kind only.
        culqiOrderId: null,
        buyerEmail: 'buyer@test.com',
        orderNumber: 'ORD-WEBHOOK01',
        trackingToken: 'tt_webhook_fixed',
        status: 'paid',
      }),
    );
    const conflict = mockOnConflictDoUpdate.mock.calls[0][0];
    expect((conflict.target as { name: string }).name).toBe('culqi_charge_id');
  });

  test('inserts a complete row arbitrated on the order id for an order-backed sale', async () => {
    stubPaymentsLookup({});
    mockPaymentOrdersFindFirst.mockResolvedValue(orderRow());

    await POST(createWebhookRequest(createChargeEvent('charge.paid', { order_id: ORDER_ID })));

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ culqiOrderId: ORDER_ID, culqiChargeId: CHARGE_ID }),
    );
    const conflict = mockOnConflictDoUpdate.mock.calls[0][0];
    expect((conflict.target as { name: string }).name).toBe('culqi_order_id');
  });

  test('inserts with status failed on charge.failed', async () => {
    stubPaymentsLookup({});
    mockPaymentOrdersFindFirst.mockResolvedValue(undefined);

    await POST(createWebhookRequest(createChargeEvent('charge.failed')));

    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    // A failed charge moves no stock.
    expect(mockFulfillPaidSale).not.toHaveBeenCalled();
  });

  test('creates no row and warns when the payload cannot yield a complete row', async () => {
    stubPaymentsLookup({});
    mockPaymentOrdersFindFirst.mockResolvedValue(undefined);
    mockBusinessesFindFirst.mockResolvedValue(null);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await POST(createWebhookRequest(createChargeEvent('charge.paid')));

    expect(response.status).toBe(200);
    expect(mockInsert).not.toHaveBeenCalled();
    // No row could be built ⇒ no row is written at all (the old update-only
    // fallback wrote a status onto a row that does not exist).
    expect(mockSet).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot create a payment row'));

    warnSpy.mockRestore();
  });

  // ============================================================
  // The `charge.paid` TRIGGER: the fulfilment really runs
  // ============================================================

  test('fulfils a paid sale from the canonical identity of the token flow', async () => {
    // The token flow has no order row: the webhook INSERTS the sale's
    // `payments` row and the post-commit resolver re-reads it. The mock has to
    // model that transition — the first lookup sees nothing (so the row is
    // inserted), every later lookup sees the row that was written.
    const insertedRow = {
      id: PAY_UUID,
      businessId: BIZ,
      productId: PROD,
      culqiChargeId: CHARGE_ID,
      culqiOrderId: null,
      metadata: { businessId: BIZ, productId: PROD, platform: 'store-lite' },
      status: 'paid',
      updatedAt: new Date(),
    };
    let paymentsLookups = 0;
    mockPaymentsFindFirst.mockImplementation(async (args: { where: unknown }) => {
      paymentsLookups += 1;
      if (paymentsLookups === 1) return undefined;
      const { sql } = compile(args.where);
      // The resolver reads by the id kind of the sale's nature: charge-only.
      return sql.includes('culqi_charge_id') ? insertedRow : undefined;
    });
    mockPaymentOrdersFindFirst.mockResolvedValue(undefined);

    await POST(createWebhookRequest(createChargeEvent('charge.paid')));

    expect(mockFulfillPaidSale).toHaveBeenCalledTimes(1);
    const [identity, snapshot] = mockFulfillPaidSale.mock.calls[0];
    expect(identity.paymentOrderId).toBeNull();
    expect(identity.paymentId).toBe(PAY_UUID);
    expect(identity.businessId).toBe(BIZ);
    expect(identity.culqiChargeId).toBe(CHARGE_ID);
    // The scalar `qty` fallback is NOT in the payload, so the snapshot carries
    // the bound product only.
    expect(snapshot).toEqual({ qty: null, productId: PROD });
  });

  test("a duplicate delivery is ack'd without a second write", async () => {
    const event = createChargeEvent('charge.paid');
    stubPaymentsLookup({
      charge: {
        id: PAY_UUID,
        businessId: BIZ,
        productId: PROD,
        culqiChargeId: CHARGE_ID,
        culqiOrderId: null,
        metadata: {},
        status: 'pending',
        updatedAt: new Date(),
      },
    });

    const first = await POST(createWebhookRequest(event));
    expect((await first.json()).received).toBe(true);

    const second = await POST(createWebhookRequest(event));
    const secondBody = await second.json();
    expect(secondBody).toEqual({ received: true, duplicate: true });
    // Only the first delivery ran the update.
    expect(mockSet).toHaveBeenCalledTimes(1);
  });
});
