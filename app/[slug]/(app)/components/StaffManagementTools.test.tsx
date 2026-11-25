import { createDefaultStorefrontTheme } from '@/core/storefront';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StaffManagementTools } from './StaffManagementTools';

vi.mock('@/features/storage/components/DeleteProductDialog', () => ({
  DeleteProductDialog: () => <div data-testid="delete-product-dialog" />,
}));

vi.mock('@/features/storage/components/createProduct/CreateProductSheet', () => ({
  CreateProductSheet: () => <div data-testid="create-product-sheet" />,
}));

vi.mock('./StorefrontEditor', () => ({
  StorefrontEditor: () => <button aria-label="Personalizar tienda" />,
}));

vi.mock('./mapToStorageProduct', () => ({
  mapToStorageProduct: (product: unknown) => product,
}));

function renderTools(canCustomizeStorefront: boolean) {
  const noop = vi.fn();
  return render(
    <StaffManagementTools
      business={{ id: 'biz-1', slug: 'demo' }}
      previewProduct={null}
      isEditOpen={false}
      isCreateOpen={false}
      isDeleteOpen={false}
      onSheetClose={noop}
      onSave={vi.fn(async () => undefined)}
      onDeleteClose={noop}
      onDeleteConfirm={vi.fn(async () => undefined)}
      editableTheme={createDefaultStorefrontTheme()}
      onThemeChange={noop}
      onPreviewSchemeChange={noop}
      onEditorClose={noop}
      onEditorOpen={noop}
      detectedColorScheme="light"
      canCustomizeStorefront={canCustomizeStorefront}
    />,
  );
}

describe('StaffManagementTools storefront gate (T27)', () => {
  it('hides the public editor entry point when customization access is denied', () => {
    renderTools(false);

    expect(screen.queryByRole('button', { name: 'Personalizar tienda' })).toBeNull();
    expect(screen.getByTestId('delete-product-dialog')).toBeDefined();
    expect(screen.getByTestId('create-product-sheet')).toBeDefined();
  });

  it('renders the public editor entry point when customization access is allowed', () => {
    renderTools(true);

    expect(screen.getByRole('button', { name: 'Personalizar tienda' })).toBeDefined();
  });
});
