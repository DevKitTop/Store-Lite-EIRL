'use server';

import { env } from '@/config/env';
import { generateAvailableBusinessSlug } from '@/core/business/slug';
import { db } from '@/core/database/client';
import {
  businesses,
  businessSettings,
  businessSubscriptions,
  profiles,
} from '@/core/database/schema';
import {
  createDefaultStorefrontLayout,
  createDefaultStorefrontTheme,
  mergeStorefrontLayoutIntoPreferences,
  mergeStorefrontThemeIntoPreferences,
  normalizeStorefrontTheme,
} from '@/core/storefront';
import { captureEvent } from '@/lib/analytics/capture';
import { AnalyticsEvents } from '@/lib/analytics/taxonomy';
import { logger, toErrorDetail } from '@/lib/logger';
import { generateBusinessSlug } from '@/shared/utils/slugify';
import { createServerClient } from '@supabase/ssr';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';

/**
 * Checks whether a given taxId (RUC) is already registered in the platform.
 * Called from the client during RUC verification (Step 1) for immediate UX feedback.
 */
export async function checkTaxIdExistsAction(taxId: string): Promise<{ exists: boolean }> {
  if (!taxId || taxId.trim().length === 0) return { exists: false };

  const existing = await db.query.businesses.findFirst({
    where: eq(businesses.taxId, taxId.trim()),
    columns: { id: true },
  });

  return { exists: !!existing };
}

export async function createBusinessAction(formData: FormData) {
  const cookieStore = await cookies();

  // 1. Get authenticated user
  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: 'Unauthorized' };
  }

  // 1.5 Ensure Profile Exists
  const userId = user.id;
  const userEmail = user.email ?? '';

  const existingProfile = await db.query.profiles.findFirst({
    where: eq(profiles.id, userId),
  });

  if (!existingProfile) {
    await db.insert(profiles).values({
      id: userId,
      email: userEmail,
      fullName:
        user.user_metadata.full_name ||
        user.user_metadata.name ||
        userEmail.split('@')[0] ||
        'Unknown User',
      avatarUrl: user.user_metadata.avatar_url,
    });
  }

  // 1.7 Check Business Limit (Max 3)
  const userBusinessesCount = await db.query.businesses.findMany({
    where: eq(businesses.ownerId, userId),
    columns: { id: true },
  });

  if (userBusinessesCount.length >= 3) {
    return {
      error: 'Has alcanzado el límite máximo de 3 negocios por cuenta.',
    };
  }

  // 1.8 Check for duplicate RUC / taxId
  const incomingTaxId = (formData.get('taxId') as string | null)?.trim();
  if (incomingTaxId) {
    const duplicateRuc = await db.query.businesses.findFirst({
      where: eq(businesses.taxId, incomingTaxId),
      columns: { id: true },
    });
    if (duplicateRuc) {
      return {
        error:
          'Este RUC ya está registrado en la plataforma. Si creés que es un error, contactá al soporte.',
      };
    }
  }

  // 2. Validate Data using Zod
  const rawData = {
    commercialName: formData.get('commercialName'),
    personType: formData.get('personType'),
    country: formData.get('country'),
    taxId: formData.get('taxId'),
    sector: formData.get('sector'),
    description: formData.get('description'),
    city: formData.get('city'),
    departamento: formData.get('departamento'),
    provincia: formData.get('provincia'),
    distrito: formData.get('distrito'),
    address: formData.get('address'),
    phone: formData.get('phone'),
    email: formData.get('email'),
    legalRepName: formData.get('legalRepName'),
    legalRepRole: formData.get('legalRepRole'),
    legalRepPhone: formData.get('legalRepPhone'),
    legalRepEmail: formData.get('legalRepEmail'),
    storefrontTheme: formData.get('storefrontTheme'),
  };

  const { createBusinessSchema } = await import('@/features/business/schemas');
  const validationResult = createBusinessSchema.safeParse(rawData);

  if (!validationResult.success) {
    const firstError = validationResult.error.issues[0]?.message;
    return { error: firstError || 'Datos de entrada no válidos' };
  }

  const {
    commercialName,
    personType: rawPersonType,
    country,
    taxId,
    sector,
    description,
    city,
    departamento,
    provincia,
    distrito,
    address,
    phone,
    email,
    legalRepName,
    legalRepRole,
    legalRepPhone,
    legalRepEmail,
    storefrontTheme: rawStorefrontTheme,
  } = validationResult.data;

  // AUTO-DETECT personType if not provided (from RUC prefix)
  let personType = rawPersonType;
  if (!personType && taxId && taxId.length === 11) {
    // Detect from RUC prefix: "20" = juridica, else = natural
    personType = taxId.startsWith('20') ? 'juridica' : 'natural';
  }

  if (!personType) {
    return { error: 'No se pudo determinar el tipo de persona. Verifique el RUC/DNI.' };
  }

  const logoFile = formData.get('logo') as File | null;

  let storefrontTheme = createDefaultStorefrontTheme();

  if (typeof rawStorefrontTheme === 'string' && rawStorefrontTheme.trim().length > 0) {
    try {
      storefrontTheme = normalizeStorefrontTheme(JSON.parse(rawStorefrontTheme));
    } catch (error) {
      logger.warn('createBusinessAction: invalid theme payload, using default', {
        error: toErrorDetail(error),
      });
    }
  }

  if (!commercialName || commercialName.length < 3) {
    return { error: 'El nombre comercial es obligatorio.' };
  }

  // 4. Generate Slug
  // Use 'store' as default type for slug generation if sector is generic
  const finalSlug = await generateAvailableBusinessSlug(() =>
    generateBusinessSlug(commercialName, 'store'),
  );

  logger.debug('createBusinessAction: initiating creation', { logoSize: logoFile?.size ?? 0 });

  try {
    // 5. Insert into Database — wrapped in a transaction so the limit check
    // and the insert are atomic. If anything fails, nothing gets committed.
    const { businessId, finalSlug: txSlug } = await db.transaction(async (tx) => {
      // Re-check limit inside the transaction to prevent race conditions
      const txBusinesses = await tx.query.businesses.findMany({
        where: eq(businesses.ownerId, userId),
        columns: { id: true },
      });

      if (txBusinesses.length >= 3) {
        throw new Error('LIMIT_EXCEEDED');
      }

      const [newBusiness] = await tx
        .insert(businesses)
        .values({
          ownerId: userId,
          name: commercialName,
          slug: finalSlug,
          taxId,
          personType,
          country,
          city,
          departamento,
          provincia,
          distrito,
          address,
          email,
          whatsappNumber: phone,
          description,
          legalRepName,
          legalRepRole,
          legalRepPhone,
          legalRepEmail,
          isActive: true,
          storeType: sector, // Map sector to storeType for now
          // The owner already completed all KYB steps in real time
          // (RUC verified against SUNAT + phone OTP via WhatsApp), so
          // the business is verified from the moment it is created.
          verificationStatus: 'verified',
        })
        .returning({ id: businesses.id });

      const bizId = newBusiness.id;

      const preferencesWithLayout = mergeStorefrontLayoutIntoPreferences(
        {},
        createDefaultStorefrontLayout(),
      );
      const initialPreferences = mergeStorefrontThemeIntoPreferences(
        preferencesWithLayout,
        storefrontTheme,
      );

      await tx.insert(businessSettings).values({
        businessId: bizId,
        contrastLevel: 'standard',
        preferences: initialPreferences,
      });

      await tx.insert(businessSubscriptions).values({
        businessId: bizId,
        planType: 'lite',
        planStatus: 'active',
        planStartDate: new Date(),
        planEndDate: null,
        cancelAtPeriodEnd: false,
      });

      return { businessId: bizId, finalSlug };
    });

    logger.debug('createBusinessAction: transaction committed', {
      slug: txSlug,
    });

    // 6. Handle Logo Upload — OUTSIDE the transaction.
    // If it fails, the business is already created. We treat it as non-fatal.
    let logoWarning: string | undefined;

    if (logoFile && logoFile.size > 0) {
      try {
        logger.debug('createBusinessAction: preparing logo upload', {
          businessId,
        });

        const fileExt = logoFile.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const filePath = `logos/${businessId}/${fileName}`;

        const { createClient } = await import('@supabase/supabase-js');
        const adminStorage = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        });

        const arrayBuffer = await logoFile.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuffer);

        const { error: uploadError } = await adminStorage.storage
          .from('store-covers')
          .upload(filePath, fileBuffer, {
            contentType: logoFile.type || 'image/jpeg',
            upsert: true,
          });

        if (uploadError) {
          logger.error('[createBusinessAction] Logo upload failed (non-fatal):', {
            error: toErrorDetail(uploadError),
          });
          logoWarning = uploadError.message;
        } else {
          const {
            data: { publicUrl },
          } = adminStorage.storage.from('store-covers').getPublicUrl(filePath);

          logger.debug('createBusinessAction: logo uploaded', {
            publicUrl,
          });
          await db
            .update(businesses)
            .set({ logoUrl: publicUrl })
            .where(eq(businesses.id, businessId));
        }
      } catch (logoError) {
        logger.error('[createBusinessAction] Logo upload exception (non-fatal):', {
          error: toErrorDetail(logoError),
        });
        logoWarning = 'No se pudo subir el logo.';
      }
    }

    logger.debug('createBusinessAction: creation completed', {
      error: toErrorDetail(txSlug),
    });

    // Fire-and-forget: the business already exists, analytics cannot undo it.
    captureEvent(AnalyticsEvents.BUSINESS_CREATED, {
      business_id: businessId,
      slug: txSlug,
    }).catch(() => {});

    return { success: true, slug: txSlug, logoWarning };
  } catch (error) {
    if (error instanceof Error && error.message === 'LIMIT_EXCEEDED') {
      return { error: 'Has alcanzado el límite máximo de 3 negocios por cuenta.' };
    }
    logger.error('[createBusinessAction] Top level catch block error:', {
      error: toErrorDetail(error),
    });
    return { error: 'Error al guardar los datos en la base de datos.' };
  }
}

export async function checkUserHasBusinessesAction() {
  const cookieStore = await cookies();

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { hasBusinesses: false };
  }

  const userBusinesses = await db.query.businesses.findMany({
    where: eq(businesses.ownerId, user.id),
    limit: 1,
  });

  return { hasBusinesses: userBusinesses.length > 0 };
}
