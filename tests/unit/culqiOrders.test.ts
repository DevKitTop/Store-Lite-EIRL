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
    mockFetch.mockResolvedValue(jsonResponse({ id: ORDER_ID, status: 'paid', state: 'paid' }));

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
    mockFetch.mockResolvedValue(jsonResponse({ id: ORDER_ID, status: 'paid' }, false));

    await expect(getCulqiOrder(ORDER_ID, SECRET_KEY)).resolves.toEqual({
      id: ORDER_ID,
      status: 'paid',
    });
  });
});

describe('isCulqiOrderPaid', () => {
  // Truth table pinned by R11: every marker present must equal exactly 'paid'.
  const cases: { label: string; order: Record<string, unknown>; expected: boolean }[] = [
    {
      label: "status 'paid' and state 'paid'",
      order: { status: 'paid', state: 'paid' },
      expected: true,
    },
    { label: "status 'paid' with state absent", order: { status: 'paid' }, expected: true },
    { label: "state 'paid' with status absent", order: { state: 'paid' }, expected: true },
    { label: "status 'pending'", order: { status: 'pending' }, expected: false },
    { label: "status 'expired'", order: { status: 'expired' }, expected: false },
    { label: "status 'cancelled'", order: { status: 'cancelled' }, expected: false },
    { label: "state 'created' alone", order: { state: 'created' }, expected: false },
    {
      label: "status 'paid' with state 'created' (self-contradictory)",
      order: { status: 'paid', state: 'created' },
      expected: false,
    },
    { label: 'neither marker present', order: {}, expected: false },
    {
      label: "status 'PAID' (wrong case)",
      order: { status: 'PAID', state: 'paid' },
      expected: false,
    },
    {
      label: "status ' paid' (leading space)",
      order: { status: ' paid', state: 'paid' },
      expected: false,
    },
    { label: 'status is the number 123', order: { status: 123, state: 'paid' }, expected: false },
    { label: 'status is an object', order: { status: {}, state: 'paid' }, expected: false },
    { label: 'status is null', order: { status: null, state: 'paid' }, expected: false },
  ];

  test.each(cases)('$label => $expected', ({ order, expected }) => {
    expect(isCulqiOrderPaid(order)).toBe(expected);
  });
});
