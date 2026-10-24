// =====================================================
// src/core/payments/culqiCharges.ts
// =====================================================
// Culqi charge READ utilities (server-side), used by the payment reconciler.
// Mirrors culqiOrders.ts: transport-agnostic, fails closed on ambiguity.
// =====================================================

import { CulqiReadError } from './culqiOrders';

const CULQI_TIMEOUT_MS = 15000;

// A charge carries its money evidence on `paid` (boolean) and `status`
// ('successful' on capture). Both are `unknown` so the fail-closed rules below
// are enforced by the type rather than by a hopeful cast.
export interface CulqiChargeState {
  id?: string;
  object?: unknown;
  paid?: unknown;
  status?: unknown;
  amount?: unknown;
  [k: string]: unknown;
}

export async function getCulqiCharge(
  chargeId: string,
  secretKey: string,
): Promise<CulqiChargeState> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, CULQI_TIMEOUT_MS);

  try {
    // The id is server-derived but percent-encoded all the same: interpolated
    // raw it could escape its own path segment and retarget the read.
    const response = await fetch(
      `https://api.culqi.com/v2/charges/${encodeURIComponent(chargeId)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${secretKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      },
    );

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
      return data as CulqiChargeState;
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

// Capture evidence is OR, not AND: `paid === true` is authoritative, and
// `status === 'successful'` is Culqi's own success marker. Everything else
// denies so the reconciler never flips a row on a guess.
export function isCulqiChargePaid(charge: CulqiChargeState): boolean {
  return charge.paid === true || charge.status === 'successful';
}
