// =====================================================
// fetchWhatsAppConversations — server action tests
// Blocker-1 contract: a CONNECTED channel must be
// reachable by id even when it has ZERO conversations.
// =====================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const getUser = vi.fn();
  const businessesFindFirst = vi.fn();
  const businessTeamMembersFindFirst = vi.fn();

  // Chainable select().from()(.leftJoin()).where()(.limit|.orderBy) mock.
  // Rows come from a per-call queue: call #1 = active channel (ends .limit(1)),
  // call #2 = conversations (ends .orderBy).
  const select = vi.fn();
  const selectFrom = vi.fn();
  const selectLeftJoin = vi.fn();
  const selectWhere = vi.fn();
  const selectOrderBy = vi.fn();
  const selectLimit = vi.fn();
  let selectQueue: unknown[][] = [];
  const nextRows = (): unknown[] => (selectQueue.length > 0 ? selectQueue.shift()! : []);
  const terminal = (): Promise<unknown[]> => Promise.resolve(nextRows());

  select.mockImplementation(() => ({ from: selectFrom }));
  selectFrom.mockImplementation(() => ({ where: selectWhere, leftJoin: selectLeftJoin }));
  selectLeftJoin.mockImplementation(() => ({ where: selectWhere }));
  selectWhere.mockImplementation(() => ({
    orderBy: selectOrderBy,
    limit: selectLimit,
    then: (resolve: (v: unknown[]) => void, reject: (e: unknown) => void) =>
      terminal().then(resolve, reject),
  }));
  selectOrderBy.mockImplementation(terminal);
  selectLimit.mockImplementation(terminal);

  return {
    getUser,
    businessesFindFirst,
    businessTeamMembersFindFirst,
    select,
    selectFrom,
    selectLeftJoin,
    selectWhere,
    selectOrderBy,
    selectLimit,
    queueRows: (...groups: unknown[][]): void => {
      selectQueue = groups;
    },
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mocks.getUser },
  })),
}));

vi.mock('@/core/database/client', () => ({
  db: {
    select: mocks.select,
    query: {
      businesses: { findFirst: mocks.businessesFindFirst },
      businessTeamMembers: { findFirst: mocks.businessTeamMembersFindFirst },
    },
  },
}));

import { fetchWhatsAppConversations } from '@/app/[slug]/(app)/chat/actions/whatsappActions';

const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';

const channelRow = {
  id: CHANNEL_ID,
  businessId: 'bus-1',
  isActive: true,
  connectedAt: new Date('2026-09-01T10:00:00.000Z'),
};

function conversationRow(id: string, customerPhone: string) {
  return {
    id,
    channelId: CHANNEL_ID,
    customerPhone,
    customerName: `Cliente ${customerPhone}`,
    metaBsuId: null,
    status: 'active',
    lastMessageAt: new Date('2026-09-20T10:00:00.000Z'),
    createdAt: new Date('2026-09-20T09:00:00.000Z'),
    lastMessage: null,
  };
}

describe('fetchWhatsAppConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mocks.businessesFindFirst.mockResolvedValue({ ownerId: 'user-1' });
  });

  it('exposes the channel id when connected with ZERO conversations (template manager reachable)', async () => {
    mocks.queueRows([channelRow], []);

    const result = await fetchWhatsAppConversations('bus-1');

    expect(result.success).toBe(true);
    expect(result.channelConnected).toBe(true);
    expect(result.channelId).toBe(CHANNEL_ID);
    expect(result.conversations).toEqual([]);
  });

  it('exposes the channel id alongside the conversations when they exist', async () => {
    mocks.queueRows(
      [channelRow],
      [conversationRow('conv-1', '+51999000001'), conversationRow('conv-2', '+51999000002')],
    );

    const result = await fetchWhatsAppConversations('bus-1');

    expect(result.success).toBe(true);
    expect(result.channelConnected).toBe(true);
    expect(result.channelId).toBe(CHANNEL_ID);
    expect(result.conversations).toHaveLength(2);
    expect(result.conversations![0]!.channelId).toBe(CHANNEL_ID);
  });

  it('reports disconnected (no channelId) when no active channel exists', async () => {
    mocks.queueRows([]);

    const result = await fetchWhatsAppConversations('bus-1');

    expect(result.success).toBe(true);
    expect(result.channelConnected).toBe(false);
    expect(result.channelId).toBeNull();
    expect(result.conversations).toEqual([]);
  });

  it('returns channelId: null on unauthorized requests', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await fetchWhatsAppConversations('bus-1');

    expect(result.success).toBe(false);
    expect(result.channelId).toBeNull();
    expect(mocks.select).not.toHaveBeenCalled();
  });
});