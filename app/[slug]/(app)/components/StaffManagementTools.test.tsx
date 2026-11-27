import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { StaffManagementTools } from './StaffManagementTools';

vi.mock('@/features/storage/components/DeleteProductDialog', () => ({
  DeleteProductDialog: () => <div data-testid="delete-product-dialog" />,
}));

vi.mock('@/features/storage/components/createProduct/CreateProductSheet', () => ({
  CreateProductSheet: () => <div data-testid="create-product-sheet" />,
}));

vi.mock('./mapToStorageProduct', () => ({
  mapToStorageProduct: (product: unknown) => product,
}));

function renderTools() {
  const noop = vi.fn();
  return render(
    <StaffManagementTools
      previewProduct={null}
      isEditOpen={false}
      isCreateOpen={false}
      isDeleteOpen={false}
      onSheetClose={noop}
      onSave={vi.fn(async () => undefined)}
      onDeleteClose={noop}
      onDeleteConfirm={vi.fn(async () => undefined)}
    />,
  );
}

describe('StaffManagementTools', () => {
  it('renders only product management dialogs', () => {
    renderTools();

    expect(screen.getByTestId('delete-product-dialog')).toBeDefined();
    expect(screen.getByTestId('create-product-sheet')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Personalizar tienda' })).toBeNull();
  });

  it('does not import the storefront editor', () => {
    const sourcePath = join(dirname(fileURLToPath(import.meta.url)), 'StaffManagementTools.tsx');
    const source = readFileSync(sourcePath, 'utf8');

    expect(source).not.toContain('StorefrontEditor');
  });
});
