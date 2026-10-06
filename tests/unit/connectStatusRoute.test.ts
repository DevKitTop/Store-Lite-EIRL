// =====================================================
// POST /api/seller/whatsapp/connect/status — Route tests
// Bug fix: the old code queried GET /whatsapp/phoneNumbers/
// {phoneNumberId}, an endpoint that does NOT exist in the
// current YCloud API. The status must be read from the
// account-wide list (GET /whatsapp/phoneNumbers) by
// matching the channel's ycloudPhoneNumberId.
// =====================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BUSINESS_ID = '22222222-2222-4222-8222-222222222222';
const CHANNEL_ID = '33333333-3333-4333-8333-333333333333';
const PHONE_NUMBER_ID = 'pn-1001';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  channelFindFirst: vi.fn(),
  businessFindFirst: vi.fn(),
  updateSet: vi.fn(),
  fetchMock: vi.fn(),
  env: { ycloudApiKey: 'test-key' },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mocks.getUser },
  })),
}));

vi.mock('@/core/database/client', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn((values: unknown) => {
        mocks.updateSet(values);
        return { where: vi.fn(() => Promise.resolve()) };
      }),
    })),
    query: {
      whatsappChannels: { findFirst: mocks.channelFindFirst },
      businesses: { findFirst: mocks.businessFindFirst },
    },
  },
}));

vi.mock('@/config/env', () => ({
  env: mocks.env,
}));

import { POST } from '@/app/api/seller/whatsapp/connect/status/route';

const YCLOUD_LIST_URL = 'https://api.ycloud.com/v2/whatsapp/phoneNumbers';

function channelRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CHANNEL_ID,
    businessId: BUSINESS_ID,
    ycloudPhoneNumberId: PHONE_NUMBER_ID,
    isActive: false,
    connectionStatus: 'pending',
    connectedAt: null,
    displayPhoneNumber: null,
    ...overrides,
  };
}

function statusRequest(): Request {
  return new Request('http://localhost/api/seller/whatsapp/connect/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumberId: PHONE_NUMBER_ID }),
  });
}

function stubYCloudList(body: unknown, status = 200): void {
  mocks.fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', mocks.fetchMock);
}

describe('POST /api/seller/whatsapp/connect/status', () => {
  beforeEach(() => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mocks.channelFindFirst.mockReset();
    mocks.businessFindFirst.mockReset();
    mocks.env.ycloudApiKey = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 401 when not authenticated', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(statusRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'No autenticado' });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the channel does not exist', async () => {
    mocks.channelFindFirst.mockResolvedValue(null);

    const response = await POST(statusRequest());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Canal no encontrado' });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('returns 403 when the business is not owned by the user', async () => {
    mocks.channelFindFirst.mockResolvedValue(channelRow());
    mocks.businessFindFirst.mockResolvedValue({ ownerId: 'someone-else' });

    const response = await POST(statusRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Sin permisos para este canal' });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('returns 403 when the payload businessId does not match the channel business', async () => {
    mocks.channelFindFirst.mockResolvedValue(channelRow());
    mocks.businessFindFirst.mockResolvedValue({ ownerId: 'user-1' });

    const request = new Request('http://localhost/api/seller/whatsapp/connect/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phoneNumberId: PHONE_NUMBER_ID,
        businessId: '55555555-5555-4555-8555-555555555555',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Sin permisos para este canal' });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('returns the DB state without calling YCloud when the channel is already active', async () => {
    mocks.channelFindFirst.mockResolvedValue(
      channelRow({
        isActive: true,
        connectionStatus: 'connected',
        connectedAt: new Date('2026-09-01T10:00:00.000Z'),
        displayPhoneNumber: '+51 967 356 665',
      }),
    );
    mocks.businessFindFirst.mockResolvedValue({ ownerId: 'user-1' });

    const response = await POST(statusRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'connected',
      isActive: true,
      connectionStatus: 'connected',
      displayPhoneNumber: '+51 967 356 665',
      connectedAt: '2026-09-01T10:00:00.000Z',
    });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('NEVER reports connected for an active-but-failed channel — YCloud wins', async () => {
    mocks.channelFindFirst.mockResolvedValue(
      channelRow({
        isActive: true,
        connectionStatus: 'failed',
        connectedAt: new Date('2026-09-01T10:00:00.000Z'),
        displayPhoneNumber: '+51 967 356 665',
      }),
    );
    mocks.businessFindFirst.mockResolvedValue({ ownerId: 'user-1' });
    stubYCloudList({
      items: [
        { id: PHONE_NUMBER_ID, status: 'DISCONNECTED', displayPhoneNumber: '+51 967 356 665' },
      ],
    });

    const response = await POST(statusRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'failed',
      isActive: false,
      connectionStatus: 'failed',
      displayPhoneNumber: '+51 967 356 665',
      connectedAt: null,
    });
    // The contradiction is persisted away: the channel is deactivated.
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false, connectionStatus: 'failed', connectedAt: null }),
    );
  });

  it('deactivates and returns coherent failed state when YCloud reports DISCONNECTED', async () => {
    mocks.channelFindFirst.mockResolvedValue(channelRow());
    mocks.businessFindFirst.mockResolvedValue({ ownerId: 'user-1' });
    stubYCloudList({ items: [{ id: PHONE_NUMBER_ID, status: 'DISCONNECTED' }] });

    const response = await POST(statusRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'failed',
      isActive: false,
      connectionStatus: 'failed',
      displayPhoneNumber: null,
      connectedAt: null,
    });
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false, connectionStatus: 'failed', connectedAt: null }),
    );
  });

  it('reports failed (not pending) when YCloud errors and the channel already failed', async () => {
    mocks.channelFindFirst.mockResolvedValue(
      channelRow({ connectionStatus: 'failed', displayPhoneNumber: '+51 967 356 665' }),
    );
    mocks.businessFindFirst.mockResolvedValue({ ownerId: 'user-1' });
    mocks.fetchMock.mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', mocks.fetchMock);

    const response = await POST(statusRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'failed',
      isActive: false,
      connectionStatus: 'failed',
      displayPhoneNumber: '+51 967 356 665',
      connectedAt: null,
    });
  });

  it('activates the channel and returns connected when YCloud reports CONNECTED', async () => {
    mocks.channelFindFirst.mockResolvedValue(channelRow());
    mocks.businessFindFirst.mockResolvedValue({ ownerId: 'user-1' });
    stubYCloudList({
      items: [{ id: PHONE_NUMBER_ID, status: 'CONNECTED', displayPhoneNumber: '+51 967 356 665' }],
    });

    const response = await POST(statusRequest());
    const body = (await response.json()) as {
      status: string;
      isActive: boolean;
      displayPhoneNumber: string;
      connectedAt: string;
    };

    expect(mocks.fetchMock).toHaveBeenCalledWith(
      YCLOUD_LIST_URL,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'X-API-Key': 'test-key' }),
      }),
    );

    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: true,
        displayPhoneNumber: '+51 967 356 665',
        connectedAt: expect.any(Date),
      }),
    );

    expect(response.status).toBe(200);
    expect(body.status).toBe('connected');
    expect(body.isActive).toBe(true);
    expect(body.connectionStatus).toBe('connected');
    expect(body.displayPhoneNumber).toBe('+51 967 356 665');

    const updated = mocks.updateSet.mock.calls[0]![0] as { connectedAt: Date };
    expect(new Date(body.connectedAt).getTime()).toBe(updated.connectedAt.getTime());
  });

  it('returns the YCloud status without activating when the number is not connected', async () => {
    mocks.channelFindFirst.mockResolvedValue(channelRow());
    mocks.businessFindFirst.mockResolvedValue({ ownerId: 'user-1' });
    stubYCloudList({ items: [{ id: PHONE_NUMBER_ID, status: 'PENDING' }] });

    const response = await POST(statusRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'PENDING',
      isActive: false,
      connectionStatus: 'pending',
      displayPhoneNumber: null,
      connectedAt: null,
    });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it('falls back to the DB state when the YCloud list request fails', async () => {
    mocks.channelFindFirst.mockResolvedValue(channelRow({ displayPhoneNumber: '+51 967 356 665' }));
    mocks.businessFindFirst.mockResolvedValue({ ownerId: 'user-1' });
    mocks.fetchMock.mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', mocks.fetchMock);

    const response = await POST(statusRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'pending',
      isActive: false,
      connectionStatus: 'pending',
      displayPhoneNumber: '+51 967 356 665',
      connectedAt: null,
    });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it('falls back to the DB state when YCloud returns a non-OK response', async () => {
    mocks.channelFindFirst.mockResolvedValue(channelRow({ displayPhoneNumber: '+51 967 356 665' }));
    mocks.businessFindFirst.mockResolvedValue({ ownerId: 'user-1' });
    stubYCloudList({ error: { code: 'AUTHENTICATION_FAILED' } }, 403);

    const response = await POST(statusRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'pending',
      isActive: false,
      connectionStatus: 'pending',
      displayPhoneNumber: '+51 967 356 665',
      connectedAt: null,
    });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it('falls back to the DB state when the channel is not in the YCloud list', async () => {
    mocks.channelFindFirst.mockResolvedValue(channelRow());
    mocks.businessFindFirst.mockResolvedValue({ ownerId: 'user-1' });
    stubYCloudList({ items: [{ id: 'pn-other', status: 'CONNECTED' }] });

    const response = await POST(statusRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'pending',
      isActive: false,
      connectionStatus: 'pending',
      displayPhoneNumber: null,
      connectedAt: null,
    });
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });
});
