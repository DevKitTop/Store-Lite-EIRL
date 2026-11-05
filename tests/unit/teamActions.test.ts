// =====================================================
// Team actions — destructive paths
//
// The roster read is covered by the governed function. What is left is the
// write path: role changes, permission overrides and removals. Those run under
// the tenant runner now, so the claims are what the policy sees. These tests pin
// two things the policy cannot: that the claims carry the *acting* user, and
// that an owner check happens before the statement is issued at all.
// =====================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  assertOwnership: vi.fn(),
  withTenantContext: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      businessTeamMembers: { findMany: vi.fn().mockResolvedValue([]) },
    },
  },
}));

vi.mock('@/core/database/tenant', () => ({
  withTenantContext: mocks.withTenantContext,
}));

vi.mock('../../app/actions/team/_helpers', () => ({
  createUserAuthClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
  assertOwnership: mocks.assertOwnership,
}));

import { leaveTeam, removeTeamMember } from '@/app/actions/team/members';
import { updateMemberRole } from '@/app/actions/team/roles';

/** A thenable that also exposes the chain methods Drizzle statements return. */
function statementChain() {
  const promise = Promise.resolve([]);
  const chain = { returning: () => promise, then: promise.then.bind(promise) };
  return {
    set: vi.fn(() => ({ where: vi.fn(() => chain) })),
    where: vi.fn(() => chain),
  };
}

function tenantStub() {
  const stub = {
    delete: vi.fn(() => statementChain()),
    update: vi.fn(() => statementChain()),
  };
  return { stub, ...stub };
}

describe('team actions — destructive paths', () => {
  beforeEach(() => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: MEMBER_ID } }, error: null });
    mocks.assertOwnership.mockReset();
    mocks.withTenantContext.mockReset();
    mocks.revalidatePath.mockReset();
  });

  it('leaveTeam deletes the caller own membership under the caller claims', async () => {
    const { stub, delete: deleteSpy } = tenantStub();
    mocks.withTenantContext.mockImplementation(async (_claims, fn) => fn(stub));

    const result = await leaveTeam(BUSINESS_ID);

    expect(result.success).toBe(true);
    expect(mocks.withTenantContext).toHaveBeenCalledWith({ sub: MEMBER_ID }, expect.any(Function));
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it('leaveTeam refuses to run without a session', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await leaveTeam(BUSINESS_ID);

    expect(result.success).toBe(false);
    expect(mocks.withTenantContext).not.toHaveBeenCalled();
  });

  it('removeTeamMember stops before the statement when the caller is not the owner', async () => {
    mocks.assertOwnership.mockResolvedValue({ userId: MEMBER_ID, error: 'No tienes permiso.' });

    const result = await removeTeamMember(BUSINESS_ID, OWNER_ID);

    expect(result.error).toBe('No tienes permiso.');
    expect(mocks.withTenantContext).not.toHaveBeenCalled();
  });

  it('removeTeamMember deletes the target under the owner claims', async () => {
    mocks.assertOwnership.mockResolvedValue({ userId: OWNER_ID, error: null });
    const { stub, delete: deleteSpy } = tenantStub();
    mocks.withTenantContext.mockImplementation(async (_claims, fn) => fn(stub));

    const result = await removeTeamMember(BUSINESS_ID, MEMBER_ID);

    expect(result.success).toBe(true);
    expect(mocks.withTenantContext).toHaveBeenCalledWith({ sub: OWNER_ID }, expect.any(Function));
    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it('updateMemberRole refuses to change the owner own role', async () => {
    mocks.assertOwnership.mockResolvedValue({ userId: OWNER_ID, error: null });

    const result = await updateMemberRole(BUSINESS_ID, OWNER_ID, 'admin');

    expect(result.success).toBe(false);
    expect(mocks.withTenantContext).not.toHaveBeenCalled();
  });

  it('updateMemberRole writes under the owner claims', async () => {
    mocks.assertOwnership.mockResolvedValue({ userId: OWNER_ID, error: null });
    const { stub } = tenantStub();
    mocks.withTenantContext.mockImplementation(async (_claims, fn) => fn(stub));

    const result = await updateMemberRole(BUSINESS_ID, MEMBER_ID, 'admin');

    expect(result.success).toBe(true);
    expect(mocks.withTenantContext).toHaveBeenCalledWith({ sub: OWNER_ID }, expect.any(Function));
    expect(stub.update).toHaveBeenCalledTimes(1);
  });
});
