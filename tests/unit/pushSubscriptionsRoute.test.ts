import { beforeEach, describe, expect, test, vi } from 'vitest';

import { DELETE, POST } from '../../app/api/push/subscriptions/route';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const BUSINESS_ID = '33333333-3333-4333-8333-333333333333';
const ENDPOINT = 'https://push.example.com/subscription/abc';
const KEYS = { p256dh: 'BNx123-_abc', auth: 'authKey_-123' };

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  select: vi.fn(),
  selectFrom: vi.fn(),
  selectWhere: vi.fn(),
  selectLimit: vi.fn(),
  insert: vi.fn(),
  insertValues: vi.fn(),
  insertOnConflict: vi.fn(),
  insertReturning: vi.fn(),
  update: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
  getMemberPermissions: vi.fn(),
  resolvePublicBusinessSlug: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));

vi.mock('@/core/database/client', () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
  },
}));

vi.mock('@/lib/permissions/checkPermission', () => ({
  getMemberPermissions: mocks.getMemberPermissions,
}));

vi.mock('@/core/business/publicSlug', () => ({
  resolvePublicBusinessSlug: mocks.resolvePublicBusinessSlug,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: mocks.loggerError,
    info: vi.fn(),
    warn: vi.fn(),
  },
  toErrorDetail: vi.fn((error: unknown) => error),
}));

function jsonRequest(
  method: 'POST' | 'DELETE',
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request('https://app.example.com/api/push/subscriptions', {
    method,
    headers: {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      'user-agent': 'vitest',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function subscribeBody(overrides: Record<string, unknown> = {}) {
  return {
    subscription: {
      endpoint: ENDPOINT,
      expirationTime: null,
      keys: KEYS,
    },
    ...overrides,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';

  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mocks.select.mockReturnValue({ from: mocks.selectFrom });
  mocks.selectFrom.mockReturnValue({ where: mocks.selectWhere });
  mocks.selectWhere.mockReturnValue({ limit: mocks.selectLimit });
  mocks.selectLimit.mockResolvedValue([]);

  mocks.insert.mockReturnValue({ values: mocks.insertValues });
  mocks.insertValues.mockReturnValue({ onConflictDoUpdate: mocks.insertOnConflict });
  mocks.insertOnConflict.mockReturnValue({ returning: mocks.insertReturning });
  mocks.insertReturning.mockResolvedValue([{ id: 'sub-1' }]);

  mocks.update.mockReturnValue({ set: mocks.updateSet });
  mocks.updateSet.mockReturnValue({ where: mocks.updateWhere });
  mocks.updateWhere.mockReturnValue({ returning: mocks.updateReturning });
  mocks.updateReturning.mockResolvedValue([{ id: 'sub-1' }]);

  mocks.getMemberPermissions.mockResolvedValue({ role: 'member' });
  mocks.resolvePublicBusinessSlug.mockResolvedValue({ id: BUSINESS_ID });
  mocks.loggerError.mockImplementation(() => undefined);
});

describe('POST /api/push/subscriptions', () => {
  test('rejects a mismatched client user_id', async () => {
    const response = await POST(jsonRequest('POST', subscribeBody({ user_id: OTHER_USER_ID })));
    expect(response.status).toBe(403);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test('subscribes with the session user id, ignoring a matching client user_id', async () => {
    const response = await POST(jsonRequest('POST', subscribeBody({ user_id: USER_ID })));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: 'subscribed' });

    const inserted = mocks.insertValues.mock.calls[0]?.[0];
    expect(inserted.userId).toBe(USER_ID);
    expect(inserted.revokedAt).toBeNull();
    expect(inserted.invalidatedAt).toBeNull();
    expect(inserted).not.toHaveProperty('user_id');
  });

  test('reports updated for an existing own subscription', async () => {
    mocks.selectLimit.mockResolvedValueOnce([{ id: 'sub-1' }]);
    const response = await POST(jsonRequest('POST', subscribeBody()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: 'updated' });
  });

  test('rejects missing authentication with 401', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await POST(jsonRequest('POST', subscribeBody()));
    expect(response.status).toBe(401);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test('rejects cross-site requests even with a valid session', async () => {
    const response = await POST(
      jsonRequest('POST', subscribeBody(), { 'sec-fetch-site': 'cross-site' }),
    );
    expect(response.status).toBe(403);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test('accepts a trusted Origin when Fetch Metadata is absent', async () => {
    const response = await POST(
      jsonRequest('POST', subscribeBody(), {
        'sec-fetch-site': '',
        origin: 'https://app.example.com',
      }),
    );
    expect(response.status).toBe(200);
  });

  test('rejects an untrusted Origin when Fetch Metadata is absent', async () => {
    const response = await POST(
      jsonRequest('POST', subscribeBody(), {
        'sec-fetch-site': '',
        origin: 'https://evil.example',
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test('rejects non-JSON content types', async () => {
    const response = await POST(
      jsonRequest('POST', subscribeBody(), { 'content-type': 'text/plain' }),
    );
    expect(response.status).toBe(403);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test('rejects malformed endpoints and keys with 400', async () => {
    const invalidEndpoint = await POST(
      jsonRequest('POST', subscribeBody({ subscription: { endpoint: 'not-a-url', keys: KEYS } })),
    );
    const invalidKeys = await POST(
      jsonRequest(
        'POST',
        subscribeBody({
          subscription: { endpoint: ENDPOINT, keys: { p256dh: '', auth: 'auth' } },
        }),
      ),
    );
    expect(invalidEndpoint.status).toBe(400);
    expect(invalidKeys.status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test('validates an optional business id without using it as authorization', async () => {
    mocks.getMemberPermissions.mockResolvedValueOnce({ role: null });
    const denied = await POST(jsonRequest('POST', subscribeBody({ businessId: BUSINESS_ID })));
    expect(denied.status).toBe(403);
    expect(mocks.insert).not.toHaveBeenCalled();

    const allowed = await POST(jsonRequest('POST', subscribeBody({ businessId: BUSINESS_ID })));
    expect(allowed.status).toBe(200);
    expect(mocks.getMemberPermissions).toHaveBeenCalledWith(BUSINESS_ID, USER_ID);
    const inserted = mocks.insertValues.mock.calls.at(-1)?.[0];
    expect(inserted).not.toHaveProperty('businessId');
  });

  test('logs only a generic message on database failure', async () => {
    mocks.insertReturning.mockRejectedValueOnce(new Error('duplicate key'));
    const response = await POST(jsonRequest('POST', subscribeBody()));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'No se pudo registrar la suscripción' });
    expect(mocks.loggerError).toHaveBeenCalledWith(
      '[push subscriptions] database error',
      expect.not.objectContaining({ endpoint: expect.anything() }),
    );
  });
});

describe('DELETE /api/push/subscriptions', () => {
  test('soft-revokes the authenticated user subscription', async () => {
    const response = await DELETE(jsonRequest('DELETE', { endpoint: ENDPOINT }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: 'revoked' });

    const updated = mocks.updateSet.mock.calls[0]?.[0];
    expect(updated.revokedAt).toBeInstanceOf(Date);
    expect(updated.updatedAt).toBeInstanceOf(Date);
    expect(mocks.update).toHaveBeenCalled();
  });

  test('is idempotent for a missing or already revoked subscription', async () => {
    mocks.updateReturning.mockResolvedValueOnce([]);
    const response = await DELETE(jsonRequest('DELETE', { endpoint: ENDPOINT }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, status: 'noop' });
  });

  test('rejects cross-site revocation', async () => {
    const response = await DELETE(
      jsonRequest('DELETE', { endpoint: ENDPOINT }, { 'sec-fetch-site': 'cross-site' }),
    );
    expect(response.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test('rejects a mismatched client user_id', async () => {
    const response = await DELETE(
      jsonRequest('DELETE', { endpoint: ENDPOINT, user_id: OTHER_USER_ID }),
    );
    expect(response.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test('validates optional slug context before revoking', async () => {
    mocks.getMemberPermissions.mockResolvedValueOnce({ role: null });
    const response = await DELETE(jsonRequest('DELETE', { endpoint: ENDPOINT, slug: 'tienda' }));
    expect(response.status).toBe(403);
    expect(mocks.resolvePublicBusinessSlug).toHaveBeenCalledWith('tienda');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  test('requires a valid endpoint', async () => {
    const response = await DELETE(jsonRequest('DELETE', { endpoint: '' }));
    expect(response.status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
