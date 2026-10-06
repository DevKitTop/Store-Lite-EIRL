// =====================================================
// POST /api/seller/whatsapp/templates/sync — Route tests
// Regression: YCloud returns UPPERCASE statuses; the route
// must persist them LOWERCASE (badges + approved filters).
// =====================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const getUser = vi.fn();
  const businessesFindFirst = vi.fn();
  const updateSet = vi.fn();

  // Chainable select().from().where()(.limit()) mock, sources rows from a
  // per-call queue: call #1 = channel lookup (ends .limit(1)), call #2... =
  // template selects (end at .where).
  const select = vi.fn();
  const selectFrom = vi.fn();
  const selectWhere = vi.fn();
  const selectLimit = vi.fn();
  let selectQueue: unknown[][] = [];
  const nextRows = (): unknown[] => (selectQueue.length > 0 ? selectQueue.shift()! : []);
  const terminal = (): Promise<unknown[]> => Promise.resolve(nextRows());

  select.mockImplementation(() => ({ from: selectFrom }));
  selectFrom.mockImplementation(() => ({ where: selectWhere }));
  selectWhere.mockImplementation(() => ({
    limit: selectLimit,
    then: (resolve: (v: unknown[]) => void, reject: (e: unknown) => void) =>
      terminal().then(resolve, reject),
  }));
  selectLimit.mockImplementation(terminal);

  const update = vi.fn(() => ({
    set: vi.fn((values: Record<string, unknown>) => {
      updateSet(values);
      return { where: vi.fn(() => Promise.resolve([values])) };
    }),
  }));

  return {
    getUser,
    businessesFindFirst,
    updateSet,
    select,
    selectFrom,
    selectWhere,
    selectLimit,
    update,
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
    update: mocks.update,
    query: {
      businesses: { findFirst: mocks.businessesFindFirst },
    },
  },
}));

vi.mock('@/config/env', () => ({
  env: { ycloudApiKey: 'test-key' },
}));

import { POST } from '@/app/api/seller/whatsapp/templates/sync/route';

const CHANNEL_ID = '11111111-1111-4111-8111-111111111111';

const channelRow = { id: CHANNEL_ID, businessId: 'bus-1' };

function templateRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tpl-1',
    channelId: CHANNEL_ID,
    name: 'order_confirmed',
    category: 'utility',
    language: 'es',
    body: 'Cuerpo',
    metaStatus: 'pending',
    metaTemplateId: 'meta-tpl-1',
    ...overrides,
  };
}

function syncRequest(): Request {
  return new Request('http://localhost/api/seller/whatsapp/templates/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId: CHANNEL_ID }),
  });
}

function stubYCloudStatus(status: string | undefined): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ id: 'meta-tpl-1', status }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

describe('POST /api/seller/whatsapp/templates/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mocks.businessesFindFirst.mockResolvedValue({ ownerId: 'user-1' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists an UPPERCASE YCloud status as lowercase', async () => {
    mocks.queueRows([channelRow], [templateRow()]);
    stubYCloudStatus('APPROVED');

    const response = await POST(syncRequest());
    const body = (await response.json()) as { synced: number; results: { metaStatus: string }[] };

    expect(response.status).toBe(200);
    expect(body.synced).toBe(1);
    expect(body.results[0]!.metaStatus).toBe('approved');
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ metaStatus: 'approved' }),
    );
  });

  it('persists REJECTED as lowercase too', async () => {
    mocks.queueRows([channelRow], [templateRow({ metaStatus: 'approved' })]);
    stubYCloudStatus('REJECTED');

    const response = await POST(syncRequest());
    const body = (await response.json()) as { results: { metaStatus: string }[] };

    expect(response.status).toBe(200);
    expect(body.results[0]!.metaStatus).toBe('rejected');
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ metaStatus: 'rejected' }),
    );
  });

  it('falls back to pending and does not break the sync when YCloud omits status', async () => {
    mocks.queueRows([channelRow], [templateRow({ metaStatus: 'rejected' })]);
    stubYCloudStatus(undefined);

    const response = await POST(syncRequest());

    expect(response.status).toBe(200);
    // rejected → pending (fallback) is a status change → still written.
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ metaStatus: 'pending' }),
    );
  });
});