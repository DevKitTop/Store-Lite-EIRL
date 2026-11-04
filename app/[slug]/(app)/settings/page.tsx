import { env } from '@/config/env';
import { resolveSettingsBusiness } from '@/core/business/privateSettings';
import { resolvePublicBusinessSlug } from '@/core/business/publicSlug';
import { replaceSlugInPath } from '@/core/business/slug';
import { db } from '@/core/database/client';
import { businessSubscriptions, businessTeamMembers, products } from '@/core/database/schema';
import { getBusinessEntitlements } from '@/core/entitlements/getBusinessEntitlements';
import { hasLockingPayments } from '@/core/orders/paymentGuards';
import {
  getStorefrontLayoutFromPreferences,
  getStorefrontThemeFromPreferences,
  hasCustomStorefrontTheme,
} from '@/core/storefront';
import { getMemberPermissions } from '@/lib/permissions/checkPermission';
import { createServerClient } from '@supabase/ssr';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { SettingsClient, type SettingsBusiness } from './components/SettingsClient';

interface SettingsPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: SettingsPageProps): Promise<Metadata> {
  const { slug } = await params;
  const business = await resolvePublicBusinessSlug(slug);

  return {
    title: business ? `Ajustes — ${business.name}` : 'Ajustes',
    description: 'Configuración y preferencias de tu negocio.',
    robots: { index: false, follow: false },
  };
}

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { slug } = await params;

  // --- Auth & Permission Guard ---
  const cookieStore = await cookies();
  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return notFound();
  }

  // Resolve only for a signed-in user. The function returns nothing unless the
  // user belongs to the business, so an outsider cannot tell a missing business
  // from one they are not allowed to see.
  const resolved = await resolveSettingsBusiness(slug, user.id);

  if (!resolved) {
    return notFound();
  }

  if (resolved.matchedAlias) {
    redirect(replaceSlugInPath(`/${slug}/settings`, slug, resolved.canonicalSlug));
  }

  const business = resolved.business;
  const { privateSettings } = resolved;

  // Obtener permisos y rol efectivos
  const { isOwner, role, permissions } = await getMemberPermissions(business.id, user.id);

  if (!role) {
    // Si no tiene rol (no es owner ni miembro), no tiene nada que hacer acá
    return notFound();
  }
  // ------------------------------

  const entitlements = await getBusinessEntitlements(business.id);
  const businessLocked = await hasLockingPayments({ businessId: business.id });

  // Fecha de vencimiento del plan activo
  const subscription = await db.query.businessSubscriptions.findFirst({
    where: and(
      eq(businessSubscriptions.businessId, business.id),
      eq(businessSubscriptions.planStatus, 'active'),
    ),
    orderBy: [desc(businessSubscriptions.createdAt)],
    columns: { planEndDate: true },
  });

  // Conteo real de productos y miembros del equipo
  const [{ count: productCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(products)
    .where(eq(products.businessId, business.id));
  const [{ count: memberCount }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(businessTeamMembers)
    .where(eq(businessTeamMembers.businessId, business.id));

  return (
    <SettingsClient
      business={
        {
          ...business,
          socialLinks: business.socialLinks ?? null,
          legalRepName: privateSettings.legalRepName,
          legalRepRole: privateSettings.legalRepRole,
          legalRepPhone: privateSettings.legalRepPhone,
          legalRepEmail: privateSettings.legalRepEmail,
          culqiPublicKey: privateSettings.culqiPublicKey,
          culqiSecretKey: privateSettings.culqiSecretKey,
          preferences: privateSettings.preferences,
        } satisfies SettingsBusiness
      }
      entitlements={{
        ...entitlements,
        planEndDate: subscription?.planEndDate?.toISOString() ?? null,
        productCount,
        memberCount,
      }}
      initialStorefrontLayout={getStorefrontLayoutFromPreferences(privateSettings.preferences)}
      initialStorefrontTheme={getStorefrontThemeFromPreferences(privateSettings.preferences)}
      initialHasCustomTheme={hasCustomStorefrontTheme(privateSettings.preferences)}
      initialScheme={privateSettings.themeMode}
      businessLocked={businessLocked}
      role={role}
      permissions={permissions}
      isOwner={isOwner}
    />
  );
}
