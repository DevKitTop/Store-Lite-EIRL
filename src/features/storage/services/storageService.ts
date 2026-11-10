import { logger, toErrorDetail } from '@/lib/logger';
import { compressImageToMaxSize } from '@/shared/utils/image';
import {
  deleteProductImageAction,
  uploadCategoryImageAction,
  uploadProductImageAction,
} from '../actions/uploads';

/**
 * Uploads a product image via server action (bypasses RLS with service role key).
 */
export const uploadProductImage = async (
  file: File,
  businessId: string | null,
): Promise<string> => {
  if (!businessId) {
    throw new Error('Business ID is required for uploading images');
  }

  const compressedFile = await compressImageToMaxSize(file);

  logger.debug('uploadProductImage: preparing form data');
  logger.debug('uploadProductImage: building payload', { businessId });
  logger.debug('uploadProductImage: image compressed', {
    fileName: file.name,
    originalSize: file.size,
    compressedSize: compressedFile.size,
    type: compressedFile.type,
  });

  const formData = new FormData();
  formData.append('file', compressedFile);
  formData.append('businessId', businessId);

  const { publicUrl, error } = await uploadProductImageAction(formData);

  if (error || !publicUrl) {
    logger.error('[uploadProductImage] Server action returned error:', {
      error: toErrorDetail(error),
    });
    throw new Error(error || 'Error desconocido al subir imagen');
  }

  logger.debug('uploadProductImage: upload succeeded', { publicUrl });
  return publicUrl;
};

/**
 * Deletes a product image via server action (bypasses RLS with service role key).
 */
export async function deleteProductImage(url: string): Promise<void> {
  if (!url) return;

  const businessIdMatch = url.match(/\/productos\/([^/]+)\//);
  const businessIdFromUrl = businessIdMatch?.[1];
  if (!businessIdFromUrl) return;

  const { error } = await deleteProductImageAction(url, businessIdFromUrl);
  if (error) {
    logger.error('[deleteProductImage] Server action error:', { error: toErrorDetail(error) });
  }
}

/**
 * Uploads a category image via server action (bypasses RLS with service role key).
 */
export const uploadCategoryImage = async (file: File, businessSlug: string): Promise<string> => {
  const compressedFile = await compressImageToMaxSize(file);
  const formData = new FormData();
  formData.append('file', compressedFile);
  formData.append('businessSlug', businessSlug);

  const { publicUrl, error } = await uploadCategoryImageAction(formData);

  if (error || !publicUrl) {
    logger.error('[uploadCategoryImage] Server action returned error:', {
      error: toErrorDetail(error),
    });
    throw new Error(error || 'Error desconocido al subir imagen de categoría');
  }

  return publicUrl;
};
