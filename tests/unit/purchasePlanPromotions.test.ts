import { POST } from '@/app/api/billing/purchase-plan/route';
import type { EligiblePromotionEvaluation, PromotionDefinition } from '@/features/promotions/types';
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
  mockGetPromotionCandidates,
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
  const mockTransaction = vi.fn((callback) =>
    callback({
      insert: mockInsert,
      query: {
        businessSubscriptions: { findFirst: mockSubscriptionFindFirst },
      },
    }),
  );
  const mockGetPromotionCandidates = vi.fn();

  return {
    mockSaasIssuerFindFirst,
    mockSubscriptionFindFirst,
    mockPlanPaymentReturning,
    mockRedemptionReturning,
    mockOnConflictDoUpdate,
    mockValues,
    mockInsert,
    mockTransaction,
    mockGetPromotionCandidates,
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

vi.mock('@/core/database/client', () => ({
  db: {
    insert: mockInsert,
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

    const planPaymentValues = mockValues.mock.calls[0][0];
    expect(planPaymentValues.amountTotal).toBe('27.3');
    expect((planPaymentValues.metadata as Record<string, unknown>).promotionCode).toBe('SAVE30');

    const redemptionValues = mockValues.mock.calls[2][0];
    expect(redemptionValues).toMatchObject({
      promotionId: 'promo-30',
      businessId: 'biz_123',
      ownerId: 'test-user-id',
      planPaymentId: 'payment_001',
      originalAmountCents: 3900,
      discountAmountCents: 1170,
      finalAmountCents: 2730,
      status: 'consumed',
    });
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
});
