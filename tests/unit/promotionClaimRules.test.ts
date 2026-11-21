// =====================================================
// Promotions — claim rules unit tests (T3)
// =====================================================

import { isNewOwnerForCampaign, resolveFreePeriodWindow } from '@/features/promotions';
import { describe, expect, test } from 'vitest';

describe('isNewOwnerForCampaign', () => {
  const startsAt = new Date('2026-11-01T00:00:00Z');
  const endsAt = new Date('2026-12-01T00:00:00Z');

  test('accepts a first business created inside the campaign window', () => {
    expect(
      isNewOwnerForCampaign({
        firstBusinessCreatedAt: new Date('2026-11-10T12:00:00Z'),
        startsAt,
        endsAt,
      }),
    ).toBe(true);
  });

  test('rejects a business created before the campaign started', () => {
    expect(
      isNewOwnerForCampaign({
        firstBusinessCreatedAt: new Date('2026-10-31T23:59:59Z'),
        startsAt,
        endsAt,
      }),
    ).toBe(false);
  });

  test('rejects a business created after the campaign ended', () => {
    expect(
      isNewOwnerForCampaign({
        firstBusinessCreatedAt: new Date('2026-12-01T00:00:00Z'),
        startsAt,
        endsAt,
      }),
    ).toBe(false);
  });

  test('accepts any creation after the start when the campaign has no end', () => {
    expect(
      isNewOwnerForCampaign({
        firstBusinessCreatedAt: new Date('2030-01-01T00:00:00Z'),
        startsAt,
        endsAt: null,
      }),
    ).toBe(true);
  });

  test('rejects when the owner has no business', () => {
    expect(isNewOwnerForCampaign({ firstBusinessCreatedAt: null, startsAt, endsAt })).toBe(false);
  });
});

describe('resolveFreePeriodWindow', () => {
  const now = new Date('2026-11-21T12:00:00Z');

  test('starts now and lasts the configured days for a lite business', () => {
    const result = resolveFreePeriodWindow({
      now,
      durationDays: 30,
      currentPlanType: 'lite',
      currentPlanEndDate: null,
    });

    expect(result.planStartDate).toEqual(now);
    expect(result.planEndDate).toEqual(new Date('2026-12-21T12:00:00Z'));
  });

  test('never shortens a paid period that is still running', () => {
    const result = resolveFreePeriodWindow({
      now,
      durationDays: 30,
      currentPlanType: 'lite_pago',
      currentPlanEndDate: new Date('2027-01-10T12:00:00Z'),
    });

    expect(result.planStartDate).toEqual(now);
    expect(result.planEndDate).toEqual(new Date('2027-02-09T12:00:00Z'));
  });

  test('starts from now when the paid period already expired', () => {
    const result = resolveFreePeriodWindow({
      now,
      durationDays: 30,
      currentPlanType: 'lite_pago',
      currentPlanEndDate: new Date('2026-11-01T12:00:00Z'),
    });

    expect(result.planEndDate).toEqual(new Date('2026-12-21T12:00:00Z'));
  });

  test('does not extend a lite_plus period (claim is blocked upstream)', () => {
    const result = resolveFreePeriodWindow({
      now,
      durationDays: 30,
      currentPlanType: 'lite_plus',
      currentPlanEndDate: new Date('2027-06-01T12:00:00Z'),
    });

    expect(result.planEndDate).toEqual(new Date('2026-12-21T12:00:00Z'));
  });
});
