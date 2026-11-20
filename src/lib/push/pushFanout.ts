// =====================================================
// PUSH FAN-OUT ENQUEUE (PWA P2, T2.5)
// =====================================================
// Best-effort producer for the durable Web Push outbox. It never throws into
// the trusted notification path: inbox durability is authoritative and the
// reconciler can backfill any delivery that is not enqueued inline.
// =====================================================

import type { NewPushNotificationDelivery } from '@/core/database/schema';
import { logger } from '@/lib/logger';
import type { PushCategory, PushSendIntent } from '@/lib/push/webPushSender';

export interface FanoutNotification {
  id: string;
  businessId: string;
  category: PushCategory;
  title: string;
  message: string;
}

export interface FanoutCandidate {
  userId: string;
  subscriptionId: string;
}

export interface EnqueueFanoutDeps {
  loadActiveSubscriptions: () => Promise<FanoutCandidate[]>;
  isEligible: (businessId: string, userId: string) => Promise<boolean>;
  insertDeliveries: (rows: NewPushNotificationDelivery[]) => Promise<void>;
  now: () => Date;
  logger: Pick<typeof logger, 'info' | 'error'>;
}

export interface EnqueueFanoutResult {
  candidates: number;
  eligible: number;
  enqueued: number;
}

const CATEGORY_COPY: Partial<Record<PushCategory, string>> = {
  pedidos: 'Tenés una nueva notificación de pedidos.',
};

/** Device/endpoint uniqueness is the dedupe key for one notification. */
export function dedupeFanoutCandidates(candidates: FanoutCandidate[]): FanoutCandidate[] {
  const seen = new Set<string>();
  const unique: FanoutCandidate[] = [];

  for (const candidate of candidates) {
    if (seen.has(candidate.subscriptionId)) continue;
    seen.add(candidate.subscriptionId);
    unique.push(candidate);
  }

  return unique;
}

/**
 * Generic payload only. Notification title/message can contain customer data,
 * so T2.5 deliberately does not copy them into the push message (T0.3/T2.6).
 */
export function buildGenericPushIntent(notification: FanoutNotification): PushSendIntent {
  return {
    businessId: notification.businessId,
    notificationId: notification.id,
    category: notification.category,
    payload: {
      title: 'Nueva notificación de Store Lite',
      body: CATEGORY_COPY[notification.category] ?? 'Tenés una nueva notificación.',
      tag: `notification-${notification.id}`,
      data: {
        url: '/dashboard',
        category: notification.category,
        notificationId: notification.id,
      },
    },
  };
}

async function defaultDeps(): Promise<EnqueueFanoutDeps> {
  return {
    loadActiveSubscriptions: async () => {
      const { db } = await import('@/core/database/client');
      const { pushSubscriptions } = await import('@/core/database/schema/pushSubscriptions');
      const { and, gt, isNull, or, sql } = await import('drizzle-orm');

      return db
        .select({
          userId: pushSubscriptions.userId,
          subscriptionId: pushSubscriptions.id,
        })
        .from(pushSubscriptions)
        .where(
          and(
            isNull(pushSubscriptions.revokedAt),
            isNull(pushSubscriptions.invalidatedAt),
            or(
              isNull(pushSubscriptions.expirationTime),
              gt(pushSubscriptions.expirationTime, sql`now()`),
            ),
          ),
        );
    },
    isEligible: async (businessId, userId) => {
      const { getMemberPermissions } = await import('@/lib/permissions/checkPermission');
      const permissions = await getMemberPermissions(businessId, userId);
      return (
        permissions.permissions.includes('dashboard.view') &&
        permissions.permissions.includes('notifications.view')
      );
    },
    insertDeliveries: async (rows) => {
      if (rows.length === 0) return;
      const { db } = await import('@/core/database/client');
      const { pushNotificationDeliveries } =
        await import('@/core/database/schema/pushNotificationDeliveries');

      await db
        .insert(pushNotificationDeliveries)
        .values(rows)
        .onConflictDoNothing({
          target: [
            pushNotificationDeliveries.notificationId,
            pushNotificationDeliveries.recipientUserId,
            pushNotificationDeliveries.pushSubscriptionId,
          ],
        });
    },
    now: () => new Date(),
    logger,
  };
}

/** Enqueue one delivery row per eligible active device. Never throws. */
export async function enqueuePushFanout(
  notification: FanoutNotification,
  overrides: Partial<EnqueueFanoutDeps> = {},
): Promise<EnqueueFanoutResult> {
  const empty: EnqueueFanoutResult = { candidates: 0, eligible: 0, enqueued: 0 };
  let activeLogger = overrides.logger ?? logger;

  try {
    if (notification.category !== 'pedidos') {
      return empty;
    }

    const deps: EnqueueFanoutDeps = { ...(await defaultDeps()), ...overrides };
    activeLogger = deps.logger;
    const candidates = dedupeFanoutCandidates(await deps.loadActiveSubscriptions());
    const rows: NewPushNotificationDelivery[] = [];

    for (const candidate of candidates) {
      if (await deps.isEligible(notification.businessId, candidate.userId)) {
        rows.push({
          notificationId: notification.id,
          recipientUserId: candidate.userId,
          pushSubscriptionId: candidate.subscriptionId,
          status: 'pending',
          attemptCount: 0,
          nextAttemptAt: deps.now(),
        });
      }
    }

    await deps.insertDeliveries(rows);
    return { candidates: candidates.length, eligible: rows.length, enqueued: rows.length };
  } catch (error) {
    activeLogger.error('[push] fan-out enqueue failed', {
      notificationId: notification.id,
      errorClass: error instanceof Error ? error.name : 'UnknownError',
    });
    return empty;
  }
}
