// =====================================================
// tests/unit/reconcilePaymentsFulfillment.test.ts
// =====================================================
// The reconcile backstop's fulfillment pass (NEW-8, design D10 / spec R4).
//
// The backstop is the LAST trigger of the sale-fulfillment chain: whatever the
// charge route, the webhook and the flip missed, the cron re-reads the PAID
// sales and fulfils them through the SAME `fulfillPaidSale` helper, so the
// exactly-once contract (one `stock_movements` claim per sale) still holds.
//
// What this suite pins:
//   - the candidate predicate is expressed over the SALE's claim KEY SET, not
//     over a single row, and the sibling row is joined through the SAME-KIND
//     link (`payments.culqi_order_id = payment_orders.culqi_order_id`) — NOT
//     through the old cross-kind link that could never see the order-flow row;
//   - a charge-id `payments` row beside the order-id `payment_orders` row of
//     the SAME sale is collected ONCE and fulfilled ONCE, no matter how many
//     times the trigger runs (the double-decrement regression);
//   - the candidate window is bounded by the fulfillment watermark (R7);
//   - the snapshot is recovered from the PERSISTED cart array, never from the
//     scalar `qty` (W-A);
//   - the counters report what the pass actually did.
//
// The regression at the bottom runs the REAL `fulfillPaidSale` against an
// in-memory `stock_movements` ledger. A mocked helper would let the route claim
// the sale twice without ever noticing — that is exactly how the old suite
// missed the double-decrement defect.
// =====================================================

import { POST } from '@/app/api/cron/reconcile-payments/route';
import { claimedSaleFilter, resolveSaleSnapshot } from '@/core/payments/reconcileFulfillment';
import type * as StockFulfillmentModule from '@/core/payments/stockFulfillment';
import { FULFILLMENT_WATERMARK, resolveClaimKeys } from '@/core/payments/stockFulfillment';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────

const {
  mockDb,
  mockPaymentsFindMany,
  mockPaymentsFindFirst,
  mockPaymentOrdersFindMany,
  mockPaymentOrdersFindFirst,
  mockFulfillPaidSale,
  mockEmitFulfillmentAlerts,
  holder,
} = vi.hoisted(() => {
  const db = {
    query: {
      payments: { findMany: vi.fn(), findFirst: vi.fn() },
      paymentOrders: { findMany: vi.fn(), findFirst: vi.fn() },
    },
    update: vi.fn(),
    transaction: vi.fn(),
  };

  return {
    mockDb: db,
    mockPaymentsFindMany: db.query.payments.findMany,
    mockPaymentsFindFirst: db.query.payments.findFirst,
    mockPaymentOrdersFindMany: db.query.paymentOrders.findMany,
    mockPaymentOrdersFindFirst: db.query.paymentOrders.findFirst,
    mockFulfillPaidSale: vi.fn(),
    mockEmitFulfillmentAlerts: vi.fn(),
    // The REAL helper, captured before `vi.mock` replaces the export. The
    // double-decrement regression needs it; every other test stays mocked.
    holder: {} as { actualFulfillPaidSale?: StockFulfillmentModule['fulfillPaidSale'] },
  };
});

vi.mock('@/core/database/client', () => ({ db: mockDb }));

// Keep the REAL watermark + snapshot readers; stub the write helper and the
// alerter so the ordinary tests assert the trigger's decisions, not the ledger.
// The real helper is captured for the regression test.
vi.mock('@/core/payments/stockFulfillment', async (importOriginal) => {
  const actual = await importOriginal<typeof StockFulfillmentModule>();
  holder.actualFulfillPaidSale = actual.fulfillPaidSale;
  return {
    ...actual,
    fulfillPaidSale: mockFulfillPaidSale,
    emitFulfillmentAlerts: mockEmitFulfillmentAlerts,
  };
});

vi.mock('@/core/payments/culqiSecretKey', () => ({ resolveCulqiSecretKey: vi.fn() }));
vi.mock('@/core/payments/culqiCharges', () => ({
  getCulqiCharge: vi.fn(),
  isCulqiChargePaid: vi.fn(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────

const BIZ = '550e8400-e29b-41d4-a716-446655440000';
const PROD_A = '660e8400-e29b-41d4-a716-446655440001';
const PROD_B = '660e8400-e29b-41d4-a716-446655440002';
const PAY_UUID = '770e8400-e29b-41d4-a716-446655440003';
const PO_UUID = '880e8400-e29b-41d4-a716-446655440004';
const PO_UUID_2 = '880e8400-e29b-41d4-a716-446655440005';
const ORD_TEXT_ID = 'ord_culqi_abc123';
const ORD_TEXT_ID_2 = 'ord_culqi_def789';
const CHR_TEXT_ID = 'chr_culqi_ghi012';

const CART = [
  { id: PROD_A, quantity: 2 },
  { id: PROD_B, quantity: 1 },
];

const AFTER_WATERMARK = new Date(FULFILLMENT_WATERMARK.getTime() + 60_000);

/**
 * The sale's `payments` row. It carries the CHARGE id in `culqi_charge_id`
 * and the ORDER id in `culqi_order_id` — one column per id kind (D13).
 */
function paidPaymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PAY_UUID,
    businessId: BIZ,
    productId: PROD_A,
    culqiChargeId: CHR_TEXT_ID,
    culqiOrderId: ORD_TEXT_ID,
    metadata: { qty: 9 },
    updatedAt: AFTER_WATERMARK,
    ...overrides,
  };
}

/** A paid `payment_orders` row (the order flow's row, carrying the cart). */
function paidOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PO_UUID,
    businessId: BIZ,
    culqiOrderId: ORD_TEXT_ID,
    metadata: { cartItems: CART },
    updatedAt: AFTER_WATERMARK,
    ...overrides,
  };
}

// ── Mutable suite state ───────────────────────────────────────────────

interface Compiled {
  sql: string;
  params: unknown[];
}

let paymentCandidateRows: unknown[] = [];
let orderCandidateRows: unknown[] = [];
let linkedPaymentRow: unknown = null;
let linkedOrderRow: unknown = null;
let paymentQueries: Compiled[] = [];
let orderQueries: Compiled[] = [];

function compile(node: unknown): Compiled {
  return new PgDialect().sqlToQuery(node as never) as Compiled;
}

async function runCron(headers: Record<string, string> = { 'x-cron-secret': 'test-secret' }) {
  const res = await POST(
    new Request('http://localhost/api/cron/reconcile-payments', { method: 'POST', headers }),
  );
  return { res, body: (await res.json()) as Record<string, number> };
}

// ── Suite ─────────────────────────────────────────────────────────────

describe('reconcileFulfillment — the candidate predicate (R4)', () => {
  test("the payments candidate is filtered by the SALE's key set, not by one row", () => {
    const { sql } = compile(claimedSaleFilter('payments'));

    // The sale's OWN payments key.
    expect(sql).toContain('"stock_movements"."source_id" = "payments"."id"');
    // AND the sibling payment_orders key, resolved through the SAME-KIND link.
    expect(sql).toContain('"payment_orders"."culqi_order_id" = "payments"."culqi_order_id"');
    expect(sql).toContain('"payment_orders"."business_id" = "payments"."business_id"');
    // The old cross-kind link (charge id vs order id) can never match and is
    // what let one sale be treated as two. It must never come back.
    expect(sql).not.toContain('"payment_orders"."culqi_order_id" = "payments"."culqi_charge_id"');
    expect(sql).toContain('not exists');
    expect(sql).toContain('"stock_movements"');
  });

  test('the payment_orders candidate is filtered by the linked payments key', () => {
    const { sql } = compile(claimedSaleFilter('payment_orders'));

    expect(sql).toContain('"stock_movements"."source_id" = "payment_orders"."id"');
    expect(sql).toContain('"payments"."culqi_order_id" = "payment_orders"."culqi_order_id"');
    expect(sql).toContain('"payments"."business_id" = "payment_orders"."business_id"');
    expect(sql).not.toContain('"payments"."culqi_charge_id" = "payment_orders"."culqi_order_id"');
    expect(sql).toContain('not exists');
  });
});

describe('reconcileFulfillment — snapshot recovery (W-A)', () => {
  test('the persisted cart array wins over the scalar qty', () => {
    expect(
      resolveSaleSnapshot({
        orderMetadata: { cartItems: CART, qty: 9 },
        paymentMetadata: { qty: 9 },
        productId: PROD_A,
      }),
    ).toEqual({ cartItems: CART });
  });

  test('the payment metadata cart array is used when the order row carries none', () => {
    expect(
      resolveSaleSnapshot({
        orderMetadata: { qty: 9 },
        paymentMetadata: { cartItems: CART },
        productId: PROD_A,
      }),
    ).toEqual({ cartItems: CART });
  });

  test('a sale with no cart array falls back to the scalar qty', () => {
    expect(
      resolveSaleSnapshot({
        orderMetadata: null,
        paymentMetadata: { qty: 3 },
        productId: PROD_A,
      }),
    ).toEqual({ qty: 3, productId: PROD_A });
  });

  test('a product-bound sale with no snapshot keeps its product so B1 can flag it', () => {
    expect(
      resolveSaleSnapshot({ orderMetadata: null, paymentMetadata: {}, productId: PROD_A }),
    ).toEqual({ qty: null, productId: PROD_A });
  });
});

describe('POST /api/cron/reconcile-payments — the fulfillment backstop', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    vi.clearAllMocks();

    paymentCandidateRows = [];
    orderCandidateRows = [];
    linkedPaymentRow = null;
    linkedOrderRow = null;
    paymentQueries = [];
    orderQueries = [];

    // The settlement pass selects PENDING rows; the fulfillment pass selects PAID
    // ones. Both read `payments`, so the predicate tells them apart.
    mockPaymentsFindMany.mockImplementation(async (args: { where?: unknown }) => {
      const compiled = compile(args.where);
      paymentQueries.push(compiled);
      return compiled.params.includes('paid') ? paymentCandidateRows : [];
    });
    mockPaymentOrdersFindMany.mockImplementation(async (args: { where?: unknown }) => {
      const compiled = compile(args.where);
      orderQueries.push(compiled);
      return orderCandidateRows;
    });

    // The link lookups are WHERE-AWARE: a lookup by `culqi_order_id` and a
    // lookup by `culqi_charge_id` must not answer the same row. The old suite
    // returned the linked row for every query, which is why it could not see
    // the double-decrement.
    mockPaymentsFindFirst.mockImplementation(async (args: { where?: unknown }) => {
      const { sql } = compile(args.where);
      if (sql.includes('"payments"."culqi_order_id"')) return linkedPaymentRow;
      if (sql.includes('"payments"."culqi_charge_id"')) return linkedPaymentRow;
      return null;
    });
    mockPaymentOrdersFindFirst.mockImplementation(async (args: { where?: unknown }) => {
      const { sql } = compile(args.where);
      if (sql.includes('"payment_orders"."culqi_order_id"')) return linkedOrderRow;
      return null;
    });

    mockFulfillPaidSale.mockResolvedValue({
      outcome: 'fulfilled',
      claimed: [{ sourceType: 'payment_orders', id: PO_UUID }],
      items: [{ productId: PROD_A, quantity: 2, applied: true }],
      oversold: [],
      b1: false,
    });
    mockEmitFulfillmentAlerts.mockReturnValue(undefined);
    mockDb.transaction.mockReset();
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  test('the paid candidate window is bounded by the fulfillment watermark', async () => {
    await runCron();

    const query = paymentQueries.find((q) => q.params.includes('paid'));
    expect(query).toBeDefined();
    // The driver encodes a timestamp bound as its ISO string.
    expect(query!.params).toContain(FULFILLMENT_WATERMARK.toISOString());
  });

  test('the order-side candidate query excludes a sale whose payments key is already claimed', async () => {
    await runCron();

    const query = orderQueries[0];
    expect(query).toBeDefined();
    expect(query.sql).toContain('"stock_movements"."source_id" = "payment_orders"."id"');
    expect(query.sql).toContain('"payments"."culqi_order_id" = "payment_orders"."culqi_order_id"');
    expect(query.sql).toContain('"payments"."business_id" = "payment_orders"."business_id"');
    expect(query.params).toContain(FULFILLMENT_WATERMARK.toISOString());
  });

  test('an order-backed sale claims the payment_orders key FIRST (N1)', async () => {
    orderCandidateRows = [paidOrderRow()];
    linkedPaymentRow = paidPaymentRow();

    await runCron();

    expect(mockFulfillPaidSale).toHaveBeenCalledTimes(1);
    const [identity] = mockFulfillPaidSale.mock.calls[0];
    // The canonical identity: DB row uuids and their id-kind hints only.
    expect(identity).toEqual({
      paymentOrderId: PO_UUID,
      paymentId: PAY_UUID,
      businessId: BIZ,
      culqiOrderId: ORD_TEXT_ID,
      culqiChargeId: CHR_TEXT_ID,
    });
  });

  test('the cron resolves the SAME ordered claim keys as every other trigger (N1)', async () => {
    orderCandidateRows = [paidOrderRow()];
    linkedPaymentRow = paidPaymentRow();

    await runCron();

    const [identity] = mockFulfillPaidSale.mock.calls[0];
    expect(resolveClaimKeys(identity)).toEqual([
      { sourceType: 'payment_orders', id: PO_UUID },
      { sourceType: 'payments', id: PAY_UUID },
    ]);
  });

  test('the sale is fulfilled from the persisted cart array, not the scalar qty (W-A)', async () => {
    orderCandidateRows = [paidOrderRow()];
    linkedPaymentRow = paidPaymentRow();

    await runCron();

    const [, snapshot] = mockFulfillPaidSale.mock.calls[0];
    expect(snapshot).toEqual({ cartItems: CART });
  });

  test('a token-only sale claims the payments key alone', async () => {
    paymentCandidateRows = [paidPaymentRow({ culqiOrderId: null })];

    await runCron();

    expect(mockFulfillPaidSale).toHaveBeenCalledTimes(1);
    const [identity] = mockFulfillPaidSale.mock.calls[0];
    expect(identity).toEqual({
      paymentOrderId: null,
      paymentId: PAY_UUID,
      businessId: BIZ,
      culqiOrderId: null,
      culqiChargeId: CHR_TEXT_ID,
    });
    expect(resolveClaimKeys(identity)).toEqual([{ sourceType: 'payments', id: PAY_UUID }]);
  });

  test('the same sale found through both rows is collected once', async () => {
    paymentCandidateRows = [paidPaymentRow()];
    orderCandidateRows = [paidOrderRow()];
    linkedPaymentRow = paidPaymentRow();

    const { body } = await runCron();

    expect(mockFulfillPaidSale).toHaveBeenCalledTimes(1);
    expect(body.fulfillmentScanned).toBe(1);
  });

  test('the counters report what the pass did', async () => {
    paymentCandidateRows = [paidPaymentRow()];
    orderCandidateRows = [paidOrderRow()];
    linkedPaymentRow = paidPaymentRow();

    const { res, body } = await runCron();

    expect(res.status).toBe(200);
    expect(body).toEqual({
      reconciled: 0,
      skipped: 0,
      scanned: 0,
      fulfilled: 1,
      fulfillmentSkipped: 0,
      fulfillmentScanned: 1,
    });
  });

  test('an already-claimed sale is skipped, not fulfilled', async () => {
    paymentCandidateRows = [paidPaymentRow({ culqiOrderId: null })];
    mockFulfillPaidSale.mockResolvedValue({
      outcome: 'already_claimed',
      claimed: [],
      items: [],
      oversold: [],
      b1: false,
    });

    const { body } = await runCron();

    expect(body.fulfilled).toBe(0);
    expect(body.fulfillmentSkipped).toBe(1);
    expect(body.fulfillmentScanned).toBe(1);
    expect(mockEmitFulfillmentAlerts).toHaveBeenCalledWith(
      'reconcile',
      expect.objectContaining({ paymentOrderId: null, paymentId: PAY_UUID }),
      expect.objectContaining({ outcome: 'already_claimed' }),
    );
  });

  test('an order-backed sale never re-collects its payments row as a second sale', async () => {
    // Both candidate reads see their side of ONE sale. The reverse index makes
    // the dedupe independent of which side resolved the same-kind link.
    paymentCandidateRows = [paidPaymentRow()];
    orderCandidateRows = [paidOrderRow()];
    linkedPaymentRow = paidPaymentRow();

    const { body } = await runCron();

    expect(mockFulfillPaidSale).toHaveBeenCalledTimes(1);
    expect(body.fulfillmentScanned).toBe(1);
  });

  test('a failing sale does not abort the run', async () => {
    orderCandidateRows = [
      paidOrderRow(),
      paidOrderRow({ id: PO_UUID_2, culqiOrderId: ORD_TEXT_ID_2 }),
    ];
    mockFulfillPaidSale.mockRejectedValueOnce(new Error('boom'));

    const { res, body } = await runCron();

    expect(res.status).toBe(200);
    expect(body.fulfillmentScanned).toBe(2);
    expect(body.fulfilled).toBe(1);
    expect(body.fulfillmentSkipped).toBe(1);
  });

  test('the backstop reports nothing when there is no paid sale to fulfil', async () => {
    const { body } = await runCron();

    expect(body).toEqual({
      reconciled: 0,
      skipped: 0,
      scanned: 0,
      fulfilled: 0,
      fulfillmentSkipped: 0,
      fulfillmentScanned: 0,
    });
    expect(mockFulfillPaidSale).not.toHaveBeenCalled();
  });

  // ==========================================================
  // THE REGRESSION (verify-report-pass3 failure)
  // ==========================================================
  // A sale whose `payments` row carries the CHARGE id and whose
  // `payment_orders` row carries the ORDER id is ONE sale. The backstop and
  // the charge trigger must collide on the SAME ordered claim set, so the
  // ledger accepts exactly ONE of them and the stock is decremented once.
  //
  // This test runs the REAL helper against an in-memory ledger: mocking it
  // would let the route claim the same sale twice and still look green — the
  // exact blind spot the old suite had.
  test('one sale with a charge-id payments row and an order-id order row is decremented exactly once', async () => {
    const singleItemCart = [{ id: PROD_A, quantity: 1 }];
    orderCandidateRows = [paidOrderRow({ metadata: { cartItems: singleItemCart } })];
    linkedPaymentRow = paidPaymentRow();

    const ledger = new Set<string>();
    let decrementCalls = 0;

    const tx = {
      insert: vi.fn(() => ({
        values: (values: { sourceType: string; sourceId: string }) => ({
          onConflictDoNothing: () => ({
            returning: async () => {
              const key = `${values.sourceType}:${values.sourceId}`;
              if (ledger.has(key)) return [];
              ledger.add(key);
              return [{ id: 'mv-new' }];
            },
          }),
          onConflictDoUpdate: () => ({ returning: async () => [{ id: 'mv-fixup' }] }),
        }),
      })),
      update: vi.fn(() => ({
        set: () => ({
          where: () => ({
            returning: async () => {
              decrementCalls += 1;
              return [{ id: PROD_A }];
            },
          }),
        }),
      })),
    };

    mockDb.transaction.mockImplementation(async (callback: (t: unknown) => Promise<unknown>) =>
      callback(tx),
    );
    mockFulfillPaidSale.mockImplementation(holder.actualFulfillPaidSale!);

    const { body } = await runCron();

    // ONE sale collected, ONE fulfillment, ONE decrement.
    expect(body.fulfillmentScanned).toBe(1);
    expect(body.fulfilled).toBe(1);
    expect(body.fulfillmentSkipped).toBe(0);
    expect(decrementCalls).toBe(1);
    expect([...ledger]).toEqual([`payment_orders:${PO_UUID}`, `payments:${PAY_UUID}`]);

    // The charge trigger resolves the same sale from the SAME identity. Its
    // claim set collides on the first key, so it must not decrement again.
    const chargeTrigger = await holder.actualFulfillPaidSale!(
      {
        paymentOrderId: PO_UUID,
        paymentId: PAY_UUID,
        businessId: BIZ,
        culqiOrderId: ORD_TEXT_ID,
        culqiChargeId: CHR_TEXT_ID,
      },
      { cartItems: singleItemCart },
      { tx: tx as never },
    );

    expect(chargeTrigger.outcome).toBe('already_claimed');
    expect(decrementCalls).toBe(1);
  });
});
