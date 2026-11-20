import { runPushFanoutBatch } from '@/lib/push/pushFanoutWorker';

const fixedNow = new Date('2026-11-20T12:00:00.000Z');

const delivery = {
  id: 'delivery-1',
  notificationId: 'notification-1',
  businessId: 'business-1',
  recipientUserId: 'user-1',
  pushSubscriptionId: 'sub-1',
  attemptCount: 0,
};

const subscription = {
  id: 'sub-1',
  userId: 'user-1',
  endpoint: 'https://push.example/sub-1',
  p256dh: 'p256dh',
  auth: 'auth',
  failureCount: 0,
};

function makeDeps(outcomeStatus: 'sent' | 'failed' | 'config_error' | 'invalidated' | 'skipped') {
  const updateDelivery = vi.fn(async () => undefined);
  const sendPush = vi.fn(async () => ({
    attempted: 1,
    sent: outcomeStatus === 'sent' ? 1 : 0,
    invalidated: outcomeStatus === 'invalidated' ? 1 : 0,
    configErrors: outcomeStatus === 'config_error' ? 1 : 0,
    failed: outcomeStatus === 'failed' ? 1 : 0,
    skipped: outcomeStatus === 'skipped' ? 1 : 0,
    outcomes: [{ subscriptionId: 'sub-1', status: outcomeStatus, attempts: 1 }],
  }));

  return {
    deps: {
      claimDeliveries: vi.fn(async () => [delivery]),
      loadSubscription: vi.fn(async () => subscription),
      isEligible: vi.fn(async () => true),
      sendPush,
      updateDelivery,
      now: () => fixedNow,
    },
    updateDelivery,
    sendPush,
  };
}

describe('runPushFanoutBatch (T2.5)', () => {
  test('revalidates send-time eligibility and skips without sending', async () => {
    const { deps, updateDelivery, sendPush } = makeDeps('sent');
    deps.isEligible = vi.fn(async () => false);

    const result = await runPushFanoutBatch({}, deps);

    expect(result.skipped).toBe(1);
    expect(sendPush).not.toHaveBeenCalled();
    expect(updateDelivery).toHaveBeenCalledWith(
      'delivery-1',
      expect.objectContaining({ status: 'skipped', lastAttemptAt: fixedNow }),
    );
  });

  test('sends only the claimed subscription and records delivered', async () => {
    const { deps, updateDelivery, sendPush } = makeDeps('sent');

    const result = await runPushFanoutBatch({}, deps);

    expect(result.delivered).toBe(1);
    expect(sendPush).toHaveBeenCalledTimes(1);
    const overrides = sendPush.mock.calls[0][1];
    const scoped = await overrides.loadSubscriptions('business-1');
    expect(scoped).toEqual([subscription]);
    expect(updateDelivery).toHaveBeenCalledWith(
      'delivery-1',
      expect.objectContaining({ status: 'delivered', attemptCount: 1, leaseExpiresAt: null }),
    );
  });

  test('failed outcome schedules bounded retry, then terminal failure', async () => {
    const retry = makeDeps('failed');
    const retryResult = await runPushFanoutBatch({ retryDelayMs: 60_000 }, retry.deps);

    expect(retryResult.retryable).toBe(1);
    expect(retry.updateDelivery).toHaveBeenCalledWith(
      'delivery-1',
      expect.objectContaining({
        status: 'retryable_failed',
        attemptCount: 1,
        nextAttemptAt: new Date(fixedNow.getTime() + 60_000),
      }),
    );

    const terminal = makeDeps('failed');
    terminal.deps.claimDeliveries = vi.fn(async () => [{ ...delivery, attemptCount: 2 }]);
    await runPushFanoutBatch({ maxAttempts: 3, retryDelayMs: 60_000 }, terminal.deps);

    expect(terminal.updateDelivery).toHaveBeenCalledWith(
      'delivery-1',
      expect.objectContaining({ status: 'terminal_failed', attemptCount: 3 }),
    );
  });

  test('config_error and invalidated outcomes are terminal', async () => {
    for (const status of ['config_error', 'invalidated'] as const) {
      const ctx = makeDeps(status);
      await runPushFanoutBatch({}, ctx.deps);

      expect(ctx.updateDelivery).toHaveBeenCalledWith(
        'delivery-1',
        expect.objectContaining({
          status: status === 'config_error' ? 'terminal_failed' : 'invalidated',
          lastErrorClass: status,
        }),
      );
    }
  });

  test('claim receives bounded limit and lease window', async () => {
    const ctx = makeDeps('sent');

    await runPushFanoutBatch({ limit: 25, leaseMs: 45_000 }, ctx.deps);

    expect(ctx.deps.claimDeliveries).toHaveBeenCalledWith(25, fixedNow, 45_000);
  });
});
