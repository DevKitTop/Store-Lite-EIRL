import type { NewPushNotificationDelivery } from '@/core/database/schema';
import {
  buildGenericPushIntent,
  dedupeFanoutCandidates,
  enqueuePushFanout,
} from '@/lib/push/pushFanout';

const notification = {
  id: '11111111-1111-4111-8111-111111111111',
  businessId: '22222222-2222-4222-8222-222222222222',
  category: 'pedidos' as const,
  title: 'SECRETO: cliente Juan',
  message: 'SECRETO: monto 120.00 y dirección privada',
};

describe('enqueuePushFanout (T2.5)', () => {
  test('expands active subscriptions to eligible recipients only', async () => {
    const insertDeliveries = vi.fn(async () => undefined);
    const isEligible = vi.fn(
      async (_businessId: string, userId: string) => userId !== 'ineligible',
    );

    const result = await enqueuePushFanout(notification, {
      loadActiveSubscriptions: async () => [
        { userId: 'eligible', subscriptionId: 'sub-1' },
        { userId: 'ineligible', subscriptionId: 'sub-2' },
      ],
      isEligible,
      insertDeliveries,
    });

    expect(result).toEqual({ candidates: 2, eligible: 1, enqueued: 1 });
    expect(insertDeliveries).toHaveBeenCalledTimes(1);
    const rows = insertDeliveries.mock.calls[0][0] as NewPushNotificationDelivery[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      notificationId: notification.id,
      recipientUserId: 'eligible',
      pushSubscriptionId: 'sub-1',
      status: 'pending',
    });
  });

  test('deduplicates repeated subscription ids before insert', () => {
    expect(
      dedupeFanoutCandidates([
        { userId: 'u1', subscriptionId: 's1' },
        { userId: 'u1', subscriptionId: 's1' },
        { userId: 'u2', subscriptionId: 's2' },
      ]),
    ).toEqual([
      { userId: 'u1', subscriptionId: 's1' },
      { userId: 'u2', subscriptionId: 's2' },
    ]);
  });

  test('never throws when fan-out lookup fails; the notification insert remains successful', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const result = await enqueuePushFanout(notification, {
      loadActiveSubscriptions: async () => {
        throw new Error('db unavailable');
      },
      insertDeliveries: vi.fn(async () => undefined),
      logger,
    });

    expect(result).toEqual({ candidates: 0, eligible: 0, enqueued: 0 });
    expect(logger.error).toHaveBeenCalledWith(
      '[push] fan-out enqueue failed',
      expect.objectContaining({ notificationId: notification.id, errorClass: 'Error' }),
    );
  });

  test('skips categories outside the PWA MVP push scope', async () => {
    const insertDeliveries = vi.fn(async () => undefined);
    const loadActiveSubscriptions = vi.fn(async () => [
      { userId: 'eligible', subscriptionId: 'sub-1' },
    ]);

    const result = await enqueuePushFanout(
      { ...notification, category: 'sistema' },
      { loadActiveSubscriptions, insertDeliveries },
    );

    expect(result).toEqual({ candidates: 0, eligible: 0, enqueued: 0 });
    expect(loadActiveSubscriptions).not.toHaveBeenCalled();
    expect(insertDeliveries).not.toHaveBeenCalled();
  });

  test('generic payload never includes notification title or message', () => {
    const intent = buildGenericPushIntent(notification);
    const serialized = JSON.stringify(intent);

    expect(intent).toMatchObject({
      businessId: notification.businessId,
      notificationId: notification.id,
      category: 'pedidos',
      payload: {
        data: { url: '/dashboard', category: 'pedidos', notificationId: notification.id },
      },
    });
    expect(serialized).not.toContain('SECRETO');
    expect(serialized).not.toContain('120.00');
  });
});
