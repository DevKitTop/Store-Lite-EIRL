import { db } from '@/core/database/client';
import { businessSettings } from '@/core/database/schema';
import {
  buildStorefrontThemeStyleTag,
  getStorefrontThemeFromPreferences,
  hasCustomStorefrontTheme,
} from '@/core/storefront';
import { resolveStorefrontDefaultScheme } from '@/core/storefront/resolveStorefrontDefaultScheme';
import { viewerSchemeCookieName } from '@/core/storefront/viewerScheme';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

interface StorefrontThemeScopeProps {
  businessId: string;
  slug: string;
  children: ReactNode;
}

export async function StorefrontThemeScope({
  businessId,
  slug,
  children,
}: StorefrontThemeScopeProps) {
  const settings = await db.query.businessSettings.findFirst({
    columns: {
      preferences: true,
      themeMode: true,
    },
    where: eq(businessSettings.businessId, businessId),
  });

  const savedStorefrontTheme = hasCustomStorefrontTheme(settings?.preferences)
    ? getStorefrontThemeFromPreferences(settings?.preferences)
    : undefined;

  const cookieStore = await cookies();
  const defaultScheme = resolveStorefrontDefaultScheme({
    cookieValue: cookieStore.get(viewerSchemeCookieName(slug))?.value,
    storedScheme: settings?.themeMode,
  });

  const styleTag = savedStorefrontTheme
    ? buildStorefrontThemeStyleTag(savedStorefrontTheme, defaultScheme)
    : '';

  return (
    <>
      {styleTag && <style dangerouslySetInnerHTML={{ __html: styleTag }} />}
      {children}
    </>
  );
}
