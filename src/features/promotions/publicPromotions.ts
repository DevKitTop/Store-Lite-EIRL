// =====================================================
// PROMOTIONS — Server-only public landing loader
// =====================================================
// Reads the campaign catalog for logged-out visitors and delegates all
// eligibility, window and discount math to the pure resolver.
// =====================================================

import { db } from '@/core/database/client';
import { promotions } from '@/core/database/schema';
import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';

import type { PublicLandingPromotion } from './publicPromotionResolver';
import { resolvePublicLandingPromotion } from './publicPromotionResolver';

export { resolvePublicLandingPromotion } from './publicPromotionResolver';
export type { PublicLandingPromotion } from './publicPromotionResolver';

/** A DB failure means "no banner", never a broken landing. */
export async function getPublicLandingPromotion(
  now: Date = new Date(),
): Promise<PublicLandingPromotion | null> {
  try {
    const rows = await db
      .select()
      .from(promotions)
      .where(
        and(
          eq(promotions.isActive, true),
          lte(promotions.startsAt, now),
          or(isNull(promotions.endsAt), gt(promotions.endsAt, now)),
          eq(promotions.type, 'percent_off'),
          eq(promotions.eligibility, 'all_users'),
        ),
      );

    return resolvePublicLandingPromotion(rows, now);
  } catch {
    return null;
  }
}
