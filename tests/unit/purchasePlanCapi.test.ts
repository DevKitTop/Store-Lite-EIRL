// =====================================================
// POST /api/billing/purchase-plan — Meta CAPI wiring
// =====================================================
// Verifies the fire-and-forget CAPI Purchase integration:
//  - consent accepted    → response carries eventId AND fireEvent fires
//  - consent declined/pending → no eventId, no CAPI event
//  - fireEvent throwing  → never alters the purchase response
// Pattern: static route import + vi.mock (see purchasePlan.test.ts).

import { POST } from '@/app/api/billing/purchase-plan/route';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks (before module imports — vi.mock is hoisted) ────────────────

const {
  mockSaasIssuerFindFirst,
  mockReturning,
  mockOnConflict,
  mockInsert,
  mockTransaction,
  mockGetPromotionCandidates,
} = vi.hoisted(() => {
  const mockSaasIssuerFindFirst = vi.fn();
  const mockSubscriptionFindFirst = vi.fn();
  const mockReturning = vi.fn();
  const mockOnConflict = vi.fn();
  const mockValues = vi.fn(() => ({
    returning: mockReturning,
    onConflictDoUpdate: mockOnConflict,
  }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  const mockGetPromotionCandidates = vi.fn(async () => ({ best: null, candidates: [] }));
  const mockTransaction = vi.fn((callback) =>
    callback({
      insert: mockInsert,
      query: {
        businessSubscriptions: { findFirst: mockSubscriptionFindFirst },
        saasIssuerConfig: { findFirst: mockSaasIssuerFindFirst },
      },
    }),
  );

  return {
    mockSaasIssuerFindFirst,
    mockReturning,
    mockOnConflict,
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
  // original-impl form so restoreMocks keeps this resolved value across tests
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
    query: { saasIssuerConfig: { findFirst: mockSaasIssuerFindFirst } },
  },
}));

const mockGetConsentState = vi.fn();
vi.mock('@/lib/consent/consentServer', () => ({
  getConsentState: (...args: unknown[]) => mockGetConsentState(...args),
}));

const mockFireEvent = vi.fn();
vi.mock('@/lib/meta/capi', () => ({
  fireEvent: (...args: unknown[]) => mockFireEvent(...args),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// ── Helpers ────────────────────────────────────────────────────────────

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createValidPayload(overrides: Record<string, unknown> = {}) {
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

// ── Suite ──────────────────────────────────────────────────────────────

describe('purchase-plan → Meta CAPI wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'charge_abc123',
        outcome: { type: 'venta_exitosa', user_message: '', merchant_message: '' },
        reference_code: 'ref_xyz',
      }),
    });

    mockSaasIssuerFindFirst.mockResolvedValue({
      id: 1,
      ruc: '10741399852',
      razonSocial: 'MAMANI TACORA ERNESTO ALONSO',
      direccion: 'ASC. CIUDAD DE DIOS ZN. 4 COM',
      distrito: 'YURA',
      provincia: 'AREQUIPA',
      departamento: 'AREQUIPA',
      ubigeo: '040128',
      igvRate: '0.18',
    });

    mockReturning.mockResolvedValue([
      { id: 'payment_001', ticketSeries: 'B001', ticketCorrelative: 42 },
    ]);
    mockOnConflict.mockResolvedValue(undefined);
    mockGetConsentState.mockResolvedValue('accepted');

    vi.stubEnv('CULQI_SK', 'sk_test_culqi_key');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('returns eventId and fires CAPI Purchase when consent is accepted', async () => {
    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload()),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.eventId).toMatch(UUID_V4_RE);
    expect(mockFireEvent).toHaveBeenCalledTimes(1);
    expect(mockFireEvent).toHaveBeenCalledWith(
      'Purchase',
      expect.objectContaining({
        eventId: body.eventId,
        email: 'test@example.com',
        fullName: 'Test User',
        eventSourceUrl: '/pricing',
        externalId: 'test-user-id',
        customData: expect.objectContaining({
          value: body.amountTotal,
          currency: 'PEN',
          plan_type: 'lite_pago',
          period: 'monthly',
        }),
      }),
    );
  });

  test('passes request-derived context (ip, ua, fbp/fbc, fbclid) to fireEvent', async () => {
    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // eslint-disable-next-line sonarjs/no-hardcoded-ip -- test fixture address, not production infra
        'x-forwarded-for': '190.1.2.3',
        'user-agent': 'test-agent',
        referer: 'https://store-lite.com/pricing?fbclid=CLICK9',
        cookie: '_fbp=fb.1.1.111; _fbc=fb.1.2.222',
      },
      body: JSON.stringify(createValidPayload()),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(mockFireEvent).toHaveBeenCalledWith(
      'Purchase',
      expect.objectContaining({
        eventSourceUrl: 'https://store-lite.com/pricing?fbclid=CLICK9',
        // eslint-disable-next-line sonarjs/no-hardcoded-ip -- test fixture address, not production infra
        clientIpAddress: '190.1.2.3',
        clientUserAgent: 'test-agent',
        fbp: 'fb.1.1.111',
        fbc: 'fb.1.2.222',
        fbclid: 'CLICK9',
      }),
    );
  });

  test('does not fire CAPI and omits eventId when consent is declined', async () => {
    mockGetConsentState.mockResolvedValue('declined');
    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload()),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty('eventId');
    expect(mockFireEvent).not.toHaveBeenCalled();
  });

  test('does not fire CAPI while consent is pending', async () => {
    mockGetConsentState.mockResolvedValue('pending');
    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload()),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty('eventId');
    expect(mockFireEvent).not.toHaveBeenCalled();
  });

  test('returns the purchase response without awaiting the CAPI send', async () => {
    // fireEvent NEVER throws and never rejects (capi.ts swallows internally);
    // the only realistic failure is a slow CAPI request. Hold the mock's
    // promise unresolved: if the route awaited it, POST could not return.
    let releaseCapi = () => {};
    const capiInFlight = new Promise<void>((resolve) => {
      releaseCapi = resolve;
    });
    mockFireEvent.mockReturnValue(capiInFlight);

    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload()),
    });

    const response = await POST(request);
    const body = await response.json();

    // Response arrives while the CAPI send is still in flight → not awaited.
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.planPaymentId).toBe('payment_001');
    expect(mockFireEvent).toHaveBeenCalledTimes(1);

    await releaseCapi(); // resolve the in-flight promise to clean up
  });
});
