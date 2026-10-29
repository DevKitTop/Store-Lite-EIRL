/* eslint-disable unicorn/filename-case -- kebab-case is mandated by the Next.js metadata file convention */
import { ImageResponse } from 'next/og';

import { resolveBusinessSlug } from '@/core/business/slug';
import { db } from '@/core/database/client';
import { businessSettings, products as productsTable } from '@/core/database/schema';
import {
  createDefaultStorefrontTheme,
  getStorefrontColorConfig,
  getStorefrontThemeFromPreferences,
  hasCustomStorefrontTheme,
} from '@/core/storefront';
import { loadPoppinsFonts } from '@/shared/seo/ogFonts';
import { and, eq, or } from 'drizzle-orm';

export const alt = 'Producto — Tienda online';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

function formatPrice(price: string | number, currency: string): string {
  const num = typeof price === 'string' ? Number.parseFloat(price) : price;
  try {
    return new Intl.NumberFormat('es-PE', {
      style: 'currency',
      currency: currency || 'PEN',
      minimumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${currency} ${num.toFixed(2)}`;
  }
}

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ slug: string; productId: string }>;
}) {
  const { slug, productId } = await params;
  const resolved = await resolveBusinessSlug(slug);
  const business = resolved?.business;

  if (!business) {
    return new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ fontSize: 64, fontWeight: 700, color: '#FFFFFF' }}>Store Lite</div>
      </div>,
      size,
    );
  }

  const product = await db.query.products.findFirst({
    where: and(
      eq(productsTable.businessId, business.id),
      or(eq(productsTable.id, productId), eq(productsTable.slug, productId)),
    ),
    with: {
      media: {
        orderBy: (m, { asc }) => [asc(m.displayOrder)],
        limit: 1,
      },
    },
  });

  if (!product) {
    return new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div style={{ fontSize: 48, fontWeight: 700, color: '#FFFFFF' }}>
          Producto no encontrado
        </div>
      </div>,
      size,
    );
  }

  const settings = await db.query.businessSettings.findFirst({
    where: eq(businessSettings.businessId, business.id),
    columns: { preferences: true },
  });

  const savedTheme = hasCustomStorefrontTheme(settings?.preferences)
    ? getStorefrontThemeFromPreferences(settings?.preferences)
    : undefined;
  const theme = savedTheme ?? createDefaultStorefrontTheme();
  const colorConfig = getStorefrontColorConfig(theme, 'light');
  const primaryColor = colorConfig.palette.primary;
  const secondaryColor = colorConfig.palette.secondary;

  const poppinsFonts = loadPoppinsFonts();
  const fontFamily =
    poppinsFonts.length > 0
      ? '"Poppins", system-ui, -apple-system, sans-serif'
      : 'system-ui, -apple-system, sans-serif';

  let productImageData: ArrayBuffer | null = null;
  const productImageUrl = product.media?.[0]?.mediaUrl;
  if (productImageUrl) {
    try {
      const res = await fetch(productImageUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        productImageData = await res.arrayBuffer();
      }
    } catch {
      // Product image fetch failed — text-only layout
    }
  }

  const truncatedBusinessName =
    business.name.length > 25 ? business.name.slice(0, 24) + '…' : business.name;
  const truncatedProductTitle =
    product.title.length > 40 ? product.title.slice(0, 39) + '…' : product.title;
  const formattedPrice = formatPrice(product.price, product.currency);

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'row',
        background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
        fontFamily,
      }}
    >
      {productImageData && (
        <div
          style={{
            width: '45%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 40,
          }}
        >
          <img
            alt=""
            src={`data:image/png;base64,${Buffer.from(productImageData).toString('base64')}`}
            style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 16 }}
          />
        </div>
      )}

      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '40px 60px',
          color: '#FFFFFF',
        }}
      >
        <div style={{ fontSize: 28, opacity: 0.85, marginBottom: 16 }}>{truncatedBusinessName}</div>

        <div style={{ fontSize: 48, fontWeight: 700, lineHeight: 1.15, marginBottom: 20 }}>
          {truncatedProductTitle}
        </div>

        <div style={{ fontSize: 36, fontWeight: 600 }}>{formattedPrice}</div>
      </div>
    </div>,
    {
      ...size,
      fonts: poppinsFonts.length > 0 ? poppinsFonts : undefined,
    },
  );
}
