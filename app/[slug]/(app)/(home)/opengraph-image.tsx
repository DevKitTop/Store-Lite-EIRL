/* eslint-disable unicorn/filename-case -- kebab-case is mandated by the Next.js metadata file convention */
import { ImageResponse } from 'next/og';

import { resolveBusinessSlug } from '@/core/business/slug';
import { db } from '@/core/database/client';
import { businessSettings } from '@/core/database/schema';
import {
  createDefaultStorefrontTheme,
  getStorefrontColorConfig,
  getStorefrontThemeFromPreferences,
  hasCustomStorefrontTheme,
} from '@/core/storefront';
import { loadPoppinsFonts } from '@/shared/seo/ogFonts';
import { eq } from 'drizzle-orm';

export const alt = 'Store — Tienda online';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
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

  let logoData: ArrayBuffer | null = null;
  if (business.logoUrl) {
    try {
      const res = await fetch(business.logoUrl, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        logoData = await res.arrayBuffer();
      }
    } catch {
      // Logo fetch failed — render text-only
    }
  }

  const truncatedName =
    business.name.length > 30 ? business.name.slice(0, 29) + '…' : business.name;

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%)`,
        fontFamily,
        padding: 60,
      }}
    >
      {logoData && (
        <img
          alt=""
          src={`data:image/png;base64,${Buffer.from(logoData).toString('base64')}`}
          style={{
            width: 120,
            height: 120,
            borderRadius: 20,
            objectFit: 'cover',
            marginBottom: 24,
          }}
        />
      )}

      <div
        style={{
          fontSize: logoData ? 64 : 80,
          fontWeight: 700,
          color: '#FFFFFF',
          textAlign: 'center',
          letterSpacing: '-0.02em',
          lineHeight: 1.1,
        }}
      >
        {truncatedName}
      </div>

      <div
        style={{
          marginTop: 24,
          fontSize: 32,
          color: 'rgba(255, 255, 255, 0.88)',
          textAlign: 'center',
        }}
      >
        Tienda online en Store Lite
      </div>

      <div
        style={{
          marginTop: 40,
          padding: '12px 36px',
          borderRadius: 999,
          border: '2px solid rgba(255, 255, 255, 0.4)',
          fontSize: 24,
          color: '#FFFFFF',
        }}
      >
        store-lite.com/{business.slug}
      </div>
    </div>,
    {
      ...size,
      fonts: poppinsFonts.length > 0 ? poppinsFonts : undefined,
    },
  );
}
