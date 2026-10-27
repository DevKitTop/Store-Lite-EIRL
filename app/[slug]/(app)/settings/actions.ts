'use server';

import { env } from '@/config/env';
import { isBusinessSlugTaken } from '@/core/business/slug';
import { db } from '@/core/database/client';
import { businesses, businessSettings, businessSlugAliases } from '@/core/database/schema';
import { getBusinessEntitlements } from '@/core/entitlements';
import { FROZEN_FIELD_MESSAGE, hasLockingPayments } from '@/core/orders/paymentGuards';
import {
  type StorefrontLayout,
  type StorefrontTheme,
  clearStorefrontThemeFromPreferences,
  createDefaultStorefrontLayout,
  createDefaultStorefrontTheme,
  mergeStorefrontLayoutIntoPreferences,
  mergeStorefrontThemeIntoPreferences,
  normalizeStorefrontLayout,
  normalizeStorefrontTheme,
} from '@/core/storefront';
import { requireAccessOnId } from '@/features/storage/actions/authz';
import { getPostHogClient } from '@/lib/posthogServer';
import type { ActionState } from '@/types/actions';
import { getErrorMessage } from '@/utils/errors';
import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

export interface SlugActionState extends ActionState {
  newSlug?: string;
}

export interface ToggleActionState extends ActionState {
  isActive?: boolean;
}

export async function updateBusinessSlug(
  businessId: string,
  newSlug: string,
): Promise<SlugActionState> {
  try {
    await requireAccessOnId(businessId, 'business.edit');
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error, 'No autorizado') };
  }

  const entitlements = await getBusinessEntitlements(businessId);
  if (entitlements.plan === 'lite') {
    return { success: false, error: 'Funcion disponible solo para planes superiores.' };
  }

  // Payment lock guard — slug is an identity field
  if (await hasLockingPayments({ businessId })) {
    return { success: false, error: FROZEN_FIELD_MESSAGE };
  }

  if (newSlug.length < 10 || newSlug.length > 30) {
    return { success: false, error: 'El slug debe tener entre 10 y 30 caracteres.' };
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(newSlug) || newSlug.endsWith('-')) {
    return {
      success: false,
      error:
        'El slug no admite espacios. Solo puede contener letras minusculas, numeros y guiones.',
    };
  }

  const currentBusiness = await db.query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { id: true, slug: true, ownerId: true },
  });

  if (!currentBusiness) {
    return { success: false, error: 'Negocio no encontrado.' };
  }

  if (currentBusiness.slug === newSlug) {
    return { success: true, newSlug };
  }

  if (await isBusinessSlugTaken(newSlug, { excludeBusinessId: businessId })) {
    return {
      success: false,
      error: 'Este slug ya esta¡ en uso por otro negocio o reservado por un redirect previo.',
    };
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .insert(businessSlugAliases)
        .values({ businessId, slug: currentBusiness.slug })
        .onConflictDoNothing();

      await tx
        .update(businesses)
        .set({ slug: newSlug, updatedAt: new Date() })
        .where(eq(businesses.id, businessId));

      await tx
        .delete(businessSlugAliases)
        .where(
          and(
            eq(businessSlugAliases.businessId, businessId),
            eq(businessSlugAliases.slug, newSlug),
          ),
        );
    });

    revalidatePath(`/${currentBusiness.slug}`);
    revalidatePath(`/${currentBusiness.slug}/settings`);
    revalidatePath(`/${newSlug}`);
    revalidatePath(`/${newSlug}/settings`);
    revalidatePath('/', 'layout');

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: businessId,
      event: 'business_slug_updated',
      properties: { business_id: businessId, new_slug: newSlug },
    });
    await posthog.flush();

    return { success: true, newSlug };
  } catch (error: unknown) {
    console.error('Error updating slug:', error);
    return { success: false, error: 'Error inesperado al actualizar el slug.' };
  }
}

export async function checkSlugAvailability(
  slug: string,
  businessId: string,
): Promise<{ success: boolean; available: boolean; error?: string }> {
  try {
    await requireAccessOnId(businessId, 'business.edit');
  } catch {
    return { success: false, available: false, error: 'No autorizado' };
  }

  if (slug.length < 10 || slug.length > 30) {
    return { success: true, available: false };
  }

  const taken = await isBusinessSlugTaken(slug, { excludeBusinessId: businessId });
  return { success: true, available: !taken };
}

export async function toggleBusinessActive(
  businessId: string,
  currentIsActive: boolean,
): Promise<ToggleActionState> {
  try {
    await requireAccessOnId(businessId, 'business.edit');
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error, 'No autorizado') };
  }

  const entitlements = await getBusinessEntitlements(businessId);
  if (entitlements.plan === 'lite') {
    return { success: false, error: 'Funcion disponible solo para planes superiores.' };
  }

  try {
    const nextState = !currentIsActive;
    await db
      .update(businesses)
      .set({ isActive: nextState, updatedAt: new Date() })
      .where(eq(businesses.id, businessId));

    revalidatePath('/', 'layout');

    return { success: true, isActive: nextState };
  } catch (error: unknown) {
    console.error('Error toggling business active state:', error);
    return { success: false, error: 'Error inesperado al cambiar estado del negocio.' };
  }
}

export interface SEOActionInput {
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoKeywords?: string[] | null;
  latitude?: string | null;
  longitude?: string | null;
  geoRegion?: string | null;
  geoPlacename?: string | null;
}

export interface StorefrontLayoutActionState extends ActionState {
  layout?: StorefrontLayout;
}

export interface StorefrontThemeActionState extends ActionState {
  storefrontTheme?: StorefrontTheme;
}

export async function updateBusinessSEO(
  businessId: string,
  seoData: SEOActionInput,
): Promise<ActionState> {
  try {
    await requireAccessOnId(businessId, 'seo.edit');
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error, 'No autorizado') };
  }

  const entitlements = await getBusinessEntitlements(businessId);
  if (entitlements.plan === 'lite') {
    return { success: false, error: 'Funcion disponible solo para planes superiores.' };
  }

  try {
    await db
      .update(businesses)
      .set({
        seoTitle: seoData.seoTitle,
        seoDescription: seoData.seoDescription,
        seoKeywords: seoData.seoKeywords,
        latitude: seoData.latitude,
        longitude: seoData.longitude,
        geoRegion: seoData.geoRegion,
        geoPlacename: seoData.geoPlacename,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, businessId));

    revalidatePath('/', 'layout');
    return { success: true, message: 'Configuracion SEO actualizada correctamente.' };
  } catch (error: unknown) {
    console.error('Error updating business SEO:', error);
    return { success: false, error: 'Error inesperado al actualizar la configuracion SEO.' };
  }
}

export async function updateStorefrontLayout(
  businessId: string,
  slug: string,
  layout: StorefrontLayout,
): Promise<StorefrontLayoutActionState> {
  try {
    await requireAccessOnId(businessId, 'storefront.edit');
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error, 'No autorizado') };
  }

  const entitlements = await getBusinessEntitlements(businessId);
  if (entitlements.plan === 'lite') {
    return {
      success: false,
      error: 'Funcion disponible solo para planes con personalizacion de storefront.',
    };
  }

  const normalizedLayout = normalizeStorefrontLayout(layout);

  try {
    const existingSettings = await db.query.businessSettings.findFirst({
      where: eq(businessSettings.businessId, businessId),
      columns: {
        id: true,
        preferences: true,
      },
    });

    const nextPreferences = mergeStorefrontLayoutIntoPreferences(
      existingSettings?.preferences ?? {},
      normalizedLayout,
    );

    if (existingSettings) {
      await db
        .update(businessSettings)
        .set({
          preferences: nextPreferences,
          updatedAt: new Date(),
        })
        .where(eq(businessSettings.businessId, businessId));
    } else {
      await db.insert(businessSettings).values({
        businessId,
        themeMode: 'light',
        contrastLevel: 'standard',
        preferences: mergeStorefrontLayoutIntoPreferences({}, normalizedLayout),
      });
    }

    revalidatePath(`/${slug}`);
    revalidatePath(`/${slug}/settings`);
    revalidatePath('/', 'layout');

    return {
      success: true,
      message: 'Layout del storefront actualizado correctamente.',
      layout: normalizedLayout,
    };
  } catch (error: unknown) {
    console.error('Error updating storefront layout:', error);
    return {
      success: false,
      error: 'Error inesperado al actualizar el layout del storefront.',
      layout: createDefaultStorefrontLayout(),
    };
  }
}

export async function updateStorefrontTheme(
  businessId: string,
  slug: string,
  storefrontTheme: StorefrontTheme,
  themeMode?: 'light' | 'dark',
): Promise<StorefrontThemeActionState> {
  try {
    await requireAccessOnId(businessId, 'storefront.edit');
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error, 'No autorizado') };
  }

  const entitlements = await getBusinessEntitlements(businessId);
  if (entitlements.plan === 'lite') {
    return {
      success: false,
      error: 'Funcion disponible solo para planes con personalizacion de storefront.',
    };
  }

  const normalizedTheme = normalizeStorefrontTheme(storefrontTheme);

  try {
    const existingSettings = await db.query.businessSettings.findFirst({
      where: eq(businessSettings.businessId, businessId),
      columns: {
        id: true,
        preferences: true,
      },
    });

    const nextPreferences = mergeStorefrontThemeIntoPreferences(
      existingSettings?.preferences ?? {},
      normalizedTheme,
    );

    if (existingSettings) {
      await db
        .update(businessSettings)
        .set({
          preferences: nextPreferences,
          ...(themeMode && { themeMode }),
          updatedAt: new Date(),
        })
        .where(eq(businessSettings.businessId, businessId));
    } else {
      await db.insert(businessSettings).values({
        businessId,
        themeMode: themeMode ?? 'light',
        contrastLevel: 'standard',
        preferences: mergeStorefrontThemeIntoPreferences({}, normalizedTheme),
      });
    }

    revalidatePath(`/${slug}`);
    revalidatePath(`/${slug}/settings`);
    revalidatePath('/', 'layout');

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: businessId,
      event: 'storefront_customized',
      properties: { business_id: businessId, customization_type: 'theme', slug },
    });
    await posthog.flush();

    return {
      success: true,
      message: 'Apariencia publica actualizada correctamente.',
      storefrontTheme: normalizedTheme,
    };
  } catch (error: unknown) {
    console.error('Error updating storefront theme:', error);
    return {
      success: false,
      error: 'Error inesperado al actualizar la apariencia publica.',
      storefrontTheme: createDefaultStorefrontTheme(),
    };
  }
}

export async function clearStorefrontTheme(businessId: string, slug: string): Promise<ActionState> {
  try {
    await requireAccessOnId(businessId, 'storefront.edit');
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error, 'No autorizado') };
  }

  const entitlements = await getBusinessEntitlements(businessId);
  if (entitlements.plan === 'lite') {
    return {
      success: false,
      error: 'Funcion disponible solo para planes con personalizacion de storefront.',
    };
  }

  try {
    const existingSettings = await db.query.businessSettings.findFirst({
      where: eq(businessSettings.businessId, businessId),
      columns: {
        id: true,
        preferences: true,
      },
    });

    if (!existingSettings) {
      return { success: true, message: 'La apariencia publica ya usaba los colores por defecto.' };
    }

    const nextPreferences = clearStorefrontThemeFromPreferences(existingSettings.preferences ?? {});

    await db
      .update(businessSettings)
      .set({
        preferences: nextPreferences,
        updatedAt: new Date(),
      })
      .where(eq(businessSettings.businessId, businessId));

    revalidatePath(`/${slug}`);
    revalidatePath(`/${slug}/settings`);
    revalidatePath('/', 'layout');

    return {
      success: true,
      message: 'Apariencia publica restablecida a los colores de la plataforma.',
    };
  } catch (error: unknown) {
    console.error('Error clearing storefront theme:', error);
    return {
      success: false,
      error: 'Error inesperado al restablecer la apariencia publica.',
    };
  }
}

export async function updateCulqiCredentials(
  businessId: string,
  publicKey: string,
  secretKey: string,
): Promise<ActionState> {
  try {
    await requireAccessOnId(businessId, 'business.edit');
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error, 'No autorizado') };
  }

  const entitlements = await getBusinessEntitlements(businessId);
  if (!entitlements.hasPaymentGateway) {
    return {
      success: false,
      error: 'La configuracion de pagos solo esta disponible en planes premium.',
    };
  }
  if (publicKey && !publicKey.startsWith('pk_')) {
    return { success: false, error: 'La llave publica debe comenzar con pk_' };
  }
  if (secretKey && !secretKey.startsWith('sk_')) {
    return { success: false, error: 'La llave secreta debe comenzar con sk_' };
  }

  // Validate keys format
  const { z } = await import('zod');
  const keySchema = z.object({
    publicKey: z.string().startsWith('pk_'),
    secretKey: z.string().startsWith('sk_'),
  });

  const validation = keySchema.safeParse({ publicKey, secretKey });
  if (!validation.success) {
    return {
      success: false,
      error: 'Formato de llave Culqi inválido. Debe empezar con pk_ y sk_.',
    };
  }

  // 🔥 ENFORCE LIVE KEYS: cuando CULQI_ENFORCE_LIVE_KEYS=true,
  //     solo se aceptan llaves _live (producción).
  //     false/omit → se acepta cualquier key pk_/sk_ (desarrollo).
  if (env.enforceLiveCulqiKeys) {
    const isPublicKeyLive = publicKey.startsWith('pk_live_');
    const isSecretKeyLive = secretKey.startsWith('sk_live_');
    if (!isPublicKeyLive || !isSecretKeyLive) {
      return {
        success: false,
        error:
          'Solo se aceptan llaves de producción (pk_live_ / sk_live_). ' +
          'Encontrás las correctas en tu CulqiPanel > Desarrollo > API Keys > Producción.',
      };
    }
  }

  // 🔥 SECURITY: Encrypt the secret key before DB storage
  const { encrypt } = await import('@/utils/crypto');
  const encryptedSecretKey = encrypt(secretKey);

  try {
    const existingSettings = await db.query.businessSettings.findFirst({
      where: eq(businessSettings.businessId, businessId),
      columns: { id: true },
    });

    if (existingSettings) {
      await db
        .update(businessSettings)
        .set({
          culqiPublicKey: publicKey,
          culqiSecretKey: encryptedSecretKey,
          updatedAt: new Date(),
        })
        .where(eq(businessSettings.businessId, businessId));
    } else {
      await db.insert(businessSettings).values({
        businessId,
        culqiPublicKey: publicKey,
        culqiSecretKey: encryptedSecretKey,
      });
    }

    revalidatePath('/', 'layout');

    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: businessId,
      event: 'payment_gateway_configured',
      properties: { business_id: businessId, gateway: 'culqi' },
    });
    await posthog.flush();

    return { success: true, message: 'Credenciales de Culqi actualizadas correctamente.' };
  } catch (error: unknown) {
    console.error('Error updating Culqi credentials:', error);
    return { success: false, error: 'Error inesperado al actualizar las credenciales.' };
  }
}

export async function updateBusinessData(
  businessId: string,
  slug: string,
  data: { whatsappNumber?: string | null },
): Promise<ActionState> {
  try {
    await requireAccessOnId(businessId, 'business.edit');
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error, 'No autorizado') };
  }

  try {
    await db
      .update(businesses)
      .set({
        whatsappNumber: data.whatsappNumber ?? null,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, businessId));

    revalidatePath(`/${slug}/settings`);
    revalidatePath('/', 'layout');
    return { success: true, message: 'WhatsApp actualizado correctamente.' };
  } catch (error: unknown) {
    console.error('Error updating business data:', error);
    return { success: false, error: 'Error inesperado al actualizar datos del negocio.' };
  }
}

export interface SocialLinksInput {
  instagram?: string;
  facebook?: string;
  twitter?: string;
  tiktok?: string;
  youtube?: string;
}

const SOCIAL_URL_ALLOWLIST: Record<string, string[]> = {
  instagram: ['instagram.com', 'instagr.am'],
  facebook: ['facebook.com', 'fb.com', 'fb.watch'],
  twitter: ['x.com', 'twitter.com'],
  tiktok: ['tiktok.com', 'vm.tiktok.com'],
  youtube: ['youtube.com', 'youtu.be'],
};

function isValidSocialUrl(platform: string, raw: string): boolean {
  let href = raw.trim();
  if (!href) return true; // empty → skip (cleaned later)

  // Add protocol if missing so URL constructor doesn't choke
  if (!/^https?:\/\//i.test(href)) href = 'https://' + href;

  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    const host = url.hostname.replace(/^www\./, '');
    const allowed = SOCIAL_URL_ALLOWLIST[platform];
    if (!allowed) return false;
    return allowed.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

function validateSocialLinks(input: SocialLinksInput): string | null {
  for (const [platform, url] of Object.entries(input)) {
    if (url && url.trim().length > 0 && !isValidSocialUrl(platform, url)) {
      const label = platform.charAt(0).toUpperCase() + platform.slice(1);
      return `El enlace de ${label} no pertenece a un dominio válido de ${label}.`;
    }
  }
  return null;
}

export async function updateSocialLinks(
  businessId: string,
  socialLinks: SocialLinksInput,
): Promise<ActionState> {
  try {
    await requireAccessOnId(businessId, 'business.edit');
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error, 'No autorizado') };
  }

  // Validar URLs contra dominios permitidos
  const validationError = validateSocialLinks(socialLinks);
  if (validationError) {
    return { success: false, error: validationError };
  }

  // Sanitizar: eliminar claves con valor vacío
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(socialLinks)) {
    if (value && value.trim().length > 0) {
      cleaned[key] = value.trim();
    }
  }

  try {
    await db
      .update(businesses)
      .set({
        socialLinks: cleaned,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, businessId));

    revalidatePath('/', 'layout');
    return { success: true, message: 'Redes sociales actualizadas correctamente.' };
  } catch (error: unknown) {
    console.error('Error updating social links:', error);
    return { success: false, error: 'Error inesperado al actualizar las redes sociales.' };
  }
}
