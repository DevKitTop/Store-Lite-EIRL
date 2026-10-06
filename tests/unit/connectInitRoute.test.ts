// =====================================================
// POST /api/seller/whatsapp/connect/init — Route tests
// Bug fix: the old code called YCloud endpoints that do
// NOT exist in the current API (POST .../phoneNumbers/
// register). Verified against the live API: the account
// already holds a CONNECTED number, so init must list
// GET /whatsapp/phoneNumbers and adopt the connected one
// (insert or reactivate the channel row).
// =====================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const NO_CONNECTED_NUMBER_ERROR =
  'No hay un número de WhatsApp conectado en la cuenta de YCloud. Conecta un número desde la consola de YCloud primero.';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  businessFindFirst: vi.fn(),
  // Call #1 = business-scoped active-channel check,
  // call #2 = phone-number-scoped lookup (unique constraint).
  channelFindFirst: vi.fn(),
  insertValues: vi.fn(),
  updateSet: vi.fn(),
  fetchMock: vi.fn(),
  env: { ycloudApiKey: 'test-key', ycloudWabaId: 'waba-1' },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mocks.getUser },
  })),
}));

vi.mock('@/core/database/client', () => ({
  db: {
    insert: vi.fn(() => ({
      values: vi.fn((values: unknown) => {
        mocks.insertValues(values);
        return Promise.resolve();
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: unknown) => {
        mocks.updateSet(values);
        return { where: vi.fn(() => Promise.resolve()) };
      }),
    })),
    query: {
      businesses: { findFirst: mocks.businessFindFirst },
      whatsappChannels: { findFirst: mocks.channelFindFirst },
    },
  },
}));

vi.mock('@/config/env', () => ({
  env: mocks.env,
}));

import { POST } from '@/app/api/seller/whatsapp/connect/init/route';

const YCLOUD_LIST_URL = 'https://api.ycloud.com/v2/whatsapp/phoneNumbers';

// Real shape verified against the live YCloud account.
const CONNECTED_NUMBER = {
  id: 'pn-1001',
  phoneNumber: '+51967356665',
  wabaId: 'waba-1',
  displayPhoneNumber: '+51 967 356 665',
  status: 'CONNECTED',
  codeVerificationStatus: 'VERIFIED',
  qualityRating: 'GREEN',
};

function initRequest(): Request {
  return new Request('http://localhost/api/seller/whatsapp/connect/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessId: BUSINESS_ID }),
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

describe('POST /api/seller/whatsapp/connect/init', () => {
  beforeEach(() => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mocks.businessFindFirst.mockReset();
    mocks.channelFindFirst.mockReset();
    mocks.env.ycloudApiKey = 'test-key';
    mocks.env.ycloudWabaId = 'waba-1';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 401 when not authenticated', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(initRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'No autenticado' });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('returns 403 when the business does not belong to the user', async () => {
    mocks.businessFindFirst.mockResolvedValue(null);

    const response = await POST(initRequest());

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Negocio no encontrado o sin permisos' });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('returns 409 when the business already has an active channel', async () => {
    mocks.businessFindFirst.mockResolvedValue({ id: BUSINESS_ID });
    mocks.channelFindFirst.mockResolvedValue({
      id: 'ch-1',
      isActive: true,
      ycloudPhoneNumberId: 'pn-999',
    });

    const response = await POST(initRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Este negocio ya tiene un canal WhatsApp activo',
    });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('adopts a CONNECTED YCloud number by inserting an active channel', async () => {
    mocks.businessFindFirst.mockResolvedValue({ id: BUSINESS_ID });
    mocks.channelFindFirst
      .mockResolvedValueOnce(null) // no active channel for this business
      .mockResolvedValueOnce(null); // no channel owns pn-1001 yet
    stubYCloudList({ items: [CONNECTED_NUMBER] });

    const response = await POST(initRequest());
    const body = (await response.json()) as {
      phoneNumberId: string;
      status: string;
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

    expect(response.status).toBe(200);
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BUSINESS_ID,
        ycloudPhoneNumberId: 'pn-1001',
        wabaId: 'waba-1',
        isActive: true,
        displayPhoneNumber: '+51 967 356 665',
        connectedAt: expect.any(Date),
      }),
    );
    expect(mocks.updateSet).not.toHaveBeenCalled();

    expect(body).toEqual({
      phoneNumberId: 'pn-1001',
      status: 'connected',
      displayPhoneNumber: '+51 967 356 665',
      connectedAt: expect.any(String),
    });

    const inserted = mocks.insertValues.mock.calls[0]![0] as { connectedAt: Date };
    expect(new Date(body.connectedAt).getTime()).toBe(inserted.connectedAt.getTime());
  });

  it('reactivates an existing INACTIVE channel with the same number id instead of inserting', async () => {
    mocks.businessFindFirst.mockResolvedValue({ id: BUSINESS_ID });
    mocks.channelFindFirst
      .mockResolvedValueOnce(null) // no ACTIVE channel for this business
      .mockResolvedValueOnce({ id: 'ch-stale' }); // stale channel owns pn-1001
    stubYCloudList({ items: [CONNECTED_NUMBER] });

    const response = await POST(initRequest());
    const body = (await response.json()) as { status: string; phoneNumberId: string };

    expect(response.status).toBe(200);
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: true,
        displayPhoneNumber: '+51 967 356 665',
        connectedAt: expect.any(Date),
      }),
    );
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(body.status).toBe('connected');
    expect(body.phoneNumberId).toBe('pn-1001');
  });

  it('returns 409 when YCloud returns no phone numbers at all', async () => {
    mocks.businessFindFirst.mockResolvedValue({ id: BUSINESS_ID });
    mocks.channelFindFirst.mockResolvedValueOnce(null);
    stubYCloudList([]); // defensive: tolerate a raw array page

    const response = await POST(initRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: NO_CONNECTED_NUMBER_ERROR });
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it('returns 409 when the CONNECTED number belongs to a different WABA', async () => {
    mocks.businessFindFirst.mockResolvedValue({ id: BUSINESS_ID });
    mocks.channelFindFirst.mockResolvedValueOnce(null);
    stubYCloudList({
      items: [
        { ...CONNECTED_NUMBER, wabaId: 'waba-other' },
        {
          id: 'pn-2002',
          phoneNumber: '+51961112233',
          wabaId: 'waba-1',
          displayPhoneNumber: null,
          status: 'PENDING',
        },
      ],
    });

    const response = await POST(initRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: NO_CONNECTED_NUMBER_ERROR });
  });

  it('returns 500 with the existing message when YCloud credentials are missing', async () => {
    mocks.businessFindFirst.mockResolvedValue({ id: BUSINESS_ID });
    mocks.channelFindFirst.mockResolvedValueOnce(null);
    mocks.env.ycloudApiKey = '';

    const response = await POST(initRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Configuración de WhatsApp incompleta. Contacta al administrador.',
    });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });
});
