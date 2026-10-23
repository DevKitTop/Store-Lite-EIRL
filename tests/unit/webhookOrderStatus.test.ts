// =====================================================
// Webhook order.status.changed — Unit tests (slice 3 / PR3, NEW-8)
// =====================================================
// The flip was rewritten (design D8):
//   - pre-read the `payment_orders` row so `businessId` is DB-derived (R5);
//   - flip inside a transaction, business-scoped, asserted with `.returning()`
//   (never `rowCount` — postgres-js has no such field);
//   - a 0-row flip throws `FlipMissedError` -> warn + 200 (never fail open);
//   - the payment state comes from Culqi's ORDER contract (`state` + `paid_at`),
//     with the legacy `status` key accepted only as an alias;
//   - the sale is fulfilled from the PERSISTED `metadata.cartItems` (W-B).
//
// The claim set comes from the CANONICAL sale identity (design D11): the order
// row plus the sale's `payments` row, linked by the SAME-KIND
// `payments.culqi_order_id = payment_orders.culqi_order_id` equality. The
// cross-kind link (`payments.culqi_charge_id = <order id>`) could never see the
// order-flow row, which is why the flip used to fulfil under a payments-only
// key set.
// =====================================================

import { POST } from '@/app/api/webhooks/culqi/route';
import type * as StockFulfillmentModule from '@/core/payments/stockFulfillment';
import { FULFILLMENT_WATERMARK, resolveClaimKeys } from '@/core/payments/stockFulfillment';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────

const {
  mockUpdate,
  mockSet,
  mockWhere,
  mockReturning,
  mockTransaction,
  mockPaymentOrdersFindFirst,
  mockTxPaymentOrdersFindFirst,
  mockPaymentsFindFirst,
  mockFulfillPaidSale,
} = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
  mockWhere: vi.fn(),
  mockReturning: vi.fn(),
  mockTransaction: vi.fn(),
  mockPaymentOrdersFindFirst: vi.fn(),
  mockTxPaymentOrdersFindFirst: vi.fn(),
  mockPaymentsFindFirst: vi.fn(),
  mockFulfillPaidSale: vi.fn(),
}));

vi.mock('@/core/database/client', () => ({
  db: {
    update: mockUpdate,
    transaction: mockTransaction,
    query: {
      paymentOrders: { findFirst: mockPaymentOrdersFindFirst },
      payments: { findFirst: mockPaymentsFindFirst },
    },
  },
}));

// Keep the real watermark + R7 predicate; stub ONLY the write helper.
vi.mock('@/core/payments/stockFulfillment', async (importOriginal) => {
  const actual = await importOriginal<typeof StockFulfillmentModule>();
  return { ...actual, fulfillPaidSale: mockFulfillPaidSale };
});

// ── Fixtures ──────────────────────────────────────────────────────────

const BIZ = '550e8400-e29b-41d4-a716-446655440000';
const PROD_A = '660e8400-e29b-41d4-a716-446655440001';
const PO_UUID = '880e8400-e29b-41d4-a716-446655440003';
const PAY_UUID = '770e8400-e29b-41d4-a716-446655440002';
const ORD_TEXT_ID = 'ord_culqi_abc123';

const CART = [{ id: PROD_A, quantity: 2 }];

/** A pre-read row that is pending and updated AFTER the watermark. */
function pendingPreRead(overrides: Record<string, unknown> = {}) {
  return {
    id: PO_UUID,
    businessId: BIZ,
    metadata: { cartItems: CART },
    status: 'pending',
    updatedAt: new Date(FULFILLMENT_WATERMARK.getTime() + 60_000),
    ...overrides,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────

let eventCounter = 0;

function createOrderStatusEvent(overrides: Record<string, unknown> = {}) {
  eventCounter += 1;
  const { data: dataOverrides, ...topLevelOverrides } = overrides;
  return {
    id: `test-event-${eventCounter}`,
    type: 'order.status.changed',
    data: {
      id: ORD_TEXT_ID,
      state: 'paid',
      ...((dataOverrides as Record<string, unknown>) || {}),
    },
    ...topLevelOverrides,
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

// ── Suite ─────────────────────────────────────────────────────────────

describe('POST /api/webhooks/culqi — order.status.changed', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // db.update().set().where().returning()
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ returning: mockReturning });
    mockReturning.mockResolvedValue([
      { id: PO_UUID, businessId: BIZ, metadata: { cartItems: CART } },
    ]);

    // db.transaction(cb) -> cb(tx)
    mockTransaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        update: mockUpdate,
        query: {
          paymentOrders: { findFirst: mockTxPaymentOrdersFindFirst },
          payments: { findFirst: mockPaymentsFindFirst },
        },
      }),
    );

    mockPaymentOrdersFindFirst.mockResolvedValue(pendingPreRead());
    // The identity resolver reads the ORDER row inside the transaction.
    mockTxPaymentOrdersFindFirst.mockResolvedValue({
      id: PO_UUID,
      businessId: BIZ,
      metadata: { cartItems: CART },
      culqiOrderId: ORD_TEXT_ID,
    });
    // The SAME-KIND sibling: the order-flow `payments` row carries the ORDER id.
    mockPaymentsFindFirst.mockResolvedValue({
      id: PAY_UUID,
      businessId: BIZ,
      metadata: { cartItems: CART },
      productId: PROD_A,
      culqiChargeId: 'chr_culqi_abc123',
      culqiOrderId: ORD_TEXT_ID,
    });
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
  // The headline case: a paid order flips AND fulfils (N1/W-B)
  // ============================================================

  test('flips a paid order and fulfils the sale from the persisted cart snapshot', async () => {
    const response = await POST(createWebhookRequest(createOrderStatusEvent()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    // The flip happens inside a transaction (D8).
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid' }));

    // The fulfilment carries the PERSISTED snapshot (W-B) — never the request cart.
    expect(mockFulfillPaidSale).toHaveBeenCalledTimes(1);
    const [anchor, snapshot] = mockFulfillPaidSale.mock.calls[0];
    expect(snapshot).toEqual({ cartItems: CART });

    // N1: the `payment_orders` key comes first and is the DB uuid, never the text id.
    expect(anchor.paymentOrderId).toBe(PO_UUID);
    expect(anchor.paymentId).toBe(PAY_UUID);
    expect(anchor.businessId).toBe(BIZ);
    expect(anchor.culqiOrderId).toBe(ORD_TEXT_ID);
    expect(anchor.paymentOrderId).not.toContain('ord_');
  });

  test('claims the payment_orders slot first and the payments slot second', async () => {
    await POST(createWebhookRequest(createOrderStatusEvent()));

    const [identity] = mockFulfillPaidSale.mock.calls[0];
    expect(identity.paymentOrderId).toBeTruthy();
    expect(identity.paymentId).toBeTruthy();
    // The helper derives the ordered key set from these two slots; the PO slot
    // must come FIRST (D4) so every order-backed path collides on it.
    const keys = resolveClaimKeys(identity);
    expect(keys[0]).toEqual({ sourceType: 'payment_orders', id: PO_UUID });
    expect(keys[1]).toEqual({ sourceType: 'payments', id: PAY_UUID });
  });

  test('fulfils under the order key alone when no payments row resolves', async () => {
    mockPaymentsFindFirst.mockResolvedValue(undefined);

    await POST(createWebhookRequest(createOrderStatusEvent()));

    const [anchor, snapshot] = mockFulfillPaidSale.mock.calls[0];
    expect(anchor.paymentOrderId).toBe(PO_UUID);
    expect(anchor.paymentId).toBeNull();
    expect(snapshot).toEqual({ cartItems: CART });
  });

  // ============================================================
  // Business scoping (R5) + `.returning()` assertion (D8)
  // ============================================================

  test('scopes the flip to the pre-read businessId', async () => {
    await POST(createWebhookRequest(createOrderStatusEvent()));

    const where = mockWhere.mock.calls[0][0];
    const { sql } = compile(where);
    expect(sql).toContain('business_id');
    expect(sql).toContain('culqi_order_id');
  });

  test('asserts the flip with .returning(), never with rowCount', async () => {
    await POST(createWebhookRequest(createOrderStatusEvent()));

    expect(mockReturning).toHaveBeenCalledTimes(1);
    // postgres-js has no `rowCount`; the affected-row signal is the returned rows.
    expect(mockReturning.mock.results[0].value).toBeDefined();
  });

  // ============================================================
  // Unknown order id -> exact warn + 200, no transaction (contract unchanged)
  // ============================================================

  test('warns "Order not found in DB" and opens no transaction when the order is unknown', async () => {
    mockPaymentOrdersFindFirst.mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await POST(
      createWebhookRequest(
        createOrderStatusEvent({ data: { id: 'ord_unknown_999', state: 'paid' } }),
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Order not found in DB: ord_unknown_999'),
    );
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockFulfillPaidSale).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  // ============================================================
  // A missed flip is never fail-open (FlipMissedError)
  // ============================================================

  test('warns and acks without fulfilling when the scoped flip matches no row', async () => {
    mockReturning.mockResolvedValue([]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await POST(createWebhookRequest(createOrderStatusEvent()));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('flip'));
    expect(mockFulfillPaidSale).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  // ============================================================
  // Lifecycle states
  // ============================================================

  test('flips an expired order without any stock effect', async () => {
    const response = await POST(
      createWebhookRequest(createOrderStatusEvent({ data: { state: 'expired' } })),
    );

    expect(response.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }));
    expect(mockFulfillPaidSale).not.toHaveBeenCalled();
  });

  test('flips a cancelled order without any stock effect', async () => {
    const response = await POST(
      createWebhookRequest(createOrderStatusEvent({ data: { state: 'cancelled' } })),
    );

    expect(response.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    expect(mockFulfillPaidSale).not.toHaveBeenCalled();
  });

  // ============================================================
  // R7 — no retro-fulfilment
  // ============================================================

  test('flips a pre-watermark paid row but never fulfils it', async () => {
    mockPaymentOrdersFindFirst.mockResolvedValue(
      pendingPreRead({
        status: 'paid',
        updatedAt: new Date(FULFILLMENT_WATERMARK.getTime() - 60_000),
      }),
    );

    const response = await POST(createWebhookRequest(createOrderStatusEvent()));

    expect(response.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid' }));
    expect(mockFulfillPaidSale).not.toHaveBeenCalled();
  });

  test('fulfils a pending row even when it was created before the watermark', async () => {
    mockPaymentOrdersFindFirst.mockResolvedValue(
      pendingPreRead({
        status: 'pending',
        updatedAt: new Date(FULFILLMENT_WATERMARK.getTime() - 60_000),
      }),
    );

    await POST(createWebhookRequest(createOrderStatusEvent()));

    expect(mockFulfillPaidSale).toHaveBeenCalledTimes(1);
  });

  // ============================================================
  // The order state contract: `state` + `paid_at` (canonical)
  // ============================================================

  test('treats a non-null paid_at as proof of payment', async () => {
    const response = await POST(
      createWebhookRequest(
        createOrderStatusEvent({ data: { state: 'created', paid_at: 1_780_000_000 } }),
      ),
    );

    expect(response.status).toBe(200);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid' }));
    expect(mockFulfillPaidSale).toHaveBeenCalledTimes(1);
  });

  test('warns and continues when the payload carries neither id nor state', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await POST(
      createWebhookRequest({
        id: 'test-event-missing-status',
        type: 'order.status.changed',
        data: { id: 'ord_culqi_xyz' }, // no state at all
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Missing order'));
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test('warns and continues when the state string is unknown', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await POST(
      createWebhookRequest(createOrderStatusEvent({ data: { state: 'unknown_status_value' } })),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown order status'));
    expect(mockSet).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test('denies a legacy status-only payload: the canonical order proof is missing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await POST(
      createWebhookRequest(createOrderStatusEvent({ data: { state: undefined, status: 'paid' } })),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });

    // `status` is fiction on a Culqi ORDER (see `culqiOrders.ts`): the charge
    // route's money gate denies the same payload, so the webhook must too.
    expect(mockSet).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockFulfillPaidSale).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  // ============================================================
  // GREEN: refund.creation.succeeded -> payments AND plan_payments refunded
  // ============================================================

  test('marks payments and plan_payments as refunded on refund.creation.succeeded', async () => {
    const response = await POST(
      createWebhookRequest({
        id: 'test-event-refund-success',
        type: 'refund.creation.succeeded',
        data: {
          id: 'ref_culqi_abc123',
          charge_id: 'chr_charge_xyz',
          amount: 5900,
          reason: 'solicitud_comprador',
        },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ received: true });

    // applyRefundStatus updates BOTH tables with status 'refunded'
    expect(mockSet).toHaveBeenCalledTimes(2);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'refunded' }));
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'refunded' }));
    // Two WHERE lookups happen (payments + plan_payments); the exact SQL object
    // from drizzle eq() is opaque, but both must exist.
    expect(mockWhere).toHaveBeenCalledTimes(2);
  });

  // ============================================================
  // GREEN: legacy alias refund.created -> still refunds both tables
  // ============================================================

  test('handles legacy refund.created alias with charge_id lookup', async () => {
    const response = await POST(
      createWebhookRequest({
        id: 'test-event-refund-legacy',
        type: 'refund.created',
        data: {
          id: 'ref_culqi_legacy',
          charge_id: 'chr_charge_legacy',
        },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ received: true });

    expect(mockSet).toHaveBeenCalledTimes(2);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'refunded' }));
    expect(mockWhere).toHaveBeenCalledTimes(2);
  });

  // ============================================================
  // GREEN: refund.creation.failed -> both tables status failed
  // ============================================================

  test('marks both tables as failed on refund.creation.failed', async () => {
    const response = await POST(
      createWebhookRequest({
        id: 'test-event-refund-failed',
        type: 'refund.creation.failed',
        data: {
          id: 'ref_culqi_failed',
          charge_id: 'chr_charge_failed',
        },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ received: true });

    expect(mockSet).toHaveBeenCalledTimes(2);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(mockWhere).toHaveBeenCalledTimes(2);
  });
});
