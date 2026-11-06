'use client';

import type { ProductGridSection, StorefrontTheme } from '@/core/storefront';
import type { BrandFilterOption } from '@/features/products/hooks/useProductFilters';
import type { ProductWithRelations } from '@/features/products/types/productTypes';
import type { PublicBusiness } from '@/types/business';
import type { ProductCategory } from '@/types/product';
import type { Dispatch, SetStateAction } from 'react';
import Feed from '../../../(main)/home/Feed';
import FilterBar from '../../../(main)/home/FilterBar';
import Pagination from '../../../(main)/home/Pagination';
import ProductFiltersTopBar from '../../../(main)/home/components/ProductFiltersTopBar';
import { StorefrontAboutSection } from '../StorefrontAboutSection';
import { HiddenCatalogNotice } from './HiddenCatalogNotice';
import { StorefrontNoticeBar } from './StorefrontNoticeBar';
import { StorefrontOwnerActions } from './StorefrontOwnerActions';

const PAGE_SIZE = 12;

export interface StorefrontProductGridSectionProps {
  section: ProductGridSection;
  business: PublicBusiness;
  categories: ProductCategory[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  selectedCategories: string[];
  onSelectedCategoriesChange: Dispatch<SetStateAction<string[]>>;
  selectedBrands: string[];
  onSelectedBrandsChange: Dispatch<SetStateAction<string[]>>;
  absoluteMin: number;
  absoluteMax: number;
  currentMinPrice: number;
  onCurrentMinPriceChange: Dispatch<SetStateAction<number>>;
  currentMaxPrice: number;
  onCurrentMaxPriceChange: Dispatch<SetStateAction<number>>;
  showDiscountedOnly: boolean;
  onShowDiscountedOnlyChange: Dispatch<SetStateAction<boolean>>;
  brandOptions: BrandFilterOption[];
  filteredProducts: ProductWithRelations[];
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  currentPage: number;
  onPageChange: (page: number) => void;
  isOwner: boolean;
  isStaff: boolean;
  hasPaymentGateway: boolean;
  isPaymentConfigured: boolean;
  culqiPublicKey?: string;
  onProductPreview: (product: ProductWithRelations, initialIndex?: number) => void;
  onContactClick: () => void;
  onCreateProduct: () => void;
  storefrontTheme?: StorefrontTheme;
  previewCardTheme?: StorefrontTheme;
  onShowLookupModal: () => void;
}

export function StorefrontProductGridSection({
  section,
  business,
  categories,
  activeTab,
  onTabChange,
  searchQuery,
  onSearchChange,
  selectedCategories,
  onSelectedCategoriesChange,
  selectedBrands,
  onSelectedBrandsChange,
  absoluteMin,
  absoluteMax,
  currentMinPrice,
  onCurrentMinPriceChange,
  currentMaxPrice,
  onCurrentMaxPriceChange,
  showDiscountedOnly,
  onShowDiscountedOnlyChange,
  brandOptions,
  filteredProducts,
  hasActiveFilters,
  onClearFilters,
  currentPage,
  onPageChange,
  isOwner,
  isStaff,
  hasPaymentGateway,
  isPaymentConfigured,
  culqiPublicKey,
  onProductPreview,
  onContactClick,
  onCreateProduct,
  storefrontTheme,
  previewCardTheme,
  onShowLookupModal,
}: StorefrontProductGridSectionProps) {
  const isGridVisible = section.visible;
  const totalPages = Math.ceil(filteredProducts.length / PAGE_SIZE);
  const start = (currentPage - 1) * PAGE_SIZE;
  const paginatedProducts = filteredProducts.slice(start, start + PAGE_SIZE);

  return (
    <>
      <FilterBar
        business={business}
        activeTab={activeTab}
        onTabChange={onTabChange}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
      />

      {activeTab === 'products' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <StorefrontNoticeBar
            isOwner={isStaff}
            business={business}
            hasPaymentGateway={hasPaymentGateway}
            isPaymentConfigured={isPaymentConfigured}
          />
          {isGridVisible ? (
            <>
              <ProductFiltersTopBar
                categories={categories}
                selectedCategories={selectedCategories}
                onCategoryChange={(id, checked) => {
                  onSelectedCategoriesChange((prev) =>
                    checked ? [...prev, id] : prev.filter((c) => c !== id),
                  );
                  onPageChange(1);
                }}
                minPrice={absoluteMin}
                maxPrice={absoluteMax}
                currentMinPrice={currentMinPrice}
                currentMaxPrice={currentMaxPrice}
                onPriceRangeChange={(min, max) => {
                  onCurrentMinPriceChange(min);
                  onCurrentMaxPriceChange(max);
                  onPageChange(1);
                }}
                showDiscountedOnly={showDiscountedOnly}
                onDiscountToggle={(checked) => {
                  onShowDiscountedOnlyChange(checked);
                  onPageChange(1);
                }}
                onClearFilters={() => {
                  onClearFilters();
                  onPageChange(1);
                }}
                hasActiveFilters={hasActiveFilters}
                selectedBrands={selectedBrands}
                onBrandChange={(brand, checked) => {
                  onSelectedBrandsChange((prev) =>
                    checked ? [...prev, brand] : prev.filter((b) => b !== brand),
                  );
                  onPageChange(1);
                }}
                brandOptions={brandOptions}
              />
              <StorefrontOwnerActions
                isOwner={isStaff}
                onCreateProduct={onCreateProduct}
                onShowLookupModal={onShowLookupModal}
              />
              <Feed
                products={paginatedProducts}
                isOwner={isStaff}
                onProductPreview={onProductPreview}
                hasPaymentGateway={hasPaymentGateway}
                isPaymentConfigured={isPaymentConfigured}
                culqiPublicKey={culqiPublicKey}
                onContactClick={onContactClick}
                gridConfig={section.config}
                businessName={business.name}
                businessRuc={business.taxId ?? undefined}
                businessAddress={business.address ?? undefined}
                businessId={business.id}
                businessLogoUrl={business.logoUrl ?? undefined}
              />
              <Pagination
                totalPages={totalPages}
                currentPage={currentPage}
                onPageChange={onPageChange}
              />
            </>
          ) : (
            <HiddenCatalogNotice isOwner={isStaff} onCreateProduct={onCreateProduct} />
          )}
        </div>
      )}

      {activeTab === 'about' && (
        <StorefrontAboutSection
          business={business}
          storefrontTheme={storefrontTheme}
          previewCardTheme={previewCardTheme}
          isOwner={isOwner}
        />
      )}
    </>
  );
}
