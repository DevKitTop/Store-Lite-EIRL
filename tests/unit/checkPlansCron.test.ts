// =====================================================
// Cron: check-plans — promotional D-5 wiring (S13)
// Proves the free-period reminder is attached to the existing
// cron and that the previous D-7 path still behaves the same.
// =====================================================

import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  notifyExpiring: vi.fn(),
  notifyExpired: vi.fn(),
  sendReminder: vi.fn(),
}));

vi.mock('@/config/env', () => ({
  env: { cronSecret: 'test-cron-secret' },
}));

vi.mock('@/core/database/client', () => ({
  db: { select: mocks.select },
}));

vi.mock('@/lib/notifications', () => ({
  notifyPlanExpiring: mocks.notifyExpiring,
  notifyPlanExpired: mocks.notifyExpired,
}));

vi.mock('@/lib/email/promotionEmails', () => ({
  sendPromotionReminderEmail: mocks.sendReminder,
}));

import { GET } from '@/app/api/cron/check-plans/route';

function cronRequest(): Request {
  return new Request('http://localhost/api/cron/check-plans?token=test-cron-secret');
}

function selectChain(result: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(async () => result);
  chain.then = (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function daysFromToday(days: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
}

function subscription(planEndDate: Date) {
  return {
    businessId: 'biz-1',
    planType: 'lite_pago',
    planEndDate,
    ownerId: 'owner-1',
    businessName: 'Mi Tienda',
    slug: 'mi-tienda',
  };
}

describe('GET /api/cron/check-plans — D-5 promotion reminder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notifyExpiring.mockResolvedValue(undefined);
    mocks.notifyExpired.mockResolvedValue(undefined);
    mocks.sendReminder.mockResolvedValue(true);
  });

  test('D-5 sends the promotional email and records the in-app notification', async () => {
    const endDate = daysFromToday(5);
    mocks.select
      .mockImplementationOnce(() => selectChain([subscription(endDate)]))
      .mockImplementation(() => selectChain([]));

    const res = await GET(cronRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, notified: 1, skipped: 0, errors: 0 });
    expect(mocks.notifyExpiring).toHaveBeenCalledWith('biz-1', {
      planName: 'Lite Pago',
      expiryDate: endDate.toLocaleDateString('es-AR'),
      daysRemaining: 5,
    });
    expect(mocks.sendReminder).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'biz-1',
        ownerId: 'owner-1',
        businessName: 'Mi Tienda',
        slug: 'mi-tienda',
      }),
    );
  });

  test('D-7 keeps its existing behavior and does not send a promotional email', async () => {
    const endDate = daysFromToday(7);
    mocks.select
      .mockImplementationOnce(() => selectChain([subscription(endDate)]))
      .mockImplementation(() => selectChain([]));

    const res = await GET(cronRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.notified).toBe(1);
    expect(mocks.notifyExpiring).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({ daysRemaining: 7 }),
    );
    expect(mocks.sendReminder).not.toHaveBeenCalled();
  });

  test('D-5 is skipped when the reminder was already recorded today', async () => {
    const endDate = daysFromToday(5);
    mocks.select
      .mockImplementationOnce(() => selectChain([subscription(endDate)]))
      .mockImplementation(() => selectChain([{ id: 'existing-notification' }]));

    const res = await GET(cronRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true, notified: 0, skipped: 1, errors: 0 });
    expect(mocks.sendReminder).not.toHaveBeenCalled();
  });
});
