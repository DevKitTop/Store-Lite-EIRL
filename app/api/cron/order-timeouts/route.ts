// ──────────────────────────────────────────
// Cron: Order Timeouts
// Vercel Cron Job — runs every 15 minutes
// Processes expired orders (seller inactivity, customer auto-approve, auto-complete)
// DS 011 (FU-1): also runs the auto-deactivation sweeps
//   (processExpiredGracePeriods + processAppealSLABreaches) on the same tick.
//   No new cron route: this IS the existing T16 cron they hook into.
// ──────────────────────────────────────────

import { env } from '@/config/env';
import { processTimeouts } from '@/core/orders/orderTimeouts';
import { processAppealSLABreaches, processExpiredGracePeriods } from '@/lib/deactivation';
import { logger, toErrorDetail } from '@/lib/logger';
import { NextResponse } from 'next/server';

// Vercel Cron: */15 * * * *
// Triggered via Supabase pg_cron → HTTP POST to storelite.app/api/cron/order-timeouts
export async function GET(request: Request) {
  // Auth: requires CRON_SECRET via ?token= or Authorization: Bearer header
  const url = new URL(request.url);
  const token =
    url.searchParams.get('token') ||
    request.headers.get('authorization')?.replace('Bearer ', '') ||
    '';
  if (!token || token !== env.cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 1) Standard order timeouts (existing behavior — fatal on failure)
  let orderResult: Awaited<ReturnType<typeof processTimeouts>>;
  try {
    orderResult = await processTimeouts();
  } catch (error) {
    logger.error('[Cron] order-timeouts: error —', { error: toErrorDetail(error) });
    return NextResponse.json({ success: false, error: String(error) }, { status: 500 });
  }

  // 2) DS 011 auto-deactivation sweeps — flag-gated and NON-FATAL.
  //    A failing sweep is reported via autoDeactivationErrors instead of
  //    failing the whole cron tick (the sweeps are best-effort by design).
  const autoDeactivationEnabled = process.env.ENABLE_AUTO_DEACTIVATION === 'true';
  let gracePeriodsProcessed = 0;
  let appealSlaProcessed = 0;
  let autoDeactivationErrors = 0;

  if (autoDeactivationEnabled) {
    try {
      gracePeriodsProcessed = (await processExpiredGracePeriods()).processed;
    } catch (error) {
      autoDeactivationErrors += 1;
      logger.error('[Cron] order-timeouts: grace-period sweep error —', {
        error: toErrorDetail(error),
      });
    }

    try {
      appealSlaProcessed = (await processAppealSLABreaches()).processed;
    } catch (error) {
      autoDeactivationErrors += 1;
      logger.error('[Cron] order-timeouts: appeal-SLA sweep error —', {
        error: toErrorDetail(error),
      });
    }
  }

  const deactivationSummary = autoDeactivationEnabled
    ? { gracePeriodsProcessed, appealSlaProcessed, autoDeactivationErrors }
    : {};

  return NextResponse.json({ success: true, ...orderResult, ...deactivationSummary });
}
