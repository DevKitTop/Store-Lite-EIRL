// =====================================================
// isBusinessSeller — one rule, asked about one business
// =====================================================
// Two call sites refuse sellers for different reasons (the order page blocks
// self-confirmation, the lookup route blocks token minting). The rule was
// written twice and both copies were wrong in opposite directions:
//
//   - the lookup route skipped the membership test when the user owned nothing;
//   - the order page skipped it when the user owned *something*.
//
// Both asked "does this user own some business" instead of "is this user a
// seller of THIS business". These tests pin the second question.
// =====================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_BUSINESS_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

const mocks = vi.hoisted(() => ({
  membersFindFirst: vi.fn(),
  isBusinessOwner: vi.fn(),
}));

vi.mock('@/core/database/client', () => ({
  db: { query: { businessTeamMembers: { findFirst: mocks.membersFindFirst } } },
}));

vi.mock('@/lib/permissions/checkPermission', () => ({
  isBusinessOwner: mocks.isBusinessOwner,
}));

import { isBusinessSeller } from '@/core/orders/sellerAccess';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.membersFindFirst.mockResolvedValue(null);
  mocks.isBusinessOwner.mockResolvedValue(false);
});

describe('isBusinessSeller', () => {
  it('treats a member of the business as a seller', async () => {
    mocks.membersFindFirst.mockResolvedValue({ id: 'membership-1' });

    await expect(isBusinessSeller(BUSINESS_ID, USER_ID)).resolves.toBe(true);
    // The membership already answered; ownership does not need a second query.
    expect(mocks.isBusinessOwner).not.toHaveBeenCalled();
  });

  it('treats the owner as a seller', async () => {
    mocks.isBusinessOwner.mockResolvedValue(true);

    await expect(isBusinessSeller(BUSINESS_ID, USER_ID)).resolves.toBe(true);
  });

  it('does not treat a seller of another business as a seller of this one', async () => {
    mocks.membersFindFirst.mockResolvedValue(null);
    mocks.isBusinessOwner.mockResolvedValue(false);

    await expect(isBusinessSeller(BUSINESS_ID, USER_ID)).resolves.toBe(false);
  });

  it('asks about the business it was given, not about any business', async () => {
    await isBusinessSeller(BUSINESS_ID, USER_ID);

    const where = mocks.membersFindFirst.mock.calls[0]?.[0]?.where;
    const { PgDialect } = await import('drizzle-orm/pg-core');
    const { sql, params } = new PgDialect().sqlToQuery(where as never);

    expect(sql).toContain('business_id');
    expect(sql).toContain('user_id');
    expect(params).toContain(BUSINESS_ID);
    expect(params).toContain(USER_ID);
    expect(params).not.toContain(OTHER_BUSINESS_ID);

    expect(mocks.isBusinessOwner).toHaveBeenCalledWith(BUSINESS_ID, USER_ID);
  });

  it('answers no without touching the database when there is no user', async () => {
    await expect(isBusinessSeller(BUSINESS_ID, undefined)).resolves.toBe(false);

    expect(mocks.membersFindFirst).not.toHaveBeenCalled();
    expect(mocks.isBusinessOwner).not.toHaveBeenCalled();
  });
});
