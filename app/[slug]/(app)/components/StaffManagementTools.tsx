'use client';

import type { StorefrontColorScheme, StorefrontTheme } from '@/core/storefront';
import type { ProductWithRelations } from '@/features/products/types/productTypes';
import { DeleteProductDialog } from '@/features/storage/components/DeleteProductDialog';
import { CreateProductSheet } from '@/features/storage/components/createProduct/CreateProductSheet';
import type { Product as StorageProduct } from '@/features/storage/data';
import type { SaveProductMediaItem, SaveProductPayload } from '@/types/storage';
import { StorefrontEditor } from './StorefrontEditor';
import { mapToStorageProduct } from './mapToStorageProduct';

type OwnerSheetSaveArgs = [StorageProduct, SaveProductPayload, SaveProductMediaItem[], boolean];

interface StaffManagementToolsProps {
  business: { id: string; slug: string };
  previewProduct: ProductWithRelations | null;
  isEditOpen: boolean;
  isCreateOpen: boolean;
  isDeleteOpen: boolean;
  onSheetClose: () => void;
  onSave: (...args: OwnerSheetSaveArgs) => Promise<void>;
  onDeleteClose: () => void;
  onDeleteConfirm: (id: string) => Promise<void>;
  editableTheme: StorefrontTheme;
  canCustomizeStorefront: boolean;
  onThemeChange: (theme: StorefrontTheme) => void;
  onPreviewSchemeChange: (scheme: StorefrontColorScheme | undefined) => void;
  onEditorClose: () => void;
  onEditorOpen: () => void;
  detectedColorScheme: StorefrontColorScheme;
  previewScheme?: StorefrontColorScheme;
  defaultScheme?: 'light' | 'dark';
  onEditorOpenChange?: (open: boolean) => void;
}

export function StaffManagementTools({
  business,
  previewProduct,
  isEditOpen,
  isCreateOpen,
  isDeleteOpen,
  onSheetClose,
  onSave,
  onDeleteClose,
  onDeleteConfirm,
  editableTheme,
  canCustomizeStorefront,
  onThemeChange,
  onPreviewSchemeChange,
  onEditorClose,
  onEditorOpen,
  detectedColorScheme,
  previewScheme,
  defaultScheme,
  onEditorOpenChange,
}: StaffManagementToolsProps) {
  const initialProduct = isEditOpen && previewProduct ? mapToStorageProduct(previewProduct) : null;
  return (
    <>
      <DeleteProductDialog
        open={isDeleteOpen}
        product={previewProduct ? mapToStorageProduct(previewProduct) : null}
        onClose={onDeleteClose}
        onConfirm={onDeleteConfirm}
      />
      <CreateProductSheet
        open={isEditOpen || isCreateOpen}
        onClose={onSheetClose}
        onSave={onSave}
        initialProduct={initialProduct}
      />
      {canCustomizeStorefront && (
        <StorefrontEditor
          business={business}
          storefrontTheme={editableTheme}
          onThemeChange={onThemeChange}
          onPreviewSchemeChange={onPreviewSchemeChange}
          onOpen={onEditorOpen}
          onClose={onEditorClose}
          detectedColorScheme={detectedColorScheme}
          currentScheme={previewScheme}
          defaultScheme={defaultScheme}
          onOpenChange={onEditorOpenChange}
        />
      )}
    </>
  );
}
