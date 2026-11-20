import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import * as webPush from 'web-push';

import { env } from '@/config/env';
import type { notificationCategoryEnum } from '@/core/database/schema/enums';
import { pushSubscriptions } from '@/core/database/schema/pushSubscriptions';
import { logger } from '@/lib/logger';

export type PushCategory = (typeof notificationCategoryEnum.enumValues)[number];

export interface PushDeliveryPayload {
  title: string;
  body: string;
  tag?: string;
  data: {
    url: string;
    category: PushCategory;
    notificationId: string;
  };
}

export interface PushSendIntent {
  businessId: string;
  notificationId: string;
  category: PushCategory;
  payload: PushDeliveryPayload;
}

export interface PushSubscriptionRecord {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failureCount: number;
}

export interface SubscriptionPatch {
  updatedAt: Date;
  lastSeenAt?: Date;
  invalidatedAt?: Date;
  failureCount?: number;
  lastFailureAt?: Date | null;
  lastFailureCode?: string | null;
}

export interface SendOptions {
  ttl: number;
  urgency: webPush.Urgency;
}

export type PushDeliveryStatus = 'sent' | 'invalidated' | 'config_error' | 'failed' | 'skipped';

export interface PushDeliveryOutcome {
  subscriptionId: string;
  status: PushDeliveryStatus;
  attempts: number;
  statusCode?: number;
}

export interface PushSendResult {
  attempted: number;
  sent: number;
  invalidated: number;
  configErrors: number;
  failed: number;
  skipped: number;
  outcomes: PushDeliveryOutcome[];
}

export interface PushSendDeps {
  loadSubscriptions: (businessId: string) => Promise<PushSubscriptionRecord[]>;
  isEligible: (businessId: string, userId: string) => Promise<boolean>;
  updateSubscription: (id: string, patch: SubscriptionPatch) => Promise<void>;
  send: (
    subscription: Pick<PushSubscriptionRecord, 'endpoint' | 'p256dh' | 'auth'>,
    payload: string,
    options: SendOptions,
  ) => Promise<void>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

const MAX_SEND_ATTEMPTS = 3;
const MAX_CONCURRENCY = 5;
const MAX_SUBSCRIPTIONS_PER_RUN = 200;
const RETRY_BASE_MS = 100;

const CATEGORY_DELIVERY: Partial<Record<PushCategory, { ttl: number; urgency: webPush.Urgency }>> =
  {
    pedidos: { ttl: 60, urgency: 'high' },
  };

const DEFAULT_DELIVERY = { ttl: 300, urgency: 'normal' } as const;

function getVapidDetails(): webPush.RequestOptions['vapidDetails'] {
  if (!env.vapidPublicKey || !env.vapidPrivateKey || !env.vapidSubject) {
    return undefined;
  }

  return {
    subject: env.vapidSubject,
    publicKey: env.vapidPublicKey,
    privateKey: env.vapidPrivateKey,
  };
}

/** The browser only ever receives this value; private VAPID config stays server-side. */
export function getVapidPublicKey(): string {
  return env.vapidPublicKey;
}

function safeInternalPath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }

  try {
    const url = new URL(value, env.nextPublicAppUrl);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

function buildPayload(intent: PushSendIntent): string {
  return JSON.stringify({
    title: intent.payload.title,
    body: intent.payload.body,
    tag: intent.payload.tag,
    data: {
      url: safeInternalPath(intent.payload.data.url),
      category: intent.payload.data.category,
      notificationId: intent.payload.data.notificationId,
    },
  });
}

function getStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) {
    return undefined;
  }

  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

function defaultDeps(): PushSendDeps {
  const vapidDetails = getVapidDetails();

  return {
    loadSubscriptions: async () => {
      const { db } = await import('@/core/database/client');
      const rows = await db
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
            isNull(pushSubscriptions.revokedAt),
            isNull(pushSubscriptions.invalidatedAt),
            or(
              isNull(pushSubscriptions.expirationTime),
              gt(pushSubscriptions.expirationTime, sql`now()`),
            ),
          ),
        )
        .limit(MAX_SUBSCRIPTIONS_PER_RUN);

      return rows;
    },
    isEligible: async (businessId, userId) => {
      const { getMemberPermissions } = await import('@/lib/permissions/checkPermission');
      const permissions = await getMemberPermissions(businessId, userId);
      return (
        permissions.permissions.includes('dashboard.view') &&
        permissions.permissions.includes('notifications.view')
      );
    },
    updateSubscription: async (id, patch) => {
      const { db } = await import('@/core/database/client');
      await db.update(pushSubscriptions).set(patch).where(eq(pushSubscriptions.id, id));
    },
    send: async (subscription, payload, options) => {
      if (!vapidDetails) {
        throw Object.assign(new Error('VAPID is not configured'), { statusCode: 401 });
      }

      await webPush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        payload,
        { ...options, vapidDetails },
      );
    },
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

interface RetryContext {
  payload: string;
  options: SendOptions;
  deps: PushSendDeps;
}

async function deliverWithRetry(
  subscription: PushSubscriptionRecord,
  context: RetryContext,
): Promise<Omit<PushDeliveryOutcome, 'subscriptionId'>> {
  const { payload, options, deps } = context;

  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
    try {
      await deps.send(subscription, payload, options);
      return { status: 'sent', attempts: attempt };
    } catch (error) {
      const statusCode = getStatusCode(error);

      if (statusCode === 410 || statusCode === 404) {
        return { status: 'invalidated', attempts: attempt, statusCode };
      }

      if (statusCode === 401 || statusCode === 403) {
        return { status: 'config_error', attempts: attempt, statusCode };
      }

      const retryable = statusCode === 429 || statusCode === undefined || statusCode >= 500;
      if (!retryable || attempt === MAX_SEND_ATTEMPTS) {
        return { status: 'failed', attempts: attempt, statusCode };
      }

      await deps.sleep(RETRY_BASE_MS * attempt);
    }
  }

  return { status: 'failed', attempts: MAX_SEND_ATTEMPTS };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];

  for (let offset = 0; offset < items.length; offset += limit) {
    const batch = items.slice(offset, offset + limit);
    results.push(...(await Promise.all(batch.map(worker))));
  }

  return results;
}

function patchForOutcome(
  outcome: Omit<PushDeliveryOutcome, 'subscriptionId'>,
  subscription: PushSubscriptionRecord,
  now: Date,
): SubscriptionPatch | null {
  switch (outcome.status) {
    case 'sent':
      return {
        updatedAt: now,
        lastSeenAt: now,
        failureCount: 0,
        lastFailureAt: null,
        lastFailureCode: null,
      };
    case 'invalidated':
      return {
        updatedAt: now,
        invalidatedAt: now,
        failureCount: subscription.failureCount + 1,
        lastFailureAt: now,
        lastFailureCode: outcome.statusCode ? String(outcome.statusCode) : 'INVALID',
      };
    case 'failed':
      return {
        updatedAt: now,
        failureCount: subscription.failureCount + 1,
        lastFailureAt: now,
        lastFailureCode: outcome.statusCode ? String(outcome.statusCode) : 'NETWORK',
      };
    default:
      return null;
  }
}

/**
 * Best-effort Web Push delivery primitive. It never logs endpoints, keys or
 * payload contents; T2.5 owns fan-out, dedupe and notification outcome writes.
 */
export async function sendPushNotifications(
  intent: PushSendIntent,
  overrides: Partial<PushSendDeps> = {},
): Promise<PushSendResult> {
  const deps: PushSendDeps = { ...defaultDeps(), ...overrides };
  const now = deps.now();
  const result: PushSendResult = {
    attempted: 0,
    sent: 0,
    invalidated: 0,
    configErrors: 0,
    failed: 0,
    skipped: 0,
    outcomes: [],
  };

  const subscriptions = await deps.loadSubscriptions(intent.businessId);
  const eligibilityByUser = new Map<string, boolean>();
  const deliverable: PushSubscriptionRecord[] = [];

  for (const subscription of subscriptions) {
    let eligible = eligibilityByUser.get(subscription.userId);
    if (eligible === undefined) {
      eligible = await deps.isEligible(intent.businessId, subscription.userId);
      eligibilityByUser.set(subscription.userId, eligible);
    }

    if (!eligible) {
      result.skipped += 1;
      result.outcomes.push({
        subscriptionId: subscription.id,
        status: 'skipped',
        attempts: 0,
      });
      continue;
    }

    deliverable.push(subscription);
  }

  const payload = buildPayload(intent);
  const options = CATEGORY_DELIVERY[intent.category] ?? DEFAULT_DELIVERY;

  const outcomes = await mapWithConcurrency(deliverable, MAX_CONCURRENCY, async (subscription) => {
    const delivery = await deliverWithRetry(subscription, { payload, options, deps });
    const patch = patchForOutcome(delivery, subscription, now);
    if (patch) {
      await deps.updateSubscription(subscription.id, patch);
    }

    return { subscriptionId: subscription.id, ...delivery };
  });

  for (const outcome of outcomes) {
    result.attempted += 1;
    result.outcomes.push(outcome);
    if (outcome.status === 'sent') result.sent += 1;
    if (outcome.status === 'invalidated') result.invalidated += 1;
    if (outcome.status === 'config_error') result.configErrors += 1;
    if (outcome.status === 'failed') result.failed += 1;
  }

  logger.info('[push] delivery completed', {
    category: intent.category,
    attempted: result.attempted,
    sent: result.sent,
    invalidated: result.invalidated,
    configErrors: result.configErrors,
    failed: result.failed,
    skipped: result.skipped,
  });

  return result;
}
