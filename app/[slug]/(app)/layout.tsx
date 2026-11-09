import { resolvePublicBusinessSlug } from '@/core/business/publicSlug';
import { db } from '@/core/database/client';
import { productCategories, products } from '@/core/database/schema';
import { getBusinessEntitlements } from '@/core/entitlements/getBusinessEntitlements';
import type { Product } from '@/features/storage/data';
import { getMemberPermissions } from '@/lib/permissions/checkPermission';
import { applySentryContext } from '@/lib/sentryContext';
import { createClient } from '@/lib/supabase/server';
import AppLayout from '@/shared/components/layout/AppLayout';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { BusinessProviders } from './components/BusinessProviders';

interface AppLayoutProps {
  children: React.ReactNode;
  modal: React.ReactNode;
  params: Promise<{ slug: string }>;
}

export default async function AppGroupLayout({ children, modal, params }: AppLayoutProps) {
  const { slug } = await params;

  const business = await resolvePublicBusinessSlug(slug);

  if (!business) {
    return notFound();
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Obtener permisos y rol
  const { isOwner, role, permissions } = user
    ? await getMemberPermissions(business.id, user.id)
    : { isOwner: false, role: null, permissions: [] };

  // isAdminView es true si el usuario es dueño o tiene algún rol en el equipo
  const isAdminView = Boolean(isOwner || role);

  // Block public access to inactive businesses, but allow the owner/team to see it
  if (!business.isActive && !isAdminView) {
    return notFound();
  }

  // Calcular entitlements del negocio según su plan de suscripción activo
  const entitlements = await getBusinessEntitlements(business.id);
  const navbarPlanName = entitlements.plan;

  // Every authenticated page render tags its Sentry scope, so an error report
  // answers "which business and which plan" without a manual lookup.
  applySentryContext(
    { userId: user?.id ?? null, businessId: business.id, plan: entitlements.plan },
    `/${slug}`,
  );

  let categoryNames: { id: string; name: string }[] | undefined;
  let storageProducts: Product[] | undefined;

  // Solo cargar datos administrativos si tiene permiso de ver productos
  const canViewProducts = isOwner || permissions.includes('products.view');
  const canViewCategories = isOwner || permissions.includes('categories.view');

  if (canViewProducts || canViewCategories) {
    const [categories, productsList] = await Promise.all([
      db.query.productCategories.findMany({
        where: eq(productCategories.businessId, business.id),
        orderBy: (categories, { asc }) => [asc(categories.displayOrder)],
      }),
      db.query.products.findMany({
        where: eq(products.businessId, business.id),
        with: {
          category: true,
          media: {
            orderBy: (media, { asc }) => [asc(media.displayOrder)],
          },
        },
      }),
    ]);

    categoryNames = categories.map((c) => ({ id: c.id, name: c.name }));
    storageProducts = productsList.map((p) => ({
      id: p.id,
      name: p.title,
      category: p.category?.name || 'Sin categoria',
      stock: p.stock,
      price: String(p.price),
      status: p.isAvailable ? 'ACTIVO' : 'NO ACTIVO',
      image: p.media?.[0]?.mediaUrl || '',
      images: p.media?.map((m) => m.mediaUrl) || [],
      description: p.description || '',
      currency: p.currency,
      brand: p.brand,
      tags: p.tags,
      shippingInfo: p.shippingInfo,
      saleStatus: p.saleStatus || 'NORMAL',
      secondPrice: p.secondPrice ? String(p.secondPrice) : null,
      metadata: (p.metadata as Record<string, unknown>) || null,
    }));
  }

  return (
    <BusinessProviders
      businessSlug={business.slug}
      businessId={business.id}
      country={business.country}
      entitlements={entitlements}
      initialProducts={storageProducts}
      initialCategories={categoryNames}
      isOwner={isOwner}
      role={role}
      permissions={permissions}
    >
      <AppLayout
        showNavbarByDefault={isAdminView}
        navbarPlanName={navbarPlanName}
        navbarBusinessId={business.id}
        navbarBusinessName={business.name}
        navbarBusinessLogoUrl={business.logoUrl ?? undefined}
        navbarBusinessCoverUrl={business.coverImageUrl ?? undefined}
      >
        {children}
        {modal}
      </AppLayout>
    </BusinessProviders>
  );
}
