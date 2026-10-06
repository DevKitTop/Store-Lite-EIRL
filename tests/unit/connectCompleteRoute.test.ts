// =====================================================
// POST /api/seller/whatsapp/connect/complete — Route tests
//
// Coexistence onboarding endpoint: after the seller completes
// Meta's Embedded Signup popup, the client submits
// { businessId, wabaId, phoneNumberId } and the route binds
// the number via YCloud smb/bind, then upserts the channel
// scoped to the AUTHENTICATED business (connection_status
// pending — the webhook/poll flips it to connected).
//
// Contract (design.md):
//   400 invalid body | 401 no session | 403 wrong business
//   409 active channel OR tenant-conflict | 500 missing key
//   smb/bind non-2xx → passthrough ycloudData.message + status
//   success → { phoneNumberId, wabaId, status:'pending',
//               connectionStatus:'pending', displayPhoneNumber }
// =====================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BUSINESS_ID = '44444444-4444-4444-8444-444444444444';
const FOREIGN_BUSINESS_ID = '99999999-9999-4999-8999-999999999999';
// YCloud/Meta WABA and phone-number IDs are digit-only numeric strings.
const WABA_ID = '102290129340398';
const PHONE_NUMBER_ID = '1045206517011070';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  businessFindFirst: vi.fn(),
  // Call #1 = business-scoped active-channel check,
  // call #2 = phone-number-scoped lookup (inside the shared upsert).
  channelFindFirst: vi.fn(),
  insertValues: vi.fn(),
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

import { POST } from '@/app/api/seller/whatsapp/connect/complete/route';

const BIND_URL = `https://api.ycloud.com/v2/whatsapp/businessAccounts/${WABA_ID}/smb/bind`;

function completeRequest(body: unknown = {}): Request {
  return new Request('http://localhost/api/seller/whatsapp/connect/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(): { businessId: string; wabaId: string; phoneNumberId: string } {
  return { businessId: BUSINESS_ID, wabaId: WABA_ID, phoneNumberId: PHONE_NUMBER_ID };
}

function stubBind(body: unknown, status = 200): void {
  mocks.fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', mocks.fetchMock);
}

describe('POST /api/seller/whatsapp/connect/complete', () => {
  beforeEach(() => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    mocks.businessFindFirst.mockReset();
    mocks.channelFindFirst.mockReset();
    mocks.env.ycloudApiKey = 'test-key';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 400 when the body is invalid', async () => {
    const response = await POST(completeRequest({ businessId: 'not-a-uuid' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'ID de negocio inválido' });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-numeric wabaId without calling YCloud', async () => {
    mocks.businessFindFirst.mockResolvedValue({ id: BUSINESS_ID });
    // Deterministic safety net: this body must be rejected by VALIDATION,
    // before auth or any YCloud call — the fetch stub must never run.
    vi.stubGlobal('fetch', mocks.fetchMock);
    mocks.fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));

    const response = await POST(
      completeRequest({
        businessId: BUSINESS_ID,
        wabaId: 'waba-seller-1',
        phoneNumberId: PHONE_NUMBER_ID,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'wabaId inválido' });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-numeric phoneNumberId without calling YCloud', async () => {
    mocks.businessFindFirst.mockResolvedValue({ id: BUSINESS_ID });
    vi.stubGlobal('fetch', mocks.fetchMock);
    mocks.fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));

    const response = await POST(
      completeRequest({
        businessId: BUSINESS_ID,
        wabaId: WABA_ID,
        phoneNumberId: 'pn-1001',
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'phoneNumberId inválido' });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('returns 401 when not authenticated', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await POST(completeRequest(validBody()));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'No autenticado' });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('returns 403 when the business does not belong to the user', async () => {
    mocks.businessFindFirst.mockResolvedValue(null);

    const response = await POST(completeRequest(validBody()));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Negocio no encontrado o sin permisos' });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('returns 409 when the business already has an active channel', async () => {
    mocks.businessFindFirst.mockResolvedValue({ id: BUSINESS_ID });
    mocks.channelFindFirst.mockResolvedValue({ id: 'ch-1', isActive: true });

    const response = await POST(completeRequest(validBody()));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Este negocio ya tiene un canal WhatsApp activo',
    });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('returns 500 without calling YCloud when the API key is missing', async () => {
    mocks.businessFindFirst.mockResolvedValue({ id: BUSINESS_ID });
    mocks.channelFindFirst.mockResolvedValueOnce(null);
    mocks.env.ycloudApiKey = '';

    const response = await POST(completeRequest(validBody()));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Configuración de WhatsApp incompleta. Contacta al administrador.',
    });
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('binds via smb/bind with X-API-Key and the phoneNumberId body', async () => {
    mocks.businessFindFirst.mockResolvedValue({ id: BUSINESS_ID });
    mocks.channelFindFirst
      .mockResolvedValueOnce(null) // no ACTIVE channel for this business
      .mockResolvedValueOnce(null); // no channel owns the number yet
    stubBind({ id: 'bind-1', wabaId: WABA_ID, phoneNumberId: PHONE_NUMBER_ID });

    await POST(completeRequest(validBody()));

    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.fetchMock).toHaveBeenCalledWith(
      BIND_URL,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-API-Key': 'test-key' }),
        body: JSON.stringify({ phoneNumberId: PHONE_NUMBER_ID }),
      }),
    );
  });

  it('upserts a pending channel and mirrors the status contract on success', async () => {
    mocks.businessFindFirst.mockResolvedValue({ id: BUSINESS_ID });
    mocks.channelFindFirst
      .mockResolvedValueOnce(null) // no ACTIVE channel for this business
      .mockResolvedValueOnce(null); // no channel owns the number yet
    stubBind({ id: 'bind-1', wabaId: WABA_ID, phoneNumberId: PHONE_NUMBER_ID });

    const response = await POST(completeRequest(validBody()));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: BUSINESS_ID,
        ycloudPhoneNumberId: PHONE_NUMBER_ID,
        wabaId: WABA_ID,
        isActive: false,
        connectionStatus: 'pending',
      }),
    );
    expect(mocks.updateSet).not.toHaveBeenCalled();

    expect(body).toEqual({
      phoneNumberId: PHONE_NUMBER_ID,
      wabaId: WABA_ID,
      status: 'pending',
      connectionStatus: 'pending',
      displayPhoneNumber: null,
    });
  });

  it('reactivates the same-business stale channel instead of inserting', async () => {
    mocks.businessFindFirst.mockResolvedValue({ id: BUSINESS_ID });
    mocks.channelFindFirst
      .mockResolvedValueOnce(null) // no ACTIVE channel for this business
      .mockResolvedValueOnce({ id: 'ch-stale', businessId: BUSINESS_ID }); // same tenant, inactive
    stubBind({ id: 'bind-1', wabaId: WABA_ID, phoneNumberId: PHONE_NUMBER_ID });

    const response = await POST(completeRequest(validBody()));

    expect(response.status).toBe(200);
    expect(mocks.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        isActive: false,
        connectionStatus: 'pending',
      }),
    );
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it('returns 409 and leaves a FOREIGN business channel untouched (cross-tenant)', async () => {
    mocks.businessFindFirst.mockResolvedValue({ id: BUSINESS_ID });
    mocks.channelFindFirst
      .mockResolvedValueOnce(null) // no ACTIVE channel for business A
      .mockResolvedValueOnce({ id: 'ch-foreign', businessId: FOREIGN_BUSINESS_ID }); // B owns the number
    stubBind({ id: 'bind-1', wabaId: WABA_ID, phoneNumberId: PHONE_NUMBER_ID });

    const response = await POST(completeRequest(validBody()));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Este número de WhatsApp ya está vinculado a otro negocio',
    });
    expect(mocks.updateSet).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });

  it('passes through 4xx bind errors without writing to the DB', async () => {
    mocks.businessFindFirst.mockResolvedValue({ id: BUSINESS_ID });
    mocks.channelFindFirst.mockResolvedValueOnce(null);
    stubBind({ message: 'WABA_NOT_FOUND: The WABA does not exist' }, 404);

    const response = await POST(completeRequest(validBody()));
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toContain('WABA_NOT_FOUND');
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });

  it('does not touch the DB when the bind request itself fails to reach YCloud', async () => {
    mocks.businessFindFirst.mockResolvedValue({ id: BUSINESS_ID });
    mocks.channelFindFirst.mockResolvedValueOnce(null);
    mocks.fetchMock.mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', mocks.fetchMock);

    const response = await POST(completeRequest(validBody()));

    expect(response.status).toBe(500);
    expect(mocks.insertValues).not.toHaveBeenCalled();
    expect(mocks.updateSet).not.toHaveBeenCalled();
  });
});
