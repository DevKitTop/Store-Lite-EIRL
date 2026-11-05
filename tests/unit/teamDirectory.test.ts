import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock('@/core/database/client', () => ({
  db: { execute: (...args: unknown[]) => execute(...args) },
}));

import { resolveTeamDirectory } from '@/core/team/directory';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const MEMBERSHIP_ID = '44444444-4444-4444-8444-444444444444';

const OWNER_ROW = {
  kind: 'owner',
  membership_id: null,
  user_id: OWNER_ID,
  email: 'owner@demo.test',
  full_name: 'Owner Name',
  avatar_url: null,
  role: 'owner',
  joined_at: null,
};

const MEMBER_ROW = {
  kind: 'member',
  membership_id: MEMBERSHIP_ID,
  user_id: MEMBER_ID,
  email: 'member@demo.test',
  full_name: 'Member Name',
  avatar_url: 'https://cdn.test/a.png',
  role: 'vendedor',
  joined_at: new Date('2026-05-22T19:10:28Z'),
};

describe('resolveTeamDirectory', () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it('returns null when the function yields no rows', async () => {
    execute.mockResolvedValue([]);

    const result = await resolveTeamDirectory(BUSINESS_ID, MEMBER_ID);

    expect(result).toBeNull();
  });

  it('passes the business and the user to the governed function', async () => {
    execute.mockResolvedValue([OWNER_ROW]);

    await resolveTeamDirectory(BUSINESS_ID, MEMBER_ID);

    const strings = (execute.mock.calls[0][0] as { queryChunks: unknown[] }).queryChunks
      .map((chunk) => (chunk as { value?: string[] }).value?.join('') ?? '')
      .join('');

    expect(strings).toContain('public.business_team_directory');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('keeps the owner first with the stable id the UI already relies on', async () => {
    execute.mockResolvedValue([OWNER_ROW, MEMBER_ROW]);

    const result = await resolveTeamDirectory(BUSINESS_ID, MEMBER_ID);

    expect(result).not.toBeNull();
    expect(result![0]).toEqual(
      expect.objectContaining({ id: 'owner', userId: OWNER_ID, role: 'owner' }),
    );
    expect(result![0]!.joinedAt).toBeInstanceOf(Date);
  });

  it('maps a member row to the membership id and its real join date', async () => {
    execute.mockResolvedValue([OWNER_ROW, MEMBER_ROW]);

    const result = await resolveTeamDirectory(BUSINESS_ID, MEMBER_ID);

    expect(result![1]).toEqual({
      id: MEMBERSHIP_ID,
      userId: MEMBER_ID,
      email: 'member@demo.test',
      fullName: 'Member Name',
      avatarUrl: 'https://cdn.test/a.png',
      role: 'vendedor',
      joinedAt: new Date('2026-05-22T19:10:28Z'),
    });
  });

  it('falls back to the user id when a member row carries no membership id', async () => {
    execute.mockResolvedValue([{ ...MEMBER_ROW, membership_id: null }]);

    const result = await resolveTeamDirectory(BUSINESS_ID, MEMBER_ID);

    expect(result![0]!.id).toBe(MEMBER_ID);
  });
});
