// =====================================================
// POST /api/billing/purchase-plan — Unit tests
// =====================================================
// Verifies that the route handler correctly omits
// ticketCorrelative from insert values so the DB
// default (sequence) fills it automatically.
// =====================================================

import { POST } from '@/app/api/billing/purchase-plan/route';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────
// Must be before module imports (vi.mock is hoisted)

const {
  mockSaasIssuerFindFirst,
  mockReturning,
  mockOnConflict,
  mockValues,
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

  // db.transaction executes the callback with a tx that delegates
  // to the same mocks — existing tests still work because
  // mockSubscriptionFindFirst returns null by default.
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
    query: {
      saasIssuerConfig: { findFirst: mockSaasIssuerFindFirst },
    },
  },
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// ── Shared helpers ───────────────────────────────────

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

// ── Suite ────────────────────────────────────────────

describe('POST /api/billing/purchase-plan', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Default mock setup — Culqi charge succeeds
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'charge_abc123',
        outcome: { type: 'venta_exitosa', user_message: '', merchant_message: '' },
        reference_code: 'ref_xyz',
      }),
    });

    // Default mock setup — SaaS issuer exists
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

    // Default mock setup — DB insert returns a payment
    mockReturning.mockResolvedValue([
      {
        id: 'payment_001',
        ticketSeries: 'B001',
        ticketCorrelative: 42,
      },
    ]);

    // Default mock setup — subscription upsert succeeds
    mockOnConflict.mockResolvedValue(undefined);

    vi.stubEnv('CULQI_SK', 'sk_test_culqi_key');
  });

  // ============================================================
  // RED-GREEN CORE: ticketCorrelative must not be passed to DB
  // ============================================================

  test('omits ticketCorrelative from insert values — DB default fills it', async () => {
    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload()),
    });

    const response = await POST(request);
    const body = await response.json();

    // Endpoint returns 200
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    // The values passed to the first insert (planPayments)
    // must NOT contain ticketCorrelative — the DB default
    // (nextval of seq_plan_payment_b001) fills it.
    const planPaymentValues = mockValues.mock.calls[0][0];
    expect(planPaymentValues).not.toHaveProperty('ticketCorrelative');
  });

  test('returns issuer fiscal data in the response for the client ticket', async () => {
    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload()),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.issuer).toEqual({
      ruc: '10741399852',
      name: 'MAMANI TACORA ERNESTO ALONSO',
      address: 'ASC. CIUDAD DE DIOS ZN. 4 COM',
      district: 'YURA',
      province: 'AREQUIPA',
      department: 'AREQUIPA',
    });
  });

  test('sends buyer identity in antifraud_details of the Culqi charge', async () => {
    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload({ buyerFullName: 'Maria Fernanda Quispe' })),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    // Inspeccionar el body enviado a Culqi
    const culqiFetchCall = mockFetch.mock.calls[0];
    const culqiBody = JSON.parse(culqiFetchCall[1].body as string);
    expect(culqiBody.antifraud_details).toMatchObject({
      email: 'test@example.com',
      first_name: 'Maria',
      last_name: 'Fernanda Quispe',
    });
  });

  // ============================================================
  // EDGE CASES
  // ============================================================

  test('returns 400 for invalid plan type', async () => {
    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload({ planType: 'nonexistent' })),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('returns 400 for free plan (lite)', async () => {
    const { POST } = await import('@/app/api/billing/purchase-plan/route');
    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload({ planType: 'lite' })),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('returns 500 when saas issuer config is missing', async () => {
    mockSaasIssuerFindFirst.mockResolvedValue(null);

    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload()),
    });

    const response = await POST(request);
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('returns 400 when missing required fields', async () => {
    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body).toHaveProperty('error');
  });

  test('returns ticketNumber computed from returned correlative', async () => {
    mockReturning.mockResolvedValue([
      {
        id: 'payment_001',
        ticketSeries: 'B001',
        ticketCorrelative: 1,
      },
    ]);

    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload()),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty('ticketNumber');
    expect(body.ticketNumber).toMatch(/^B001-/);
  });
});
