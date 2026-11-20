import { beforeEach, describe, expect, test, vi } from 'vitest';

import { GET, POST } from '../../app/api/notifications/route';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BUSINESS_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_BUSINESS_ID = '44444444-4444-4444-8444-444444444444';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  insert: vi.fn(),
  insertValues: vi.fn(),
  insertReturning: vi.fn(),
  getMemberPermissions: vi.fn(),
  checkRateLimitAsync: vi.fn(),
  sendPushNotifications: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getUser: mocks.getUser } })),
}));

vi.mock('@/core/database/client', () => ({
  db: {
    insert: mocks.insert,
  },
}));

vi.mock('@/lib/permissions/checkPermission', () => ({
  getMemberPermissions: mocks.getMemberPermissions,
}));

vi.mock('@/lib/rateLimit', () => ({
  RATE_LIMITS: {
    notificationCreate: { windowMs: 60_000, maxRequests: 10 },
  },
  checkRateLimitAsync: mocks.checkRateLimitAsync,
}));

vi.mock('@/lib/push/webPushSender', () => ({
  sendPushNotifications: mocks.sendPushNotifications,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: mocks.loggerError,
    warn: mocks.loggerWarn,
    info: vi.fn(),
  },
  toErrorDetail: vi.fn((error: unknown) => error),
}));

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://app.example.com/api/notifications', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'sec-fetch-site': 'same-origin',
      'user-agent': 'vitest',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    businessId: BUSINESS_ID,
    type: 'order_created',
    category: 'pedidos',
    title: 'Nuevo pedido',
    message: 'Recibiste un pedido',
    data: { orderId: 'ord-1' },
    ...overrides,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
  vi.clearAllMocks();

  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mocks.getMemberPermissions.mockResolvedValue({ role: 'owner' });
  mocks.checkRateLimitAsync.mockResolvedValue({
    allowed: true,
    remaining: 9,
    resetInMs: 60_000,
  });
  mocks.insert.mockReturnValue({ values: mocks.insertValues });
  mocks.insertValues.mockReturnValue({ returning: mocks.insertReturning });
  mocks.insertReturning.mockResolvedValue([{ id: 'notification-1' }]);
  mocks.loggerError.mockImplementation(() => undefined);
  mocks.loggerWarn.mockImplementation(() => undefined);
});

describe('POST /api/notifications hardening', () => {
  test('rejects cross-site requests even with a valid session', async () => {
    const response = await POST(
      jsonRequest(validBody(), { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }),
    );

    expect(response.status).toBe(403);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test('rejects non-JSON content types before parsing', async () => {
    const response = await POST(jsonRequest(validBody(), { 'content-type': 'text/plain' }));

    expect(response.status).toBe(403);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test('accepts a trusted Origin when Fetch Metadata is absent', async () => {
    const response = await POST(
      jsonRequest(validBody(), { 'sec-fetch-site': '', origin: 'https://app.example.com' }),
    );

    expect(response.status).toBe(200);
    expect(mocks.insert).toHaveBeenCalled();
  });

  test('rejects a businessId that is not a UUID', async () => {
    const response = await POST(jsonRequest(validBody({ businessId: 'not-a-uuid' })));

    expect(response.status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test('rejects oversized title and message values', async () => {
    const response = await POST(
      jsonRequest(validBody({ title: 't'.repeat(121), message: 'm'.repeat(501) })),
    );

    expect(response.status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test('rejects oversized data payloads', async () => {
    const response = await POST(jsonRequest(validBody({ data: { blob: 'x'.repeat(5000) } })));

    expect(response.status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test('rejects unexpected fields', async () => {
    const response = await POST(jsonRequest(validBody({ isRead: true })));

    expect(response.status).toBe(400);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test('returns 429 with Retry-After when the route rate limit is exhausted', async () => {
    mocks.checkRateLimitAsync.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetInMs: 4500,
    });

    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('5');
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  test('charges the rate limit per authenticated user and business', async () => {
    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(200);
    expect(mocks.checkRateLimitAsync).toHaveBeenCalledWith(
      `${USER_ID}:${BUSINESS_ID}`,
      expect.objectContaining({ maxRequests: 10, windowMs: 60_000 }),
    );
  });

  test('preserves the owner creation flow without fan-out', async () => {
    const response = await POST(jsonRequest(validBody()));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    expect(mocks.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: BUSINESS_ID, data: { orderId: 'ord-1' } }),
    );
    expect(mocks.sendPushNotifications).not.toHaveBeenCalled();
  });

  test('still denies cross-tenant creation after hardening', async () => {
    mocks.getMemberPermissions.mockResolvedValue({ role: null });

    const response = await POST(jsonRequest(validBody({ businessId: OTHER_BUSINESS_ID })));

    expect(response.status).toBe(403);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});

describe('GET /api/notifications unchanged', () => {
  test('still requires authentication', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const request = new Request('https://app.example.com/api/notifications', {
      method: 'GET',
    });

    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  test('still rejects a non-UUID businessId', async () => {
    const request = new Request('https://app.example.com/api/notifications?businessId=bad-id', {
      method: 'GET',
    });

    const response = await GET(request);

    expect(response.status).toBe(400);
  });
});
