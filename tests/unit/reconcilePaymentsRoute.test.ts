import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockDb,
  mockPayments,
  mockPaymentOrders,
  mockStockMovements,
  mockEq,
  mockAnd,
  mockOr,
  mockLt,
  mockIsNotNull,
  mockGte,
  mockSql,
} = vi.hoisted(() => {
  const payments = {
    id: 'payments.id',
    businessId: 'payments.businessId',
    productId: 'payments.productId',
    culqiChargeId: 'payments.culqiChargeId',
    // R4: the settlement pass and the sale-key predicate both read the ORDER
    // id column, so the schema stand-in must expose it.
    culqiOrderId: 'payments.culqiOrderId',
    status: 'payments.status',
    createdAt: 'payments.createdAt',
    updatedAt: 'payments.updatedAt',
  };

  const paymentOrders = {
    id: 'payment_orders.id',
    businessId: 'payment_orders.businessId',
    culqiOrderId: 'payment_orders.culqiOrderId',
    status: 'payment_orders.status',
    createdAt: 'payment_orders.createdAt',
    updatedAt: 'payment_orders.updatedAt',
  };

  const stockMovements = {
    sourceType: 'stock_movements.sourceType',
    sourceId: 'stock_movements.sourceId',
  };

  const db = {
    query: {
      payments: { findMany: vi.fn(), findFirst: vi.fn() },
      paymentOrders: { findMany: vi.fn(), findFirst: vi.fn() },
    },
    update: vi.fn(),
  };

  return {
    mockDb: db,
    mockPayments: payments,
    mockPaymentOrders: paymentOrders,
    mockStockMovements: stockMovements,
    mockEq: vi.fn(),
    mockAnd: vi.fn(),
    mockOr: vi.fn(),
    mockLt: vi.fn(),
    mockIsNotNull: vi.fn(),
    mockGte: vi.fn(),
    mockSql: vi.fn(),
  };
});

vi.mock('@/core/database/client', () => ({ db: mockDb }));
vi.mock('@/core/database/schema', () => ({
  payments: mockPayments,
  paymentOrders: mockPaymentOrders,
  stockMovements: mockStockMovements,
}));
vi.mock('drizzle-orm', () => ({
  eq: mockEq,
  and: mockAnd,
  or: mockOr,
  lt: mockLt,
  isNotNull: mockIsNotNull,
  gte: mockGte,
  sql: mockSql,
}));
vi.mock('@/core/payments/culqiSecretKey', () => ({ resolveCulqiSecretKey: vi.fn() }));
vi.mock('@/core/payments/culqiCharges', () => ({
  getCulqiCharge: vi.fn(),
  isCulqiChargePaid: vi.fn(),
}));

import { GET, POST } from '@/app/api/cron/reconcile-payments/route';
import { getCulqiCharge, isCulqiChargePaid } from '@/core/payments/culqiCharges';
import { resolveCulqiSecretKey } from '@/core/payments/culqiSecretKey';

const resolveKeyMock = vi.mocked(resolveCulqiSecretKey);
const getChargeMock = vi.mocked(getCulqiCharge);
const isPaidMock = vi.mocked(isCulqiChargePaid);

function request(headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/cron/reconcile-payments', { method: 'POST', headers });
}

function mockUpdateReturning(ids: string[]) {
  const returning = vi.fn().mockResolvedValue(ids.map((id) => ({ id })));
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  mockDb.update.mockReturnValueOnce({ set });
  return { set, where, returning };
}

describe('reconcile-payments cron (W-P3.2)', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    vi.clearAllMocks();
    mockEq.mockImplementation((...args) => args as never);
    mockAnd.mockImplementation((...args) => args as never);
    mockOr.mockImplementation((...args) => args as never);
    mockLt.mockImplementation((...args) => args as never);
    mockIsNotNull.mockImplementation((...args) => args as never);
    mockGte.mockImplementation((...args) => args as never);
    mockSql.mockImplementation((...args) => args as never);
    // The settlement pass and the fulfillment backstop both read `payments`;
    // default every read to "no rows" so a test only declares what it needs.
    mockDb.query.payments.findMany.mockResolvedValue([]);
    mockDb.query.payments.findFirst.mockResolvedValue(null);
    mockDb.query.paymentOrders.findMany.mockResolvedValue([]);
    mockDb.query.paymentOrders.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  it('returns 401 when the secret header is missing', async () => {
    const res = await POST(request());
    expect(res.status).toBe(401);
    expect(mockDb.query.payments.findMany).not.toHaveBeenCalled();
  });

  it('returns 401 when the secret header mismatches', async () => {
    const res = await POST(request({ 'x-cron-secret': 'wrong' }));
    expect(res.status).toBe(401);
    expect(mockDb.query.payments.findMany).not.toHaveBeenCalled();
  });

  it('returns 401 when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(request({ 'x-cron-secret': 'test-secret' }));
    expect(res.status).toBe(401);
  });

  it('accepts a Bearer token that matches CRON_SECRET', async () => {
    const res = await POST(request({ authorization: 'Bearer test-secret' }));
    expect(res.status).toBe(200);
  });

  it('returns 401 when the Bearer token mismatches', async () => {
    const res = await POST(request({ authorization: 'Bearer wrong-secret' }));
    expect(res.status).toBe(401);
    expect(mockDb.query.payments.findMany).not.toHaveBeenCalled();
  });

  it('returns 401 when the Bearer token is empty', async () => {
    const res = await POST(request({ authorization: 'Bearer ' }));
    expect(res.status).toBe(401);
  });

  it('scans and returns zeros when there are no candidates', async () => {
    mockDb.query.payments.findMany.mockResolvedValueOnce([]);

    const res = await POST(request({ 'x-cron-secret': 'test-secret' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      reconciled: 0,
      skipped: 0,
      scanned: 0,
      fulfilled: 0,
      fulfillmentSkipped: 0,
      fulfillmentScanned: 0,
    });
  });

  it('marks a pending payment as paid when Culqi confirms the charge', async () => {
    mockDb.query.payments.findMany.mockResolvedValueOnce([
      { id: 'p1', businessId: 'b1', culqiChargeId: 'chr_1' },
    ]);
    resolveKeyMock.mockResolvedValueOnce({ secretKey: 'sk_live_123', error: null });
    getChargeMock.mockResolvedValueOnce({ paid: true });
    isPaidMock.mockReturnValueOnce(true);
    const { set } = mockUpdateReturning(['p1']);

    const res = await POST(request({ 'x-cron-secret': 'test-secret' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      reconciled: 1,
      skipped: 0,
      scanned: 1,
      fulfilled: 0,
      fulfillmentSkipped: 0,
      fulfillmentScanned: 0,
    });
    expect(set).toHaveBeenCalledWith({ status: 'paid', updatedAt: expect.any(Date) });
  });

  it('does not write when Culqi read fails', async () => {
    mockDb.query.payments.findMany.mockResolvedValueOnce([
      { id: 'p2', businessId: 'b1', culqiChargeId: 'chr_2' },
    ]);
    resolveKeyMock.mockResolvedValueOnce({ secretKey: 'sk_live_123', error: null });
    getChargeMock.mockRejectedValueOnce(new Error('timeout'));

    const res = await POST(request({ 'x-cron-secret': 'test-secret' }));

    expect(await res.json()).toEqual({
      reconciled: 0,
      skipped: 1,
      scanned: 1,
      fulfilled: 0,
      fulfillmentSkipped: 0,
      fulfillmentScanned: 0,
    });
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('does not write when Culqi reports the charge unpaid', async () => {
    mockDb.query.payments.findMany.mockResolvedValueOnce([
      { id: 'p3', businessId: 'b1', culqiChargeId: 'chr_3' },
    ]);
    resolveKeyMock.mockResolvedValueOnce({ secretKey: 'sk_live_123', error: null });
    getChargeMock.mockResolvedValueOnce({ paid: false });
    isPaidMock.mockReturnValueOnce(false);

    const res = await POST(request({ 'x-cron-secret': 'test-secret' }));

    expect(await res.json()).toEqual({
      reconciled: 0,
      skipped: 1,
      scanned: 1,
      fulfilled: 0,
      fulfillmentSkipped: 0,
      fulfillmentScanned: 0,
    });
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('skips a payment whose business has no Culqi key configured', async () => {
    mockDb.query.payments.findMany.mockResolvedValueOnce([
      { id: 'p4', businessId: 'b1', culqiChargeId: 'chr_4' },
    ]);
    resolveKeyMock.mockResolvedValueOnce({
      secretKey: '',
      error: new Response('x') as never,
    });

    const res = await POST(request({ 'x-cron-secret': 'test-secret' }));

    expect(await res.json()).toEqual({
      reconciled: 0,
      skipped: 1,
      scanned: 1,
      fulfilled: 0,
      fulfillmentSkipped: 0,
      fulfillmentScanned: 0,
    });
    expect(getChargeMock).not.toHaveBeenCalled();
  });

  it('is idempotent: a concurrent settlement (no rows updated) counts as skipped', async () => {
    mockDb.query.payments.findMany.mockResolvedValueOnce([
      { id: 'p5', businessId: 'b1', culqiChargeId: 'chr_5' },
    ]);
    resolveKeyMock.mockResolvedValueOnce({ secretKey: 'sk_live_123', error: null });
    getChargeMock.mockResolvedValueOnce({ paid: true });
    isPaidMock.mockReturnValueOnce(true);
    mockUpdateReturning([]);

    const res = await POST(request({ 'x-cron-secret': 'test-secret' }));

    expect(await res.json()).toEqual({
      reconciled: 0,
      skipped: 1,
      scanned: 1,
      fulfilled: 0,
      fulfillmentSkipped: 0,
      fulfillmentScanned: 0,
    });
  });

  it('exposes the same guarded behaviour via GET', async () => {
    mockDb.query.payments.findMany.mockResolvedValueOnce([]);
    const res = await GET(
      new Request('http://localhost/api/cron/reconcile-payments', {
        method: 'GET',
        headers: { 'x-cron-secret': 'test-secret' },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      reconciled: 0,
      skipped: 0,
      scanned: 0,
      fulfilled: 0,
      fulfillmentSkipped: 0,
      fulfillmentScanned: 0,
    });
  });
});
