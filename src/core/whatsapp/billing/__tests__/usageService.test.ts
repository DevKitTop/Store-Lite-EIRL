import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// db.select({...}).from(whatsappMessages).innerJoin(whatsappChannels, ...).where(...)
const mocks = vi.hoisted(() => {
  const selectWhere = vi.fn();
  const selectInnerJoin = vi.fn(() => ({ where: selectWhere }));
  const selectFrom = vi.fn(() => ({ innerJoin: selectInnerJoin }));
  const select = vi.fn(() => ({ from: selectFrom }));

  return { select, selectFrom, selectInnerJoin, selectWhere };
});

vi.mock('@/core/database/client', () => ({
  db: { select: mocks.select },
}));

import { getMonthlyUsage } from '../usageService';

interface MessageRow {
  id: string;
  channelId: string;
  direction: 'inbound' | 'outbound';
  type: 'text' | 'template' | 'media' | 'interactive';
  status: string;
  ycloudMessageId: string;
  metaPrice: string | null;
  metaCurrency: string | null;
  createdAt: Date;
}

function messageRow(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'msg-1',
    channelId: 'chan-1',
    direction: 'inbound',
    type: 'text',
    status: 'delivered',
    ycloudMessageId: 'ycloud-1',
    metaPrice: '0.05',
    metaCurrency: 'USD',
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    ...overrides,
  };
}

describe('getMonthlyUsage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Midnight UTC lands mid-September in every timezone (UTC-12..+14),
    // so the local month is always September (9).
    vi.setSystemTime(new Date('2026-09-15T00:00:00.000Z'));
    mocks.selectWhere.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aggregates counts and costs grouped by direction, type, and currency', async () => {
    mocks.selectWhere.mockResolvedValue([
      messageRow({ id: 'msg-1', ycloudMessageId: 'y-1', status: 'delivered', metaPrice: '0.05' }),
      messageRow({ id: 'msg-2', ycloudMessageId: 'y-2', status: 'read', metaPrice: '0.07' }),
      messageRow({ id: 'msg-3', ycloudMessageId: 'y-3', status: 'sent', metaPrice: null, metaCurrency: null }),
      messageRow({
        id: 'msg-4',
        ycloudMessageId: 'y-4',
        direction: 'outbound',
        type: 'template',
        status: 'delivered',
        metaPrice: '0.0315',
      }),
      messageRow({
        id: 'msg-5',
        ycloudMessageId: 'y-5',
        direction: 'outbound',
        type: 'template',
        status: 'delivered',
        metaPrice: '0.0315',
      }),
      messageRow({
        id: 'msg-6',
        ycloudMessageId: 'y-6',
        direction: 'outbound',
        type: 'template',
        status: 'delivered',
        metaPrice: '0.09',
        metaCurrency: 'EUR',
      }),
      messageRow({
        id: 'msg-7',
        ycloudMessageId: 'y-7',
        direction: 'outbound',
        type: 'media',
        status: 'failed',
        metaPrice: '0.02',
        metaCurrency: null,
      }),
    ]);

    const report = await getMonthlyUsage('bus-1');

    expect(report.period).toEqual({ year: 2026, month: 9 });
    expect(report.totalMessages).toBe(7);

    expect(report.totalCostByCurrency).toEqual({ USD: 0.2, EUR: 0.09 });

    expect(report.byDirection.inbound).toEqual({ count: 3, costByCurrency: { USD: 0.12 } });
    expect(report.byDirection.outbound).toEqual({
      count: 4,
      costByCurrency: { USD: 0.08, EUR: 0.09 },
    });

    expect(report.byType.text).toEqual({ count: 3, costByCurrency: { USD: 0.12 } });
    expect(report.byType.template).toEqual({
      count: 3,
      costByCurrency: { USD: 0.06, EUR: 0.09 },
    });
    expect(report.byType.media).toEqual({ count: 1, costByCurrency: { USD: 0.02 } });

    expect(report.breakdown).toHaveLength(7);
    expect(report.breakdown[0]).toEqual({
      messageId: 'msg-1',
      ycloudMessageId: 'y-1',
      direction: 'inbound',
      type: 'text',
      status: 'delivered',
      metaPrice: '0.05',
      metaCurrency: 'USD',
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });
  });

  it('rounds per-group costs to 2 decimal places', async () => {
    // 0.0315 + 0.0315 = 0.063 → 0.06
    mocks.selectWhere.mockResolvedValue([
      messageRow({
        id: 'msg-a',
        direction: 'outbound',
        type: 'template',
        metaPrice: '0.0315',
      }),
      messageRow({
        id: 'msg-b',
        direction: 'outbound',
        type: 'template',
        metaPrice: '0.0315',
      }),
    ]);

    const report = await getMonthlyUsage('bus-1');

    expect(report.byDirection.outbound.costByCurrency).toEqual({ USD: 0.06 });
    expect(report.byType.template.costByCurrency).toEqual({ USD: 0.06 });
    expect(report.totalCostByCurrency).toEqual({ USD: 0.06 });
  });

  it('skips null and non-numeric prices but still counts the messages', async () => {
    mocks.selectWhere.mockResolvedValue([
      messageRow({ id: 'msg-x', metaPrice: null, metaCurrency: null }),
      messageRow({ id: 'msg-y', metaPrice: 'not-a-price', metaCurrency: 'USD' }),
      messageRow({ id: 'msg-z', metaPrice: '0.05', metaCurrency: 'USD' }),
    ]);

    const report = await getMonthlyUsage('bus-1');

    expect(report.totalMessages).toBe(3);
    expect(report.totalCostByCurrency).toEqual({ USD: 0.05 });
    expect(report.byDirection.inbound.count).toBe(3);
    expect(report.byDirection.inbound.costByCurrency).toEqual({ USD: 0.05 });
  });

  it('defaults to the current month when no period is given', async () => {
    mocks.selectWhere.mockResolvedValue([]);

    const report = await getMonthlyUsage('bus-1');

    expect(report.period).toEqual({ year: 2026, month: 9 });
    expect(mocks.selectWhere).toHaveBeenCalledTimes(1);
  });

  it('honors the requested year/month and the optional channelId filter', async () => {
    mocks.selectWhere.mockResolvedValue([]);

    const report = await getMonthlyUsage('bus-1', {
      year: 2025,
      month: 2,
      channelId: 'chan-9',
    });

    expect(report.period).toEqual({ year: 2025, month: 2 });
    expect(report.totalMessages).toBe(0);
    expect(mocks.selectWhere).toHaveBeenCalledTimes(1);
  });
});