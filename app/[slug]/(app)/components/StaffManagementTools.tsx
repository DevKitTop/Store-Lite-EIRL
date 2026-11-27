'use client';

import type { ProductWithRelations } from '@/features/products/types/productTypes';
import { CreateProductSheet } from '@/features/storage/components/createProduct/CreateProductSheet';
import { DeleteProductDialog } from '@/features/storage/components/DeleteProductDialog';
import type { Product as StorageProduct } from '@/features/storage/data';
import type { SaveProductMediaItem, SaveProductPayload } from '@/types/storage';
import { mapToStorageProduct } from './mapToStorageProduct';

type OwnerSheetSaveArgs = [StorageProduct, SaveProductPayload, SaveProductMediaItem[], boolean];

interface StaffManagementToolsProps {
  previewProduct: ProductWithRelations | null;
  isEditOpen: boolean;
  isCreateOpen: boolean;
  isDeleteOpen: boolean;
  onSheetClose: () => void;
  onSave: (...args: OwnerSheetSaveArgs) => Promise<void>;
  onDeleteClose: () => void;
  onDeleteConfirm: (id: string) => Promise<void>;
}

export function StaffManagementTools({
  previewProduct,
  isEditOpen,
  isCreateOpen,
  isDeleteOpen,
  onSheetClose,
  onSave,
  onDeleteClose,
  onDeleteConfirm,
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
    </>
  );
}
