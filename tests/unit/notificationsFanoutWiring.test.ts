const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  values: vi.fn(),
  returning: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock('@/core/database/client', () => ({
  db: {
    insert: mocks.insert,
  },
}));

vi.mock('@/lib/push/pushFanout', () => ({
  enqueuePushFanout: mocks.enqueue,
}));

import { createBusinessNotification } from '@/lib/notifications';

const created = {
  id: '11111111-1111-4111-8111-111111111111',
  businessId: '22222222-2222-4222-8222-222222222222',
  type: 'order_created',
  category: 'pedidos',
  title: 'Nuevo pedido recibido',
  message: 'Mensaje de prueba',
  data: {},
  isRead: false,
  isDismissed: false,
  createdAt: new Date('2026-11-20T12:00:00.000Z'),
  updatedAt: new Date('2026-11-20T12:00:00.000Z'),
};

describe('createBusinessNotification fan-out wiring (T2.5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockReturnValue({ returning: mocks.returning });
    mocks.returning.mockResolvedValue([created]);
    mocks.enqueue.mockResolvedValue({ candidates: 1, eligible: 1, enqueued: 1 });
  });

  test('returns the durable notification and enqueues fan-out after insert', async () => {
    const result = await createBusinessNotification({
      businessId: created.businessId,
      type: 'order_created',
      category: 'pedidos',
      title: created.title,
      message: created.message,
    });

    expect(result).toEqual(created);
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: created.businessId, category: 'pedidos' }),
    );
    expect(mocks.enqueue).toHaveBeenCalledWith(created);
  });

  test('enqueue failure never fails the notification flow', async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error('outbox unavailable'));

    const result = await createBusinessNotification({
      businessId: created.businessId,
      type: 'order_created',
      category: 'pedidos',
      title: created.title,
      message: created.message,
    });

    expect(result).toEqual(created);
  });
});
