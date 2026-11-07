'use client';

import type { BusinessTrustScore } from '@/actions/business/getBusinessTrustScore';
import type {
  StorefrontColorScheme,
  StorefrontLayout,
  StorefrontSection,
  StorefrontTheme,
} from '@/core/storefront';
import {
  buildBackgroundCSS,
  buildStorefrontThemeVars,
  createDefaultStorefrontTheme,
} from '@/core/storefront';
import { useProductFilters } from '@/features/products/hooks/useProductFilters';
import type { ProductWithRelations } from '@/features/products/types/productTypes';
import { StorageProvider, useStorage } from '@/features/storage/context/StorageContext';
import type { Product as StorageProduct } from '@/features/storage/data';
import { AlertSnackbar } from '@/shared/components/ui';
import type { PublicBusiness } from '@/types/business';
import type { ProductCategory } from '@/types/product';
import type { SaveProductMediaItem, SaveProductPayload } from '@/types/storage';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { posthog } from 'posthog-js';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import FeaturedItems from '../../(main)/home/FeaturedItems';
import Hero from '../../(main)/home/Hero';
import styles from './BusinessPageContent.module.css';
import { BasicContactDialog } from './components/BasicContactDialog';
import { CustomerFloatingUi } from './components/CustomerFloatingUi';
import { LookupOrderModal } from './components/LookupOrderModal';
import ProductPreviewSheet from './components/ProductPreviewSheet';
import { StorefrontProductGridSection } from './components/StorefrontProductGridSection';
import StorefrontTrustBadge from './components/StorefrontTrustBadge';
import { mapToStorageProduct } from './components/mapToStorageProduct';
import { resolveActiveScheme } from './components/schemeResolution';
import { useStorefrontViewerTheme } from './components/useStorefrontViewerTheme';

// The staff tools drag in StorefrontEditor and PatternBrowser: one 243 KB
// chunk that used to ship to every public visitor even though the tools only
// render for staff. A dynamic import keeps it out of the visitor's bundle.
const StaffManagementTools = dynamic(
  () => import('./components/StaffManagementTools').then((mod) => mod.StaffManagementTools),
  { ssr: false, loading: () => null },
);

interface BusinessPageContentProps {
  business: PublicBusiness;
  isOwner?: boolean;
  isStaff?: boolean;
  isLoggedIn?: boolean;
  categories?: ProductCategory[];
  products?: ProductWithRelations[];
  hasPaymentGateway?: boolean;
  isPaymentConfigured?: boolean;
  culqiPublicKey?: string;
  chatEnabled?: boolean;
  storefrontLayout: StorefrontLayout;
  storefrontTheme?: StorefrontTheme;
  previewCardTheme?: StorefrontTheme;
  /** Default color scheme for the storefront from business settings */
  defaultScheme?: 'light' | 'dark';
  // Props del negocio para el checkout
  businessName?: string;
  businessRuc?: string;
  businessAddress?: string;
  businessId?: string;
  /** DS 011 trust signal (same source as the complaint banner); null when flag off. */
  trustSignal?: BusinessTrustScore | null;
}

type OwnerSheetSaveArgs = [StorageProduct, SaveProductPayload, SaveProductMediaItem[], boolean];

export default function BusinessPageContent({
  business,
  isOwner = false,
  isStaff = false,
  isLoggedIn = false,
  categories = [],
  products = [],
  hasPaymentGateway = true,
  isPaymentConfigured = false,
  culqiPublicKey,
  chatEnabled = false,
  storefrontLayout,
  storefrontTheme,
  previewCardTheme,
  defaultScheme,
  trustSignal = null,
}: BusinessPageContentProps) {
  const mappedProducts: StorageProduct[] = products.map(mapToStorageProduct);

  const mappedCategories = categories.map((c) => ({ id: c.id, name: c.name }));

  // El staff (dueño + miembros con acceso) hereda las capacidades de gestión en el context
  return (
    <StorageProvider
      businessSlug={business.slug}
      businessId={business.id}
      initialProducts={mappedProducts}
      initialCategories={mappedCategories}
      isOwner={isStaff}
    >
      <BusinessPageContentUI
        business={business}
        isOwner={isOwner}
        isStaff={isStaff}
        isLoggedIn={isLoggedIn}
        categories={categories}
        products={products}
        hasPaymentGateway={hasPaymentGateway}
        isPaymentConfigured={isPaymentConfigured}
        culqiPublicKey={culqiPublicKey}
        chatEnabled={chatEnabled}
        storefrontLayout={storefrontLayout}
        storefrontTheme={storefrontTheme}
        previewCardTheme={previewCardTheme}
        defaultScheme={defaultScheme}
        trustSignal={trustSignal}
      />
    </StorageProvider>
  );
}

function BusinessPageContentUI({
  business,
  isOwner = false,
  isStaff = false,
  isLoggedIn: _isLoggedIn = false,
  categories = [],
  products = [],
  hasPaymentGateway = true,
  isPaymentConfigured = false,
  culqiPublicKey,
  chatEnabled = false,
  storefrontLayout,
  storefrontTheme,
  previewCardTheme,
  defaultScheme,
  trustSignal = null,
}: BusinessPageContentProps) {
  // Pagos habilitados para compra automática solo si plan+credenciales están listos.
  const paymentsEnabled = hasPaymentGateway && isPaymentConfigured;

  const [activeTab, setActiveTab] = useState('products');
  const [currentPage, setCurrentPage] = useState(1);
  const [previewProduct, setPreviewProduct] = useState<ProductWithRelations | null>(null);
  const [previewSignal, setPreviewSignal] = useState(0);
  const [previewImageIndex, setPreviewImageIndex] = useState(0);
  const [isContactDialogOpen, setIsContactDialogOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [showLookupModal, setShowLookupModal] = useState(false);
  const [editableTheme, setEditableTheme] = useState<StorefrontTheme>(
    () => storefrontTheme ?? createDefaultStorefrontTheme(),
  );
  const [previewScheme, setPreviewScheme] = useState<StorefrontColorScheme | undefined>(undefined);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const { effectiveTheme, viewerTheme, setViewerTheme, handleViewerThemeToggle, setTheme } =
    useStorefrontViewerTheme({ slug: business.slug, editorOpen: isEditorOpen });
  const [alert, setAlert] = useState<{
    open: boolean;
    description: string;
    color: 'success' | 'error';
    icon: string;
  }>({
    open: false,
    description: '',
    color: 'success',
    icon: 'check_circle',
  });

  const { deleteProduct, saveProductBackground } = useStorage();
  const router = useRouter();

  const {
    searchQuery,
    setSearchQuery,
    selectedCategories,
    setSelectedCategories,
    selectedBrands,
    setSelectedBrands,
    absoluteMin,
    absoluteMax,
    currentMinPrice,
    setCurrentMinPrice,
    currentMaxPrice,
    setCurrentMaxPrice,
    showDiscountedOnly,
    setShowDiscountedOnly,
    brandOptions,
    filteredProducts,
    hasActiveFilters,
    clearFilters,
  } = useProductFilters(products);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setCurrentPage(1);
  };

  const handlePreviewProduct = (product: ProductWithRelations, imageIndex = 0) => {
    setPreviewProduct(product);
    setPreviewImageIndex(imageIndex);
    setPreviewSignal((prev) => prev + 1);
  };

  const handleEditFromPreview = () => {
    setIsEditOpen(true);
  };

  const handleCreateProduct = () => {
    setIsCreateOpen(true);
  };

  const handleDeleteFromPreview = () => {
    setIsDeleteOpen(true);
  };

  const handleConfirmDelete = async (id: string) => {
    setIsDeleteOpen(false);
    try {
      const result = await deleteProduct(id);
      if (result.success) {
        router.refresh();
        setAlert({
          open: true,
          description: 'Producto eliminado correctamente',
          color: 'success',
          icon: 'check_circle',
        });
        setPreviewProduct(null);
      } else {
        setAlert({
          open: true,
          description: result.error || 'Error al eliminar',
          color: 'error',
          icon: 'error',
        });
      }
    } catch {
      setAlert({
        open: true,
        description: 'Error inesperado',
        color: 'error',
        icon: 'error',
      });
    }
  };

  const handleSaveProduct = async (...args: OwnerSheetSaveArgs) => {
    const [optimisticProduct, payload, mediaFiles, isEdit] = args;
    try {
      const initialProduct = isEdit && previewProduct ? mapToStorageProduct(previewProduct) : null;
      const result = await saveProductBackground({
        payload,
        media: mediaFiles,
        isEdit,
        initialProduct,
        optimisticProduct,
      });
      if (!result.success) {
        throw new Error(result.error || 'No se pudo guardar el producto');
      }

      setAlert({
        open: true,
        description: isEdit
          ? 'Producto actualizado correctamente'
          : 'Producto guardado correctamente',
        color: 'success',
        icon: 'check_circle',
      });

      if (!isEdit) {
        try {
          if (typeof posthog?.capture === 'function') {
            posthog.capture('product_created', {
              productId: optimisticProduct.id,
              businessSlug: business.slug,
            });
          }
        } catch {
          // Analytics should never block user flow
        }
      }

      setIsEditOpen(false);
      setIsCreateOpen(false);
      router.refresh();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Error al guardar';
      setAlert({
        open: true,
        description: errorMessage,
        color: 'error',
        icon: 'error',
      });
    }
  };

  const renderStorefrontSection = (section: StorefrontSection) => {
    if (!section.visible) {
      if (section.type !== 'product_grid') {
        return null;
      }
    }

    switch (section.type) {
      case 'hero':
        return <Hero key={section.id} business={business} isOwner={isStaff} />;
      case 'featured_categories':
        return (
          <FeaturedItems
            key={section.id}
            isOwner={isStaff}
            categories={categories}
            onCategorySelect={(categoryId) => {
              if (activeTab !== 'products') handleTabChange('products');
              setSelectedCategories([categoryId]);

              // Scroll to products section smoothly
              const productsSection = document.getElementById('products-grid');
              if (productsSection) {
                const headerOffset = 140;
                const elementPosition = productsSection.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
                window.scrollTo({
                  top: offsetPosition,
                  behavior: 'smooth',
                });
              }
            }}
          />
        );
      case 'product_grid':
        return (
          <StorefrontProductGridSection
            key={section.id}
            section={section}
            business={business}
            categories={categories}
            activeTab={activeTab}
            onTabChange={handleTabChange}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            selectedCategories={selectedCategories}
            onSelectedCategoriesChange={setSelectedCategories}
            selectedBrands={selectedBrands}
            onSelectedBrandsChange={setSelectedBrands}
            absoluteMin={absoluteMin}
            absoluteMax={absoluteMax}
            currentMinPrice={currentMinPrice}
            onCurrentMinPriceChange={setCurrentMinPrice}
            currentMaxPrice={currentMaxPrice}
            onCurrentMaxPriceChange={setCurrentMaxPrice}
            showDiscountedOnly={showDiscountedOnly}
            onShowDiscountedOnlyChange={setShowDiscountedOnly}
            brandOptions={brandOptions}
            filteredProducts={filteredProducts}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            isOwner={isOwner}
            isStaff={isStaff}
            hasPaymentGateway={hasPaymentGateway}
            isPaymentConfigured={isPaymentConfigured}
            culqiPublicKey={culqiPublicKey}
            onProductPreview={handlePreviewProduct}
            onContactClick={() => setIsContactDialogOpen(true)}
            onCreateProduct={handleCreateProduct}
            storefrontTheme={storefrontTheme}
            previewCardTheme={previewCardTheme}
            onShowLookupModal={() => setShowLookupModal(true)}
          />
        );
      default:
        return null;
    }
  };

  const activeScheme = useMemo(
    () =>
      resolveActiveScheme(
        viewerTheme,
        previewScheme,
        defaultScheme ?? (effectiveTheme as StorefrontColorScheme),
      ),
    [viewerTheme, previewScheme, defaultScheme, effectiveTheme],
  );
  const themeStyles = useMemo(
    () =>
      buildStorefrontThemeVars(editableTheme, activeScheme) as CSSProperties &
        Record<string, string>,
    [editableTheme, activeScheme],
  );

  // Sync theme CSS vars to document root so parent elements (layout, main-area)
  // can see --storefront-bg, --storefront-bg-image, and all MD colors
  // useLayoutEffect ensures vars are applied synchronously BEFORE paint,
  // preventing the flicker from cleanup â†’ re-apply of CSS custom properties.
  useLayoutEffect(() => {
    const root = document.documentElement;
    const entries = Object.entries(themeStyles) as [string, string][];

    // 1. Set all CSS vars on root (affects layout/main-area/storefront)
    entries.forEach(([key, value]) => root.style.setProperty(key, value));

    // 2. Recompute the ORIGINAL background (themeStyles has it stripped so
    //    ::before doesn't double-paint). HTML handles the pattern exclusively.
    const activeBackground =
      activeScheme === 'dark' ? editableTheme.dark.background : editableTheme.light.background;
    const bgOriginal = buildBackgroundCSS(activeBackground);
    const bgImage = bgOriginal['--storefront-bg-image' as keyof typeof bgOriginal] as
      | string
      | undefined;
    const hasImage = bgImage && bgImage !== 'none' && bgImage.length > 0;

    if (hasImage) {
      // Override --storefront-bg to transparent so .layout / .main-area
      // don't paint a solid color that blocks the pattern on <html>.
      root.style.setProperty('--storefront-bg', 'transparent');

      // Set the background directly on <html> so it covers the entire page.
      root.style.backgroundColor = 'transparent';
      root.style.backgroundImage = bgImage;
      root.style.backgroundSize =
        (bgOriginal['--storefront-bg-size' as keyof typeof bgOriginal] as string) || 'auto';
      root.style.backgroundPosition =
        (bgOriginal['--storefront-bg-position' as keyof typeof bgOriginal] as string) || '0 0';
      root.style.backgroundRepeat =
        (bgOriginal['--storefront-bg-repeat' as keyof typeof bgOriginal] as string) || 'repeat';
      root.style.backgroundAttachment = 'fixed';

      // Make <body> transparent so the <html> pattern/gradient shows through
      // the entire viewport â€” including margins, the sidebar column, and areas
      // outside .storefrontThemeRoot.
      document.body.style.backgroundColor = 'transparent';
    } else {
      // Sin imagen de fondo: <html> hereda el color sólido normal.
      root.style.backgroundColor = '';
      root.style.backgroundImage = '';
      root.style.backgroundSize = '';
      root.style.backgroundPosition = '';
      root.style.backgroundRepeat = '';
      root.style.backgroundAttachment = '';

      // Restore body background when no pattern is active.
      document.body.style.backgroundColor = '';
    }

    return () => {
      entries.forEach(([key]) => root.style.removeProperty(key));
      root.style.backgroundColor = '';
      root.style.backgroundImage = '';
      root.style.backgroundSize = '';
      root.style.backgroundPosition = '';
      root.style.backgroundRepeat = '';
      root.style.backgroundAttachment = '';
      document.body.style.backgroundColor = '';
    };
  }, [themeStyles, editableTheme, activeScheme]);

  // Read stored preview scheme from localStorage on mount (staff only)
  // Mirrors the same localStorage pattern as viewerTheme above.
  useEffect(() => {
    if (!isStaff) return;
    try {
      const stored = localStorage.getItem(`storefront-preview-scheme-${business.slug}`);
      if (stored === 'light' || stored === 'dark') {
        setPreviewScheme(stored);
      }
    } catch {
      // Safari private mode â€” no-op
    }
  }, [isStaff, business.slug]);

  const handlePreviewSchemeChange = useCallback(
    (scheme: StorefrontColorScheme | undefined) => {
      setPreviewScheme(scheme);
      if (scheme) {
        setViewerTheme(scheme);
        setTheme(scheme); // 'light' | 'dark' â€” same values
        try {
          localStorage.setItem(`storefront-preview-scheme-${business.slug}`, scheme);
          localStorage.setItem(`storefront-theme-${business.slug}`, scheme);
        } catch {
          // Safari private mode â€” no-op
        }
      }
    },
    [business.slug, setTheme, setViewerTheme],
  );

  return (
    <>
      <div className={`page-container ${styles.storefrontThemeRoot}`} style={themeStyles}>
        {/* DS 011 customer-facing trust signal (badge) — same data as the banner */}
        <StorefrontTrustBadge trustSignal={trustSignal} />
        {storefrontLayout.sections.map(renderStorefrontSection)}
      </div>
      <ProductPreviewSheet
        slug={business.slug}
        product={previewProduct}
        openSignal={previewSignal}
        isOwner={isStaff}
        hasPaymentGateway={hasPaymentGateway}
        culqiPublicKey={culqiPublicKey}
        businessId={business.id}
        businessName={business.name}
        businessAddress={business.address ?? undefined}
        businessCity={business.city ?? undefined}
        businessLogoUrl={business.logoUrl ?? undefined}
        onEdit={handleEditFromPreview}
        onDelete={handleDeleteFromPreview}
        initialImageIndex={previewImageIndex}
      />{' '}
      {!isStaff && (
        <CustomerFloatingUi
          business={business}
          paymentsEnabled={paymentsEnabled}
          culqiPublicKey={culqiPublicKey}
          chatEnabled={chatEnabled}
          activeScheme={activeScheme}
          onViewerThemeToggle={handleViewerThemeToggle}
          onContactClick={() => setIsContactDialogOpen(true)}
        />
      )}
      <BasicContactDialog
        business={business}
        isOpen={isContactDialogOpen}
        onClose={() => setIsContactDialogOpen(false)}
      />
      {isStaff && (
        <StaffManagementTools
          business={{ id: business.id, slug: business.slug }}
          previewProduct={previewProduct}
          isEditOpen={isEditOpen}
          isCreateOpen={isCreateOpen}
          isDeleteOpen={isDeleteOpen}
          onSheetClose={() => {
            setIsEditOpen(false);
            setIsCreateOpen(false);
          }}
          onSave={handleSaveProduct}
          onDeleteClose={() => setIsDeleteOpen(false)}
          onDeleteConfirm={handleConfirmDelete}
          editableTheme={editableTheme}
          onThemeChange={setEditableTheme}
          onPreviewSchemeChange={handlePreviewSchemeChange}
          onEditorClose={() => setIsEditorOpen(false)}
          onEditorOpen={() => setIsEditorOpen(true)}
          detectedColorScheme={effectiveTheme as StorefrontColorScheme}
          previewScheme={previewScheme}
          defaultScheme={defaultScheme}
          onEditorOpenChange={setIsEditorOpen}
        />
      )}
      {isStaff && (
        <AlertSnackbar
          open={alert.open}
          description={alert.description}
          color={alert.color}
          icon={alert.icon}
          onClose={() => setAlert((prev) => ({ ...prev, open: false }))}
        />
      )}
      <LookupOrderModal
        open={showLookupModal}
        onClose={() => setShowLookupModal(false)}
        businessSlug={business.slug}
        businessName={business.name}
      />
    </>
  );
}
