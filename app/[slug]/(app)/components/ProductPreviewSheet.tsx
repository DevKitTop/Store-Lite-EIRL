'use client';

import type { ProductWithRelations } from '@/features/products/types/productTypes';
import { updateProductPublicMetadata } from '@/features/storage/actions/products';
import { useCart } from '@/features/storage/context/CartContext';
import { formatPrice } from '@/features/storage/utils/currency';
import { Button, Sheet } from '@/shared/components/ui';
import { Icon } from '@/shared/components/ui/data-display/Icon';
import { Checkbox } from '@/shared/components/ui/inputs/Checkbox';
import { getBusinessPath } from '@/shared/utils/url';
import Image from 'next/image';
import Link from 'next/link';
import { posthog } from 'posthog-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toCartProduct } from '../product/utils/cartHelpers';
import { LazyCheckout } from './lazyCheckout';
import styles from './ProductPreviewSheet.module.css';

interface ProductPreviewSheetProps {
  slug: string;
  product: ProductWithRelations | null;
  openSignal: number;
  isOwner?: boolean;
  hasPaymentGateway?: boolean;
  culqiPublicKey?: string;
  businessId?: string;
  businessName?: string;
  businessAddress?: string;
  businessCity?: string;
  businessLogoUrl?: string;
  onEdit?: () => void;
  onDelete?: () => void;
  initialImageIndex?: number;
  /** Columnas extra marcadas como visibles en el Column Manager (storage) */
  visibleExtraColumns?: string[];
  /** Notifies the parent so the client-side product copy does not keep stale metadata. */
  onPublicMetadataChange?: (productId: string, publicKeys: string[]) => void;
  /** Override the sheet DOM id — use when two instances coexist on the same page */
  sheetId?: string;
}

type SheetElement = HTMLDivElement & { show?: () => void; close?: () => void };

const SHEET_ID = 'product-preview-sheet';

export default function ProductPreviewSheet({
  slug,
  product,
  openSignal,
  isOwner = false,
  hasPaymentGateway = true,
  culqiPublicKey,
  businessId,
  businessName,
  businessAddress,
  businessCity,
  businessLogoUrl,
  onEdit,
  onDelete,
  initialImageIndex = 0,
  visibleExtraColumns,
  onPublicMetadataChange,
  sheetId,
}: ProductPreviewSheetProps) {
  const id = sheetId ?? SHEET_ID;
  const { isInCart, toggleCartItem } = useCart();
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);

  // ── Public visibility toggles for extra metadata fields ──
  // undefined = _public not set => all fields are public (backward compat)
  const [publicKeys, setPublicKeys] = useState<string[] | undefined>(undefined);
  const togglingRef = useRef(false);

  // Sync publicKeys state when product changes
  useEffect(() => {
    if (togglingRef.current) return; // don't override while toggling
    const meta = (product?.metadata as Record<string, unknown>) ?? {};
    const _public = meta._public;
    setPublicKeys(Array.isArray(_public) ? (_public as string[]) : undefined);
  }, [product]);

  const isFieldPublic = useCallback(
    (key: string): boolean => {
      if (publicKeys === undefined) return true; // _public not set = all public
      return publicKeys.includes(key);
    },
    [publicKeys],
  );

  const handlePublicToggle = useCallback(
    async (key: string) => {
      if (!product) return;

      const meta = (product.metadata as Record<string, unknown>) ?? {};
      const allMetaKeys = Object.keys(meta).filter((k) => k !== '_public');

      // If _public does not exist yet, all metadata fields are considered public.
      // IMPORTANT: use all metadata keys here, not only visibleExtraColumns, otherwise toggling
      // one visible column would accidentally make hidden metadata columns private.
      const currentPublic = publicKeys ?? allMetaKeys;

      const newKeys = currentPublic.includes(key)
        ? currentPublic.filter((k) => k !== key)
        : [...currentPublic, key];
      const previousPublicKeys = publicKeys ? [...publicKeys] : undefined;

      togglingRef.current = true;
      setPublicKeys(newKeys);

      try {
        const result = await updateProductPublicMetadata(slug, product.id, newKeys);
        if (!result.success) {
          setPublicKeys(previousPublicKeys); // revert on error
          return;
        }
        onPublicMetadataChange?.(product.id, newKeys);
      } catch {
        setPublicKeys(previousPublicKeys); // revert on error
      } finally {
        togglingRef.current = false;
      }
    },
    [product, publicKeys, slug, onPublicMetadataChange],
  );

  const handleAction = (action?: () => void) => {
    if (!action) return;
    const node = document.getElementById(id) as SheetElement | null;
    node?.close?.();
    action();
  };

  useEffect(() => {
    if (!product) return;
    const node = document.getElementById(id) as SheetElement | null;
    node?.show?.();
    // Clamp el índice para que nunca quede out of bounds
    const maxIndex = Math.max(0, (product.media?.length ?? 1) - 1);
    const safeIndex = Math.min(initialImageIndex, maxIndex);
    setCurrentImageIndex(safeIndex);
    setIsPaymentModalOpen(false);

    try {
      if (typeof posthog?.capture === 'function') {
        posthog.capture('product_viewed', {
          productId: product.id,
          productName: product.title,
          businessSlug: slug,
        });
      }
    } catch {
      // Analytics should never block user flow
    }
  }, [product, openSignal, initialImageIndex, slug]);

  if (!product) {
    return <Sheet id={id} title="Vista previa" direction="bottom" className={styles.sheet} />;
  }

  const mainImage = product.media?.[0]?.mediaUrl || '';
  const category = product.category?.name || 'Producto';
  const currency = product.currency === 'PEN' ? 'S/' : product.currency;
  const isProductInCart = isInCart(product.id);

  // Consideramos pagos habilitados solo si el plan lo permite Y las llaves están configuradas
  const paymentsEnabled = hasPaymentGateway && !!culqiPublicKey && !!businessId;

  return (
    <>
      <Sheet id={id} title="Vista previa del producto" direction="bottom" className={styles.sheet}>
        <div className={styles.content}>
          <div className={styles.media}>
            {product.media && product.media.length > 0 ? (
              <>
                <div className={styles.carouselContainer}>
                  <button
                    className={styles.carouselButton}
                    title="Imagen anterior"
                    onClick={() =>
                      setCurrentImageIndex(
                        (prev: number) =>
                          (prev - 1 + product.media!.length) % product.media!.length,
                      )
                    }
                    disabled={product.media.length <= 1}
                  >
                    <Icon size={24}>chevron_left</Icon>
                  </button>
                  <div className={styles.imageWrapper}>
                    <Image
                      src={
                        product.media[currentImageIndex]?.mediaUrl ??
                        product.media[0]?.mediaUrl ??
                        ''
                      }
                      alt={product.title}
                      fill
                      className={styles.image}
                      sizes="(max-width: 900px) 100vw, 400px"
                      priority
                    />
                  </div>
                  <button
                    className={styles.carouselButton}
                    title="Siguiente imagen"
                    onClick={() =>
                      setCurrentImageIndex((prev: number) => (prev + 1) % product.media!.length)
                    }
                    disabled={product.media.length <= 1}
                  >
                    <Icon size={24}>chevron_right</Icon>
                  </button>
                  {product.media.length > 1 && (
                    <div className={styles.dots}>
                      {product.media.map((_, i) => (
                        <div
                          key={i}
                          className={`${styles.dot} ${
                            i === currentImageIndex ? styles.activeDot : ''
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
                {businessName && (
                  <div className={styles.storeBadge}>
                    {businessLogoUrl ? (
                      <Image
                        src={businessLogoUrl}
                        alt={businessName}
                        className={styles.storeLogo}
                        width={24}
                        height={24}
                      />
                    ) : (
                      <Icon size={18}>store</Icon>
                    )}
                    <span>{businessName}</span>
                  </div>
                )}
              </>
            ) : (
              <div className={styles.noImage}>Sin imagen</div>
            )}
          </div>

          <div className={styles.details}>
            {/* Top row: category + brand + stock indicator */}
            <div className={styles.topRow}>
              <p className={styles.category}>
                {product.brand ? `${product.brand.toUpperCase()} | ` : ''}
                {category}
              </p>
              {(() => {
                const stockLevel =
                  product.stock <= 0 ? 'outOfStock' : product.stock <= 5 ? 'lowStock' : 'inStock';
                const stockLabel =
                  product.stock <= 0
                    ? 'Agotado'
                    : product.stock <= 5
                      ? `Solo ${product.stock} uds.`
                      : `${product.stock} uds.`;
                return (
                  <span
                    className={`${styles.stockBadge} ${styles[stockLevel]}`}
                    title={
                      product.stock > 0
                        ? `${product.stock} unidades disponibles`
                        : 'Producto sin stock'
                    }
                  >
                    <span className={styles.stockDot} />
                    {stockLabel}
                  </span>
                );
              })()}
            </div>
            <h3 className={styles.title}>{product.title}</h3>

            <div className={styles.priceContainer}>
              {product.secondPrice ? (
                <>
                  <p className={styles.price}>
                    {formatPrice(Number(product.secondPrice), currency)}
                  </p>
                  <p className={styles.originalPrice}>
                    {formatPrice(Number(product.price), currency)}
                  </p>
                </>
              ) : (
                <p className={styles.price}>{formatPrice(Number(product.price), currency)}</p>
              )}
            </div>
            <div className={styles.descriptionContainer}>
              <p className={styles.description}>
                {product.description && product.description.length > 120
                  ? `${product.description.slice(0, 120)}...`
                  : product.description || 'Sin descripción disponible.'}
              </p>
              {product.description && product.description.length > 120 && (
                <Link
                  href={getBusinessPath(slug, `/product/${product.id}`)}
                  className={styles.inlineLink}
                >
                  Ver detalle completo
                </Link>
              )}
            </div>

            {/* ── Tags ── */}
            {product.tags && product.tags.length > 0 && (
              <div className={styles.tags}>
                {product.tags.map((tag, i) => (
                  <span key={i} className={styles.tag}>
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {/* ── Extra metadata fields ── */}
            {(() => {
              const meta = (product?.metadata as Record<string, unknown>) ?? {};
              const productMetaKeys = Object.keys(meta).filter((k) => k !== '_public');

              // En storage (con visibleExtraColumns): muestra las columnas checkeadas
              // con opción de toggle público/privado.
              // En storefront (sin visibleExtraColumns):
              //   - Owner: ve TODOS los campos, pueda reactivar los privados
              //   - Público: solo ve los campos en _public (o todos si no existe _public)
              const isStorageView = visibleExtraColumns !== undefined;
              const fieldsToShow = isStorageView
                ? visibleExtraColumns.length > 0
                  ? visibleExtraColumns.filter((col) => col in meta && col !== '_public')
                  : productMetaKeys
                : isOwner
                  ? productMetaKeys
                  : Array.isArray(meta._public)
                    ? (meta._public as string[]).filter((k) => k in meta && k !== '_public')
                    : productMetaKeys;

              if (fieldsToShow.length === 0) return null;

              return (
                <div className={styles.extraFieldsSection}>
                  <div className={styles.extraFieldsHeader}>
                    <Icon size={16}>{isOwner ? 'view_column' : 'info'}</Icon>
                    <span className={styles.extraFieldsTitle}>
                      {isOwner ? 'Campos adicionales' : 'Información adicional'}
                    </span>
                  </div>
                  {fieldsToShow.map((col) => {
                    const value = meta[col];
                    if (value === undefined || value === null) return null;

                    return (
                      <div key={col} className={styles.extraFieldRow}>
                        {isOwner && (
                          <span className={styles.extraFieldCheckbox}>
                            <Checkbox
                              checked={isFieldPublic(col)}
                              onChange={() => handlePublicToggle(col)}
                              touchTarget="none"
                            />
                          </span>
                        )}
                        <span className={styles.extraFieldName}>{col}</span>
                        <span className={styles.extraFieldValue}>{String(value)}</span>
                        {isOwner && (
                          <span
                            className={`${styles.extraFieldPublicIcon} ${
                              isFieldPublic(col) ? styles.isPublic : styles.isPrivate
                            }`}
                          >
                            <Icon size={12}>
                              {isFieldPublic(col) ? 'public' : 'visibility_off'}
                            </Icon>
                            {isFieldPublic(col) ? 'Público' : 'Privado'}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {product.shippingInfo && (
              <div className={styles.shippingCard}>
                <div className={styles.shippingHeader}>
                  <Icon size={18}>local_shipping</Icon>
                  <span className={styles.shippingLabel}>Envío</span>
                </div>
                <p className={styles.shippingText}>{product.shippingInfo}</p>
              </div>
            )}

            <div className={styles.actions}>
              {isOwner ? (
                <>
                  <Button
                    onClick={() => handleAction(onEdit)}
                    variant="filled"
                    style={
                      {
                        '--md-filled-button-container-color': 'var(--md-sys-color-primary)',
                      } as React.CSSProperties
                    }
                  >
                    Editar Producto
                  </Button>
                  <Button
                    onClick={() => handleAction(onDelete)}
                    variant="outlined"
                    style={
                      {
                        '--md-outlined-button-outline-color': 'var(--md-sys-color-error)',
                        '--md-outlined-button-label-text-color': 'var(--md-sys-color-error)',
                      } as React.CSSProperties
                    }
                  >
                    Eliminar Producto
                  </Button>
                </>
              ) : (
                <>
                  <div className={styles.actionsRow}>
                    {product.stock > 0 ? (
                      <>
                        <Button
                          onClick={() =>
                            toggleCartItem(
                              toCartProduct({
                                id: product.id,
                                name: product.title,
                                category,
                                stock: product.stock,
                                price: String(product.price),
                                currency: product.currency,
                                status: product.isAvailable ? 'ACTIVO' : 'NO ACTIVO',
                                image: mainImage,
                                images: product.media?.map((item) => item.mediaUrl) || [],
                                description: product.description || '',
                                secondPrice: product.secondPrice
                                  ? String(product.secondPrice)
                                  : null,
                              }),
                            )
                          }
                          aria-label={isProductInCart ? 'Quitar del carrito' : 'Agregar al carrito'}
                          style={
                            {
                              '--md-filled-button-container-color': isProductInCart
                                ? 'var(--md-sys-color-secondary-container)'
                                : 'var(--md-sys-color-surface-container-highest)',
                              '--md-filled-button-label-text-color': isProductInCart
                                ? 'var(--md-sys-color-on-secondary-container)'
                                : 'var(--md-sys-color-on-surface-variant)',
                            } as React.CSSProperties
                          }
                        >
                          <Icon>
                            {isProductInCart ? 'remove_shopping_cart' : 'add_shopping_cart'}
                          </Icon>
                        </Button>

                        {paymentsEnabled && (
                          <Button
                            variant="filled"
                            onClick={() => setIsPaymentModalOpen(true)}
                            style={
                              {
                                flex: 1,
                                '--md-filled-button-container-color': 'var(--md-sys-color-primary)',
                              } as React.CSSProperties
                            }
                          >
                            Comprar ahora
                          </Button>
                        )}
                      </>
                    ) : (
                      <Button
                        disabled
                        aria-label="Sin stock"
                        style={
                          {
                            flex: 1,
                            '--md-filled-button-container-color':
                              'var(--md-sys-color-surface-variant)',
                            '--md-filled-button-label-text-color':
                              'var(--md-sys-color-on-surface-variant)',
                          } as React.CSSProperties
                        }
                      >
                        Agotado
                      </Button>
                    )}
                    <Link
                      href={getBusinessPath(slug, `/product/${product.id}`)}
                      className={styles.fullLink}
                    >
                      {paymentsEnabled ? 'Ver más' : 'Ver más'}
                    </Link>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </Sheet>

      {isPaymentModalOpen && product && businessId && (
        <LazyCheckout
          totalAmount={Number(product.secondPrice || product.price)}
          cartItems={[
            {
              id: product.id,
              name: product.title,
              price: String(product.price),
              secondPrice: product.secondPrice ? String(product.secondPrice) : null,
              currency: product.currency,
              image: mainImage,
              quantity: 1,
              category: category,
              stock: product.stock,
              status: product.isAvailable ? 'ACTIVO' : 'NO ACTIVO',
              description: product.description || '',
            },
          ]}
          culqiPublicKey={culqiPublicKey}
          onSuccess={() => setIsPaymentModalOpen(false)}
          onCancel={() => setIsPaymentModalOpen(false)}
          businessId={businessId}
          businessName={businessName}
          businessAddress={businessAddress}
          businessCity={businessCity}
          businessLogoUrl={businessLogoUrl}
        />
      )}
    </>
  );
}
