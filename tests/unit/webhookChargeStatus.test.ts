// =====================================================
// Webhook charge.paid / charge.failed — idempotent upsert (W-P3.1)
// =====================================================
// Before W-P3.1 these events ran an UPDATE keyed on `culqiChargeId`. If the
// webhook out-raced the charge route's insert, the UPDATE matched zero rows and
// the payment confirmation was lost. These tests lock in the upsert behaviour:
// update when the row exists, insert (with on-conflict update) otherwise, and a
// safe update-only fallback when a complete row cannot be built.

import { POST } from '@/app/api/webhooks/culqi/route';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockUpdate,
  mockSet,
  mockWhere,
  mockPaymentsFindFirst,
  mockBusinessesFindFirst,
  mockInsert,
  mockValues,
  mockOnConflictDoUpdate,
} = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
  mockWhere: vi.fn(),
  mockPaymentsFindFirst: vi.fn(),
  mockBusinessesFindFirst: vi.fn(),
  mockInsert: vi.fn(),
  mockValues: vi.fn(),
  mockOnConflictDoUpdate: vi.fn(),
}));

vi.mock('@/core/database/client', () => ({
  db: {
    update: mockUpdate,
    insert: mockInsert,
    query: {
      payments: { findFirst: mockPaymentsFindFirst },
      businesses: { findFirst: mockBusinessesFindFirst },
    },
  },
}));

vi.mock('@/core/utils/trackingToken', () => ({
  generateTrackingToken: () => 'tt_webhook_fixed',
}));

vi.mock('@/core/payments/orderNumber', () => ({
  resolveOrderNumber: () => 'ORD-WEBHOOK01',
}));

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
      id: 'chr_abc123',
      amount: 150000,
      currency_code: 'PEN',
      email: 'buyer@test.com',
      reference_code: 'ref_xyz',
      metadata: {
        businessId: '550e8400-e29b-41d4-a716-446655440000',
        productId: '660e8400-e29b-41d4-a716-446655440001',
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

// ── Suite ────────────────────────────────────────────

describe('POST /api/webhooks/culqi — charge.paid / charge.failed (W-P3.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhere });
    mockWhere.mockResolvedValue(undefined);

    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
    mockOnConflictDoUpdate.mockResolvedValue(undefined);

    // Default: no existing row, owner resolvable.
    mockPaymentsFindFirst.mockResolvedValue(undefined);
    mockBusinessesFindFirst.mockResolvedValue({ ownerId: '770e8400-e29b-41d4-a716-446655440002' });

    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CULQI_WEBHOOK_SECRET', '');
  });

  test('updates an existing payment row and does not insert', async () => {
    mockPaymentsFindFirst.mockResolvedValue({ id: 'payment-1' });

    const response = await POST(createWebhookRequest(createChargeEvent('charge.paid')));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid' }));
    expect(mockInsert).not.toHaveBeenCalled();
    // The owner lookup is only needed when inserting.
    expect(mockBusinessesFindFirst).not.toHaveBeenCalled();
  });

  test('inserts a complete row and upserts on conflict when the row is missing', async () => {
    mockPaymentsFindFirst.mockResolvedValue(undefined);

    const response = await POST(createWebhookRequest(createChargeEvent('charge.paid')));

    expect(response.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: '550e8400-e29b-41d4-a716-446655440000',
        productId: '660e8400-e29b-41d4-a716-446655440001',
        sellerUserId: '770e8400-e29b-41d4-a716-446655440002',
        amount: '1500',
        currency: 'PEN',
        culqiChargeId: 'chr_abc123',
        buyerEmail: 'buyer@test.com',
        orderNumber: 'ORD-WEBHOOK01',
        trackingToken: 'tt_webhook_fixed',
        status: 'paid',
      }),
    );
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: expect.objectContaining({ status: 'paid' }) }),
    );
  });

  test('inserts with status failed on charge.failed', async () => {
    mockPaymentsFindFirst.mockResolvedValue(undefined);

    await POST(createWebhookRequest(createChargeEvent('charge.failed')));

    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  test('falls back to update-only and warns when the owner cannot be resolved', async () => {
    mockPaymentsFindFirst.mockResolvedValue(undefined);
    mockBusinessesFindFirst.mockResolvedValue(null);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await POST(createWebhookRequest(createChargeEvent('charge.paid')));

    expect(response.status).toBe(200);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid' }));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Cannot upsert payment'));

    warnSpy.mockRestore();
  });

  test('falls back to update-only when the payload has no business metadata', async () => {
    mockPaymentsFindFirst.mockResolvedValue(undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const response = await POST(
      createWebhookRequest(createChargeEvent('charge.paid', { metadata: {} })),
    );

    expect(response.status).toBe(200);
    expect(mockInsert).not.toHaveBeenCalled();
    // businessId is missing ⇒ no point querying businesses.
    expect(mockBusinessesFindFirst).not.toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'paid' }));
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test("a duplicate delivery is ack'd without a second write", async () => {
    const event = createChargeEvent('charge.paid');
    mockPaymentsFindFirst.mockResolvedValue({ id: 'payment-1' });

    const first = await POST(createWebhookRequest(event));
    expect((await first.json()).received).toBe(true);

    const second = await POST(createWebhookRequest(event));
    const secondBody = await second.json();
    expect(secondBody).toEqual({ received: true, duplicate: true });
    // Only the first delivery ran the update.
    expect(mockSet).toHaveBeenCalledTimes(1);
  });
});
