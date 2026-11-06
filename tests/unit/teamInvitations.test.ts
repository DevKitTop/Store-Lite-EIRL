// =====================================================
// Invitation acceptance
//
// A code is a capability: holding it authorizes joining a business the caller
// is not a member of yet. No row policy can decide that, so the decision lives
// in `accept_business_invitation`, which locks the invitation while it checks
// the usage limit and writes the membership.
//
// These tests cover the seam: the status the database returns is what the
// caller acts on, and nothing here re-derives it or swallows it.
// =====================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock('@/core/database/client', () => ({
  db: { execute: mocks.execute },
}));

import { acceptBusinessInvitation } from '@/core/team/invitations';

describe('acceptBusinessInvitation', () => {
  beforeEach(() => {
    mocks.execute.mockReset();
  });

  it('returns the status and invitation id the database decided', async () => {
    mocks.execute.mockResolvedValue([{ status: 'joined', invitation_id: 'inv-1' }]);

    const result = await acceptBusinessInvitation(BUSINESS_ID, 'ABCD-EFGH', USER_ID);

    expect(result).toEqual({ status: 'joined', invitationId: 'inv-1' });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it('passes the business, the code and the redeeming user to the function', async () => {
    mocks.execute.mockResolvedValue([{ status: 'joined', invitation_id: 'inv-1' }]);

    await acceptBusinessInvitation(BUSINESS_ID, 'ABCD-EFGH', USER_ID);

    const query = JSON.stringify(mocks.execute.mock.calls[0]);
    expect(query).toContain('accept_business_invitation');
    expect(query).toContain(BUSINESS_ID);
    expect(query).toContain('ABCD-EFGH');
    expect(query).toContain(USER_ID);
  });

  it.each(['invalid', 'already_member', 'owner', 'unauthenticated'] as const)(
    'surfaces %s instead of treating it as a join',
    async (status) => {
      mocks.execute.mockResolvedValue([{ status, invitation_id: null }]);

      const result = await acceptBusinessInvitation(BUSINESS_ID, 'ABCD-EFGH', USER_ID);

      expect(result.status).toBe(status);
      expect(result.invitationId).toBeNull();
    },
  );

  it('does not report a join when the function returns no rows', async () => {
    mocks.execute.mockResolvedValue([]);

    const result = await acceptBusinessInvitation(BUSINESS_ID, 'ABCD-EFGH', USER_ID);

    expect(result.status).toBe('invalid');
  });

  it('lets the rejection propagate instead of reporting a failed join as success', async () => {
    mocks.execute.mockRejectedValue(new Error('connection reset'));

    await expect(acceptBusinessInvitation(BUSINESS_ID, 'ABCD-EFGH', USER_ID)).rejects.toThrow(
      'connection reset',
    );
  });
});
