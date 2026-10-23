// =====================================================
// tests/unit/saleIdentity.test.ts
// =====================================================
// D17 regression contract for the CANONICAL sale identity (design D13/D14):
//   - an order-backed sale resolves BOTH row ids and claims `payment_orders`
//     first (design D4);
//   - a token-only sale resolves the single `payments` id;
//   - the link between a `payments` row and its `payment_orders` row is the
//     SAME-KIND `culqi_order_id` equality — a charge id is never an order id;
//   - every read is business-scoped;
//   - an unresolvable anchor fails closed: no keys, no claim, no decrement.
//
// Harness contract (D17): the `findFirst` fake honours the COMPILED predicate
// instead of returning a canned row regardless of `where`. A fake that ignores
// `where` is what hid the asymmetric-link defect in the previous suite.
// =====================================================

import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, test, vi } from 'vitest';

import {
  type SaleIdentity,
  type SaleIdentityReader,
  type SaleIdentitySourceRow,
  findSalePaymentRow,
  resolveClaimKeys,
  resolveSaleIdentity,
} from '@/core/payments/saleIdentity';
import { fulfillPaidSale } from '@/core/payments/stockFulfillment';

const BIZ = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_BIZ = '550e8400-e29b-41d4-a716-446655440099';
const ORDER_ROW_ID = '11111111-2222-4333-8444-555555555555';
const PAYMENT_ROW_ID = '99999999-8888-4777-a666-555555555555';
const PRODUCT_ID = '660e8400-e29b-41d4-a716-446655440001';
const CART = [{ id: PRODUCT_ID, quantity: 2 }];

function compileWhere(where: unknown): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(where as never);
}

type TableName = 'payment_orders' | 'payments';

interface ReaderCall {
  table: TableName;
  sql: string;
  params: unknown[];
}

/**
 * Does the compiled `where` match this row? The resolver always builds
 * `and(eq(column, value), eq(businessId, businessId))`, so the compiled SQL
 * names every constrained column and its positional parameter. Matching on
 * that contract is what makes the fake predicate-aware.
 */
function rowMatches(args: {
  table: TableName;
  row: SaleIdentitySourceRow;
  sql: string;
  params: unknown[];
}) {
  const { table, row, sql, params } = args;
  const comparisons = [...sql.matchAll(/"(payment_orders|payments)"\."([a-z_]+)" = \$(\d+)/g)];
  if (comparisons.length === 0) return false;

  return comparisons.every(([, tableName, column, positional]) => {
    if (tableName !== table) return false;
    const value = params[Number(positional) - 1];
    switch (column) {
      case 'business_id':
        return row.businessId === value;
      case 'culqi_order_id':
        return row.culqiOrderId === value;
      case 'culqi_charge_id':
        return row.culqiChargeId === value;
      case 'id':
        return row.id === value;
      default:
        return false;
    }
  });
}

function createReader(seed: {
  orders?: SaleIdentitySourceRow[];
  payments?: SaleIdentitySourceRow[];
}) {
  const calls: ReaderCall[] = [];

  const makeFindFirst = (table: TableName, rows: SaleIdentitySourceRow[]) =>
    vi.fn(async (args: { where: unknown }) => {
      const { sql, params } = compileWhere(args.where);
      calls.push({ table, sql, params });
      return rows.find((row) => rowMatches({ table, row, sql, params })) ?? null;
    });

  const reader: SaleIdentityReader = {
    query: {
      paymentOrders: { findFirst: makeFindFirst('payment_orders', seed.orders ?? []) },
      payments: { findFirst: makeFindFirst('payments', seed.payments ?? []) },
    },
  };

  return { reader, calls };
}

function orderRow(overrides: Partial<SaleIdentitySourceRow> = {}): SaleIdentitySourceRow {
  return {
    id: ORDER_ROW_ID,
    businessId: BIZ,
    metadata: { productId: PRODUCT_ID, cartItems: CART },
    culqiOrderId: 'ord_1',
    ...overrides,
  };
}

function paymentRow(overrides: Partial<SaleIdentitySourceRow> = {}): SaleIdentitySourceRow {
  return {
    id: PAYMENT_ROW_ID,
    businessId: BIZ,
    metadata: { qty: 2 },
    productId: PRODUCT_ID,
    culqiOrderId: 'ord_1',
    culqiChargeId: null,
    ...overrides,
  };
}

describe('resolveSaleIdentity', () => {
  test('order-backed sale resolves BOTH row ids and claims payment_orders first', async () => {
    const { reader } = createReader({
      orders: [orderRow()],
      payments: [paymentRow()],
    });

    const sale = await resolveSaleIdentity({
      businessId: BIZ,
      anchor: { culqiOrderId: 'ord_1' },
      tx: reader,
    });

    expect(sale).not.toBeNull();
    expect(sale).toMatchObject({
      paymentOrderId: ORDER_ROW_ID,
      paymentId: PAYMENT_ROW_ID,
      businessId: BIZ,
      culqiOrderId: 'ord_1',
      culqiChargeId: null,
    });
    // The persisted order snapshot travels with the identity (W-B).
    expect(sale?.orderMetadata).toEqual({ productId: PRODUCT_ID, cartItems: CART });

    expect(resolveClaimKeys(sale as SaleIdentity)).toEqual([
      { sourceType: 'payment_orders', id: ORDER_ROW_ID },
      { sourceType: 'payments', id: PAYMENT_ROW_ID },
    ]);
  });

  test('token-only sale resolves the single payments key', async () => {
    const { reader } = createReader({
      payments: [paymentRow({ culqiOrderId: null, culqiChargeId: 'chr_1' })],
    });

    const sale = await resolveSaleIdentity({
      businessId: BIZ,
      anchor: { culqiChargeId: 'chr_1' },
      tx: reader,
    });

    expect(sale).not.toBeNull();
    expect(sale).toMatchObject({
      paymentOrderId: null,
      paymentId: PAYMENT_ROW_ID,
      businessId: BIZ,
      culqiOrderId: null,
      culqiChargeId: 'chr_1',
    });
    expect(resolveClaimKeys(sale as SaleIdentity)).toEqual([
      { sourceType: 'payments', id: PAYMENT_ROW_ID },
    ]);
  });

  test('links payment to order on culqi_order_id, never on the charge column', async () => {
    const { reader, calls } = createReader({
      orders: [orderRow()],
      payments: [paymentRow()],
    });

    const sale = await resolveSaleIdentity({
      businessId: BIZ,
      anchor: { culqiOrderId: 'ord_1' },
      tx: reader,
    });

    expect(sale?.paymentId).toBe(PAYMENT_ROW_ID);
    const paymentCalls = calls.filter((call) => call.table === 'payments');
    expect(paymentCalls).toHaveLength(1);
    // The only payments read is the SAME-KIND order link.
    expect(paymentCalls[0].sql).toContain('"payments"."culqi_order_id"');
    expect(paymentCalls[0].sql).not.toContain('"payments"."culqi_charge_id"');
    expect(paymentCalls[0].params).toEqual(['ord_1', BIZ]);
  });

  test('a charge id compared to an order id is NOT a link', async () => {
    const { reader, calls } = createReader({
      orders: [orderRow()],
      payments: [paymentRow()],
    });

    // 'ord_1' is an ORDER id; passing it as a CHARGE id must not resolve.
    const sale = await resolveSaleIdentity({
      businessId: BIZ,
      anchor: { culqiChargeId: 'ord_1' },
      tx: reader,
    });

    expect(sale).toBeNull();
    // No order read ever happens: an order hint was never supplied.
    expect(calls.some((call) => call.table === 'payment_orders')).toBe(false);
    const paymentCall = calls.find((call) => call.table === 'payments');
    expect(paymentCall?.sql).toContain('"payments"."culqi_charge_id"');

    // The same rule applies to the explicit payments lookup: the charge column
    // does not hold order ids, so the order id cannot match it.
    const lookup = await findSalePaymentRow(reader, {
      businessId: BIZ,
      culqiChargeId: 'ord_1',
    });
    expect(lookup).toBeNull();

    // The same-kind order lookup DOES find the row.
    const linked = await findSalePaymentRow(reader, {
      businessId: BIZ,
      culqiOrderId: 'ord_1',
    });
    expect(linked?.id).toBe(PAYMENT_ROW_ID);
  });

  test('a cross-tenant id resolves to nothing (business scoping)', async () => {
    const { reader } = createReader({
      orders: [orderRow({ businessId: OTHER_BIZ })],
      payments: [paymentRow({ businessId: OTHER_BIZ })],
    });

    const orderSale = await resolveSaleIdentity({
      businessId: BIZ,
      anchor: { culqiOrderId: 'ord_1' },
      tx: reader,
    });
    const chargeSale = await resolveSaleIdentity({
      businessId: BIZ,
      anchor: { culqiChargeId: 'chr_1' },
      tx: reader,
    });

    expect(orderSale).toBeNull();
    expect(chargeSale).toBeNull();
  });

  test('fails closed on an unresolvable anchor: no keys, no claim, no decrement', async () => {
    const { reader } = createReader({});

    const sale = await resolveSaleIdentity({
      businessId: BIZ,
      anchor: { culqiChargeId: 'chr_unknown' },
      tx: reader,
    });

    // The resolver must answer "unknown" with null, not a shapeless identity.
    expect(sale).toBeNull();

    const identity: SaleIdentity = {
      paymentOrderId: null,
      paymentId: null,
      businessId: BIZ,
      culqiOrderId: null,
      culqiChargeId: 'chr_unknown',
    };
    expect(resolveClaimKeys(identity)).toEqual([]);

    const insert = vi.fn();
    const update = vi.fn();
    const result = await fulfillPaidSale(
      identity,
      { cartItems: CART },
      { tx: { insert, update } as never },
    );

    expect(result.outcome).toBe('unresolved');
    expect(result.claimed).toEqual([]);
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
