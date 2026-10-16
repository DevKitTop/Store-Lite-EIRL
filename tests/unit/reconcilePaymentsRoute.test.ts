import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDb, mockPayments, mockInArray, mockLt, mockAnd, mockEq } = vi.hoisted(() => {
  const payments = {
    id: 'payments.id',
    businessId: 'payments.businessId',
    culqiChargeId: 'payments.culqiChargeId',
    culqiOrderId: 'payments.culqiOrderId',
    status: 'payments.status',
    createdAt: 'payments.createdAt',
    updatedAt: 'payments.updatedAt',
  };

  const findMany = vi.fn();
  const update = vi.fn();

  const db = {
    query: { payments: { findMany } },
    update,
  };

  return {
    mockDb: db,
    mockPayments: payments,
    mockInArray: vi.fn(),
    mockLt: vi.fn(),
    mockAnd: vi.fn(),
    mockEq: vi.fn(),
  };
});

vi.mock('@/core/database/client', () => ({ db: mockDb }));
vi.mock('@/core/database/schema', () => ({ payments: mockPayments }));
vi.mock('drizzle-orm', () => ({
  inArray: mockInArray,
  lt: mockLt,
  and: mockAnd,
  eq: mockEq,
}));
vi.mock('@/core/payments/culqiSecretKey', () => ({
  resolveCulqiSecretKey: vi.fn(),
}));
vi.mock('@/core/payments/culqiOrders', () => ({
  getCulqiOrder: vi.fn(),
  isCulqiOrderPaid: vi.fn(),
  CulqiReadError: class CulqiReadError extends Error {},
}));

import { POST } from '@/app/api/cron/reconcile-payments/route';
import { CulqiReadError, getCulqiOrder, isCulqiOrderPaid } from '@/core/payments/culqiOrders';
import { resolveCulqiSecretKey } from '@/core/payments/culqiSecretKey';

const resolveCulqiSecretKeyMock = vi.mocked(resolveCulqiSecretKey);
const getCulqiOrderMock = vi.mocked(getCulqiOrder);
const isCulqiOrderPaidMock = vi.mocked(isCulqiOrderPaid);

describe('reconcile-payments cron (W-P3.2)', () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.CRON_SECRET = 'test-secret';
    vi.clearAllMocks();
    mockInArray.mockImplementation((...args) => args as any);
    mockLt.mockImplementation((...args) => args as any);
    mockAnd.mockImplementation((...args) => args as any);
    mockEq.mockImplementation((...args) => args as any);
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  it('returns 401 when header missing', async () => {
    const res = await POST(
      new Request('http://localhost/api/cron/reconcile-payments', { method: 'POST' }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 when secret mismatches', async () => {
    const res = await POST(
      new Request('http://localhost/api/cron/reconcile-payments', {
        method: 'POST',
        headers: { 'x-cron-secret': 'wrong' },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 0 reconciled when no candidates', async () => {
    mockDb.query.payments.findMany.mockResolvedValueOnce([]);

    const res = await POST(
      new Request('http://localhost/api/cron/reconcile-payments', {
        method: 'POST',
        headers: { 'x-cron-secret': 'test-secret' },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ reconciled: 0 });
  });

  it('reconciles payment to paid when Culqi confirms order paid', async () => {
    mockDb.query.payments.findMany.mockResolvedValueOnce([
      {
        id: 'p1',
        businessId: 'b1',
        culqiChargeId: 'chr_1',
        culqiOrderId: 'ord_1',
        status: 'pending',
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    ]);

    resolveCulqiSecretKeyMock.mockResolvedValueOnce({ secretKey: 'sk_live_123', error: null });
    getCulqiOrderMock.mockResolvedValueOnce({ paid: true } as any);
    isCulqiOrderPaidMock.mockReturnValueOnce(true);

    const updateSet = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    mockDb.update.mockReturnValueOnce({ set: updateSet });

    const res = await POST(
      new Request('http://localhost/api/cron/reconcile-payments', {
        method: 'POST',
        headers: { 'x-cron-secret': 'test-secret' },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ reconciled: 1 });
    expect(updateSet).toHaveBeenCalledWith({ status: 'paid', updatedAt: expect.any(Date) });
  });

  it('does not reconcile when Culqi read error occurs', async () => {
    mockDb.query.payments.findMany.mockResolvedValueOnce([
      {
        id: 'p2',
        businessId: 'b1',
        culqiChargeId: 'chr_2',
        culqiOrderId: 'ord_2',
        status: 'processing',
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    ]);

    resolveCulqiSecretKeyMock.mockResolvedValueOnce({ secretKey: 'sk_live_123', error: null });
    getCulqiOrderMock.mockRejectedValueOnce(new CulqiReadError('timeout'));

    const res = await POST(
      new Request('http://localhost/api/cron/reconcile-payments', {
        method: 'POST',
        headers: { 'x-cron-secret': 'test-secret' },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ reconciled: 0 });
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('skips when cannot deterministically confirm (no culqiOrderId)', async () => {
    mockDb.query.payments.findMany.mockResolvedValueOnce([
      {
        id: 'p3',
        businessId: 'b1',
        culqiChargeId: 'chr_3',
        culqiOrderId: null,
        status: 'pending',
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    ]);

    resolveCulqiSecretKeyMock.mockResolvedValueOnce({ secretKey: 'sk_live_123', error: null });

    const res = await POST(
      new Request('http://localhost/api/cron/reconcile-payments', {
        method: 'POST',
        headers: { 'x-cron-secret': 'test-secret' },
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ reconciled: 0 });
    expect(getCulqiOrderMock).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
