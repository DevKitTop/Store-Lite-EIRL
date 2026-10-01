// =====================================================
// src/core/payments/culqiOrders.ts
// =====================================================
// Culqi order read utilities (server-side).
// Reads a Culqi Order via REST and evaluates its paid state.
// The module is transport-agnostic (no dependency on next/server)
// for reuse outside route handlers.
// =====================================================

const CULQI_TIMEOUT_MS = 15000;

export type CulqiReadErrorKind = 'timeout' | 'transport';

export class CulqiReadError extends Error {
  readonly kind: CulqiReadErrorKind;

  constructor(kind: CulqiReadErrorKind) {
    super(kind === 'timeout' ? 'Culqi order read timeout' : 'Culqi order read transport error');
    this.name = 'CulqiReadError';
    this.kind = kind;
  }
}

// Mirrors Culqi's real ORDER object: an order has NO `status` field. `status`
// / `paid` belong to the CHARGE object. Both markers are `unknown` so the
// fail-closed non-string rules below are enforced by the type.
export interface CulqiOrderState {
  id?: string;
  object?: unknown;
  state?: unknown;
  paid_at?: unknown;
  [k: string]: unknown;
}

export async function getCulqiOrder(orderId: string, secretKey: string): Promise<CulqiOrderState> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, CULQI_TIMEOUT_MS);

  try {
    const response = await fetch(`https://api.culqi.com/v2/orders/${orderId}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    // A body the gateway labels as JSON MUST parse: a failure there is a transport
    // fault, not an empty order. A non-JSON body (HTML error page, empty proxy
    // response) is tolerated down to `{}` so the caller fails closed on "not paid".
    const contentType = response.headers?.get?.('content-type') ?? '';
    const declaresJson = contentType.includes('json');

    let data: unknown = {};
    try {
      data = await response.json();
    } catch {
      if (declaresJson) {
        clearTimeout(timeout);
        throw new CulqiReadError('transport');
      }
      data = {};
    }

    clearTimeout(timeout);

    if (data && typeof data === 'object') {
      return data as CulqiOrderState;
    }

    return {};
  } catch (err) {
    clearTimeout(timeout);
    const isAbort = err instanceof Error && err.name === 'AbortError';
    if (isAbort) {
      throw new CulqiReadError('timeout');
    }
    throw new CulqiReadError('transport');
  }
}

// Culqi's real ORDER object carries its payment state in TWO fields, not one:
//   - `state`   — lifecycle string. 'paid' is confirmed real (Culqi's own
//                 Prestashop module compares `$state == 'paid'` on the order
//                 webhook payload; GET /v2/orders filters on `state`).
//   - `paid_at` — unix timestamp of the capture, `null` while unpaid.
//
// There is deliberately NO `status` here. An earlier revision of this contract
// read `status` because this repo's POST create-order handler and its webhook
// touch that name — but on the CHARGE object, where `status`/`paid` really
// live. On an order, a `status` key is fiction: it filters out as `undefined`
// and silently proves nothing, while poisoning the written contract and the
// next reader. `status` is therefore ignored, and a response carrying only
// `status: 'paid'` denies.
//
// The check is OR, not AND, on purpose. `state` can still read 'pending' for a
// few seconds after Culqi captured the money on an async method, so a non-null
// `paid_at` is authoritative money evidence and wins. Denying there would reject
// a buyer who genuinely paid — the free-order failure mode this gate exists to
// prevent. Everything else denies (R11).
export function isCulqiOrderPaid(order: CulqiOrderState): boolean {
  if (order.state === 'paid') return true;

  return isMoneyTimestamp(order.paid_at);
}

// A timestamp counts as money evidence only when it is a finite number > 0, or
// a non-empty string that parses to one. Epoch 0, `''`, `null` and non-numeric
// strings deny: none of them is a real capture time, and admitting any of them
// would let a synthetic default unlock a free order.
function isMoneyTimestamp(value: unknown): boolean {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0;
  }

  if (typeof value === 'string') {
    if (value === '') return false;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0;
  }

  return false;
}
