// =====================================================
// requestServerTicket — buyer proof on the wire (design D3)
//
// The 3rd parameter is what lets an anonymous buyer download their ticket.
// Its contract is that callers that do not pass it send the SAME body they
// sent before the parameter existed — the seller dashboard and any other
// owner-authed caller must keep working untouched.
// =====================================================

import { requestServerTicket } from '@/app/[slug]/(app)/services/ticketService';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const GENERATED_URL = 'https://supabase.co/storage/v1/object/public/tickets/ORD-1.png';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The parsed request body the service actually sent. */
function sentBody(): Record<string, unknown> {
  const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [string, RequestInit];
  expect(url).toBe('/api/ticket/generate');
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe('requestServerTicket', () => {
  beforeEach(() => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, publicUrl: GENERATED_URL }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('sends only the order number when no proof is passed (unchanged public contract)', async () => {
    const result = await requestServerTicket('ORD-1');

    expect(sentBody()).toEqual({ orderNumber: 'ORD-1' });
    expect(result).toEqual({ success: true, publicUrl: GENERATED_URL });
  });

  test('still forwards forceRegenerate as the second parameter', async () => {
    await requestServerTicket('ORD-1', true);

    expect(sentBody()).toEqual({ orderNumber: 'ORD-1', forceRegenerate: true });
  });

  test('forwards the buyer trackingToken when it is provided', async () => {
    await requestServerTicket('ORD-1', true, 'tk_9f2c1b7e4a6d8f0a3b5c7d9e1f3a5b7c');

    expect(sentBody()).toEqual({
      orderNumber: 'ORD-1',
      forceRegenerate: true,
      trackingToken: 'tk_9f2c1b7e4a6d8f0a3b5c7d9e1f3a5b7c',
    });
  });

  test('omits trackingToken when the caller has none, rather than sending undefined', async () => {
    await requestServerTicket('ORD-1', true, undefined);

    // `JSON.stringify` drops undefined values anyway, so the wire body is
    // already clean — this pins that the service does not invent a fallback.
    expect(Object.keys(sentBody())).toEqual(['orderNumber', 'forceRegenerate']);
  });

  test('surfaces the server error message on a 401', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'No autorizado' }, 401));

    const result = await requestServerTicket('ORD-1', true, 'tk_wrong');

    expect(result).toEqual({ success: false, error: 'No autorizado' });
  });
});
