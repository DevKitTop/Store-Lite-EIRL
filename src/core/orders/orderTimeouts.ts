// ──────────────────────────────────────────
// Order Timeouts
// Auto-transitions for orders past their timeout threshold.
// Called by Vercel Cron (T16) or on-demand.
// ──────────────────────────────────────────

import { db } from '@/core/database/client';
import { businesses, payments, penalties } from '@/core/database/schema';
import { and, eq, lt, or, sql } from 'drizzle-orm';

import {
  PENALTY_A_DESCRIPTION,
  PENALTY_A_PERCENTAGE,
  PENALTY_A_TITLE,
  PENALTY_B_DESCRIPTION,
  PENALTY_B_PERCENTAGE,
  PENALTY_B_TITLE,
  PenaltyType,
} from '@/core/penalties/penaltyTypes';
import { processOrderCompletion } from '@/lib/deactivation';
import { checkIncompleteOrderDeactivation } from '@/lib/incompleteOrderRate';
import { logger } from '@/lib/logger';
import { transition } from './orderService';
import type { OrderStatusV2 } from './orderStatus';
import { ORDER_STATUS, ORDER_STATUS_V2 } from './orderStatus';

// ─── Timeout config ───

interface TimeoutRule {
  /** Human-readable label for logging */
  label: string;
  /** Legacy DB status (if migration not applied) */
  legacyStatus: string;
  /** V2 DB status (if migration applied) */
  v2Status: OrderStatusV2;
  /** Additional V2 statuses to match (used by penalty rules for cumulative seller states) */
  extraV2Statuses?: OrderStatusV2[];
  /** Target V2 status for the auto-transition (unused for 'penalty' rules) */
  toStatus: OrderStatusV2;
  /** Hours since updatedAt after which this timeout applies */
  hours: number;
  /** Rule type: 'transition' calls transition(), 'penalty' creates a penalty record */
  type: 'transition' | 'penalty';
  /** For 'penalty' rules: which penalty type to create */
  penaltyType?: PenaltyType;
}

const TIMEOUT_RULES: TimeoutRule[] = [
  // ── Penalty rules (order stays in PREPARING_ORDER — no status transition) ──
  {
    label: 'penalty-a',
    legacyStatus: ORDER_STATUS.DELIVERED,
    v2Status: ORDER_STATUS_V2.PREPARING_ORDER,
    extraV2Statuses: [ORDER_STATUS_V2.READY_TO_SHIP, ORDER_STATUS_V2.READY_FOR_PICKUP],
    toStatus: ORDER_STATUS_V2.PREPARING_ORDER,
    hours: 120, // 5 days
    type: 'penalty',
    penaltyType: PenaltyType.INCUMPLIMIENTO_PLAZO_PREPARACION,
  },
  {
    label: 'penalty-b',
    legacyStatus: ORDER_STATUS.DELIVERED,
    v2Status: ORDER_STATUS_V2.PREPARING_ORDER,
    extraV2Statuses: [ORDER_STATUS_V2.READY_TO_SHIP, ORDER_STATUS_V2.READY_FOR_PICKUP],
    toStatus: ORDER_STATUS_V2.PREPARING_ORDER,
    hours: 240, // 10 days
    type: 'penalty',
    penaltyType: PenaltyType.ABANDONO_PEDIDO,
  },
  // ── Transition rules ──
  {
    label: 'customer-auto-approve',
    legacyStatus: ORDER_STATUS.VALIDANDO,
    v2Status: ORDER_STATUS_V2.WAITING_CUSTOMER_CONFIRMATION,
    toStatus: ORDER_STATUS_V2.READY_TO_SHIP,
    hours: 48,
    type: 'transition',
  },
  {
    label: 'auto-complete',
    legacyStatus: ORDER_STATUS.NOT_DELIVERED,
    v2Status: ORDER_STATUS_V2.DELIVERED,
    toStatus: ORDER_STATUS_V2.COMPLETED,
    hours: 72,
    type: 'transition',
  },
  {
    label: 'pickup-auto-complete',
    legacyStatus: ORDER_STATUS.EN_REPARTO,
    v2Status: ORDER_STATUS_V2.READY_FOR_PICKUP,
    toStatus: ORDER_STATUS_V2.COMPLETED,
    hours: 168, // 7 days — unclaimed pickup auto-completes
    type: 'transition',
  },
  {
    label: 'picked-up-auto-complete',
    legacyStatus: ORDER_STATUS.EN_REPARTO,
    v2Status: ORDER_STATUS_V2.PICKED_UP,
    toStatus: ORDER_STATUS_V2.COMPLETED,
    hours: 72, // 3 days — after customer picked up, auto-complete
    type: 'transition',
  },
];

// ─── Processor ───

/**
 * Find orders past their timeout threshold and auto-transition them
 * (or register penalty records for penalty-type rules).
 * Matches BOTH legacy and V2 status values for safety.
 *
 * Idempotency: version-locked updates prevent double-processing for
 * transition rules. For penalty rules, a pre-check prevents duplicate
 * penalty records per order+type.
 */
export async function processTimeouts(): Promise<{
  processed: number;
  errors: number;
}> {
  let processed = 0;
  let errors = 0;

  for (const rule of TIMEOUT_RULES) {
    try {
      const cutoff = new Date(Date.now() - rule.hours * 60 * 60 * 1000);

      // Query orders past threshold — match EITHER legacy or V2 status
      // For penalty rules, also match extraV2Statuses (READY_TO_SHIP, READY_FOR_PICKUP)
      const statusConditions = [
        sql`${payments.status} = ${rule.legacyStatus}`,
        sql`${payments.status} = ${rule.v2Status}`,
      ];
      if (rule.extraV2Statuses?.length) {
        for (const extraStatus of rule.extraV2Statuses) {
          statusConditions.push(sql`${payments.status} = ${extraStatus}`);
        }
      }

      const expired = await db
        .select({
          id: payments.id,
          version: payments.version,
          businessId: payments.businessId,
          amount: payments.amount,
          orderNumber: payments.orderNumber,
        })
        .from(payments)
        .where(and(or(...statusConditions), lt(payments.updatedAt, cutoff)));

      for (const order of expired) {
        if (rule.type === 'penalty') {
          try {
            await handlePenalty(rule, order);
            processed++;
          } catch (err) {
            errors++;
            logger.error('Timeouts: penalty failed', {
              rule: rule.label,
              orderId: order.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        } else {
          // Transition rules: delegate to orderService.transition()
          try {
            const result = await transition({
              paymentId: order.id,
              toStatus: rule.toStatus,
              actor: { type: 'system' },
              expectedVersion: order.version ?? 0,
              metadata: { timeoutRule: rule.label },
            });

            if (result.success) {
              processed++;
            } else {
              errors++;
              logger.error('Timeouts: transition failed', {
                rule: rule.label,
                orderId: order.id,
                error: result.error,
              });
            }
          } catch (err) {
            errors++;
            logger.error('Timeouts: transition threw', {
              rule: rule.label,
              orderId: order.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    } catch (err) {
      errors++;
      logger.error('Timeouts: rule query failed', {
        rule: rule.label,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { processed, errors };
}

// ─── Penalty Handler ───

/**
 * Create a penalty record and update the business for a penalty-type timeout rule.
 * Idempotent: skips if a penalty for this order+type already exists.
 * Order remains in PREPARING_ORDER — no status transition occurs.
 */
async function handlePenalty(
  rule: TimeoutRule,
  order: {
    id: string;
    version: number | null;
    businessId: string | null;
    amount: string | null;
    orderNumber: string | null;
  },
): Promise<void> {
  const penaltyType = rule.penaltyType;
  if (!penaltyType) {
    throw new Error(`Rule "${rule.label}" is type 'penalty' but has no penaltyType`);
  }

  // ── Guard: amount must be valid ──
  if (!order.amount) {
    throw new Error(`Order ${order.id} has no amount — skipping`);
  }

  const amount = parseFloat(order.amount);
  if (isNaN(amount) || amount <= 0) {
    throw new Error(`Order ${order.id} has invalid amount "${order.amount}" — skipping`);
  }

  // ── Guard: businessId must be present ──
  if (!order.businessId) {
    throw new Error(`Order ${order.id} has no businessId — skipping`);
  }

  // ── Resolve penalty metadata based on penalty type ──
  let percentage: number;
  let title: string;
  let description: string;

  if (penaltyType === PenaltyType.INCUMPLIMIENTO_PLAZO_PREPARACION) {
    percentage = PENALTY_A_PERCENTAGE;
    title = PENALTY_A_TITLE;
    description = PENALTY_A_DESCRIPTION;
  } else if (penaltyType === PenaltyType.ABANDONO_PEDIDO) {
    percentage = PENALTY_B_PERCENTAGE;
    title = PENALTY_B_TITLE;
    description = PENALTY_B_DESCRIPTION;
  } else {
    throw new Error(`Unknown penalty type: ${penaltyType}`);
  }

  const penaltyAmount = ((amount * percentage) / 100).toFixed(2);

  // ── Idempotency check: skip if penalty already exists for this order+type ──
  const [existing] = await db
    .select({ id: penalties.id })
    .from(penalties)
    .where(and(eq(penalties.orderId, order.id), eq(penalties.penaltyType, penaltyType)))
    .limit(1);

  if (existing) {
    return; // skip — NOT an error, NOT counted as processed
  }

  // ── Guard: verify business exists ──
  const [business] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(eq(businesses.id, order.businessId))
    .limit(1);

  if (!business) {
    throw new Error(`Business ${order.businessId} not found for order ${order.id}`);
  }

  // ── Insert penalty record ──
  await db.insert(penalties).values({
    businessId: order.businessId,
    orderId: order.id,
    penaltyType,
    title,
    description,
    amount: penaltyAmount,
    percentage: String(percentage),
    productValue: order.amount,
    status: 'pending',
    orderNumber: order.orderNumber,
  });

  // ── Update business ──
  if (penaltyType === PenaltyType.INCUMPLIMIENTO_PLAZO_PREPARACION) {
    await db
      .update(businesses)
      .set({
        culqiBlocked: true,
        penaltyDebt: sql`${businesses.penaltyDebt} + ${penaltyAmount}`,
        penaltyCount: sql`${businesses.penaltyCount} + 1`,
      })
      .where(eq(businesses.id, order.businessId));
  } else {
    // ABANDONO_PEDIDO — permanent blacklist
    await db
      .update(businesses)
      .set({
        blacklisted: true,
        blacklistedAt: new Date(),
        penaltyDebt: sql`${businesses.penaltyDebt} + ${penaltyAmount}`,
        penaltyCount: sql`${businesses.penaltyCount} + 1`,
      })
      .where(eq(businesses.id, order.businessId));
  }

  // Check incomplete order rate and trigger deactivation if needed (feature flag guarded)
  if (process.env.ENABLE_AUTO_DEACTIVATION === 'true') {
    try {
      const deactivationCheck = await checkIncompleteOrderDeactivation(order.businessId!);
      if (deactivationCheck.shouldDeactivate) {
        await processOrderCompletion(order.businessId!);
      }
    } catch (deactivationError) {
      logger.error('handlePenalty: incomplete order rate check failed', {
        error:
          deactivationError instanceof Error
            ? deactivationError.message
            : String(deactivationError),
      });
      // Don't fail the penalty processing if deactivation check fails
    }
  }
}
