'use client';

import type { ProductWithRelations } from '@/features/products/types/productTypes';
import { useCart } from '@/features/storage/context/CartContext';
import type { Product } from '@/features/storage/data';
import { Button } from '@/shared/components/ui/buttons/Button';
import type { PublicBusiness } from '@/types/business';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BasicContactDialog } from '../../../components/BasicContactDialog';
import { LazyCheckout } from '../../../components/lazyCheckout';
import ProductPreviewSheet from '../../../components/ProductPreviewSheet';
import LikeSection from './LikeSection';
import styles from './ProductDetail.module.css';

interface PurchaseActionsProps {
  product: Product;
  business: PublicBusiness;
  hasPaymentGateway: boolean;
  culqiPublicKey?: string;
  isOwner: boolean;
  // LikeSection props — se renderiza inline con el botón principal
  likesCount: number;
  hasLiked: boolean;
  productId: string;
  businessSlug: string;
}

/** Convierte un Product del storage al formato ProductWithRelations que espera el PreviewSheet */
function toPreviewProduct(sp: Product): ProductWithRelations {
  const media: { mediaUrl: string; displayOrder: number }[] = [];
  if (sp.image) {
    media.push({ mediaUrl: sp.image, displayOrder: 0 });
  }
  if (sp.images) {
    sp.images.forEach((url, i) => {
      const exists = media.some((m) => m.mediaUrl === url);
      if (!exists) {
        media.push({ mediaUrl: url, displayOrder: media.length + i });
      }
    });
  }

  return {
    id: sp.id,
    title: sp.name,
    description: sp.description ?? null,
    price: sp.price,
    secondPrice: sp.secondPrice ?? null,
    stock: sp.stock,
    currency: sp.currency,
    isAvailable: sp.status === 'ACTIVO',
    brand: sp.brand ?? null,
    tags: sp.tags ?? null,
    shippingInfo: sp.shippingInfo ?? null,
    saleStatus: (sp.saleStatus ?? 'NORMAL') as 'MAS_VENDIDO' | 'NUEVO_PRODUCTO' | 'NORMAL',
    slug: sp.seoTitle ?? null,
    seoTitle: sp.seoTitle ?? null,
    seoDescription: sp.seoDescription ?? null,
    stars: 0,
    externalCode: null,
    displayOrder: 0,
    metadata: sp.metadata ?? null,
    businessId: '',
    categoryId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    category: sp.category ? { id: '', name: sp.category, businessId: '' } : null,
    media,
  } as unknown as ProductWithRelations;
}

export default function PurchaseActions({
  product,
  business,
  hasPaymentGateway,
  culqiPublicKey,
  isOwner,
  likesCount,
  hasLiked,
  productId,
  businessSlug,
}: PurchaseActionsProps) {
  const router = useRouter();
  const { addToCart } = useCart();
  const [isAdding, setIsAdding] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isContactDialogOpen, setIsContactDialogOpen] = useState(false);

  const [previewSignal, setPreviewSignal] = useState(0);
  const previewProduct = useMemo(() => toPreviewProduct(product), [product]);

  const handleAddToCart = async () => {
    setIsAdding(true);
    addToCart(product);
    setIsAdding(false);
  };

  const handleBuyNow = () => {
    if (hasPaymentGateway) {
      setIsPaymentModalOpen(true);
    } else {
      setIsContactDialogOpen(true);
    }
  };

  const isOutOfStock = product.stock <= 0;

  let addToCartText = 'Al carrito';
  if (isAdding) {
    addToCartText = 'Añadiendo...';
  } else if (isOutOfStock) {
    addToCartText = 'Sin stock';
  }

  let buyNowText = hasPaymentGateway ? 'Comprar' : 'Contactar Negocio';
  if (isOutOfStock) {
    buyNowText = 'Agotado';
  }

  // ── Owner view: no puede comprar su propio producto ──
  if (isOwner) {
    return (
      <>
        <div className={styles.purchaseActions}>
          <Button
            variant="filled"
            className={styles.buyNowButton}
            onClick={() => setPreviewSignal((p) => p + 1)}
          >
            Vista previa
          </Button>
        </div>

        {previewSignal > 0 && (
          <ProductPreviewSheet
            slug={businessSlug}
            product={previewProduct}
            openSignal={previewSignal}
            isOwner={true}
            hasPaymentGateway={hasPaymentGateway}
            culqiPublicKey={culqiPublicKey}
            businessId={business.id}
            businessName={business.name}
            businessAddress={business.address ?? undefined}
            businessCity={business.city ?? undefined}
            businessLogoUrl={business.logoUrl ?? undefined}
            onEdit={() => router.push(`/${businessSlug}/storage`)}
            onDelete={() => router.push(`/${businessSlug}/storage`)}
            sheetId="product-preview-sheet-detail"
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className={styles.purchaseActions}>
        <Button
          variant="tonal"
          className={styles.addToCartButton}
          onClick={handleAddToCart}
          disabled={isAdding || isOutOfStock}
        >
          {addToCartText}
        </Button>
        <div className={styles.mainActionRow}>
          <Button
            variant="filled"
            className={styles.buyNowButton}
            onClick={handleBuyNow}
            disabled={isOutOfStock}
          >
            {buyNowText}
          </Button>
          <LikeSection
            productId={productId}
            businessSlug={businessSlug}
            initialLikesCount={likesCount}
            initialHasLiked={hasLiked}
          />
        </div>
      </div>

      {isPaymentModalOpen && (
        <LazyCheckout
          totalAmount={Number(product.secondPrice || product.price)}
          cartItems={[{ ...product, quantity: 1 }]}
          culqiPublicKey={culqiPublicKey}
          onSuccess={() => setIsPaymentModalOpen(false)}
          onCancel={() => setIsPaymentModalOpen(false)}
          businessName={business.name}
          businessAddress={business.address ?? undefined}
          businessCity={business.city ?? undefined}
          businessLogoUrl={business.logoUrl ?? undefined}
          businessId={business.id}
        />
      )}

      {isContactDialogOpen && (
        <BasicContactDialog
          business={business}
          isOpen={isContactDialogOpen}
          onClose={() => setIsContactDialogOpen(false)}
        />
      )}
    </>
  );
}
