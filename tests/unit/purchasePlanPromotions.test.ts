import { POST } from '@/app/api/billing/purchase-plan/route';
import type { EligiblePromotionEvaluation, PromotionDefinition } from '@/features/promotions/types';
import { AnalyticsEvents } from '@/lib/analytics/taxonomy';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockSaasIssuerFindFirst,
  mockSubscriptionFindFirst,
  mockPlanPaymentReturning,
  mockRedemptionReturning,
  mockOnConflictDoUpdate,
  mockValues,
  mockInsert,
  mockTransaction,
  mockUpdateReturning,
  mockUpdateSet,
  mockDeleteWhere,
  mockDelete,
  mockGetPromotionCandidates,
  mockCaptureEvent,
} = vi.hoisted(() => {
  const mockSaasIssuerFindFirst = vi.fn();
  const mockSubscriptionFindFirst = vi.fn();
  const mockPlanPaymentReturning = vi.fn();
  const mockRedemptionReturning = vi.fn();
  const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const mockOnConflictDoNothing = vi.fn(() => ({ returning: mockRedemptionReturning }));
  const mockValues = vi.fn((_values: Record<string, unknown>) => ({
    returning: mockPlanPaymentReturning,
    onConflictDoUpdate: mockOnConflictDoUpdate,
    onConflictDoNothing: mockOnConflictDoNothing,
  }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  const mockUpdateReturning = vi.fn();
  const mockUpdateWhere = vi.fn(() => ({ returning: mockUpdateReturning }));
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));
  const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
  const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }));
  const mockTransaction = vi.fn((callback) =>
    callback({
      insert: mockInsert,
      update: mockUpdate,
      query: {
        businessSubscriptions: { findFirst: mockSubscriptionFindFirst },
      },
    }),
  );
  const mockGetPromotionCandidates = vi.fn();
  const mockCaptureEvent = vi.fn().mockResolvedValue(undefined);

  return {
    mockSaasIssuerFindFirst,
    mockSubscriptionFindFirst,
    mockPlanPaymentReturning,
    mockRedemptionReturning,
    mockOnConflictDoUpdate,
    mockValues,
    mockInsert,
    mockTransaction,
    mockUpdateReturning,
    mockUpdateSet,
    mockDeleteWhere,
    mockDelete,
    mockGetPromotionCandidates,
    mockCaptureEvent,
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'test-user-id' } }, error: null }),
    },
  })),
}));

vi.mock('@/features/storage/actions/authz', () => ({
  requireOwnedBusinessById: vi.fn(async () => ({
    businessId: 'biz_123',
    ownerId: 'test-user-id',
    slug: 'test-business',
  })),
}));

vi.mock('@/features/promotions/getApplicablePromotion', () => ({
  getPromotionCandidates: mockGetPromotionCandidates,
}));

vi.mock('@/lib/analytics/capture', () => ({
  captureEvent: mockCaptureEvent,
}));

vi.mock('@/core/database/client', () => ({
  db: {
    insert: mockInsert,
    delete: mockDelete,
    transaction: mockTransaction,
    query: {
      saasIssuerConfig: { findFirst: mockSaasIssuerFindFirst },
    },
  },
}));

const mockFetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
globalThis.fetch = mockFetch as unknown as typeof fetch;

function promotionDefinition(overrides: Partial<PromotionDefinition> = {}): PromotionDefinition {
  return {
    id: 'promo-30',
    code: 'SAVE30',
    type: 'percent_off',
    planScope: 'lite_pago',
    periodScope: 'monthly',
    durationDays: null,
    percentOff: 30,
    amountOffCents: null,
    eligibility: 'code',
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    endsAt: null,
    maxRedemptions: null,
    isActive: true,
    ...overrides,
  };
}

function eligiblePromotion(
  overrides: Partial<EligiblePromotionEvaluation> = {},
): EligiblePromotionEvaluation {
  return {
    eligible: true,
    promotionId: 'promo-30',
    code: 'SAVE30',
    type: 'percent_off',
    discountCents: 1170,
    finalPriceCents: 2730,
    grantedDays: null,
    ...overrides,
  };
}

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    token: 'ype_test_token_123',
    planType: 'lite_pago',
    period: 'monthly',
    businessId: 'biz_123',
    buyerEmail: 'test@example.com',
    buyerFullName: 'Test User',
    buyerDocumentType: 'DNI',
    buyerDocumentNumber: '12345678',
    ...overrides,
  };
}

function post(overrides: Record<string, unknown> = {}) {
  return new Request('http://localhost/api/billing/purchase-plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createPayload(overrides)),
  });
}

function parseChargePayload(): { amount: number; metadata: Record<string, unknown> } {
  const firstCall = mockFetch.mock.calls[0];
  return JSON.parse(String(firstCall?.[1]?.body)) as {
    amount: number;
    metadata: Record<string, unknown>;
  };
}

describe('purchase-plan promotion wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'charge_abc123',
        outcome: { type: 'venta_exitosa', user_message: '', merchant_message: '' },
        reference_code: 'ref_xyz',
      }),
    } as unknown as Response);

    mockSaasIssuerFindFirst.mockResolvedValue({
      ruc: '10741399852',
      razonSocial: 'TEST ISSUER',
      direccion: 'TEST ADDRESS',
      distrito: 'YURA',
      provincia: 'AREQUIPA',
      departamento: 'AREQUIPA',
    });

    mockSubscriptionFindFirst.mockResolvedValue(null);
    mockPlanPaymentReturning.mockResolvedValue([
      { id: 'payment_001', ticketSeries: 'B001', ticketCorrelative: 42 },
    ]);
    mockOnConflictDoUpdate.mockResolvedValue(undefined);
    mockRedemptionReturning.mockResolvedValue([{ id: 'redemption_001' }]);
    mockUpdateReturning.mockResolvedValue([{ id: 'redemption_001' }]);
    mockGetPromotionCandidates.mockResolvedValue({ best: null, candidates: [] });

    vi.stubEnv('CULQI_SK', 'sk_test_culqi_key');
  });

  test('charges the server-evaluated final amount and records the redemption in the payment transaction', async () => {
    const evaluation = eligiblePromotion();
    mockGetPromotionCandidates.mockResolvedValue({
      best: evaluation,
      candidates: [{ promotion: promotionDefinition(), evaluation }],
    });

    const response = await POST(post({ promotionCode: 'SAVE30' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.amountTotal).toBe(27.3);

    const chargePayload = parseChargePayload();
    expect(chargePayload.amount).toBe(2730);
    expect(chargePayload.metadata.promotionCode).toBe('SAVE30');

    expect(mockGetPromotionCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'test-user-id',
        planType: 'lite_pago',
        period: 'monthly',
        listPriceCents: 3900,
        providedCode: 'SAVE30',
      }),
    );

    const reservationValues = mockValues.mock.calls[0][0];
    expect(reservationValues).toMatchObject({
      promotionId: 'promo-30',
      businessId: 'biz_123',
      ownerId: 'test-user-id',
      planPaymentId: null,
      originalAmountCents: 3900,
      discountAmountCents: 1170,
      finalAmountCents: 2730,
      status: 'granted',
    });

    const planPaymentValues = mockValues.mock.calls[1][0];
    expect(planPaymentValues.amountTotal).toBe('27.3');
    expect((planPaymentValues.metadata as Record<string, unknown>).promotionCode).toBe('SAVE30');

    expect(mockUpdateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        planPaymentId: 'payment_001',
        status: 'consumed',
      }),
    );
  });

  test('reserves the promotion before contacting Culqi and rejects conflicts without charging', async () => {
    const evaluation = eligiblePromotion();
    mockGetPromotionCandidates.mockResolvedValue({
      best: evaluation,
      candidates: [{ promotion: promotionDefinition(), evaluation }],
    });
    mockRedemptionReturning.mockResolvedValue([]);

    const response = await POST(post({ promotionCode: 'SAVE30' }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain('promoción ya fue utilizada');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledTimes(1);
    expect(mockValues.mock.calls[0][0]).toMatchObject({
      status: 'granted',
      planPaymentId: null,
    });
  });

  test('releases the promotion reservation when Culqi declines the charge', async () => {
    const evaluation = eligiblePromotion();
    mockGetPromotionCandidates.mockResolvedValue({
      best: evaluation,
      candidates: [{ promotion: promotionDefinition(), evaluation }],
    });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 402,
      json: async () => ({ user_message: 'Pago declinado' }),
    } as unknown as Response);

    const response = await POST(post({ promotionCode: 'SAVE30' }));

    expect(response.status).toBe(402);
    expect(mockDeleteWhere).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  test('captures plan purchase and promotion analytics events without storing buyer PII', async () => {
    const evaluation = eligiblePromotion();
    mockGetPromotionCandidates.mockResolvedValue({
      best: evaluation,
      candidates: [{ promotion: promotionDefinition(), evaluation }],
    });

    const response = await POST(post({ promotionCode: 'SAVE30' }));

    expect(response.status).toBe(200);
    expect(mockCaptureEvent).toHaveBeenCalledWith(
      AnalyticsEvents.PLAN_PURCHASE_STARTED,
      expect.objectContaining({
        plan: 'lite_pago',
        period: 'monthly',
        business_id: 'biz_123',
        promotion_code: 'SAVE30',
      }),
    );
    expect(mockCaptureEvent).toHaveBeenCalledWith(
      AnalyticsEvents.PROMOTION_APPLIED,
      expect.objectContaining({
        promotion_code: 'SAVE30',
        discount_cents: 1170,
        final_amount_cents: 2730,
      }),
    );
    expect(mockCaptureEvent).toHaveBeenCalledWith(
      AnalyticsEvents.PLAN_PURCHASED,
      expect.objectContaining({
        plan: 'lite_pago',
        period: 'monthly',
        business_id: 'biz_123',
        amount_total_cents: 2730,
      }),
    );

    const serializedCalls = JSON.stringify(mockCaptureEvent.mock.calls);
    expect(serializedCalls).not.toContain('test@example.com');
    expect(serializedCalls).not.toContain('Test User');
    expect(serializedCalls).not.toContain('12345678');
  });

  test('ignores untrusted client amounts and charges the authoritative list price', async () => {
    const response = await POST(
      post({
        amountTotal: 1,
        discountCents: 3900,
        promotion: { code: 'SAVE30', finalAmountCents: 1 },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.amountTotal).toBe(39);

    const chargePayload = parseChargePayload();
    expect(chargePayload.amount).toBe(3900);

    const subscriptionValues = mockValues.mock.calls[1][0];
    expect(subscriptionValues).not.toHaveProperty('promotionId');
  });

  test('rejects an invalid promotion code before contacting Culqi', async () => {
    const response = await POST(post({ promotionCode: 'WRONG' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Código de descuento');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockValues).not.toHaveBeenCalled();
  });

  test('rejects an explicit code that does not match an auto-applicable campaign', async () => {
    const evaluation = eligiblePromotion({ code: 'AUTO10', promotionId: 'promo-auto' });
    mockGetPromotionCandidates.mockResolvedValue({
      best: evaluation,
      candidates: [
        {
          promotion: promotionDefinition({
            id: 'promo-auto',
            code: 'AUTO10',
            eligibility: 'all_users',
          }),
          evaluation,
        },
      ],
    });

    const response = await POST(post({ promotionCode: 'BOGUS' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Código de descuento');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockValues).not.toHaveBeenCalled();
  });
});
