// =====================================================
// Promotions — discovery, welcome and reminder rules (T5)
// =====================================================
// S12/S13: the banner only targets the owner while the offer is available;
// the reminder is due exactly five days before the free period ends.
// =====================================================

import {
  buildPromotionSettingsPath,
  isDiscoveryBannerVisible,
  isPromotionReminderDue,
  resolvePromotionOffer,
  type PromotionCandidateLike,
} from '@/features/promotions/discoveryRules';
import { describe, expect, test } from 'vitest';

const SLUG = 'mi-tienda';

describe('isDiscoveryBannerVisible', () => {
  test('shows the banner only to the owner while the offer is available', () => {
    expect(isDiscoveryBannerVisible({ isOwner: true, offerState: 'available' })).toBe(true);
  });

  test('hides the banner from non-owners', () => {
    expect(isDiscoveryBannerVisible({ isOwner: false, offerState: 'available' })).toBe(false);
  });

  test('hides the banner once the offer is active or used', () => {
    expect(isDiscoveryBannerVisible({ isOwner: true, offerState: 'active' })).toBe(false);
    expect(isDiscoveryBannerVisible({ isOwner: true, offerState: 'used' })).toBe(false);
  });
});

describe('isPromotionReminderDue', () => {
  const now = new Date('2026-11-21T12:00:00Z');

  test('is due five days before the end date', () => {
    const planEndDate = new Date('2026-11-26T12:00:00Z');
    expect(isPromotionReminderDue({ planEndDate, now })).toBe(true);
  });

  test('is not due outside the five-day boundary', () => {
    expect(
      isPromotionReminderDue({
        planEndDate: new Date('2026-11-25T12:00:00Z'),
        now,
      }),
    ).toBe(false);
    expect(
      isPromotionReminderDue({
        planEndDate: new Date('2026-11-27T12:00:00Z'),
        now,
      }),
    ).toBe(false);
  });

  test('is not due without an end date', () => {
    expect(isPromotionReminderDue({ planEndDate: null, now })).toBe(false);
  });
});

describe('buildPromotionSettingsPath', () => {
  test('points to Plan y Límites inside Opciones', () => {
    expect(buildPromotionSettingsPath(SLUG)).toBe(`/${SLUG}/settings`);
  });
});

function freeCandidate(overrides: Partial<PromotionCandidateLike> = {}): PromotionCandidateLike {
  return {
    promotion: {
      code: 'BIENVENIDA30',
      name: 'Mes gratis de Lite Pago',
      type: 'free_period',
      durationDays: 30,
    },
    evaluation: { eligible: true },
    ...overrides,
  };
}

describe('resolvePromotionOffer', () => {
  const now = new Date('2026-11-21T12:00:00Z');

  test('returns an available offer for an eligible owner', () => {
    expect(
      resolvePromotionOffer({
        candidates: [freeCandidate()],
        plan: 'lite',
        isActive: true,
        planEndDate: null,
        now,
      }),
    ).toMatchObject({ state: 'available', durationDays: 30, daysRemaining: null });
  });

  test('returns an active offer after redemption while Lite Pago is current', () => {
    expect(
      resolvePromotionOffer({
        candidates: [
          freeCandidate({ evaluation: { eligible: false, reason: 'already_redeemed' } }),
        ],
        plan: 'lite_pago',
        isActive: true,
        planEndDate: '2026-12-21T12:00:00Z',
        now,
      }),
    ).toMatchObject({
      state: 'active',
      planEndDate: '2026-12-21T12:00:00.000Z',
      daysRemaining: 30,
    });
  });

  test('returns a used offer after the granted period ended', () => {
    expect(
      resolvePromotionOffer({
        candidates: [
          freeCandidate({ evaluation: { eligible: false, reason: 'already_redeemed' } }),
        ],
        plan: 'lite',
        isActive: true,
        planEndDate: null,
        now,
      }),
    ).toMatchObject({ state: 'used', planEndDate: null, daysRemaining: null });
  });

  test('hides the offer when Lite Plus is active', () => {
    expect(
      resolvePromotionOffer({
        candidates: [freeCandidate()],
        plan: 'lite_plus',
        isActive: true,
        planEndDate: '2026-12-21T12:00:00Z',
        now,
      }),
    ).toBeNull();
  });

  test('returns null when there is no free-period campaign', () => {
    expect(
      resolvePromotionOffer({
        candidates: [],
        plan: 'lite',
        isActive: true,
        planEndDate: null,
        now,
      }),
    ).toBeNull();
  });
});
