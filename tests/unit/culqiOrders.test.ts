// =====================================================
// src/core/payments/culqiOrders — Unit tests
// =====================================================
// R8/R11: the order flow must read the Culqi order before trusting
// the client-supplied culqiOrderId. These tests pin the request
// contract, the error mapping (timeout/transport) and the paid-state
// truth table.
// =====================================================

import { CulqiReadError, getCulqiOrder, isCulqiOrderPaid } from '@/core/payments/culqiOrders';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const ORDER_ID = 'ord_culqi_abc123';
const SECRET_KEY = 'sk_test_abc123';

const mockFetch = vi.fn();

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

describe('getCulqiOrder', () => {
  let clearTimeoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('GETs /v2/orders/{id} with the business secret key as a Bearer token', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ id: ORDER_ID, state: 'paid', paid_at: 1538540700000 }),
    );

    await getCulqiOrder(ORDER_ID, SECRET_KEY);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.culqi.com/v2/orders/${ORDER_ID}`);
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${SECRET_KEY}` });
  });

  test('passes an AbortSignal so the read can be cancelled', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: ORDER_ID }));

    await getCulqiOrder(ORDER_ID, SECRET_KEY);

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
  });

  test('aborted read throws CulqiReadError("timeout") and clears the timer', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValue(abortError);

    await expect(getCulqiOrder(ORDER_ID, SECRET_KEY)).rejects.toMatchObject({
      name: 'CulqiReadError',
      kind: 'timeout',
    });
    await expect(getCulqiOrder(ORDER_ID, SECRET_KEY)).rejects.toBeInstanceOf(CulqiReadError);
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  test('fetch throw becomes CulqiReadError("transport") and clears the timer', async () => {
    mockFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(getCulqiOrder(ORDER_ID, SECRET_KEY)).rejects.toMatchObject({
      name: 'CulqiReadError',
      kind: 'transport',
    });
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  test('a .json() throw on a JSON response becomes CulqiReadError("transport")', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json; charset=utf-8' },
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    });

    await expect(getCulqiOrder(ORDER_ID, SECRET_KEY)).rejects.toMatchObject({ kind: 'transport' });
  });

  test('tolerates a non-JSON response and resolves to an empty state', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      headers: { get: () => 'text/html; charset=utf-8' },
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    });

    await expect(getCulqiOrder(ORDER_ID, SECRET_KEY)).resolves.toEqual({});
  });

  test('parses a received response even when the gateway answers non-ok', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: ORDER_ID, state: 'paid' }, false));

    await expect(getCulqiOrder(ORDER_ID, SECRET_KEY)).resolves.toEqual({
      id: ORDER_ID,
      state: 'paid',
    });
  });

  // The id is client-supplied. Interpolated raw it escapes its own path segment
  // and can retarget the request at a different Culqi endpoint.
  test.each([
    {
      label: 'path traversal and query separator',
      orderId: '../../v2/charges/chr_x?limit=100',
      encoded: '..%2F..%2Fv2%2Fcharges%2Fchr_x%3Flimit%3D100',
    },
    { label: 'space and plus', orderId: 'ord 123+x', encoded: 'ord%20123%2Bx' },
  ])('percent-encodes the order id ($label) into the URL path', async ({ orderId, encoded }) => {
    mockFetch.mockResolvedValue(jsonResponse({ id: orderId, state: 'paid' }));

    await getCulqiOrder(orderId, SECRET_KEY);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe(`https://api.culqi.com/v2/orders/${encoded}`);

    // Structural guarantee: nothing the caller controls can add a path segment
    // or a query string after the fixed orders/ prefix.
    const idSegment = url.slice('https://api.culqi.com/v2/orders/'.length);
    expect(idSegment).not.toContain('/');
    expect(idSegment).not.toContain('?');
    expect(idSegment).not.toContain(' ');
  });

  test('a benign id is still requested unchanged', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ id: ORDER_ID, state: 'paid' }));

    await getCulqiOrder(ORDER_ID, SECRET_KEY);

    const [url] = mockFetch.mock.calls[0] as [string];
    expect(url).toBe(`https://api.culqi.com/v2/orders/${ORDER_ID}`);
  });
});

describe('isCulqiOrderPaid', () => {
  // Truth table pinned by R11 against Culqi's REAL order schema.
  //
  // The order object has NO `status` field. Its real paid markers are:
  //   - `state`   — string lifecycle value; 'paid' is confirmed real
  //   - `paid_at` — unix timestamp (ms or string), null while unpaid
  // `status` / `paid` belong to the CHARGE object, not the order.
  const cases: { label: string; order: Record<string, unknown>; expected: boolean }[] = [
    // --- paid: state or paid_at is authoritative money evidence -------------
    { label: "state 'paid'", order: { state: 'paid' }, expected: true },
    { label: 'paid_at timestamp (number)', order: { paid_at: 1538540700000 }, expected: true },
    {
      label: 'paid_at timestamp (non-empty numeric string)',
      order: { paid_at: '1538540700000' },
      expected: true,
    },
    {
      label: "state 'paid' with paid_at",
      order: { state: 'paid', paid_at: 1538540700000 },
      expected: true,
    },

    // --- denied: every real non-paid state ---------------------------------
    { label: "state 'pending'", order: { state: 'pending' }, expected: false },
    { label: "state 'created'", order: { state: 'created' }, expected: false },
    { label: "state 'expired'", order: { state: 'expired' }, expected: false },
    { label: "state 'cancelled'", order: { state: 'cancelled' }, expected: false },
    { label: "state 'refunded'", order: { state: 'refunded' }, expected: false },
    {
      label: "state 'unpaid' (substring trap for includes())",
      order: { state: 'unpaid' },
      expected: false,
    },

    // --- denied: state is not exactly 'paid' (no case/trim normalization) ---
    { label: "state 'PAID' (wrong case)", order: { state: 'PAID' }, expected: false },
    { label: "state ' paid' (leading space)", order: { state: ' paid' }, expected: false },
    { label: 'state is the number 123', order: { state: 123 }, expected: false },
    { label: 'state is null', order: { state: null }, expected: false },
    { label: 'state is an object', order: { state: {} }, expected: false },

    // --- denied: paid_at is absent or carries no money evidence -----------
    { label: 'paid_at null (unpaid order)', order: { paid_at: null }, expected: false },
    // Epoch 0 is not a real payment timestamp — denying it prevents a
    // synthetic/default value from unlocking a free order.
    { label: 'paid_at 0 (epoch zero)', order: { paid_at: 0 }, expected: false },
    { label: 'paid_at empty string', order: { paid_at: '' }, expected: false },
    { label: 'paid_at non-numeric string', order: { paid_at: 'not-a-date' }, expected: false },
    { label: 'no marker at all', order: {}, expected: false },

    // --- REGRESSION PIN: `status` is NOT a Culqi order marker --------------
    // `status` / `paid` belong to the CHARGE object. A prior spec revision
    // invented `status` on the order; this row fails if anyone reintroduces it.
    {
      label: "status 'paid' (charge-only field, not an order marker)",
      order: { status: 'paid' },
      expected: false,
    },

    // --- documented asymmetry, pinned on purpose --------------------------
    // `state` can still read 'pending' for a few seconds after Culqi captured
    // the money (async methods). A non-null `paid_at` is authoritative money
    // evidence, so it wins: denying here would hand a real payer a free-order
    // rejection.
    {
      label: 'state pending but paid_at present (paid_at wins)',
      order: { state: 'pending', paid_at: 1538540700000 },
      expected: true,
    },
  ];

  test.each(cases)('$label => $expected', ({ order, expected }) => {
    expect(isCulqiOrderPaid(order)).toBe(expected);
  });
});
