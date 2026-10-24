import { db } from '@/core/database/client';
import { paymentIdempotencyKeys } from '@/core/database/schema';
import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export type JsonResponseBody = Record<string, unknown>;

type Reservation =
  | { type: 'reserved'; key: string }
  | { type: 'replay'; response: NextResponse }
  | { type: 'processing'; response: NextResponse };

export async function reserveIdempotencyKey(key: string | null): Promise<Reservation | null> {
  if (!key) return null;

  const [inserted] = await db
    .insert(paymentIdempotencyKeys)
    .values({ key, status: 'processing' })
    .onConflictDoNothing()
    .returning({ key: paymentIdempotencyKeys.key });

  if (inserted) {
    return { type: 'reserved', key };
  }

  const existing = await db.query.paymentIdempotencyKeys.findFirst({
    where: eq(paymentIdempotencyKeys.key, key),
  });

  if (existing?.responseBody && existing.responseStatus) {
    return {
      type: 'replay',
      response: NextResponse.json(existing.responseBody as JsonResponseBody, {
        status: existing.responseStatus,
      }),
    };
  }

  return {
    type: 'processing',
    response: NextResponse.json(
      {
        error: 'Este pago ya se está procesando. Esperá la confirmación antes de reintentar.',
      },
      { status: 409 },
    ),
  };
}

export async function completeIdempotencyKey(
  key: string | null,
  responseBody: JsonResponseBody,
  responseStatus = 200,
): Promise<void> {
  if (!key) return;

  await db
    .update(paymentIdempotencyKeys)
    .set({
      status: responseStatus >= 200 && responseStatus < 300 ? 'succeeded' : 'failed',
      responseStatus,
      responseBody,
      updatedAt: new Date(),
    })
    .where(eq(paymentIdempotencyKeys.key, key));
}

/**
 * Releases a reservation so a genuine retry can attempt the charge again.
 *
 * W-P1 reserves the idempotency key BEFORE the external Culqi call (the key's
 * whole purpose is to prevent two in-flight requests from double-charging). That
 * means an attempt which fails BEFORE any money moves — a Culqi order read that
 * times out, an order not yet paid, a declined card, a config error — must not
 * leave the key parked at `processing`. For the ORDER flow the client key is
 * deterministic per Culqi order (`charge-${culqiOrderId}`), so a stale
 * reservation would replay the failure forever and permanently lock the buyer
 * out of an order that later becomes payable.
 *
 * Deletion is guarded by `status = 'processing'` on purpose: a key that was
 * concurrently completed (a committed payment, a recorded failure) must never be
 * removed by a late release, or a replay would re-run the charge.
 */
export async function releaseIdempotencyKey(key: string | null): Promise<void> {
  if (!key) return;

  await db
    .delete(paymentIdempotencyKeys)
    .where(
      and(eq(paymentIdempotencyKeys.key, key), eq(paymentIdempotencyKeys.status, 'processing')),
    );
}
