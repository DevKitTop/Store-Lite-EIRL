'use client';

import { Button, IconButton } from '@/shared/components/ui/buttons';
import { Icon } from '@/shared/components/ui/data-display';
import type { Product, ProductCategory } from '@/types/product';
import { LazyCheckout } from '@app/[slug]/(app)/components/lazyCheckout';
import Image from 'next/image';
import { useState } from 'react';

interface ProductCardProps {
  product: Product & {
    media?: { mediaUrl: string; displayOrder: number }[];
    category?: ProductCategory | null;
  };
  businessName?: string;
  businessRuc?: string;
  businessAddress?: string;
  businessCity?: string;
  businessLogoUrl?: string;
}

export default function ProductCard({
  product,
  businessName,
  businessRuc,
  businessAddress,
  businessCity,
  businessLogoUrl,
}: ProductCardProps) {
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  const mainImage = product.media?.[0]?.mediaUrl || 'https://via.placeholder.com/220';
  const categoryName = product.category?.name || 'Producto';

  // Pricing logic: if secondPrice exists and differs from price,
  // it's the discounted offer price (shown as the current price),
  // and the original price (product.price) is shown as strikethrough.
  const hasOffer =
    product.secondPrice !== null &&
    product.secondPrice !== undefined &&
    String(product.secondPrice) !== '' &&
    Number(product.secondPrice) !== Number(product.price);
  const price = hasOffer ? Number(product.secondPrice) : Number(product.price);
  const originalPrice = hasOffer ? Number(product.price) : null;
  const discount =
    originalPrice && price < originalPrice
      ? Math.round(((originalPrice - price) / originalPrice) * 100)
      : null;

  return (
    <article
      className="relative w-full max-w-[320px] bg-white rounded-[24px] p-5 shadow-[0_2px_12px_rgba(0,0,0,0.04)] border border-slate-100 overflow-hidden flex flex-col group transition-all duration-300 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)] hover:-translate-y-1 h-full"
      data-purpose="product-card"
    >
      {/* Action Buttons (Floating) - Sliding interaction */}
      <div
        className="absolute top-4 right-4 flex flex-col gap-2 z-10 translate-x-12 group-hover:translate-x-0 transition-transform duration-300"
        data-purpose="action-buttons"
      >
        <IconButton
          variant="standard"
          aria-label="Add to wishlist"
          className="bg-[#fff8ef] rounded-full text-[#f59e0b] hover:bg-[#ffecd1]"
        >
          <Icon>favorite</Icon>
        </IconButton>
        <IconButton
          variant="standard"
          aria-label="Compare product"
          className="bg-[#f0f4ff] rounded-full text-[#4a5568] hover:bg-[#e2e8f0]"
        >
          <Icon>compare_arrows</Icon>
        </IconButton>
      </div>

      {/* Product Image Container - Fixed size to avoid "enormous" look */}
      <div
        className="w-full flex justify-center mb-6 pt-4 relative aspect-square max-h-[180px]"
        data-purpose="image-container"
      >
        <div className="relative w-[180px] h-[180px]">
          <Image
            src={mainImage}
            alt={product.title}
            fill
            className="object-contain group-hover:scale-105 transition-transform duration-300"
            sizes="180px"
          />
        </div>
        {/* Pagination Dots */}
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 flex gap-1.5 pb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
          <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
          <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
        </div>
      </div>

      {/* Product Info - Premium Layout */}
      <div className="grow space-y-2 mt-3">
        <div className="flex flex-wrap items-center gap-2 mb-1.5">
          <span className="bg-slate-100 text-slate-500 text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider">
            {categoryName}
          </span>
          {product.stock === 0 ? (
            <span className="bg-[#fce8e6] text-[#c5221f] text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider">
              AGOTADO
            </span>
          ) : (
            <span className="bg-[#e6f4ea] text-[#137333] text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider">
              Stock: {product.stock}
            </span>
          )}
        </div>
        <h2
          className="text-[#0f172a] text-[1.15rem] font-extrabold leading-snug line-clamp-2 transition-colors group-hover:text-blue-600 mb-1"
          data-purpose="product-title"
        >
          {product.title}
        </h2>
        <p
          className="text-[#475569] text-[0.875rem] leading-relaxed line-clamp-2"
          data-purpose="product-description"
        >
          {product.description || 'Sin descripción disponible'}
        </p>
      </div>

      {/* Pricing and CTA */}
      <div className="mt-5 flex flex-col gap-4" data-purpose="pricing-footer">
        <div className="flex flex-col mb-1">
          {originalPrice && (
            <div className="flex items-center gap-2 mb-[2px]">
              <span className="text-[#94a3b8] line-through text-[13px] font-medium">
                ${originalPrice.toLocaleString()}
              </span>
              {discount && (
                <span className="bg-[#fee2e2] text-[#dc2626] text-[10px] font-extrabold px-1.5 py-0.5 rounded-sm uppercase tracking-wide">
                  -{discount}%
                </span>
              )}
            </div>
          )}
          <span className="text-[1.7rem] font-extrabold text-[#0f172a] tracking-tight leading-none">
            ${price.toLocaleString()}
          </span>
        </div>

        <div className="flex gap-2.5">
          <Button
            className="grow h-[52px] rounded-[16px]! bg-[#0f172a] text-white font-bold transition-all hover:bg-slate-800 active:scale-95 shadow-[0_4px_10px_rgba(15,23,42,0.2)] uppercase text-[13px] tracking-wide"
            style={{ '--md-filled-button-container-color': '#0f172a' } as React.CSSProperties}
            onClick={() => setIsCheckoutOpen(true)}
          >
            Comprar
          </Button>
          <Button
            className="w-[52px]! h-[52px] rounded-[16px]! bg-[#eff6ff] text-[#2563eb] flex items-center justify-center transition-all hover:bg-[#dbeafe] active:scale-95 shadow-sm p-0"
            style={
              {
                '--md-filled-button-container-color': '#eff6ff',
                '--md-filled-button-label-text-color': '#2563eb',
              } as React.CSSProperties
            }
            aria-label="Add to cart"
          >
            <Icon>add_shopping_cart</Icon>
          </Button>
        </div>
      </div>

      {isCheckoutOpen && (
        <LazyCheckout
          totalAmount={price}
          cartItems={[
            {
              id: product.id,
              name: product.title,
              price: price.toString(),
              currency: 'PEN',
              image: mainImage,
              category: categoryName,
              stock: product.stock,
              status: product.isAvailable ? 'Active' : 'Inactive',
              quantity: 1,
            },
          ]}
          businessId={product.businessId}
          businessName={businessName}
          businessRuc={businessRuc}
          businessAddress={businessAddress}
          businessCity={businessCity}
          businessLogoUrl={businessLogoUrl}
          onSuccess={() => setIsCheckoutOpen(false)}
          onCancel={() => setIsCheckoutOpen(false)}
        />
      )}
    </article>
  );
}
