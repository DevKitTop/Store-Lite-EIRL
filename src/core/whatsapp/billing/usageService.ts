// =====================================================
// WHATSAPP USAGE / BILLING PASSTHROUGH SERVICE
// Aggregates Meta per-message cost from whatsapp_messages
// joined with whatsapp_channels, per seller (businessId).
// =====================================================

import { and, eq, gte, lt } from 'drizzle-orm';

import { db } from '@/core/database/client';
import { whatsappChannels, whatsappMessages } from '@/core/database/schema';

export interface UsageBreakdownEntry {
  messageId: string;
  ycloudMessageId: string;
  direction: 'inbound' | 'outbound';
  type: 'text' | 'template' | 'media' | 'interactive';
  status: string;
  metaPrice: string | null;
  metaCurrency: string | null;
  createdAt: Date | null;
}

export interface DirectionUsage {
  count: number;
  costByCurrency: Record<string, number>;
}

export interface MonthlyUsageReport {
  period: { year: number; month: number };
  totalMessages: number;
  totalCostByCurrency: Record<string, number>;
  byDirection: {
    inbound: DirectionUsage;
    outbound: DirectionUsage;
  };
  byType: Record<string, DirectionUsage>;
  breakdown: UsageBreakdownEntry[];
}

export interface MonthlyUsageOptions {
  year?: number;
  month?: number;
  /** Restrict to a single channel when provided; otherwise all business channels. */
  channelId?: string;
}

/** Aggregates parsed prices into a per-currency map, rounding each total to 2 decimals. */
function buildCostMap(priced: { price: number; currency: string }[]): Record<string, number> {
  const raw: Record<string, number> = {};
  for (const { price, currency } of priced) {
    raw[currency] = (raw[currency] ?? 0) + price;
  }

  const rounded: Record<string, number> = {};
  for (const [currency, total] of Object.entries(raw)) {
    rounded[currency] = Math.round(total * 100) / 100;
  }
  return rounded;
}

/**
 * Returns the monthly Meta usage report for a business's WhatsApp channels.
 * Costs come from `whatsapp_messages.metaPrice` (text) parsed to float;
 * messages without a parseable price are counted but contribute no cost.
 * The period defaults to the current month, using UTC month boundaries.
 */
export async function getMonthlyUsage(
  businessId: string,
  opts: MonthlyUsageOptions = {},
): Promise<MonthlyUsageReport> {
  const now = new Date();
  const year = opts.year ?? now.getUTCFullYear();
  const month = opts.month ?? now.getUTCMonth() + 1;

  const startOfMonth = new Date(Date.UTC(year, month - 1, 1));
  const startOfNextMonth = new Date(Date.UTC(year, month, 1));

  const conditions = [
    eq(whatsappChannels.businessId, businessId),
    gte(whatsappMessages.createdAt, startOfMonth),
    lt(whatsappMessages.createdAt, startOfNextMonth),
  ];
  if (opts.channelId) {
    conditions.push(eq(whatsappMessages.channelId, opts.channelId));
  }

  const rows = await db
    .select({
      id: whatsappMessages.id,
      ycloudMessageId: whatsappMessages.ycloudMessageId,
      direction: whatsappMessages.direction,
      type: whatsappMessages.type,
      status: whatsappMessages.status,
      metaPrice: whatsappMessages.metaPrice,
      metaCurrency: whatsappMessages.metaCurrency,
      createdAt: whatsappMessages.createdAt,
    })
    .from(whatsappMessages)
    .innerJoin(whatsappChannels, eq(whatsappMessages.channelId, whatsappChannels.id))
    .where(and(...conditions));

  const pricedRows = rows
    .map((row) => {
      if (row.metaPrice === null) return null;
      const price = Number.parseFloat(row.metaPrice);
      if (Number.isNaN(price)) return null;
      return {
        direction: row.direction,
        type: row.type,
        price,
        currency: row.metaCurrency ?? 'USD',
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const countBy = (predicate: (row: (typeof rows)[number]) => boolean): number =>
    rows.filter(predicate).length;

  const byType: Record<string, DirectionUsage> = {};
  for (const type of [...new Set(rows.map((row) => row.type))].sort()) {
    byType[type] = {
      count: countBy((row) => row.type === type),
      costByCurrency: buildCostMap(pricedRows.filter((row) => row.type === type)),
    };
  }

  return {
    period: { year, month },
    totalMessages: rows.length,
    totalCostByCurrency: buildCostMap(pricedRows),
    byDirection: {
      inbound: {
        count: countBy((row) => row.direction === 'inbound'),
        costByCurrency: buildCostMap(pricedRows.filter((row) => row.direction === 'inbound')),
      },
      outbound: {
        count: countBy((row) => row.direction === 'outbound'),
        costByCurrency: buildCostMap(pricedRows.filter((row) => row.direction === 'outbound')),
      },
    },
    byType,
    breakdown: rows.map((row) => ({
      messageId: row.id,
      ycloudMessageId: row.ycloudMessageId,
      direction: row.direction,
      type: row.type,
      status: row.status,
      metaPrice: row.metaPrice,
      metaCurrency: row.metaCurrency,
      createdAt: row.createdAt,
    })),
  };
}