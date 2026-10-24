// =====================================================
// src/core/payments/stockFulfillment — Unit tests (NEW-8, slice 1)
// =====================================================
// Strict TDD: these truth tables pin the exactly-once CAS over the ordered
// key set (design D4), the conditional decrement idiom (D5), transaction
// ownership (D5), snapshot resolution (D6) and the alert emitter (B-07).
// =====================================================

import type { SaleIdentity } from '@/core/payments/stockFulfillment';
import {
  FULFILLMENT_WATERMARK,
  emitFulfillmentAlerts,
  fulfillPaidSale,
  isHistoricalPaidRow,
  readFulfillmentCartItems,
  readFulfillmentQty,
  resolveFulfillmentItems,
} from '@/core/payments/stockFulfillment';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Chainable DB mocks ──────────────────────────────────────────────
// A single `insert()` chain serves BOTH the `payments` insert and the CAS
// claim. `returning()` is the terminal the helper asserts on; when the target
// table is `stockMovements` we answer `[]` to model an already-claimed key.

const {
  mockValues,
  mockReturning,
  mockOnConflictDoNothing,
  mockOnConflictDoUpdate,
  mockInsert,
  mockUpdateReturning,
  mockUpdateWhere,
  mockUpdateSet,
  mockUpdate,
  mockSelect,
  mockTransaction,
} = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockOnConflictDoNothing = vi.fn();
  const mockOnConflictDoUpdate = vi.fn();
  const mockValues = vi.fn();
  // terminal `returning` answers the same whether reached directly or via
  // `onConflictDoNothing()` / `onConflictDoUpdate()` (the oversell correction).
  mockValues.mockReturnValue({
    returning: mockReturning,
    onConflictDoNothing: mockOnConflictDoNothing,
    onConflictDoUpdate: mockOnConflictDoUpdate,
  });
  mockOnConflictDoNothing.mockImplementation(() => ({ returning: mockReturning }));
  mockOnConflictDoUpdate.mockImplementation(() => ({ returning: mockReturning }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));

  const mockUpdateReturning = vi.fn(async () => [{ id: 'p1' }]);
  const mockUpdateWhere = vi.fn(() => ({ returning: mockUpdateReturning }));
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

  const mockSelect = vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(async () => []) })) }));

  const mockTransaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({ insert: mockInsert, update: mockUpdate, select: mockSelect }),
  );

  return {
    mockValues,
    mockReturning,
    mockOnConflictDoNothing,
    mockOnConflictDoUpdate,
    mockInsert,
    mockUpdateReturning,
    mockUpdateWhere,
    mockUpdateSet,
    mockUpdate,
    mockSelect,
    mockTransaction,
  };
});

vi.mock('@/core/database/client', () => ({
  db: {
    insert: mockInsert,
    update: mockUpdate,
    select: mockSelect,
    transaction: mockTransaction,
  },
}));

/** A stand-in `tx` passed by callers that own the transaction (charge route). */
function makeTx() {
  return { insert: mockInsert, update: mockUpdate, select: mockSelect };
}

function compile(node: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(node as never);
}

const BIZ = '550e8400-e29b-41d4-a716-446655440000';
const PROD = '660e8400-e29b-41d4-a716-446655440001';
const PAY_ID = '770e8400-e29b-41d4-a716-446655440002';
const PO_ID = '880e8400-e29b-41d4-a716-446655440003';

// ── Identity factories (R2 contract) ──
// Claim keys derive ONLY from the DB row uuids (`paymentOrderId`/`paymentId`);
// a Culqi text id ('ord_…') is a resolution hint and must never become a
// sourceId (uuid column, unique (sourceType, sourceId)).

/** Token-only sale: no `payment_orders` row resolves, so the payments slot alone keys the claim. */
function tokenAnchor(): SaleIdentity {
  return {
    paymentOrderId: null,
    paymentId: PAY_ID,
    businessId: BIZ,
    culqiOrderId: null,
    culqiChargeId: 'chr_1',
  };
}

/** Order-backed sale: BOTH row ids resolve — the ordered key set (D4/R2). */
function orderAnchor(): SaleIdentity {
  return {
    paymentOrderId: PO_ID,
    paymentId: PAY_ID,
    businessId: BIZ,
    culqiOrderId: 'ord_1',
    culqiChargeId: 'chr_1',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockValues.mockReturnValue({
    returning: mockReturning,
    onConflictDoNothing: mockOnConflictDoNothing,
    onConflictDoUpdate: mockOnConflictDoUpdate,
  });
  mockOnConflictDoNothing.mockImplementation(() => ({ returning: mockReturning }));
  mockOnConflictDoUpdate.mockImplementation(() => ({ returning: mockReturning }));
  mockUpdateReturning.mockResolvedValue([{ id: 'p1' }]);
});

// ============================================================
// resolveFulfillmentItems — pure snapshot resolution (D6)
// ============================================================

describe('resolveFulfillmentItems', () => {
  test('uses cartItems when present, mapping to {productId, quantity, applied:false}', () => {
    const result = resolveFulfillmentItems({
      cartItems: [
        { id: PROD, quantity: 2 },
        { id: '660e8400-e29b-41d4-a716-446655440009', quantity: 1 },
      ],
      productId: PROD,
    });

    expect(result.productBound).toBe(true);
    expect(result.b1).toBe(false);
    expect(result.items).toEqual([
      { productId: PROD, quantity: 2, applied: false },
      { productId: '660e8400-e29b-41d4-a716-446655440009', quantity: 1, applied: false },
    ]);
  });

  test('uses the scalar qty (clamped to >= 1) for the bound productId when no cartItems', () => {
    const result = resolveFulfillmentItems({ qty: 3, productId: PROD });

    expect(result.productBound).toBe(true);
    expect(result.b1).toBe(false);
    expect(result.items).toEqual([{ productId: PROD, quantity: 3, applied: false }]);
  });

  test('falls back to qty = 1 with b1 = true when a bound product has no snapshot', () => {
    const result = resolveFulfillmentItems({ productId: PROD });

    expect(result.productBound).toBe(true);
    expect(result.b1).toBe(true);
    expect(result.items).toEqual([{ productId: PROD, quantity: 1, applied: false }]);
  });

  test('is product-less (no items, no b1) when there is no bound product and no cartItems', () => {
    const result = resolveFulfillmentItems({});

    expect(result.productBound).toBe(false);
    expect(result.b1).toBe(false);
    expect(result.items).toEqual([]);
  });

  test('clamps a non-positive / non-finite scalar qty to 1', () => {
    expect(resolveFulfillmentItems({ qty: 0, productId: PROD }).items[0].quantity).toBe(1);
    expect(resolveFulfillmentItems({ qty: -5, productId: PROD }).items[0].quantity).toBe(1);
    expect(resolveFulfillmentItems({ qty: NaN, productId: PROD }).items[0].quantity).toBe(1);
  });
});

// ============================================================
// isHistoricalPaidRow — R7 watermark predicate
// ============================================================

describe('isHistoricalPaidRow', () => {
  test('true only for a paid row updated BEFORE the watermark', () => {
    const before = new Date(FULFILLMENT_WATERMARK.getTime() - 60_000);
    const after = new Date(FULFILLMENT_WATERMARK.getTime() + 60_000);

    expect(isHistoricalPaidRow({ status: 'paid', updatedAt: before })).toBe(true);
    expect(isHistoricalPaidRow({ status: 'paid', updatedAt: after })).toBe(false);
  });

  test('boundary: the exact watermark instant is NOT history (R7 cutover)', () => {
    const justBefore = new Date(FULFILLMENT_WATERMARK.getTime() - 1);
    const atWatermark = new Date(FULFILLMENT_WATERMARK.getTime());

    // A paid row updated before cutover is history -> never fulfilled.
    expect(isHistoricalPaidRow({ status: 'paid', updatedAt: justBefore })).toBe(true);
    // A paid row updated AT cutover is a task -> fulfilled.
    expect(isHistoricalPaidRow({ status: 'paid', updatedAt: atWatermark })).toBe(false);
  });

  test('false for any non-paid status regardless of timestamp', () => {
    const before = new Date(FULFILLMENT_WATERMARK.getTime() - 60_000);
    expect(isHistoricalPaidRow({ status: 'pending', updatedAt: before })).toBe(false);
  });

  test('accepts an ISO string updatedAt', () => {
    const before = new Date(FULFILLMENT_WATERMARK.getTime() - 60_000).toISOString();
    expect(isHistoricalPaidRow({ status: 'paid', updatedAt: before })).toBe(true);
  });
});

// ============================================================
// readFulfillmentQty — scalar recovery truth table
// ============================================================

describe('readFulfillmentQty', () => {
  test('returns an integer >= 1 from metadata.qty', () => {
    expect(readFulfillmentQty({ qty: 4 })).toBe(4);
    expect(readFulfillmentQty({ qty: '2' })).toBe(2);
  });

  test('returns null when qty is absent, non-numeric, or < 1', () => {
    expect(readFulfillmentQty({})).toBeNull();
    expect(readFulfillmentQty(null)).toBeNull();
    expect(readFulfillmentQty({ qty: 'abc' })).toBeNull();
    expect(readFulfillmentQty({ qty: 0 })).toBeNull();
    expect(readFulfillmentQty({ qty: 1.5 })).toBeNull();
  });
});

// ============================================================
// readFulfillmentCartItems — persisted cart snapshot recovery
// ============================================================
// The order flow persists the FULL cart array in
// `payment_orders.metadata.cartItems` (W-B); the token flow's charge-route
// rows carry the same array in `payments.metadata.cartItems` (W-A). This
// reader is the ONLY sanctioned way to recover it — the scalar `qty` channel
// is a DIFFERENT shape and must never be mistaken for a cart.

describe('readFulfillmentCartItems', () => {
  test('recovers the persisted cart array from metadata.cartItems', () => {
    expect(
      readFulfillmentCartItems({
        cartItems: [
          { id: PROD, quantity: 2 },
          { id: '660e8400-e29b-41d4-a716-446655440009', quantity: 1 },
        ],
      }),
    ).toEqual([
      { id: PROD, quantity: 2 },
      { id: '660e8400-e29b-41d4-a716-446655440009', quantity: 1 },
    ]);
  });

  test('returns null when the row carries no cart array (the scalar qty channel is NOT a cart)', () => {
    expect(readFulfillmentCartItems({ qty: 3 })).toBeNull();
    expect(readFulfillmentCartItems({})).toBeNull();
    expect(readFulfillmentCartItems(null)).toBeNull();
    expect(readFulfillmentCartItems(undefined)).toBeNull();
    expect(readFulfillmentCartItems({ cartItems: 'nope' })).toBeNull();
    expect(readFulfillmentCartItems({ cartItems: [] })).toBeNull();
    expect(readFulfillmentCartItems([{ id: PROD, quantity: 1 }])).toBeNull();
  });

  test('drops entries without a usable product id and clamps the quantity to >= 1', () => {
    expect(
      readFulfillmentCartItems({
        cartItems: [
          { id: PROD, quantity: 2 },
          { id: '', quantity: 1 },
          { quantity: 1 },
          'garbage',
          { id: '660e8400-e29b-41d4-a716-446655440009', quantity: 0 },
        ],
      }),
    ).toEqual([
      { id: PROD, quantity: 2 },
      { id: '660e8400-e29b-41d4-a716-446655440009', quantity: 1 },
    ]);
  });
});

// ============================================================
// fulfillPaidSale — CAS ordering, decrement idiom, tx ownership
// ============================================================

describe('fulfillPaidSale', () => {
  /** Route the shared insert mock: stockMovements claims answer a row, payments answer a row. */
  function claimSucceeds() {
    mockReturning.mockResolvedValue([{ id: 'mv-1' }]);
  }

  test('claims (INSERT) before it decrements (UPDATE) — invocation order', async () => {
    claimSucceeds();

    await fulfillPaidSale(tokenAnchor(), { qty: 1, productId: PROD }, { tx: makeTx() });

    expect(mockOnConflictDoNothing).toHaveBeenCalled();
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockInsert.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpdate.mock.invocationCallOrder[0],
    );
  });

  test('inserts the claim into stockMovements with the ordered key and business scope', async () => {
    claimSucceeds();

    await fulfillPaidSale(tokenAnchor(), { qty: 1, productId: PROD }, { tx: makeTx() });

    const values = mockValues.mock.calls[0][0] as Record<string, unknown>;
    expect(values).toMatchObject({
      sourceType: 'payments',
      sourceId: PAY_ID,
      businessId: BIZ,
    });
  });

  test('a claim conflict (returning []) skips the decrement and reports already_claimed', async () => {
    claimSucceeds();
    // The CAS claim matches nothing -> the sale is already claimed.
    mockReturning.mockResolvedValueOnce([]);

    const result = await fulfillPaidSale(
      tokenAnchor(),
      { qty: 2, productId: PROD },
      { tx: makeTx() },
    );

    expect(result.outcome).toBe('already_claimed');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('decrement is conditional and business-scoped: WHERE business_id AND stock >= qty', async () => {
    claimSucceeds();

    await fulfillPaidSale(tokenAnchor(), { qty: 2, productId: PROD }, { tx: makeTx() });

    const where = compile(mockUpdateWhere.mock.calls[0][0]);
    expect(where.sql).toMatch(
      /"products"\."id" = .* and "products"\."business_id" = .* and "products"\."stock" >= /,
    );
    expect(where.params).toEqual([PROD, BIZ, 2]);
  });

  test('decrement set is a plain subtraction, never GREATEST', async () => {
    claimSucceeds();

    await fulfillPaidSale(tokenAnchor(), { qty: 2, productId: PROD }, { tx: makeTx() });

    const set = mockUpdateSet.mock.calls[0][0] as { stock: unknown };
    const compiled = compile(set.stock);
    expect(compiled.sql).not.toMatch(/greatest/i);
    expect(compiled.sql).toMatch(/stock" - /);
  });

  test('a 0-row decrement records the line as oversold without throwing', async () => {
    claimSucceeds();
    mockUpdateReturning.mockResolvedValueOnce([]);

    const result = await fulfillPaidSale(
      tokenAnchor(),
      { qty: 1, productId: PROD },
      { tx: makeTx() },
    );

    expect(result.outcome).toBe('partial');
    expect(result.oversold).toEqual([{ productId: PROD, requested: 1 }]);
  });

  test('does NOT open db.transaction when a tx is passed', async () => {
    claimSucceeds();

    await fulfillPaidSale(tokenAnchor(), { qty: 1, productId: PROD }, { tx: makeTx() });

    expect(mockTransaction).not.toHaveBeenCalled();
  });

  test('opens its own db.transaction when no tx is passed', async () => {
    claimSucceeds();

    await fulfillPaidSale(tokenAnchor(), { qty: 1, productId: PROD });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  test('order-backed anchor claims payment_orders FIRST, then payments — keyed to DB row ids', async () => {
    claimSucceeds();

    await fulfillPaidSale(orderAnchor(), { qty: 1, productId: PROD }, { tx: makeTx() });

    const first = mockValues.mock.calls[0][0] as Record<string, unknown>;
    const second = mockValues.mock.calls[1][0] as Record<string, unknown>;
    expect(first).toMatchObject({ sourceType: 'payment_orders', sourceId: PO_ID });
    // The payments slot keys the PAYMENTS row id — never a copy of the order id
    // (two triggers would then win one slot each: the exactly-once break) and
    // never the Culqi text id ('ord_1': a uuid-column crash).
    expect(second).toMatchObject({ sourceType: 'payments', sourceId: PAY_ID });
    const sourceIds = [first.sourceId, second.sourceId];
    expect(sourceIds).not.toContain('ord_1');
  });

  test('a token-only anchor claims payments alone', async () => {
    claimSucceeds();

    await fulfillPaidSale(tokenAnchor(), { qty: 1, productId: PROD }, { tx: makeTx() });

    expect(mockValues).toHaveBeenCalledTimes(1);
    const only = mockValues.mock.calls[0][0] as Record<string, unknown>;
    expect(only.sourceType).toBe('payments');
  });

  test('a product-less paid order claims but never decrements (no_product)', async () => {
    claimSucceeds();

    const result = await fulfillPaidSale(
      // Status-only-flip shape: the payments slot never resolved, so the single
      // claim keys the payment_orders row id.
      {
        paymentOrderId: PO_ID,
        paymentId: null,
        businessId: BIZ,
        culqiOrderId: 'ord_1',
        culqiChargeId: null,
      },
      {},
      { tx: makeTx() },
    );

    expect(result.outcome).toBe('no_product');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('an identity that resolves no DB row id fails closed instead of claiming with a hint', async () => {
    // Neither slot resolved: the ONLY safe answer is to refuse — falling back
    // to a Culqi text id would crash the uuid column. The refusal is an
    // `unresolved` OUTCOME, not a throw: the webhook must still be acknowledged
    // and the reconcile backstop still has to be able to heal the sale (D14).
    const result = await fulfillPaidSale(
      {
        paymentOrderId: null,
        paymentId: null,
        businessId: BIZ,
        culqiOrderId: null,
        culqiChargeId: 'chr_1',
      },
      { qty: 1, productId: PROD },
      { tx: makeTx() },
    );

    expect(result.outcome).toBe('unresolved');
    expect(result.claimed).toEqual([]);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('an order-backed claim collides with a later payments-only re-claim (in-memory ledger)', async () => {
    // The DB uniqueness that actually protects us: (sourceType, sourceId) unique.
    // An in-memory ledger reproduces it so the two-trigger scenario is real.
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
              return [{ id: PROD }];
            },
          }),
        }),
      })),
      select: vi.fn(),
    };

    // Trigger 1 (the charge route): order-backed, wins BOTH keys.
    const first = await fulfillPaidSale(
      orderAnchor(),
      { qty: 1, productId: PROD },
      {
        tx: tx as never,
      },
    );
    expect(first.outcome).toBe('fulfilled');

    // Trigger 2 (e.g. a later webhook keyed only on payments): the payments row
    // it tries is already claimed — the sale is fulfilled, NOT a second decrement.
    const second = await fulfillPaidSale(
      tokenAnchor(),
      { qty: 1, productId: PROD },
      {
        tx: tx as never,
      },
    );
    expect(second.outcome).toBe('already_claimed');
    expect(second.oversold).toEqual([]);
    // Exactly one decrement across both triggers — the whole point of R2.
    expect(decrementCalls).toBe(1);
  });

  test('a fully applied sale records no correction — one ledger write per key', async () => {
    claimSucceeds();

    await fulfillPaidSale(tokenAnchor(), { qty: 1, productId: PROD }, { tx: makeTx() });

    expect(mockValues).toHaveBeenCalledTimes(1);
    expect(mockOnConflictDoUpdate).not.toHaveBeenCalled();
  });

  test('an oversell corrects the persisted claim to outcome partial with truthful items', async () => {
    claimSucceeds();
    mockUpdateReturning.mockResolvedValueOnce([]);

    const result = await fulfillPaidSale(
      tokenAnchor(),
      { qty: 1, productId: PROD },
      {
        tx: makeTx(),
      },
    );

    expect(result.outcome).toBe('partial');
    // The correction is an upsert on the claim's unique key — the ledger stays
    // insert-only and `tx.update` stays reserved for the flip and the
    // decrement (tests pin that exact count).
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);
    const config = mockOnConflictDoUpdate.mock.calls[0][0] as {
      target: unknown;
      set: { outcome: string; items: { productId: string; quantity: number; applied: boolean }[] };
      where: unknown;
    };
    expect(config.set.outcome).toBe('partial');
    expect(config.set.items).toEqual([{ productId: PROD, quantity: 1, applied: false }]);
    // Scoped to this business: a correction must never rewrite another tenant's row.
    expect(compile(config.where).sql).toMatch(/business_id/);
    const corrected = mockValues.mock.calls[1][0] as Record<string, unknown>;
    expect(corrected).toMatchObject({
      sourceType: 'payments',
      sourceId: PAY_ID,
      outcome: 'partial',
    });
  });
});

// ============================================================
// emitFulfillmentAlerts — console.error only, identifiers intact (B-07)
// ============================================================

describe('emitFulfillmentAlerts', () => {
  test('emits oversold alerts through console.error, never the structured logger', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    emitFulfillmentAlerts('charge', tokenAnchor(), {
      outcome: 'partial',
      claimed: [{ sourceType: 'payments', id: PAY_ID }],
      items: [{ productId: PROD, quantity: 1, applied: false }],
      oversold: [{ productId: PROD, requested: 1 }],
      b1: false,
    });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('oversold'),
      expect.objectContaining({ businessId: BIZ, productId: PROD, requested: 1 }),
    );
  });

  test('emits a B1 alert when the snapshot was unrecoverable', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    emitFulfillmentAlerts('culqi-webhook', tokenAnchor(), {
      outcome: 'fulfilled',
      claimed: [{ sourceType: 'payments', id: PAY_ID }],
      items: [{ productId: PROD, quantity: 1, applied: true }],
      oversold: [],
      b1: true,
    });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('B1'),
      expect.objectContaining({ businessId: BIZ }),
    );
  });
});

describe('FULFILLMENT_WATERMARK', () => {
  // The merge day of this change. The watermark may start earlier in that day
  // (it must be <= merge time) but it may NEVER predate it: a past date
  // retro-classifies already-paid rows as work and re-opens R7.
  const CUTOVER_FLOOR = Date.parse('2026-10-22T00:00:00.000Z');

  test('is a Date constant', () => {
    expect(FULFILLMENT_WATERMARK).toBeInstanceOf(Date);
    expect(Number.isNaN(FULFILLMENT_WATERMARK.getTime())).toBe(false);
  });

  test('is not set to a past date (cannot silently regress to a stale cutover)', () => {
    expect(FULFILLMENT_WATERMARK.getTime()).toBeGreaterThanOrEqual(CUTOVER_FLOOR);
  });
});
