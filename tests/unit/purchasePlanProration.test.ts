// =====================================================
// POST /api/billing/purchase-plan — Proration tests
// =====================================================
// Verifies SCD-003: plan date calculation with prorating
// for renewals, upgrades, downgrades, and first purchase.
// =====================================================

import { POST } from '@/app/api/billing/purchase-plan/route';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────

const {
  mockSaasIssuerFindFirst,
  mockSubscriptionFindFirst,
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
    mockSubscriptionFindFirst,
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

// Fixed reference date for all proration tests
const REFERENCE_DATE = new Date('2026-06-15T12:00:00Z');

// ── Suite ────────────────────────────────────────────

describe('POST /api/billing/purchase-plan — proration', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(REFERENCE_DATE);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    // Default — Culqi succeeds
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'charge_abc123',
        outcome: { type: 'venta_exitosa', user_message: '', merchant_message: '' },
        reference_code: 'ref_xyz',
      }),
    });

    // Default — SaaS issuer exists
    mockSaasIssuerFindFirst.mockResolvedValue({
      id: 'issuer_1',
      businessName: 'Store Lite',
      documentType: 'RUC',
      documentNumber: '20123456789',
    });

    // Default — insert returns a payment
    mockReturning.mockResolvedValue([
      {
        id: 'payment_001',
        ticketSeries: 'B001',
        ticketCorrelative: 1,
      },
    ]);

    // Default — upsert succeeds
    mockOnConflict.mockResolvedValue(undefined);

    vi.stubEnv('CULQI_SK', 'sk_test_culqi_key');
  });

  // ============================================================
  // SCD-003 Scenario: Renew same plan (monthly)
  // ============================================================

  test('renewing the same plan extends from current planEndDate (monthly)', async () => {
    // Current subscription: lite_pago, ends 2026-07-15
    mockSubscriptionFindFirst.mockResolvedValue({
      planType: 'lite_pago',
      planEndDate: new Date('2026-07-15T00:00:00Z'),
      planStartDate: new Date('2026-01-01T00:00:00Z'),
    });

    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload({ planType: 'lite_pago', period: 'monthly' })),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    // Should be extended from 2026-07-15 + 30 days = 2026-08-14
    const activatedUntil = new Date(body.planActivatedUntil);
    expect(activatedUntil.toISOString()).toBe('2026-08-14T00:00:00.000Z');
  });

  // ============================================================
  // SCD-003 Scenario: Renew same plan (annual)
  // ============================================================

  test('renewing the same plan extends from current planEndDate (annual)', async () => {
    mockSubscriptionFindFirst.mockResolvedValue({
      planType: 'lite_pago',
      planEndDate: new Date('2026-09-01T00:00:00Z'),
      planStartDate: new Date('2026-03-01T00:00:00Z'),
    });

    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload({ planType: 'lite_pago', period: 'annual' })),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    // 2026-09-01 + 365 = 2027-09-01
    expect(body.planActivatedUntil).toBe('2027-09-01T00:00:00.000Z');
  });

  // ============================================================
  // SCD-003 Scenario: Upgrade / downgrade to different plan
  // ============================================================

  test('upgrading to a different plan resets dates from today', async () => {
    // Current subscription: lite_pago, ends 2026-08-15
    mockSubscriptionFindFirst.mockResolvedValue({
      planType: 'lite_pago',
      planEndDate: new Date('2026-08-15T00:00:00Z'),
      planStartDate: new Date('2026-01-01T00:00:00Z'),
    });

    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload({ planType: 'lite_plus', period: 'monthly' })),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    // Today (2026-06-15) + 30 = 2026-07-15
    expect(body.planActivatedUntil).toBe('2026-07-15T12:00:00.000Z');
  });

  // ============================================================
  // SCD-003 Scenario: First purchase (no previous subscription)
  // ============================================================

  test('first purchase without previous subscription starts from today', async () => {
    // No previous subscription
    mockSubscriptionFindFirst.mockResolvedValue(null);

    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload({ planType: 'lite_pago', period: 'monthly' })),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    // Today (2026-06-15) + 30 = 2026-07-15
    expect(body.planActivatedUntil).toBe('2026-07-15T12:00:00.000Z');
  });

  // ============================================================
  // SCD-003: Previous subscription expired before renewal
  // ============================================================

  test('renewing when current plan is expired starts from today', async () => {
    // Current subscription exists but is expired
    mockSubscriptionFindFirst.mockResolvedValue({
      planType: 'lite_pago',
      planEndDate: new Date('2026-01-01T00:00:00Z'), // expired
      planStartDate: new Date('2025-06-01T00:00:00Z'),
    });

    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload({ planType: 'lite_pago', period: 'monthly' })),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    // Expired → starts from today (2026-06-15) + 30 = 2026-07-15
    expect(body.planActivatedUntil).toBe('2026-07-15T12:00:00.000Z');
  });

  // ============================================================
  // Transaction wrapping
  // ============================================================

  test('wraps subscription read + write in a DB transaction', async () => {
    mockSubscriptionFindFirst.mockResolvedValue(null);

    const request = new Request('http://localhost/api/billing/purchase-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createValidPayload()),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    // transaction should have been called
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // The callback receives a tx object
    expect(typeof mockTransaction.mock.calls[0][0]).toBe('function');
  });
});
