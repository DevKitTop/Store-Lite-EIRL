import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PushSendDeps,
  PushSendIntent,
  PushSubscriptionRecord,
} from '@/lib/push/webPushSender';
import { sendPushNotifications } from '@/lib/push/webPushSender';

function subscription(overrides: Partial<PushSubscriptionRecord> = {}): PushSubscriptionRecord {
  return {
    id: `sub-${Math.random().toString(36).slice(2)}`,
    userId: `user-${Math.random().toString(36).slice(2)}`,
    endpoint: 'https://push.example/secret-endpoint-token',
    p256dh: 'p256dh-key',
    auth: 'auth-secret',
    failureCount: 0,
    ...overrides,
  };
}

function intent(overrides: Partial<PushSendIntent> = {}): PushSendIntent {
  return {
    businessId: '11111111-1111-4111-8111-111111111111',
    notificationId: '22222222-2222-4222-8222-222222222222',
    category: 'pedidos',
    payload: {
      title: 'Nueva notificación',
      body: 'Tenés una novedad en tu negocio.',
      tag: 'pedidos',
      data: {
        url: '/dashboard/pedidos',
        category: 'pedidos',
        notificationId: '22222222-2222-4222-8222-222222222222',
      },
    },
    ...overrides,
  };
}

interface HarnessOptions {
  subscriptions?: PushSubscriptionRecord[];
  eligible?: boolean;
  send?: PushSendDeps['send'];
}

function harness(options: HarnessOptions = {}) {
  const deps: PushSendDeps = {
    loadSubscriptions: vi.fn().mockResolvedValue(options.subscriptions ?? []),
    isEligible: vi.fn().mockResolvedValue(options.eligible ?? true),
    updateSubscription: vi.fn().mockResolvedValue(undefined),
    send: options.send ?? vi.fn().mockResolvedValue(undefined),
    now: vi.fn().mockReturnValue(new Date('2026-11-20T12:00:00.000Z')),
    sleep: vi.fn().mockResolvedValue(undefined),
  };

  return deps;
}

describe('sendPushNotifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends a privacy-safe payload with bounded options and records success', async () => {
    const sub = subscription();
    const deps = harness({ subscriptions: [sub] });

    const result = await sendPushNotifications(intent(), deps);

    expect(result).toMatchObject({
      attempted: 1,
      sent: 1,
      invalidated: 0,
      configErrors: 0,
      failed: 0,
      skipped: 0,
    });
    expect(result.outcomes).toEqual([{ subscriptionId: sub.id, status: 'sent', attempts: 1 }]);
    expect(deps.send).toHaveBeenCalledTimes(1);

    const [sentSubscription, serializedPayload, sendOptions] = vi.mocked(deps.send).mock.calls[0];
    expect(sentSubscription).toMatchObject({
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
    });
    expect(JSON.parse(serializedPayload as string)).toEqual({
      title: 'Nueva notificación',
      body: 'Tenés una novedad en tu negocio.',
      tag: 'pedidos',
      data: {
        url: '/dashboard/pedidos',
        category: 'pedidos',
        notificationId: '22222222-2222-4222-8222-222222222222',
      },
    });
    expect(sendOptions).toMatchObject({ ttl: 60, urgency: 'high' });
    expect(deps.updateSubscription).toHaveBeenCalledWith(
      sub.id,
      expect.objectContaining({
        failureCount: 0,
        lastFailureAt: null,
        lastFailureCode: null,
      }),
    );
  });

  it('replaces an external click URL with the dashboard root', async () => {
    const deps = harness({
      subscriptions: [subscription()],
      send: vi.fn().mockResolvedValue(undefined),
    });

    await sendPushNotifications(
      intent({
        payload: {
          title: 'Aviso',
          body: 'Cuerpo',
          data: {
            url: 'https://attacker.example/steal?token=abc',
            category: 'pedidos',
            notificationId: 'n-1',
          },
        },
      }),
      deps,
    );

    const [, serializedPayload] = vi.mocked(deps.send).mock.calls[0];
    expect(JSON.parse(serializedPayload as string).data.url).toBe('/');
  });

  it('retries a 429 three times and then records a bounded failure', async () => {
    const sub = subscription({ failureCount: 1 });
    const sendError = Object.assign(new Error('Too Many Requests'), { statusCode: 429 });
    const send = vi.fn().mockRejectedValue(sendError);
    const deps = harness({ subscriptions: [sub], send });

    const result = await sendPushNotifications(intent(), deps);

    expect(send).toHaveBeenCalledTimes(3);
    expect(result.outcomes).toEqual([
      { subscriptionId: sub.id, status: 'failed', attempts: 3, statusCode: 429 },
    ]);
    expect(result.failed).toBe(1);
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(deps.updateSubscription).toHaveBeenCalledWith(
      sub.id,
      expect.objectContaining({ failureCount: 2, lastFailureCode: '429' }),
    );
  });

  it('invalidates a 410 subscription without retrying it', async () => {
    const sub = subscription();
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('Gone'), { statusCode: 410 }));
    const deps = harness({ subscriptions: [sub], send });

    const result = await sendPushNotifications(intent(), deps);

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.invalidated).toBe(1);
    expect(result.outcomes[0]).toMatchObject({
      status: 'invalidated',
      attempts: 1,
      statusCode: 410,
    });
    expect(deps.updateSubscription).toHaveBeenCalledWith(
      sub.id,
      expect.objectContaining({ invalidatedAt: expect.any(Date) }),
    );
  });

  it('treats 401 as a configuration error and does not invalidate the subscription', async () => {
    const sub = subscription();
    const send = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('Unauthorized'), { statusCode: 401 }));
    const deps = harness({ subscriptions: [sub], send });

    const result = await sendPushNotifications(intent(), deps);

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.configErrors).toBe(1);
    expect(result.outcomes[0]).toMatchObject({ status: 'config_error', statusCode: 401 });
    expect(deps.updateSubscription).not.toHaveBeenCalled();
  });

  it('skips subscriptions whose user lost dashboard access', async () => {
    const sub = subscription();
    const deps = harness({ subscriptions: [sub], eligible: false });

    const result = await sendPushNotifications(intent(), deps);

    expect(result.skipped).toBe(1);
    expect(deps.send).not.toHaveBeenCalled();
    expect(deps.isEligible).toHaveBeenCalledWith(intent().businessId, sub.userId);
  });

  it('never writes an endpoint, key or payload body to logs', async () => {
    const sub = subscription();
    const deps = harness({ subscriptions: [sub] });
    const { logger } = await import('@/lib/logger');
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    await sendPushNotifications(intent(), deps);

    const logged = JSON.stringify([...info.mock.calls, ...error.mock.calls]);
    expect(logged).not.toContain(sub.endpoint);
    expect(logged).not.toContain(sub.p256dh);
    expect(logged).not.toContain(sub.auth);
    expect(logged).not.toContain('Nueva notificación');
  });
});
