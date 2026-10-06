import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// The guards query the db through chainable select().from().where() calls with
// three different terminal shapes:
//   - window/template: .where(...).orderBy(...).limit(1)  /  .where(...).limit(1)
//   - rate limit:      .where(...)  (awaited directly, so `where` is thenable)
// The mock sources rows from a queue (per-call) falling back to a default set.
const mocks = vi.hoisted(() => {
  let rows: unknown[] = [];
  let queue: unknown[][] = [];

  const nextRows = (): unknown[] => (queue.length > 0 ? queue.shift()! : rows);

  const select = vi.fn();
  const selectFrom = vi.fn();
  const selectWhere = vi.fn();
  const selectOrderBy = vi.fn();
  const selectLimit = vi.fn();

  const terminal = (): Promise<unknown[]> => Promise.resolve(nextRows());

  select.mockImplementation(() => ({ from: selectFrom }));
  selectFrom.mockImplementation(() => ({ where: selectWhere }));
  // `where` may be the terminal (rate limit) or mid-chain (window/template).
  selectWhere.mockImplementation(() => ({
    orderBy: selectOrderBy,
    limit: selectLimit,
    then: (resolve: (value: unknown[]) => void, reject: (error: unknown) => void) =>
      terminal().then(resolve, reject),
  }));
  selectOrderBy.mockImplementation(() => ({ limit: selectLimit }));
  selectLimit.mockImplementation(terminal);

  return {
    select,
    selectFrom,
    selectWhere,
    selectOrderBy,
    selectLimit,
    setRows: (r: unknown[]): void => {
      rows = r;
    },
    queueRows: (...groups: unknown[][]): void => {
      queue = groups;
    },
    clearQueue: (): void => {
      queue = [];
    },
  };
});

vi.mock('@/core/database/client', () => ({
  db: { select: mocks.select },
}));

import {
  WHATSAPP_SERVICE_WINDOW_MS,
  assertOutboundRateLimit,
  assertTemplateApproved,
  assertWithinServiceWindow,
  resolveRateLimitConfig,
} from '../whatsappSendGuards';

// ── Fixtures / helpers ────────────────────────────────────────────────────────

const NOW = new Date('2026-09-15T12:00:00.000Z');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface MessageRow {
  createdAt: Date | null;
}

interface TemplateRow {
  metaTemplateId: string | null;
}

function inboundRow(createdAt: Date | null): MessageRow {
  return { createdAt };
}

function templateRow(metaTemplateId: string | null): TemplateRow {
  return { metaTemplateId };
}

function outboundRow(id: string): { id: string } {
  return { id };
}

/** Shape of the drizzle SQL nodes we walk (param wrappers + nested SQL). */
interface SqlNodeLike {
  value?: unknown;
  queryChunks?: unknown[];
}

/** Walks a drizzle SQL object collecting the raw Date/string parameter values. */
function collectValues(node: unknown, out: (Date | string)[] = []): (Date | string)[] {
  if (node instanceof Date || typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectValues(item, out);
    return out;
  }
  if (node === null || typeof node !== 'object') return out;
  const sqlNode = node as SqlNodeLike;
  if (sqlNode.value !== undefined) collectValues(sqlNode.value, out);
  if (Array.isArray(sqlNode.queryChunks)) collectValues(sqlNode.queryChunks, out);
  return out;
}

function whereValuesFor(callIndex: number): (Date | string)[] {
  const whereArg = mocks.selectWhere.mock.calls.at(callIndex)?.[0];
  return whereArg === undefined ? [] : collectValues(whereArg);
}

// ── assertWithinServiceWindow ─────────────────────────────────────────────────

describe('assertWithinServiceWindow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.clearQueue();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens when the last inbound message is inside the 24h window', async () => {
    mocks.setRows([inboundRow(new Date(NOW.getTime() - 1 * HOUR))]);

    const result = await assertWithinServiceWindow('conv-9');

    expect(result.ok).toBe(true);
    expect(result.expiresAt).toEqual(new Date(NOW.getTime() - 1 * HOUR + DAY));
    // The query must filter inbound messages only (never rely on lastMessageAt).
    expect(whereValuesFor(0)).toContain('inbound');
  });

  it('expires exactly when the inbound message is 24h old', async () => {
    mocks.setRows([inboundRow(new Date(NOW.getTime() - DAY))]);

    const result = await assertWithinServiceWindow('conv-9');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('WINDOW_EXPIRED');
    expect(result.expiresAt?.getTime()).toBe(NOW.getTime());
  });

  it('stays open 1ms inside the 24h boundary', async () => {
    mocks.setRows([inboundRow(new Date(NOW.getTime() - DAY + 1000))]);

    const result = await assertWithinServiceWindow('conv-9');

    expect(result.ok).toBe(true);
    expect(result.expiresAt?.getTime()).toBe(NOW.getTime() + 1000);
    expect(result.reason).toBeUndefined();
  });

  it('is closed when the inbound message is older than 24h', async () => {
    mocks.setRows([inboundRow(new Date(NOW.getTime() - DAY - 1 * HOUR))]);

    const result = await assertWithinServiceWindow('conv-9');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('WINDOW_EXPIRED');
    expect(result.expiresAt?.getTime()).toBe(NOW.getTime() - 1 * HOUR);
  });

  it('is closed when no inbound message ever exists (customer never wrote first)', async () => {
    mocks.setRows([]);

    const result = await assertWithinServiceWindow('conv-9');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('NO_INBOUND');
    expect(result.expiresAt).toBeUndefined();
  });

  it('is closed when the only inbound message has no createdAt (no `?? now` fallback)', async () => {
    mocks.setRows([inboundRow(null)]);

    const result = await assertWithinServiceWindow('conv-9');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('NO_INBOUND');
  });

  it('asks the DB for the single most recent inbound message (orderBy desc, limit 1)', async () => {
    // DB returns rows ordered desc by createdAt — newest first.
    mocks.setRows([
      inboundRow(new Date(NOW.getTime() - 30 * MINUTE)),
      inboundRow(new Date(NOW.getTime() - DAY)),
    ]);

    const result = await assertWithinServiceWindow('conv-9');

    // Anchors on the newest inbound (rows[0] as delivered by the SQL order).
    expect(result.ok).toBe(true);
    expect(result.expiresAt?.getTime()).toBe(NOW.getTime() - 30 * MINUTE + DAY);
    // The window must never be extended by older inbound messages.
    expect(mocks.selectOrderBy).toHaveBeenCalledTimes(1);
    expect(mocks.selectLimit).toHaveBeenCalledTimes(1);
  });
});

// ── assertTemplateApproved ────────────────────────────────────────────────────

describe('assertTemplateApproved', () => {
  beforeEach(() => {
    mocks.clearQueue();
  });

  it('passes when the channel has an approved template with a metaTemplateId', async () => {
    mocks.queueRows([templateRow('mt-order-confirmed')]);

    const result = await assertTemplateApproved('chan-9', 'order_confirmed');

    expect(result).toBe(true);
    // Channel-approved short-circuits the global fallback query.
    expect(mocks.selectWhere).toHaveBeenCalledTimes(1);
    expect(whereValuesFor(0)).toEqual(
      expect.arrayContaining(['chan-9', 'order_confirmed', 'approved']),
    );
  });

  it('fails when the channel template is still pending for review', async () => {
    mocks.queueRows([], []);

    const result = await assertTemplateApproved('chan-9', 'order_confirmed');

    expect(result).toBe(false);
    expect(mocks.selectWhere).toHaveBeenCalledTimes(2);
  });

  it('fails when the channel template was rejected', async () => {
    mocks.queueRows([], []);

    const result = await assertTemplateApproved('chan-9', 'order_confirmed');

    expect(result).toBe(false);
    expect(whereValuesFor(0)).toEqual(
      expect.arrayContaining(['chan-9', 'order_confirmed', 'approved']),
    );
  });

  it('fails when the approved row lacks a metaTemplateId', async () => {
    mocks.queueRows([templateRow(null)], []);

    const result = await assertTemplateApproved('chan-9', 'order_confirmed');

    expect(result).toBe(false);
    expect(mocks.selectWhere).toHaveBeenCalledTimes(2);
  });

  it('passes via a global (channelId null) approved template as fallback', async () => {
    mocks.queueRows([], [templateRow('mt-global-order-shipped')]);

    const result = await assertTemplateApproved('chan-9', 'order_shipped');

    expect(result).toBe(true);
    expect(mocks.selectWhere).toHaveBeenCalledTimes(2);
    // First query targets the channel; fallback query must NOT filter by it.
    expect(whereValuesFor(0)).toEqual(
      expect.arrayContaining(['chan-9', 'order_shipped', 'approved']),
    );
    expect(whereValuesFor(1)).toEqual(expect.arrayContaining(['order_shipped', 'approved']));
    expect(whereValuesFor(1)).not.toContain('chan-9');
  });

  it('fails when neither the channel nor a global approved template exists', async () => {
    mocks.queueRows([], []);

    const result = await assertTemplateApproved('chan-9', 'order_confirmed');

    expect(result).toBe(false);
    expect(mocks.selectWhere).toHaveBeenCalledTimes(2);
  });
});

// ── assertOutboundRateLimit ───────────────────────────────────────────────────

describe('assertOutboundRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.clearQueue();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows sends when the sliding-window count is under the limit', async () => {
    mocks.setRows([outboundRow('m-1'), outboundRow('m-2'), outboundRow('m-3')]);

    const result = await assertOutboundRateLimit('chan-9');

    expect(result.ok).toBe(true);
    expect(result.current).toBe(3);
    expect(result.limit).toBe(100);
    expect(result.retryAfterSeconds).toBeUndefined();
  });

  it('blocks sends when the count reaches the limit', async () => {
    mocks.setRows(Array.from({ length: 100 }, (_, i) => outboundRow(`m-${i}`)));

    const result = await assertOutboundRateLimit('chan-9');

    expect(result.ok).toBe(false);
    expect(result.current).toBe(100);
    expect(result.limit).toBe(100);
    expect(result.retryAfterSeconds).toBe(300); // 5 min window, safe upper bound
  });

  it('blocks sends when the count exceeds the limit', async () => {
    mocks.setRows(Array.from({ length: 105 }, (_, i) => outboundRow(`m-${i}`)));

    const result = await assertOutboundRateLimit('chan-9');

    expect(result.ok).toBe(false);
    expect(result.current).toBe(105);
    expect(result.retryAfterSeconds).toBe(300);
  });

  it('counts only outbound messages within the sliding window (createdAt >= now - window)', async () => {
    mocks.setRows([outboundRow('m-1')]);

    await assertOutboundRateLimit('chan-9');

    const values = whereValuesFor(0);
    expect(values).toContain('outbound');
    expect(values).toContain('chan-9');
    // Boundary math: the gte lower bound must be exactly now - 5 minutes.
    expect(values).toContainEqual(new Date(NOW.getTime() - 5 * MINUTE));
    expect(values).not.toContainEqual(new Date(NOW.getTime() - 5 * MINUTE - 1));
  });
});

// ── resolveRateLimitConfig (env parsing) ──────────────────────────────────────

describe('resolveRateLimitConfig', () => {
  it('parses the default limit and window from env strings', () => {
    expect(resolveRateLimitConfig('100', '5')).toEqual({ limit: 100, windowMs: 300000 });
  });

  it('parses custom limits and windows', () => {
    expect(resolveRateLimitConfig('250', '10')).toEqual({ limit: 250, windowMs: 600000 });
    expect(resolveRateLimitConfig('3', '15')).toEqual({ limit: 3, windowMs: 900000 });
  });

  it('falls back to safe defaults on unparseable values', () => {
    expect(resolveRateLimitConfig('abc', '0')).toEqual({ limit: 100, windowMs: 300000 });
    expect(resolveRateLimitConfig('-3', '-1')).toEqual({ limit: 100, windowMs: 300000 });
  });

  it('falls back to defaults on non-integer values', () => {
    expect(resolveRateLimitConfig('2.5', '0.5')).toEqual({ limit: 100, windowMs: 300000 });
  });

  it('keeps the 24h service window constant aligned with Meta policy', () => {
    expect(WHATSAPP_SERVICE_WINDOW_MS).toBe(DAY);
  });
});