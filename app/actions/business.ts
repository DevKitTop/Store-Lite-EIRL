'use server';

import { env } from '@/config/env';
import { db } from '@/core/database/client';
import { businesses } from '@/core/database/schema';
import { FROZEN_FIELD_MESSAGE, hasLockingPayments } from '@/core/orders/paymentGuards';
import { logger } from '@/lib/logger';
import type { ActionState as BaseActionState } from '@/types/actions';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';

export interface ActionState extends BaseActionState {
  url?: string;
}

const MAX_IMAGE_UPLOAD_SIZE = 300 * 1024;

/**
 * Creates a Supabase client with the service role key.
 * USE ONLY in server actions where authorization has already been validated.
 * This client bypasses RLS — never expose to the client side.
 */
function createAdminStorageClient() {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    logger.error('createAdminStorageClient: missing environment variables', {
      hasUrl: !!env.supabaseUrl,
      hasServiceKey: !!env.supabaseServiceRoleKey,
    });
  }
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Creates a Supabase client bound to the current user's session (via cookies).
 * Used only to authenticate the user — storage operations use the admin client.
 */
async function createUserAuthClient() {
  const cookieStore = await cookies();
  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
    },
  });
}

async function assertBusinessOwnershipOrFail(businessId: string) {
  const supabaseUser = await createUserAuthClient();
  const {
    data: { user },
  } = await supabaseUser.auth.getUser();

  if (!user) {
    return { user: null, error: 'No autorizado.' as const };
  }

  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { ownerId: true },
  });

  if (!business || business.ownerId !== user.id) {
    return { user, error: 'No tienes permiso para editar este negocio.' as const };
  }

  return { user, error: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGO DE NEGOCIO
// Bucket: store-covers | Path: logos/{businessId}/{fileName}
// ─────────────────────────────────────────────────────────────────────────────

export async function updateBusinessLogo(
  businessId: string,
  slug: string,
  formData: FormData,
): Promise<ActionState> {
  const file = formData.get('file') as File;

  if (!file) return { error: 'No se ha proporcionado ninguna imagen.' };
  if (file.size > MAX_IMAGE_UPLOAD_SIZE)
    return { error: 'La imagen comprimida excede el límite de 300KB.' };

  // 1. Verify user is authenticated
  const supabaseUser = await createUserAuthClient();
  const {
    data: { user },
  } = await supabaseUser.auth.getUser();
  if (!user) return { error: 'No autorizado. Por favor, inicia sesión.' };

  // 2. Verify ownership via our own DB (not relying on Supabase RLS)
  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { ownerId: true },
  });
  if (!business || business.ownerId !== user.id) {
    return { error: 'No tienes permiso para editar este negocio.' };
  }

  try {
    // 3. Upload using admin client (bypasses RLS — ownership already verified above)
    const adminStorage = createAdminStorageClient();
    const fileExt = file.name.split('.').pop();
    const fileName = `logo-${Date.now()}.${fileExt}`;
    const filePath = `logos/${businessId}/${fileName}`;

    const { error: uploadError } = await adminStorage.storage
      .from('store-covers')
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      logger.error('updateBusinessLogo: storage upload failed', { error: uploadError.message });
      return { error: `Error al subir el logo: ${uploadError.message}` };
    }

    // 4. Get public URL
    const {
      data: { publicUrl },
    } = adminStorage.storage.from('store-covers').getPublicUrl(filePath);

    // 5. Update DB record
    await db
      .update(businesses)
      .set({ logoUrl: publicUrl, updatedAt: new Date() })
      .where(eq(businesses.id, businessId));

    // 6. Remove previous logo files so replaced images do not accumulate
    const { data: existingFiles } = await adminStorage.storage
      .from('store-covers')
      .list(`logos/${businessId}`);
    if (existingFiles && existingFiles.length > 0) {
      const staleFiles = existingFiles
        .filter((item) => item.name !== fileName)
        .map((item) => `logos/${businessId}/${item.name}`);
      if (staleFiles.length > 0) {
        const { error: removeError } = await adminStorage.storage
          .from('store-covers')
          .remove(staleFiles);
        if (removeError) {
          logger.warn('updateBusinessLogo: failed to remove stale logos', {
            error: removeError.message,
          });
        }
      }
    }

    revalidatePath(`/${slug}`);
    revalidatePath('/list-business');

    return { success: true, message: 'Logo de empresa actualizado exitosamente.', url: publicUrl };
  } catch (err) {
    logger.error('updateBusinessLogo: unexpected error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: 'Error inesperado al actualizar el logo.' };
  }
}

export async function updateBusinessData(
  businessId: string,
  slug: string,
  data: Partial<{
    name: string;
    description: string;
    address: string;
    departamento: string;
    provincia: string;
    distrito: string;
    storeType: string;
    whatsappNumber: string;
    taxId: string;
    personType: string;
    country: string;
    city: string;
    email: string;
    legalRepName: string;
    legalRepRole: string;
    legalRepPhone: string;
    legalRepEmail: string;
  }>,
): Promise<ActionState> {
  // 1. Verify user is authenticated
  const supabaseUser = await createUserAuthClient();
  const {
    data: { user },
  } = await supabaseUser.auth.getUser();
  if (!user) return { error: 'No autorizado. Por favor, inicia sesión.' };

  // 2. Verify ownership — include identity fields for guard diff
  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: {
      ownerId: true,
      name: true,
      taxId: true,
      legalRepName: true,
      legalRepRole: true,
      legalRepPhone: true,
      legalRepEmail: true,
      address: true,
      departamento: true,
      provincia: true,
      distrito: true,
      city: true,
      country: true,
    },
  });
  if (!business || business.ownerId !== user.id) {
    return { error: 'No tienes permiso para editar este negocio.' };
  }

  try {
    // 3. Sanitize whatsappNumber if present (runs before zod)
    const sanitizedData = { ...data };
    if (sanitizedData.whatsappNumber !== undefined) {
      const raw = sanitizedData.whatsappNumber;
      const cleaned = raw.replace(/\D/g, '');
      if (cleaned && cleaned.length !== 9) {
        return { error: 'El número de WhatsApp debe tener exactamente 9 dígitos.' };
      }
      sanitizedData.whatsappNumber = cleaned ? '+' + cleaned : '';
    }

    // 4. Zod validation
    const { updateBusinessDataSchema } = await import('@/features/business/schemas');
    const parsed = updateBusinessDataSchema.safeParse(sanitizedData);
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]?.message;
      return { error: firstError || 'Datos inválidos.' };
    }

    // 5. Payment lock guard
    if (await hasLockingPayments({ businessId })) {
      const IDENTITY_KEYS = [
        'name',
        'taxId',
        'legalRepName',
        'legalRepRole',
        'legalRepPhone',
        'legalRepEmail',
        'address',
        'departamento',
        'provincia',
        'distrito',
        'city',
        'country',
      ] as const;

      for (const key of IDENTITY_KEYS) {
        const incoming = sanitizedData[key];
        if (incoming !== undefined) {
          const current = business[key as keyof typeof business];
          if (String(incoming) !== String(current ?? '')) {
            return { error: FROZEN_FIELD_MESSAGE };
          }
        }
      }
    }

    // 6. Update DB record
    await db
      .update(businesses)
      .set({
        ...sanitizedData,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, businessId));

    revalidatePath(`/${slug}`);
    revalidatePath('/list-business');

    return { success: true, message: 'Información del negocio actualizada correctamente.' };
  } catch (err) {
    logger.error('updateBusinessData: unexpected error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: 'Error inesperado al actualizar la información del negocio.' };
  }
}

/**
 * Returns whether a business has locking payment history.
 * Used by the UI to mirror frozen fields (UX only — server guards are authoritative).
 */
export async function getBusinessLockState(
  businessId: string,
): Promise<{ locked: boolean; error?: string }> {
  try {
    const locked = await hasLockingPayments({ businessId });
    return { locked };
  } catch (error) {
    logger.error('getBusinessLockState: failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { locked: false, error: 'Error al verificar el estado del negocio.' };
  }
}

export async function removeBusinessLogo(businessId: string, slug: string): Promise<ActionState> {
  const authCheck = await assertBusinessOwnershipOrFail(businessId);
  if (authCheck.error) return { error: authCheck.error };

  try {
    const adminStorage = createAdminStorageClient();
    const { data: files } = await adminStorage.storage
      .from('store-covers')
      .list(`logos/${businessId}`);

    if (files && files.length > 0) {
      const pathsToDelete = files.map((f) => `logos/${businessId}/${f.name}`);
      const { error: deleteError } = await adminStorage.storage
        .from('store-covers')
        .remove(pathsToDelete);
      if (deleteError) return { error: `Error al eliminar el logo: ${deleteError.message}` };
    }

    await db
      .update(businesses)
      .set({ logoUrl: null, updatedAt: new Date() })
      .where(eq(businesses.id, businessId));

    revalidatePath(`/${slug}`);
    revalidatePath('/list-business');
    return { success: true, message: 'Logo eliminado.' };
  } catch (err) {
    logger.error('business action failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: 'Error inesperado.' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLICIDAD (Hero / portada del negocio)
// Bucket: store-covers | Path: portadas/{businessId}/{fileName}
// ─────────────────────────────────────────────────────────────────────────────

export async function updateBusinessCover(
  businessId: string,
  slug: string,
  formData: FormData,
): Promise<ActionState> {
  const file = formData.get('file') as File;

  if (!file) {
    logger.warn('updateBusinessCover: no file provided');
    return { error: 'No se ha proporcionado ninguna imagen.' };
  }
  if (file.size > MAX_IMAGE_UPLOAD_SIZE) {
    logger.warn('updateBusinessCover: file too large', { size: file.size });
    return { error: 'La imagen comprimida excede el límite de 300KB.' };
  }

  logger.debug('updateBusinessCover: starting upload', {
    businessId,
    slug,
    fileName: file.name,
    fileSize: file.size,
  });

  // 1. Verify user is authenticated
  const supabaseUser = await createUserAuthClient();
  const {
    data: { user },
  } = await supabaseUser.auth.getUser();
  if (!user) {
    logger.warn('updateBusinessCover: user not authenticated');
    return { error: 'No autorizado.' };
  }
  logger.debug('updateBusinessCover: user authenticated', { userId: user.id });

  // 2. Verify ownership
  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { ownerId: true },
  });
  if (!business) {
    logger.warn('updateBusinessCover: business not found', { businessId });
    return { error: 'Negocio no encontrado.' };
  }
  if (business.ownerId !== user.id) {
    logger.warn('updateBusinessCover: unauthorized', {
      businessId,
      ownerId: business.ownerId,
      userId: user.id,
    });
    return { error: 'No tienes permiso para editar este negocio.' };
  }

  try {
    // 3. Delete existing images to avoid accumulating unused files
    logger.debug('updateBusinessCover: listing existing files');
    const adminStorage = createAdminStorageClient();
    const { data: existingFiles } = await adminStorage.storage
      .from('store-covers')
      .list(`portadas/${businessId}`);

    if (existingFiles && existingFiles.length > 0) {
      logger.debug('updateBusinessCover: deleting existing files', {
        count: existingFiles.length,
      });
      const pathsToDelete = existingFiles.map((f) => `portadas/${businessId}/${f.name}`);
      const { error: deleteError } = await adminStorage.storage
        .from('store-covers')
        .remove(pathsToDelete);

      if (deleteError) {
        logger.warn('updateBusinessCover: could not delete old images', {
          error: deleteError.message,
        });
      }
    } else {
      logger.debug('updateBusinessCover: no existing images found');
    }

    // 4. Upload using admin client
    const fileExt = file.name.split('.').pop();
    const fileName = `portada-${Date.now()}.${fileExt}`;
    const filePath = `portadas/${businessId}/${fileName}`;

    logger.debug('updateBusinessCover: ready to upload', { filePath });
    const { error: uploadError } = await adminStorage.storage
      .from('store-covers')
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      logger.error('updateBusinessCover: storage upload failed', {
        error: uploadError.message,
      });
      return { error: `Error al subir la publicidad: ${uploadError.message}` };
    }
    logger.debug('updateBusinessCover: upload successful', { filePath });

    const {
      data: { publicUrl },
    } = adminStorage.storage.from('store-covers').getPublicUrl(filePath);

    // 5. Update DB record
    logger.debug('updateBusinessCover: updating database', { publicUrl });
    await db
      .update(businesses)
      .set({ coverImageUrl: publicUrl, updatedAt: new Date() })
      .where(eq(businesses.id, businessId));

    revalidatePath(`/${slug}`);
    revalidatePath('/list-business');
    logger.debug('updateBusinessCover: success');
    return { success: true, url: publicUrl, message: 'Publicidad actualizada.' };
  } catch (err) {
    logger.error('business action failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: 'Error inesperado.' };
  }
}

export async function removeBusinessCover(businessId: string, slug: string): Promise<ActionState> {
  const authCheck = await assertBusinessOwnershipOrFail(businessId);
  if (authCheck.error) return { error: authCheck.error };

  try {
    const adminStorage = createAdminStorageClient();
    const { data: files } = await adminStorage.storage
      .from('store-covers')
      .list(`portadas/${businessId}`);

    if (files && files.length > 0) {
      const pathsToDelete = files.map((f) => `portadas/${businessId}/${f.name}`);
      const { error: deleteError } = await adminStorage.storage
        .from('store-covers')
        .remove(pathsToDelete);
      if (deleteError) return { error: `Error al eliminar la publicidad: ${deleteError.message}` };
    }

    await db
      .update(businesses)
      .set({ heroImages: [], coverImageUrl: null, updatedAt: new Date() })
      .where(eq(businesses.id, businessId));

    revalidatePath(`/${slug}`);
    revalidatePath('/list-business');
    return { success: true, message: 'Publicidad eliminada.' };
  } catch (err) {
    logger.error('business action failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: 'Error inesperado.' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HERO CAROUSEL — Múltiples imágenes (hasta 3)
// Bucket: store-covers | Path: portadas/{businessId}/{fileName}
// Mantiene coverImageUrl sincronizado con heroImages[0] para backward compat
// ─────────────────────────────────────────────────────────────────────────────

const MAX_HERO_IMAGES = 3;

/**
 * Sube una nueva imagen al array heroImages (máx. 3).
 * Sincroniza coverImageUrl con heroImages[0] para backward compat.
 */
export async function addHeroImage(
  businessId: string,
  slug: string,
  formData: FormData,
): Promise<ActionState> {
  const file = formData.get('file') as File;
  if (!file) return { error: 'No se ha proporcionado ninguna imagen.' };
  if (file.size > MAX_IMAGE_UPLOAD_SIZE)
    return { error: 'La imagen comprimida excede el límite de 300KB.' };

  // 1. Authenticate & authorize
  const supabaseUser = await createUserAuthClient();
  const {
    data: { user },
  } = await supabaseUser.auth.getUser();
  if (!user) return { error: 'No autorizado.' };

  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { ownerId: true, heroImages: true },
  });
  if (!business || business.ownerId !== user.id) {
    return { error: 'No tienes permiso para editar este negocio.' };
  }

  // 2. Validate limit
  const currentImages = (business.heroImages || []).filter(Boolean);
  if (currentImages.length >= MAX_HERO_IMAGES) {
    return { error: `Máximo ${MAX_HERO_IMAGES} imágenes de publicidad.` };
  }

  try {
    // 3. Upload
    const adminStorage = createAdminStorageClient();
    const fileExt = file.name.split('.').pop();
    const fileName = `hero-${Date.now()}.${fileExt}`;
    const filePath = `portadas/${businessId}/${fileName}`;

    const { error: uploadError } = await adminStorage.storage
      .from('store-covers')
      .upload(filePath, file, { upsert: true });

    if (uploadError) {
      return { error: `Error al subir la imagen: ${uploadError.message}` };
    }

    const {
      data: { publicUrl },
    } = adminStorage.storage.from('store-covers').getPublicUrl(filePath);

    // 4. Append to heroImages array
    const newImages = [...currentImages, publicUrl];

    const updateData: Record<string, unknown> = {
      heroImages: newImages,
      updatedAt: new Date(),
    };

    // Sync coverImageUrl con el primer elemento
    updateData.coverImageUrl = newImages[0];

    await db.update(businesses).set(updateData).where(eq(businesses.id, businessId));

    revalidatePath(`/${slug}`);
    return { success: true, url: publicUrl, message: 'Imagen agregada a la galería.' };
  } catch (err) {
    logger.error('business action failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: 'Error inesperado al subir la imagen.' };
  }
}

/**
 * Elimina una imagen del heroImages por índice.
 * También borra el archivo de storage y sincroniza coverImageUrl.
 */
export async function deleteHeroImage(
  businessId: string,
  slug: string,
  index: number,
): Promise<ActionState> {
  const authCheck = await assertBusinessOwnershipOrFail(businessId);
  if (authCheck.error) return { error: authCheck.error };

  const business = await db.query.businesses.findFirst({
    where: eq(businesses.id, businessId),
    columns: { heroImages: true },
  });

  const currentImages = (business?.heroImages || []).filter(Boolean);
  if (index < 0 || index >= currentImages.length) {
    return { error: 'Índice de imagen inválido.' };
  }

  const removedUrl = currentImages[index];
  const newImages = currentImages.filter((_, i) => i !== index);

  try {
    const adminStorage = createAdminStorageClient();

    // Extraer file path de la URL y eliminar de storage
    const urlParts = removedUrl.split('/portadas/');
    if (urlParts.length === 2) {
      const filePath = `portadas/${urlParts[1]}`;
      const { error: deleteError } = await adminStorage.storage
        .from('store-covers')
        .remove([filePath]);
      if (deleteError) {
        logger.warn('deleteHeroImage: could not delete file from storage', {
          error: deleteError.message,
        });
      }
    }

    const updateData: Record<string, unknown> = {
      heroImages: newImages.length > 0 ? newImages : [],
      updatedAt: new Date(),
    };

    // Sincronizar coverImageUrl: si se borró la primera, usar la nueva primera (o null)
    if (newImages.length > 0) {
      updateData.coverImageUrl = newImages[0];
    } else {
      updateData.coverImageUrl = null;
    }

    await db.update(businesses).set(updateData).where(eq(businesses.id, businessId));

    revalidatePath(`/${slug}`);
    return { success: true, message: 'Imagen eliminada.' };
  } catch (err) {
    logger.error('business action failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: 'Error inesperado al eliminar la imagen.' };
  }
}
