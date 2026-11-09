'use server';

import { resolvePublicBusinessSlug } from '@/core/business/publicSlug';
import { db } from '@/core/database/client';
import { businesses } from '@/core/database/schema';
import { logger, toErrorDetail } from '@/lib/logger';
import { eq } from 'drizzle-orm';

export async function getBusinessBySlug(slug: string) {
  try {
    const resolvedBusiness = await resolvePublicBusinessSlug(slug);
    if (!resolvedBusiness) {
      return null;
    }

    const business = await db.query.businesses.findFirst({
      where: eq(businesses.id, resolvedBusiness.id),
      columns: {
        id: true,
        name: true,
        slug: true,
        coverImageUrl: true,
        logoUrl: true,
        storeType: true,
      },
      with: {
        subscriptions: {
          columns: {
            planType: true,
          },
        },
      },
    });

    return business || null;
  } catch (error) {
    logger.error('navigation: failed to fetch business', { error: toErrorDetail(error) });
    return null;
  }
}
