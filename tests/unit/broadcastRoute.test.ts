// =====================================================
// POST /api/sass/notifications/broadcast — key gate, body gate, sent count
// =====================================================
// The route had 0% coverage: the 401 key gate, the 400 body gate and the sent
// count the operator reads back had no test-level contract, so a regression in
// any of them would have shipped silently (spec R3 evidence, R5, R6).
//
// The route itself is UNCHANGED — it already implements these contracts
// verbatim, so this is a coverage unit and its production diff must stay 0
// (design D9). Assertions are pinned to behavior: status codes, the response
// body, whether the database was reached, and whether a dispatch happened.

import { POST } from '@/app/api/sass/notifications/broadcast/route';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { mockEnv, mockSelect, mockFrom, mockWhere, mockCreateBusinessNotification } = vi.hoisted(
  () => ({
    // Mutable holder: the "SASS_API_KEY unset" case flips `sassApiKey` to ''
    // at runtime, which a factory-frozen object could not express.
    mockEnv: { sassApiKey: 'sass-secret-key' } as { sassApiKey: string },
    mockSelect: vi.fn(),
    mockFrom: vi.fn(),
    mockWhere: vi.fn(),
    mockCreateBusinessNotification: vi.fn(),
  }),
);

vi.mock('@/config/env', () => ({
  env: mockEnv,
}));

// The route awaits `db.select().from().where()` directly, so `where()` must
// RESOLVE the row array. (`penaltiesRoute.test.ts` returns `{ orderBy }` from
// `where()` because its route chains `.orderBy()` — that shape does not fit
// this query and the rows would arrive as `undefined`.)
vi.mock('@/core/database/client', () => ({
  db: { select: mockSelect },
}));

vi.mock('@/lib/notifications', () => ({
  createBusinessNotification: mockCreateBusinessNotification,
}));

// ── Fixtures ─────────────────────────────────────────

const API_KEY = 'sass-secret-key';
const ENDPOINT = 'http://localhost/api/sass/notifications/broadcast';

const ACTIVE_SUBS = [{ businessId: 'biz-1' }, { businessId: 'biz-2' }];

const COMPLETE_BODY = { title: 'Novedad', message: 'Ya podés vender online' };

/** `key: null` omits the header entirely; `key: ''` sends an empty one. */
function broadcastRequest(
  body: unknown = COMPLETE_BODY,
  { key = API_KEY }: { key?: string | null } = {},
): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (key !== null) headers['x-sass-key'] = key;
  return new Request(ENDPOINT, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// ── Suite ────────────────────────────────────────────

describe('POST /api/sass/notifications/broadcast', () => {
  beforeEach(() => {
    mockEnv.sassApiKey = API_KEY;
    mockSelect.mockReset();
    mockFrom.mockReset();
    mockWhere.mockReset();
    mockCreateBusinessNotification.mockReset();

    mockWhere.mockResolvedValue(ACTIVE_SUBS);
    mockFrom.mockImplementation(() => ({ where: mockWhere }));
    mockSelect.mockImplementation(() => ({ from: mockFrom }));
    mockCreateBusinessNotification.mockResolvedValue(undefined);
  });

  // ── 401 — the key gate runs before body validation and before the database ──

  test('401 when the x-sass-key header is missing, without reaching the database', async () => {
    // A valid body on purpose: the 401 must come from the key gate, not from
    // the 400 body gate (R5 ordering).
    const res = await POST(broadcastRequest(COMPLETE_BODY, { key: null }));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Unauthorized');
    expect(mockSelect).not.toHaveBeenCalled();
  });

  test('401 for a wrong x-sass-key, without reaching the database', async () => {
    const res = await POST(broadcastRequest(COMPLETE_BODY, { key: 'not-the-key' }));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Unauthorized');
    expect(mockSelect).not.toHaveBeenCalled();
  });

  test('401 when SASS_API_KEY is unset and the header is empty', async () => {
    mockEnv.sassApiKey = '';
    const request = broadcastRequest(COMPLETE_BODY, { key: '' });
    // Non-vacuous: `Request` really does hand back '' for an empty header, so
    // this exercises the empty-vs-empty comparison instead of a missing value.
    expect(request.headers.get('x-sass-key')).toBe('');

    const res = await POST(request);

    expect(res.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  // ── 400 — an unusable body is rejected before any dispatch ──

  test('400 when the body carries a message but no title, with nothing dispatched', async () => {
    const res = await POST(broadcastRequest({ message: 'solo mensaje' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('title y message son requeridos');
    expect(mockCreateBusinessNotification).not.toHaveBeenCalled();
  });

  test('400 for a body that is not valid JSON, with nothing dispatched', async () => {
    // The parse failure is swallowed into `{}` and then misses `title`.
    const res = await POST(broadcastRequest('{ not json'));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('title y message son requeridos');
    expect(mockCreateBusinessNotification).not.toHaveBeenCalled();
  });

  test('400 for a target that is neither all nor an array, before the subscription query', async () => {
    const res = await POST(broadcastRequest({ ...COMPLETE_BODY, target: 'acme' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('target debe ser "all" o un array de business IDs');
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockCreateBusinessNotification).not.toHaveBeenCalled();
  });

  // ── 200 — the sent count the operator reads back ──

  test('200 reports every active subscriber as sent', async () => {
    const res = await POST(broadcastRequest({ ...COMPLETE_BODY, target: 'all' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 2, total: 2, errors: 0 });
    expect(mockCreateBusinessNotification).toHaveBeenCalledTimes(2);
    expect(mockCreateBusinessNotification).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ businessId: 'biz-1' }),
    );
    expect(mockCreateBusinessNotification).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ businessId: 'biz-2' }),
    );
  });

  test('200 counts a rejected dispatch as an error instead of failing the broadcast', async () => {
    mockCreateBusinessNotification.mockRejectedValueOnce(new Error('boom'));

    const res = await POST(broadcastRequest({ ...COMPLETE_BODY, target: 'all' }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(1);
    expect(body.total).toBe(2);
    expect(body.errors).toBe(1);
    expect(body.errorDetails).toEqual(['boom']);
  });

  test('200 with sent 0 and no dispatch when the resolved audience is empty', async () => {
    mockWhere.mockResolvedValue([]);

    const res = await POST(broadcastRequest({ ...COMPLETE_BODY, target: 'all' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      sent: 0,
      message: 'No hay destinatarios para este target',
    });
    expect(mockCreateBusinessNotification).not.toHaveBeenCalled();
  });
});
