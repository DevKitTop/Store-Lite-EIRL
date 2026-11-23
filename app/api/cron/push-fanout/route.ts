// ──────────────────────────────────────────
// Cron: Web Push fan-out reconciler
// Server-only outbox worker. No client-callable mutation surface.
// ──────────────────────────────────────────

import { timingSafeEqual } from 'node:crypto';

import { logger, toErrorDetail } from '@/lib/logger';
import { runPushFanoutBatch } from '@/lib/push/pushFanoutWorker';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/** Timing-safe comparison; length mismatch is a mismatch. */
function secretsMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);

  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }

  try {
    return timingSafeEqual(providedBuf, expectedBuf);
  } catch {
    return false;
  }
}

function isAuthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const headerSecret = request.headers.get('x-cron-secret');
  if (headerSecret && secretsMatch(headerSecret, expected)) return true;

  const bearerToken = readBearerToken(request);
  return bearerToken !== null && secretsMatch(bearerToken, expected);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runPushFanoutBatch();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    logger.error('[Cron] push-fanout failed', { error: toErrorDetail(error) });
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
