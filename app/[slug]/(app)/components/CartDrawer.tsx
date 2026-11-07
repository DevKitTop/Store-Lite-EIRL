'use client';

import type { CartItem, CartServerItem } from '@/features/storage/context/CartContext';
import { useCart } from '@/features/storage/context/CartContext';
import { formatPrice } from '@/features/storage/utils/currency';
import { Icon } from '@/shared/components/ui';
import { IconButton } from '@/shared/components/ui/buttons';
import { getBusinessPath } from '@/shared/utils/url';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import posthog from 'posthog-js';
import { useEffect, useState } from 'react';
import styles from './CartDrawer.module.css';
import { LazyCheckout } from './lazyCheckout';

interface CartDrawerProps {
  hasPaymentGateway?: boolean;
  culqiPublicKey?: string;
  businessId: string;
  businessName?: string;
  businessAddress?: string;
  businessCity?: string;
  businessLogoUrl?: string;
  onContactClick?: () => void;
}

type ItemValidation = 'valid' | 'removed' | 'unavailable' | 'stock_changed' | 'price_changed';

function getItemValidation(
  item: CartItem,
  cartValidation: Record<string, CartServerItem> | null,
): { status: ItemValidation; server?: CartServerItem } {
  // null = no se validó aún, {} = falló la validación — ambos se tratan como "válido"
  if (!cartValidation || Object.keys(cartValidation).length === 0) {
    return { status: 'valid' };
  }

  const server = cartValidation[item.id];
  if (!server) return { status: 'removed' };
  if (!server.isAvailable) return { status: 'unavailable', server };
  if (server.stock === 0) return { status: 'unavailable', server };
  if (server.stock !== item.stock) return { status: 'stock_changed', server };
  if (server.price !== item.price || server.secondPrice !== item.secondPrice) {
    return { status: 'price_changed', server };
  }
  return { status: 'valid', server };
}

export function CartDrawer({
  hasPaymentGateway = true,
  culqiPublicKey,
  businessId,
  businessName,
  businessAddress,
  businessCity,
  businessLogoUrl,
  onContactClick,
}: CartDrawerProps) {
  const {
    cartItems,
    isCartOpen,
    setIsCartOpen,
    removeFromCart,
    updateQuantity,
    totalPrice,
    cartValidation,
    isCartValidating,
    validateCart,
  } = useCart();
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const params = useParams();
  const slug = params.slug as string;
  const checkoutItems = cartItems.length > 0 ? (cartItems as [CartItem, ...CartItem[]]) : null;

  // Validar al abrir el carrito si hay items y no se validó aún
  useEffect(() => {
    if (isCartOpen && cartItems.length > 0 && !cartValidation && !isCartValidating) {
      validateCart();
    }
  }, [isCartOpen, cartItems.length, cartValidation, isCartValidating, validateCart]);

  // Determinar si hay items bloqueantes (removed / unavailable)
  const hasBlockedItems = cartItems.some((item) => {
    if (!cartValidation) return false;
    const v = getItemValidation(item, cartValidation);
    return v.status === 'removed' || v.status === 'unavailable';
  });

  if (!isCartOpen) return null;

  return (
    <div className={styles.overlay} onClick={() => setIsCartOpen(false)}>
      {!isCheckoutOpen && (
        <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <div className={styles.headerTitle}>
              <Icon size={21}>shopping_cart</Icon>
              <h2>Tu Carrito</h2>
            </div>
            <div className={styles.headerActions}>
              {cartItems.length > 0 && (
                <IconButton
                  variant="standard"
                  onClick={validateCart}
                  disabled={isCartValidating}
                  aria-label="Actualizar carrito"
                >
                  <Icon>{isCartValidating ? 'hourglass_empty' : 'refresh'}</Icon>
                </IconButton>
              )}
              <IconButton variant="standard" onClick={() => setIsCartOpen(false)}>
                <Icon>close</Icon>
              </IconButton>
            </div>
          </div>

          <div className={styles.content}>
            {isCartValidating && cartItems.length > 0 && (
              <div className={styles.validationBanner}>
                <Icon size={16}>sync</Icon>
                Validando carrito…
              </div>
            )}

            {cartItems.length === 0 ? (
              <div className={styles.emptyState}>
                <Icon size={50} className={styles.emptyIcon}>
                  shopping_basket
                </Icon>
                <p>Tu carrito está vacío</p>
                <button className={styles.continueBtn} onClick={() => setIsCartOpen(false)}>
                  Continuar comprando
                </button>
              </div>
            ) : (
              <div className={styles.itemList}>
                {cartItems.map((item) => {
                  const { status, server } = getItemValidation(item, cartValidation);
                  const isBlocked = status === 'removed' || status === 'unavailable';

                  return (
                    <div
                      key={item.id}
                      className={`${styles.item} ${isBlocked ? styles.itemBlocked : ''}`}
                    >
                      <Link
                        href={getBusinessPath(slug, `/product/${item.id}`)}
                        className={`${styles.itemImage} ${isBlocked ? styles.imgBlocked : ''}`}
                        onClick={() => setIsCartOpen(false)}
                      >
                        {item.image ? (
                          <Image
                            src={item.image}
                            alt={item.name}
                            width={80}
                            height={80}
                            className={styles.img}
                          />
                        ) : (
                          <div className={styles.noImage}>
                            <Icon>image_not_supported</Icon>
                          </div>
                        )}
                      </Link>

                      <div className={styles.itemInfo}>
                        <Link
                          href={getBusinessPath(slug, `/product/${item.id}`)}
                          className={`${styles.itemName} ${isBlocked ? styles.nameBlocked : ''}`}
                          onClick={() => setIsCartOpen(false)}
                        >
                          {item.name}
                        </Link>

                        {status === 'removed' && (
                          <span className={styles.itemError}>
                            <Icon size={14}>block</Icon>
                            Producto eliminado — ya no está disponible
                          </span>
                        )}

                        {status === 'unavailable' && (
                          <span className={styles.itemError}>
                            <Icon size={14}>block</Icon>
                            Producto no disponible
                          </span>
                        )}

                        <div className={styles.itemPrices}>
                          {status === 'price_changed' && server ? (
                            <>
                              <span className={styles.itemPrice}>
                                S/ {server.secondPrice ?? server.price}
                              </span>
                              {server.secondPrice && (
                                <span className={styles.oldPrice}>S/ {server.price}</span>
                              )}
                              {item.secondPrice !== server.secondPrice &&
                                item.price !== server.price && (
                                  <span className={styles.oldPrice}>
                                    Antes: S/ {item.secondPrice ?? item.price}
                                  </span>
                                )}
                              <span className={styles.priceBadge}>Precio actualizado</span>
                            </>
                          ) : item.secondPrice ? (
                            <>
                              <span className={styles.itemPrice}>S/ {item.secondPrice}</span>
                              <span className={styles.oldPrice}>S/ {item.price}</span>
                            </>
                          ) : (
                            <span className={styles.itemPrice}>S/ {item.price}</span>
                          )}
                        </div>

                        <span className={styles.itemStock}>
                          Stock:{' '}
                          {status === 'stock_changed' && server
                            ? server.stock
                            : item.stock === 0
                              ? 'AGOTADO'
                              : item.stock}
                        </span>

                        <div className={styles.quantityControls}>
                          <button
                            className={styles.qtyBtn}
                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            disabled={item.quantity <= 1 || isBlocked}
                          >
                            <Icon>remove</Icon>
                          </button>
                          <span className={styles.itemQty}>{item.quantity}</span>
                          <button
                            className={styles.qtyBtn}
                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            disabled={item.quantity >= (server?.stock ?? item.stock) || isBlocked}
                          >
                            <Icon>add</Icon>
                          </button>
                        </div>

                        {item.quantity >= (server?.stock ?? item.stock) && !isBlocked && (
                          <span className={styles.stockWarning}>¡Límite de stock alcanzado!</span>
                        )}
                      </div>

                      <IconButton
                        variant="standard"
                        className={styles.removeBtn}
                        onClick={() => removeFromCart(item.id)}
                        aria-label="Eliminar producto"
                      >
                        <Icon>delete_outline</Icon>
                      </IconButton>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {cartItems.length > 0 && (
            <div className={styles.footer}>
              <div className={styles.totalRow}>
                <span>Total</span>
                <span className={styles.totalPrice}>{formatPrice(totalPrice, 'S/')}</span>
              </div>
              <button
                className={styles.checkoutBtn}
                disabled={hasBlockedItems || isCartValidating}
                onClick={async () => {
                  // Re-validar antes de checkout por si pasó tiempo
                  await validateCart();
                  if (hasPaymentGateway) {
                    posthog.capture('checkout_started', {
                      item_count: cartItems.length,
                      total_amount: totalPrice,
                      store_slug: slug,
                    });
                    setIsCheckoutOpen(true);
                  } else {
                    setIsCartOpen(false);
                    onContactClick?.();
                  }
                }}
              >
                {hasBlockedItems
                  ? 'Revisa los productos no disponibles'
                  : isCartValidating
                    ? 'Validando…'
                    : hasPaymentGateway
                      ? 'Comprar Todo'
                      : 'Contactar Negocio'}
              </button>
            </div>
          )}
        </div>
      )}

      {isCheckoutOpen && checkoutItems && (
        <LazyCheckout
          totalAmount={totalPrice}
          cartItems={checkoutItems}
          culqiPublicKey={culqiPublicKey}
          businessId={businessId}
          businessName={businessName}
          businessAddress={businessAddress}
          businessCity={businessCity}
          businessLogoUrl={businessLogoUrl}
          onSuccess={() => {
            setIsCheckoutOpen(false);
            setIsCartOpen(false);
          }}
          onCancel={() => setIsCheckoutOpen(false)}
        />
      )}
    </div>
  );
}
