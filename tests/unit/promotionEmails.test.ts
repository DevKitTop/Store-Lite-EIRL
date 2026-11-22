// =====================================================
// src/lib/email/promotionEmails — Unit tests (T5)
// =====================================================
// Verifies that the welcome email reaches the new owner and that the
// five-day reminder only goes out for a redeemed free period.
// =====================================================

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockSendEmail, mockGetPromotionCandidates, mockProfileFindFirst, mockSelect, mockLimit } =
  vi.hoisted(() => {
    const limit = vi.fn();
    const where = vi.fn(() => ({ limit }));
    const innerJoin = vi.fn(() => ({ where }));
    const from = vi.fn(() => ({ innerJoin }));
    const select = vi.fn(() => ({ from }));
    return {
      mockSendEmail: vi.fn(),
      mockGetPromotionCandidates: vi.fn(),
      mockProfileFindFirst: vi.fn(),
      mockSelect: select,
      mockFrom: from,
      mockInnerJoin: innerJoin,
      mockWhere: where,
      mockLimit: limit,
    };
  });

vi.mock('@/core/database/client', () => ({
  db: {
    query: { profiles: { findFirst: mockProfileFindFirst } },
    select: mockSelect,
  },
}));

vi.mock('@/lib/email/resend', () => ({ sendEmail: mockSendEmail }));

vi.mock('@/features/promotions/getApplicablePromotion', () => ({
  getPromotionCandidates: mockGetPromotionCandidates,
}));

import { sendPromotionReminderEmail, sendPromotionWelcomeEmail } from '@/lib/email/promotionEmails';

const NOW = new Date('2026-11-21T12:00:00Z');
const END = new Date('2026-11-26T12:00:00Z');

describe('sendPromotionWelcomeEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPromotionCandidates.mockResolvedValue({
      best: { type: 'free_period', grantedDays: 30 },
      candidates: [],
    });
  });

  test('sends the welcome email with the real CTA to Plan y Límites', async () => {
    await sendPromotionWelcomeEmail({
      ownerId: 'owner-1',
      ownerEmail: 'owner@example.com',
      ownerName: 'Ana',
      businessName: 'Mi Tienda',
      slug: 'mi-tienda',
    });

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const params = mockSendEmail.mock.calls[0][0];
    expect(params.to).toBe('owner@example.com');
    expect(params.subject).toContain('bienvenida');
    expect(params.html).toContain('Ana');
    expect(params.html).toContain('Mi Tienda');
    expect(params.html).toContain('/mi-tienda/settings');
    expect(params.html).toContain('30');
    expect(params.html).not.toContain('${');
  });

  test('does not send when no free-period offer is available', async () => {
    mockGetPromotionCandidates.mockResolvedValue({ best: null, candidates: [] });

    await sendPromotionWelcomeEmail({
      ownerId: 'owner-1',
      ownerEmail: 'owner@example.com',
      ownerName: 'Ana',
      businessName: 'Mi Tienda',
      slug: 'mi-tienda',
    });

    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});

describe('sendPromotionReminderEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProfileFindFirst.mockResolvedValue({
      email: 'owner@example.com',
      fullName: 'Ana Pérez',
    });
    mockLimit.mockResolvedValue([{ id: 'redemption-1' }]);
  });

  test('sends the D-5 reminder for a redeemed free period', async () => {
    const sent = await sendPromotionReminderEmail({
      businessId: 'biz-1',
      ownerId: 'owner-1',
      businessName: 'Mi Tienda',
      slug: 'mi-tienda',
      planEndDate: END,
      now: NOW,
    });

    expect(sent).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const params = mockSendEmail.mock.calls[0][0];
    expect(params.to).toBe('owner@example.com');
    expect(params.subject).toContain('vence');
    expect(params.html).toContain('26 de noviembre de 2026');
    expect(params.html).toContain('/mi-tienda/settings');
    expect(params.html).not.toContain('${');
  });

  test('does not send outside the five-day window', async () => {
    const sent = await sendPromotionReminderEmail({
      businessId: 'biz-1',
      ownerId: 'owner-1',
      businessName: 'Mi Tienda',
      slug: 'mi-tienda',
      planEndDate: new Date('2026-11-25T12:00:00Z'),
      now: NOW,
    });

    expect(sent).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockProfileFindFirst).not.toHaveBeenCalled();
  });

  test('does not send when the owner never redeemed a free period', async () => {
    mockLimit.mockResolvedValue([]);

    const sent = await sendPromotionReminderEmail({
      businessId: 'biz-1',
      ownerId: 'owner-1',
      businessName: 'Mi Tienda',
      slug: 'mi-tienda',
      planEndDate: END,
      now: NOW,
    });

    expect(sent).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
