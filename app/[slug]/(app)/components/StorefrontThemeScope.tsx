import { db } from '@/core/database/client';
import { businessSettings } from '@/core/database/schema';
import { getStorefrontThemeFromPreferences, hasCustomStorefrontTheme } from '@/core/storefront';
import { resolveStorefrontDefaultScheme } from '@/core/storefront/resolveStorefrontDefaultScheme';
import { viewerSchemeCookieName } from '@/core/storefront/viewerScheme';
import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { StorefrontThemeShell } from './StorefrontThemeShell';

interface StorefrontThemeScopeProps {
  businessId: string;
  slug: string;
  canCustomizeStorefront?: boolean;
  isAdminView?: boolean;
  children: ReactNode;
}

export async function StorefrontThemeScope({
  businessId,
  slug,
  canCustomizeStorefront = false,
  isAdminView = false,
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

  return (
    <StorefrontThemeShell
      businessId={businessId}
      slug={slug}
      storefrontTheme={savedStorefrontTheme}
      defaultScheme={defaultScheme}
      canCustomizeStorefront={canCustomizeStorefront}
      isAdminView={isAdminView}
    >
      {children}
    </StorefrontThemeShell>
  );
}
