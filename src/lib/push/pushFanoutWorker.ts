// =====================================================
// PUSH FAN-OUT WORKER (PWA P2, T2.5)
// =====================================================
// Claims durable delivery rows, revalidates eligibility at send time, calls
// the T2.4 sender for exactly one device, and records a bounded outcome.
// =====================================================

import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';

import type { PushDeliveryStatus as OutboxStatus } from '@/core/database/schema/pushNotificationDeliveries';
import { logger } from '@/lib/logger';
import { buildGenericPushIntent, type FanoutNotification } from '@/lib/push/pushFanout';
import type {
  PushCategory,
  PushSendDeps,
  PushSendIntent,
  PushSendResult,
  PushSubscriptionRecord,
} from '@/lib/push/webPushSender';

export interface ClaimedDelivery {
  id: string;
  notificationId: string;
  businessId: string;
  category: PushCategory;
  recipientUserId: string;
  pushSubscriptionId: string;
  attemptCount: number;
}

export interface DeliveryPatch {
  status: OutboxStatus;
  attemptCount?: number;
  nextAttemptAt?: Date;
  lastAttemptAt?: Date;
  leaseExpiresAt?: Date | null;
  providerStatusCode?: number | null;
  lastErrorClass?: string | null;
}

export interface FanoutWorkerOptions {
  limit?: number;
  leaseMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export interface FanoutWorkerDeps {
  claimDeliveries: (limit: number, now: Date, leaseMs: number) => Promise<ClaimedDelivery[]>;
  loadSubscription: (
    subscriptionId: string,
    userId: string,
  ) => Promise<PushSubscriptionRecord | null>;
  isEligible: (businessId: string, userId: string) => Promise<boolean>;
  sendPush: (intent: PushSendIntent, overrides: Partial<PushSendDeps>) => Promise<PushSendResult>;
  updateDelivery: (id: string, patch: DeliveryPatch) => Promise<void>;
  now: () => Date;
  logger: Pick<typeof logger, 'info' | 'error'>;
}

export interface FanoutBatchResult {
  claimed: number;
  delivered: number;
  retryable: number;
  terminal: number;
  invalidated: number;
  skipped: number;
}

const DEFAULT_OPTIONS = {
  limit: 100,
  leaseMs: 60_000,
  maxAttempts: 3,
  retryDelayMs: 60_000,
} as const;

type ClaimRow = ClaimedDelivery;

async function defaultDeps(): Promise<FanoutWorkerDeps> {
  return {
    claimDeliveries: async (limit, now, leaseMs) => {
      const { db } = await import('@/core/database/client');
      const leaseExpiresAt = new Date(now.getTime() + leaseMs);
      const rows = (await db.execute(sql`
        WITH candidates AS (
          SELECT d.id, n.business_id, n.category
          FROM "public"."push_notification_deliveries" d
          JOIN "public"."notifications" n ON n.id = d.notification_id
          WHERE
            (
              d.status IN ('pending', 'retryable_failed')
              AND d.next_attempt_at <= ${now}
            )
            OR (
              d.status = 'processing'
              AND d.lease_expires_at IS NOT NULL
              AND d.lease_expires_at <= ${now}
            )
          ORDER BY d.next_attempt_at ASC
          LIMIT ${limit}
        )
        UPDATE "public"."push_notification_deliveries" d
        SET status = 'processing', lease_expires_at = ${leaseExpiresAt}, updated_at = ${now}
        FROM candidates c
        WHERE d.id = c.id
        RETURNING
          d.id,
          d.notification_id AS "notificationId",
          c.business_id AS "businessId",
          c.category,
          d.recipient_user_id AS "recipientUserId",
          d.push_subscription_id AS "pushSubscriptionId",
          d.attempt_count AS "attemptCount"
      `)) as unknown as ClaimRow[];

      return rows.map((row) => ({
        id: row.id,
        notificationId: row.notificationId,
        businessId: row.businessId,
        category: row.category,
        recipientUserId: row.recipientUserId,
        pushSubscriptionId: row.pushSubscriptionId,
        attemptCount: Number(row.attemptCount),
      }));
    },
    loadSubscription: async (subscriptionId, userId) => {
      const { db } = await import('@/core/database/client');
      const { pushSubscriptions } = await import('@/core/database/schema/pushSubscriptions');

      const [row] = await db
        .select({
          id: pushSubscriptions.id,
          userId: pushSubscriptions.userId,
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
          failureCount: pushSubscriptions.failureCount,
        })
        .from(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.id, subscriptionId),
            eq(pushSubscriptions.userId, userId),
            isNull(pushSubscriptions.revokedAt),
            isNull(pushSubscriptions.invalidatedAt),
            or(
              isNull(pushSubscriptions.expirationTime),
              gt(pushSubscriptions.expirationTime, sql`now()`),
            ),
          ),
        )
        .limit(1);

      return row ?? null;
    },
    isEligible: async (businessId, userId) => {
      const { getMemberPermissions } = await import('@/lib/permissions/checkPermission');
      const permissions = await getMemberPermissions(businessId, userId);
      return (
        permissions.permissions.includes('dashboard.view') &&
        permissions.permissions.includes('notifications.view')
      );
    },
    sendPush: async (intent, overrides) => {
      const { sendPushNotifications } = await import('@/lib/push/webPushSender');
      return sendPushNotifications(intent, overrides);
    },
    updateDelivery: async (id, patch) => {
      const { db } = await import('@/core/database/client');
      const { pushNotificationDeliveries } =
        await import('@/core/database/schema/pushNotificationDeliveries');

      await db
        .update(pushNotificationDeliveries)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(pushNotificationDeliveries.id, id));
    },
    now: () => new Date(),
    logger,
  };
}

type DeliveryOutcome = PushSendResult['outcomes'][number];

interface BatchRun {
  deps: FanoutWorkerDeps;
  now: Date;
  maxAttempts: number;
  retryDelayMs: number;
  summary: FanoutBatchResult;
}

function terminalStatus(outcome: DeliveryOutcome): OutboxStatus {
  if (outcome.status === 'invalidated') return 'invalidated';
  if (outcome.status === 'skipped') return 'skipped';
  return 'terminal_failed';
}

async function recordOutcome(
  delivery: ClaimedDelivery,
  outcome: DeliveryOutcome,
  run: BatchRun,
): Promise<void> {
  const { deps, now, maxAttempts, retryDelayMs, summary } = run;
  const attemptCount = delivery.attemptCount + 1;
  const basePatch: Omit<DeliveryPatch, 'status'> = {
    attemptCount,
    lastAttemptAt: now,
    leaseExpiresAt: null,
    providerStatusCode: outcome.statusCode ?? null,
    lastErrorClass: null,
  };

  if (outcome.status === 'sent') {
    await deps.updateDelivery(delivery.id, { ...basePatch, status: 'delivered' });
    summary.delivered += 1;
    return;
  }

  if (outcome.status === 'failed' && attemptCount < maxAttempts) {
    await deps.updateDelivery(delivery.id, {
      ...basePatch,
      status: 'retryable_failed',
      nextAttemptAt: new Date(now.getTime() + retryDelayMs),
      lastErrorClass: 'failed',
    });
    summary.retryable += 1;
    return;
  }

  await deps.updateDelivery(delivery.id, {
    ...basePatch,
    status: terminalStatus(outcome),
    lastErrorClass:
      outcome.status === 'skipped'
        ? null
        : (outcome.status as 'failed' | 'config_error' | 'invalidated'),
  });
  summary.terminal += 1;
  if (outcome.status === 'invalidated') summary.invalidated += 1;
  if (outcome.status === 'skipped') summary.skipped += 1;
}

async function recordException(
  delivery: ClaimedDelivery,
  error: unknown,
  run: BatchRun,
): Promise<void> {
  const { deps, now, maxAttempts, retryDelayMs, summary } = run;
  const attemptCount = delivery.attemptCount + 1;
  const retryable = attemptCount < maxAttempts;
  const errorClass = error instanceof Error ? error.name : 'UnknownError';

  await deps.updateDelivery(delivery.id, {
    status: retryable ? 'retryable_failed' : 'terminal_failed',
    attemptCount,
    lastAttemptAt: now,
    nextAttemptAt: retryable ? new Date(now.getTime() + retryDelayMs) : undefined,
    leaseExpiresAt: null,
    lastErrorClass: errorClass,
  });
  deps.logger.error('[push] fan-out delivery failed', {
    deliveryId: delivery.id,
    errorClass,
  });
  if (retryable) summary.retryable += 1;
  else summary.terminal += 1;
}

async function processDelivery(delivery: ClaimedDelivery, run: BatchRun): Promise<void> {
  const { deps, now, summary } = run;
  const notification: FanoutNotification = {
    id: delivery.notificationId,
    businessId: delivery.businessId,
    category: delivery.category,
    title: '',
    message: '',
  };

  try {
    const subscription = await deps.loadSubscription(
      delivery.pushSubscriptionId,
      delivery.recipientUserId,
    );
    const eligible = subscription
      ? await deps.isEligible(delivery.businessId, delivery.recipientUserId)
      : false;

    if (!subscription || !eligible) {
      await deps.updateDelivery(delivery.id, {
        status: 'skipped',
        attemptCount: delivery.attemptCount,
        lastAttemptAt: now,
        leaseExpiresAt: null,
      });
      summary.skipped += 1;
      return;
    }

    const result = await deps.sendPush(buildGenericPushIntent(notification), {
      loadSubscriptions: async () => [subscription],
      isEligible: async () => true,
    });
    const outcome = result.outcomes.find(
      (candidate) => candidate.subscriptionId === delivery.pushSubscriptionId,
    ) ?? { subscriptionId: delivery.pushSubscriptionId, status: 'failed', attempts: 1 };

    await recordOutcome(delivery, outcome, run);
  } catch (error) {
    await recordException(delivery, error, run);
  }
}

/** Process one bounded batch of durable delivery rows. */
export async function runPushFanoutBatch(
  options: FanoutWorkerOptions = {},
  overrides: Partial<FanoutWorkerDeps> = {},
): Promise<FanoutBatchResult> {
  const deps: FanoutWorkerDeps = { ...(await defaultDeps()), ...overrides };
  const {
    limit = DEFAULT_OPTIONS.limit,
    leaseMs = DEFAULT_OPTIONS.leaseMs,
    maxAttempts = DEFAULT_OPTIONS.maxAttempts,
    retryDelayMs = DEFAULT_OPTIONS.retryDelayMs,
  } = options;
  const now = deps.now();
  const claimed = await deps.claimDeliveries(limit, now, leaseMs);
  const summary: FanoutBatchResult = {
    claimed: claimed.length,
    delivered: 0,
    retryable: 0,
    terminal: 0,
    invalidated: 0,
    skipped: 0,
  };
  const run: BatchRun = { deps, now, maxAttempts, retryDelayMs, summary };

  for (const delivery of claimed) {
    await processDelivery(delivery, run);
  }

  deps.logger.info('[push] fan-out batch completed', { ...summary });
  return summary;
}
