/**
 * Regression test for the isStaff vs isOwner gate in the product grid section.
 *
 * Bug: commit 1036514 changed `isOwner={isStaff}` → `isOwner={isOwner}` at the
 * StorefrontProductGridSection call site, making ALL child components use strict
 * owner gating. A permissioned staff (isStaff=true, isOwner=false) lost the
 * merchant admin view and fell back to the customer view.
 *
 * Fix: StorefrontProductGridSection now receives BOTH `isOwner` (strict, for
 * StorefrontAboutSection download button) and `isStaff` (for merchant-view
 * components: NoticeBar, OwnerActions, Feed, HiddenCatalogNotice).
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

type BuildStorefrontThemeVarsFn = (
  ...args: Parameters<typeof buildStorefrontThemeVars>
) => ReturnType<typeof buildStorefrontThemeVars>;

// ─── Mocks (vi.mock paths are relative to THIS test file) ──────────────────

vi.mock('@/core/storefront/buildStorefrontThemeVars', async (importOriginal) => {
  const actual = (await importOriginal()) as {
    buildStorefrontThemeVars: BuildStorefrontThemeVarsFn;
  };
  return {
    ...actual,
    buildStorefrontThemeVars: vi.fn(actual.buildStorefrontThemeVars),
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('posthog-js', () => ({ posthog: { capture: vi.fn() } }));
vi.mock('@/shared/context/ThemeContext', () => ({
  useTheme: () => ({ effectiveTheme: 'light', setTheme: vi.fn() }),
}));
vi.mock('@/features/products/hooks/useProductFilters', () => ({
  useProductFilters: () => ({
    searchQuery: '',
    setSearchQuery: vi.fn(),
    selectedCategories: [],
    setSelectedCategories: vi.fn(),
    selectedBrands: [],
    setSelectedBrands: vi.fn(),
    absoluteMin: 0,
    absoluteMax: 1000,
    currentMinPrice: 0,
    setCurrentMinPrice: vi.fn(),
    currentMaxPrice: 1000,
    setCurrentMaxPrice: vi.fn(),
    showDiscountedOnly: false,
    setShowDiscountedOnly: vi.fn(),
    brandOptions: [],
    filteredProducts: [],
    hasActiveFilters: false,
    clearFilters: vi.fn(),
  }),
}));

// Mock all sibling components that BusinessPageContent imports.
// Use @/ path alias so vitest resolves them correctly.
vi.mock('@/app/(main)/home/Feed', () => ({
  __esModule: true,
  default: () => React.createElement('div', { 'data-testid': 'feed' }),
}));
vi.mock('@/app/(main)/home/FilterBar', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));
vi.mock('@/app/(main)/home/Pagination', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));
vi.mock('@/app/(main)/home/components/ProductFiltersTopBar', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));
vi.mock('@/app/(main)/home/Hero', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));
vi.mock('@/app/(main)/home/FeaturedItems', () => ({
  __esModule: true,
  default: () => React.createElement('div'),
}));

// Mock BusinessPageContent's heavy dependencies.
vi.mock('@/features/storage/context/StorageContext', () => ({
  StorageProvider: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
  useStorage: () => ({ deleteProduct: vi.fn(), saveProductBackground: vi.fn() }),
}));
vi.mock('@/shared/components/ui', () => ({
  AlertSnackbar: () => null,
  Button: ({ children, ...p }: any) =>
    React.createElement('button', { ...p, type: 'button' }, children),
  Icon: ({ children }: any) => React.createElement('span', null, children),
}));
vi.mock('@/shared/components/ui/buttons/Button', () => ({
  Button: ({ children, ...p }: any) => React.createElement('button', p, children),
}));
vi.mock('@/shared/components/ui/data-display/Icon', () => ({
  Icon: ({ children }: any) => React.createElement('span', null, children),
}));
vi.mock('@/app/[slug]/(app)/components/ProductPreviewSheet', () => ({
  __esModule: true,
  default: () => null,
}));
vi.mock('@/app/[slug]/(app)/components/StorefrontEditor', () => ({
  StorefrontEditor: () => null,
}));
vi.mock('@/app/[slug]/(app)/components/ThemeToggle', () => ({ ThemeToggle: () => null }));
vi.mock('@/app/[slug]/(app)/components/schemeResolution', () => ({
  resolveActiveScheme: () => 'light',
}));
vi.mock('@/app/[slug]/(app)/components/FloatingCartButton', () => ({
  FloatingCartButton: () => null,
}));
vi.mock('@/app/[slug]/(app)/components/CartDrawer', () => ({ CartDrawer: () => null }));
vi.mock('@/app/[slug]/(app)/components/FloatingChatFab', () => ({
  FloatingChatFab: () => null,
}));
vi.mock('@/app/[slug]/(app)/components/BasicContactDialog', () => ({
  BasicContactDialog: () => null,
}));
vi.mock('@/app/[slug]/(app)/components/LookupOrderModal', () => ({
  LookupOrderModal: () => null,
}));
vi.mock('@/features/storage/components/DeleteProductDialog', () => ({
  DeleteProductDialog: () => null,
}));
vi.mock('@/features/storage/components/createProduct/CreateProductSheet', () => ({
  CreateProductSheet: () => null,
}));
vi.mock('@/app/[slug]/(app)/Footer', () => ({ Footer: () => null }));
vi.mock('@/app/[slug]/(app)/components/mapToStorageProduct', () => ({
  mapToStorageProduct: (p: any) => p,
}));

// ─── Real imports (after mocks are hoisted by vitest) ──────────────────────

import BusinessPageContent from '@/app/[slug]/(app)/BusinessPageContent';
import { StorefrontAboutSection } from '@/app/[slug]/(app)/StorefrontAboutSection';
import { buildStorefrontThemeVars } from '@/core/storefront/buildStorefrontThemeVars';
import type { Business } from '@/types/business';
import { render, screen } from '@testing-library/react';

// ─── Fixtures ──────────────────────────────────────────────────────────────

const business = {
  id: 'b1',
  ownerId: 'u1',
  name: 'Test Store',
  slug: 'test-store',
  coverImageUrl: null,
  heroImages: [],
  logoUrl: null,
  address: 'Av. Test 123',
  storeType: 'Ropa',
  description: 'Tienda de prueba',
  whatsappNumber: null,
  email: null,
  socialLinks: null,
  taxId: null,
  personType: null,
  country: null,
  city: null,
  departamento: null,
  provincia: null,
  distrito: null,
  legalRepPhone: null,
  legalRepName: null,
  legalRepRole: null,
  verificationStatus: 'unverified',
} as unknown as Business;

const layout = {
  id: 'layout-1',
  sections: [
    {
      id: 'grid-1',
      type: 'product_grid' as const,
      visible: true,
      config: { columns: 2, cardStyle: 'compact' },
    },
  ],
};

// ─── Grid section: merchant-view gating (isStaff) ──────────────────────────

describe('StorefrontProductGridSection — merchant-view uses isStaff', () => {
  it('staff (isStaff=true, isOwner=false) sees "Agregar Producto" (owner actions)', () => {
    render(
      <BusinessPageContent
        business={business}
        isOwner={false}
        isStaff={true}
        storefrontLayout={layout}
      />,
    );
    expect(screen.getByText('Agregar Producto')).toBeDefined();
  });

  it('customer (isStaff=false, isOwner=false) does NOT see "Agregar Producto"', () => {
    render(
      <BusinessPageContent
        business={business}
        isOwner={false}
        isStaff={false}
        storefrontLayout={layout}
      />,
    );
    expect(screen.queryByText('Agregar Producto')).toBeNull();
  });

  it('owner (isOwner=true, isStaff=true) sees "Agregar Producto"', () => {
    render(
      <BusinessPageContent
        business={business}
        isOwner={true}
        isStaff={true}
        storefrontLayout={layout}
      />,
    );
    expect(screen.getByText('Agregar Producto')).toBeDefined();
  });
});

// ─── Paint surface: the shell owns the single scoped surface ─────────────

describe('StorefrontContent — one scoped paint surface', () => {
  it('does not duplicate theme vars on the home content root', () => {
    const buildVars = vi.mocked(buildStorefrontThemeVars);
    buildVars.mockClear();

    const { container } = render(
      <BusinessPageContent
        business={business}
        isOwner={false}
        isStaff={false}
        storefrontLayout={layout}
      />,
    );

    const root = container.querySelector('div.page-container');
    expect(root).not.toBeNull();
    expect(root?.children.length).toBeGreaterThan(0);
    expect(root?.getAttribute('style')).toBeNull();
    expect(buildVars).not.toHaveBeenCalled();
  });

  it('does not write storefront theme vars to document.documentElement', () => {
    const setProperty = vi.spyOn(document.documentElement.style, 'setProperty');
    try {
      render(
        <BusinessPageContent
          business={business}
          isOwner={false}
          isStaff={false}
          storefrontLayout={layout}
        />,
      );

      const storefrontWrites = setProperty.mock.calls.filter(
        ([name]) =>
          typeof name === 'string' &&
          (name.startsWith('--storefront-') || name.startsWith('--md-sys-')),
      );
      expect(storefrontWrites).toEqual([]);
    } finally {
      setProperty.mockRestore();
    }
  });
});

// ─── Grid section: notice bar uses isStaff ─────────────────────────────────

describe('StorefrontProductGridSection — notice bar uses isStaff', () => {
  it('staff without payment sees owner plan-upgrade prompt', () => {
    render(
      <BusinessPageContent
        business={business}
        isOwner={false}
        isStaff={true}
        storefrontLayout={layout}
        hasPaymentGateway={false}
      />,
    );
    expect(screen.getByText(/Actualiza tu plan para aceptar pagos automáticos/)).toBeDefined();
  });

  it('customer does NOT see owner payment prompts', () => {
    render(
      <BusinessPageContent
        business={business}
        isOwner={false}
        isStaff={false}
        storefrontLayout={layout}
        hasPaymentGateway={false}
      />,
    );
    expect(screen.queryByText(/Actualiza tu plan para aceptar pagos automáticos/)).toBeNull();
  });
});

// ─── About section: download button uses strict isOwner ────────────────────

describe('StorefrontAboutSection — download gated by strict isOwner only', () => {
  it('hides download button when isOwner=false (staff without ownership)', () => {
    render(
      <StorefrontAboutSection
        business={business}
        storefrontTheme={null}
        previewCardTheme={null}
        isOwner={false}
      />,
    );
    expect(screen.queryByLabelText('Descargar tarjeta')).toBeNull();
  });

  it('shows download button when isOwner=true (actual owner)', () => {
    render(
      <StorefrontAboutSection
        business={business}
        storefrontTheme={null}
        previewCardTheme={null}
        isOwner={true}
      />,
    );
    expect(screen.getByLabelText('Descargar tarjeta')).toBeDefined();
  });
});
