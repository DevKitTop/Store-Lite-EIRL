// =====================================================
// Promotions — server resolver mapping unit tests (T3)
// =====================================================
// The queries are trivial; the wiring is what can silently break:
// owner redemptions, global caps and the new-owner window.
// =====================================================

import { buildPromotionCandidates } from '@/features/promotions/getApplicablePromotion';
import { describe, expect, test, vi } from 'vitest';

// The module imports the db client at top level; the pure builder never uses it.
vi.mock('@/core/database/client', () => ({ db: {} }));

const STARTS_AT = new Date('2026-11-01T00:00:00Z');
const ENDS_AT = new Date('2026-12-31T23:59:59Z');
const NOW = new Date('2026-11-21T12:00:00Z');

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'promo-1',
    code: 'bienvenida-2026',
    name: 'Mes gratis de Lite Pago',
    type: 'free_period' as const,
    planScope: 'lite_pago' as const,
    periodScope: 'any' as const,
    durationDays: 30,
    percentOff: null,
    amountOffCents: null,
    eligibility: 'new_owner' as const,
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    maxRedemptions: null,
    isActive: true,
    createdAt: STARTS_AT,
    updatedAt: STARTS_AT,
    ...overrides,
  };
}

function build(overrides: Record<string, unknown> = {}) {
  return buildPromotionCandidates({
    catalog: [makeRow()],
    firstBusinessCreatedAt: new Date('2026-11-10T12:00:00Z'),
    redeemedPromotionIds: [],
    globalRedemptionCounts: new Map(),
    planType: 'lite_pago',
    period: 'monthly',
    listPriceCents: 3900,
    now: NOW,
    ...overrides,
  });
}

describe('buildPromotionCandidates', () => {
  test('returns the free period as best for a new owner inside the window', () => {
    const result = build();

    expect(result.best).toMatchObject({
      eligible: true,
      promotionId: 'promo-1',
      finalPriceCents: 0,
      grantedDays: 30,
    });
    expect(result.candidates[0]?.evaluation).toMatchObject({ eligible: true });
  });

  test('marks the campaign as already redeemed for that owner', () => {
    const result = build({ redeemedPromotionIds: ['promo-1'] });

    expect(result.best).toBeNull();
    expect(result.candidates[0]?.evaluation).toMatchObject({
      eligible: false,
      reason: 'already_redeemed',
    });
  });

  test('rejects an owner whose first business predates the campaign', () => {
    const result = build({ firstBusinessCreatedAt: new Date('2026-10-15T12:00:00Z') });

    expect(result.best).toBeNull();
    expect(result.candidates[0]?.evaluation).toMatchObject({
      eligible: false,
      reason: 'not_new_owner',
    });
  });

  test('rejects the campaign when the global cap was reached', () => {
    const result = build({
      catalog: [makeRow({ maxRedemptions: 5 })],
      globalRedemptionCounts: new Map([['promo-1', 5]]),
    });

    expect(result.candidates[0]?.evaluation).toMatchObject({
      eligible: false,
      reason: 'max_redemptions_reached',
    });
  });

  test('rejects an inactive campaign', () => {
    const result = build({ catalog: [makeRow({ isActive: false })] });

    expect(result.candidates[0]?.evaluation).toMatchObject({
      eligible: false,
      reason: 'inactive',
    });
  });
});
