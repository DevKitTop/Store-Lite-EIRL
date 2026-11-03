import { replaceSlugInPath, resolveBusinessSlug } from '@/core/business/slug';
import { db } from '@/core/database/client';
import {
  businessSubscriptions,
  formMessages,
  messages,
  payments,
  productCategories,
  productLikes,
  productMedia,
  products,
} from '@/core/database/schema';
import { getBusinessEntitlements } from '@/core/entitlements/getBusinessEntitlements';
import { isValidPaymentStatus } from '@/core/orders/isValidPaymentStatus';
import type { OrderStatusValue } from '@/core/orders/orderStatus';
import { ORDER_STATUS } from '@/core/orders/orderStatus';
import { hasLockingPayments } from '@/core/orders/paymentGuards';
import { getSignedTicketUrls } from '@/lib/storage/signedTicket';
import { and, count, desc, eq, gt, gte, inArray, lt, lte, sql, sum } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';

import { DashboardHeader } from './components/DashboardHeader';
import { EarningsStats } from './components/EarningsStats';
import { InventoryAlerts } from './components/InventoryAlerts';
import { MarketInsights } from './components/MarketInsights';
import { PenaltyInfoCard } from './components/PenaltyInfoCard';
import { PlanStatusBar } from './components/PlanStatusBar';
import { RecentOrders } from './components/RecentOrders';
import { StatCards } from './components/StatCards';

import styles from './dashboard.module.css';

interface DashboardProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    page?: string;
    status?: string;
    search?: string;
    date?: string;
  }>;
}

export default async function Dashboard({ params, searchParams }: DashboardProps) {
  const { slug } = await params;
  const { page, status, search, date } = await searchParams;

  const currentPage = Math.max(1, parseInt(page || '1'));
  const currentLimit = 10; // Fixed limit of 10 orders per page
  const offset = (currentPage - 1) * currentLimit;

  const lastUpdatedAt = new Date().toISOString();

  // 1. Fetch business core data
  const resolvedBusiness = await resolveBusinessSlug(slug);
  const business = resolvedBusiness?.business;

  if (!business) {
    return notFound();
  }

  if (resolvedBusiness.matchedAlias) {
    redirect(replaceSlugInPath(`/${slug}/dashboard`, slug, resolvedBusiness.canonicalSlug));
  }

  // ─── Time Period Definitions ───
  const now = new Date();

  // Today vs Yesterday
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  // This Week (Last 7 days)
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const fourteenDaysAgo = new Date(now);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

  // This Month (Last 30 days)
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sixtyDaysAgo = new Date(now);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  // ─── Statuses that represent a successful, paid sale ───
  // Excludes: pending (not paid), failed (not paid), refund_requested / refunded (money returned)
  const SOLD_STATUSES: OrderStatusValue[] = [
    ORDER_STATUS.PAID,
    ORDER_STATUS.VALIDANDO,
    ORDER_STATUS.EN_REPARTO,
    ORDER_STATUS.DELIVERED,
    ORDER_STATUS.NOT_DELIVERED,
    ORDER_STATUS.COMPLETED,
    ORDER_STATUS.DISPUTED,
  ];

  // ─── Filters for Recent Orders ───
  const orderFilters = [eq(payments.businessId, business.id)];

  // Filter by status
  if (status && status !== 'all' && isValidPaymentStatus(status)) {
    orderFilters.push(eq(payments.status, status as OrderStatusValue));
  }

  // Filter by order number (search)
  if (search) {
    const searchTerm = `%${search}%`;
    orderFilters.push(sql`${payments.orderNumber} ILIKE ${searchTerm}`);
  }

  // Filter by date
  if (date && date !== 'all') {
    const now = new Date();
    let dateFilter: Date;

    switch (date) {
      case 'today':
        dateFilter = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        orderFilters.push(gte(payments.createdAt, dateFilter));
        break;
      case 'yesterday': {
        const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        orderFilters.push(gte(payments.createdAt, startOfYesterday));
        orderFilters.push(lt(payments.createdAt, startOfToday));
        break;
      }
      case 'week':
        dateFilter = new Date(now);
        dateFilter.setDate(dateFilter.getDate() - 7);
        orderFilters.push(gte(payments.createdAt, dateFilter));
        break;
    }
  }

  const orderWhere = and(...orderFilters);

  // 2. Resolve entitlements & plan
  const [entitlements, subscription] = await Promise.all([
    getBusinessEntitlements(business.id),
    db.query.businessSubscriptions.findFirst({
      where: and(
        eq(businessSubscriptions.businessId, business.id),
        eq(businessSubscriptions.planStatus, 'active'),
      ),
      orderBy: [desc(businessSubscriptions.createdAt)],
    }),
  ]);

  // 3. Parallel fetching for stats & financial analysis
  const [counts, inventoryData, financialMetrics, recentOrdersResult] = await Promise.all([
    // Group 1: General Counts & Alerts Prep
    Promise.all([
      db.select({ count: count() }).from(products).where(eq(products.businessId, business.id)),
      db
        .select({ count: count() })
        .from(productCategories)
        .where(eq(productCategories.businessId, business.id)),
      // Unread Form Messages + Unread Chat Messages
      db
        .select({ count: count() })
        .from(formMessages)
        .where(and(eq(formMessages.businessId, business.id), eq(formMessages.isRead, false))),
      db
        .select({ count: count() })
        .from(messages)
        .innerJoin(products, eq(products.businessId, business.id))
        .where(and(eq(messages.isRead, false), eq(messages.isFromStore, false))),
      db
        .select({ count: count() })
        .from(productLikes)
        .innerJoin(products, eq(productLikes.productId, products.id))
        .where(eq(products.businessId, business.id)),
      db
        .select({ count: count() })
        .from(payments)
        .where(and(eq(payments.businessId, business.id), inArray(payments.status, SOLD_STATUSES))),
      // Out of Stock & Low Stock Counts
      db
        .select({ count: count() })
        .from(products)
        .where(and(eq(products.businessId, business.id), eq(products.stock, 0))),
      db
        .select({ count: count() })
        .from(products)
        .where(
          and(eq(products.businessId, business.id), gt(products.stock, 0), lte(products.stock, 5)),
        ),
      // Added this week
      db
        .select({ count: count() })
        .from(products)
        .where(and(eq(products.businessId, business.id), gte(products.createdAt, sevenDaysAgo))),
      // Locked state: payments that freeze identity/product edits
      hasLockingPayments({ businessId: business.id }),
    ]),

    // Group 2: Inventory Lists
    Promise.all([
      // Top Liked
      db.query.products.findMany({
        where: eq(products.businessId, business.id),
        limit: 4,
        orderBy: [desc(products.stars)],
      }),
      // Out of Stock
      db.query.products.findMany({
        where: and(eq(products.businessId, business.id), eq(products.stock, 0)),
        limit: 4,
        orderBy: [desc(products.updatedAt)],
      }),
      // Low Stock
      db.query.products.findMany({
        where: and(
          eq(products.businessId, business.id),
          gt(products.stock, 0),
          lte(products.stock, 5),
        ),
        limit: 4,
        orderBy: [desc(products.stock)],
      }),
    ]),

    // Group 3: Financials
    Promise.all([
      // Daily Earnings
      db
        .select({ sum: sum(payments.amount) })
        .from(payments)
        .where(
          and(
            eq(payments.businessId, business.id),
            inArray(payments.status, SOLD_STATUSES),
            gte(payments.createdAt, startOfToday),
          ),
        ),
      db
        .select({ sum: sum(payments.amount) })
        .from(payments)
        .where(
          and(
            eq(payments.businessId, business.id),
            inArray(payments.status, SOLD_STATUSES),
            gte(payments.createdAt, startOfYesterday),
            lt(payments.createdAt, startOfToday),
          ),
        ),

      // Weekly Earnings
      db
        .select({ sum: sum(payments.amount) })
        .from(payments)
        .where(
          and(
            eq(payments.businessId, business.id),
            inArray(payments.status, SOLD_STATUSES),
            gte(payments.createdAt, sevenDaysAgo),
          ),
        ),
      db
        .select({ sum: sum(payments.amount) })
        .from(payments)
        .where(
          and(
            eq(payments.businessId, business.id),
            inArray(payments.status, SOLD_STATUSES),
            gte(payments.createdAt, fourteenDaysAgo),
            lt(payments.createdAt, sevenDaysAgo),
          ),
        ),

      // Monthly Earnings
      db
        .select({ sum: sum(payments.amount) })
        .from(payments)
        .where(
          and(
            eq(payments.businessId, business.id),
            inArray(payments.status, SOLD_STATUSES),
            gte(payments.createdAt, thirtyDaysAgo),
          ),
        ),
      db
        .select({ sum: sum(payments.amount) })
        .from(payments)
        .where(
          and(
            eq(payments.businessId, business.id),
            inArray(payments.status, SOLD_STATUSES),
            gte(payments.createdAt, sixtyDaysAgo),
            lt(payments.createdAt, thirtyDaysAgo),
          ),
        ),

      // Top Products by Sales
      db
        .select({ name: products.title, count: count(payments.id) })
        .from(payments)
        .innerJoin(products, eq(payments.productId, products.id))
        .where(and(eq(payments.businessId, business.id), inArray(payments.status, SOLD_STATUSES)))
        .groupBy(products.title)
        .orderBy(desc(count(payments.id)))
        .limit(5),

      // Top Categories by Sales
      db
        .select({ name: productCategories.name, count: count(payments.id) })
        .from(payments)
        .innerJoin(products, eq(payments.productId, products.id))
        .innerJoin(productCategories, eq(products.categoryId, productCategories.id))
        .where(and(eq(payments.businessId, business.id), inArray(payments.status, SOLD_STATUSES)))
        .groupBy(productCategories.name)
        .orderBy(desc(count(payments.id)))
        .limit(5),

      // Best Days
      db
        .select({
          day: sql<number>`EXTRACT(DOW FROM ${payments.createdAt})`,
          count: count(payments.id),
        })
        .from(payments)
        .where(
          and(
            eq(payments.businessId, business.id),
            inArray(payments.status, SOLD_STATUSES),
            gte(payments.createdAt, sevenDaysAgo),
          ),
        )
        .groupBy(sql`EXTRACT(DOW FROM ${payments.createdAt})`),
    ]),

    // Group 4: Recent Orders (Filtered & Paginated)
    Promise.all([
      db.query.payments.findMany({
        where: orderWhere,
        limit: currentLimit,
        offset: offset,
        orderBy: [desc(payments.createdAt)],
        with: {
          product: {
            columns: { title: true, slug: true },
            with: {
              media: {
                limit: 1,
                orderBy: [desc(productMedia.displayOrder)],
              },
            },
          },
        },
      }),
      db.select({ count: count() }).from(payments).where(orderWhere),
    ]),
  ]);

  // ─── Extract Results ───
  const productsCount = counts[0][0]?.count || 0;
  const categoriesCount = counts[1][0]?.count || 0;
  const unreadMessagesCount = (counts[2][0]?.count || 0) + (counts[3][0]?.count || 0);
  const totalLikes = counts[4][0]?.count || 0;
  const totalSold = counts[5][0]?.count || 0;
  const _outOfStockCount = counts[6][0]?.count || 0;
  const _lowStockCount = counts[7][0]?.count || 0;
  const _addedThisWeekCount = counts[8][0]?.count || 0;
  const businessLocked = counts[9];

  const topLiked = inventoryData[0];
  const outOfStock = inventoryData[1];
  const lowStock = inventoryData[2];

  const financialData = financialMetrics;
  const recentOrdersData = recentOrdersResult[0];
  const totalOrdersCount = recentOrdersResult[1][0]?.count || 0;
  const _totalPages = Math.ceil(totalOrdersCount / currentLimit);
  // ─── Formatting Helpers ───
  const getAmount = (res: any) => parseFloat(res[0]?.sum || '0');
  const calcChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  };

  const earnings = {
    daily: {
      label: 'Hoy',
      amount: `S/ ${getAmount(financialData[0]).toFixed(2)}`,
      percentage: calcChange(getAmount(financialData[0]), getAmount(financialData[1])),
      isPositive: getAmount(financialData[0]) >= getAmount(financialData[1]),
      color: 'blue' as const,
    },
    weekly: {
      label: 'Semanal',
      amount: `S/ ${getAmount(financialData[2]).toFixed(2)}`,
      percentage: calcChange(getAmount(financialData[2]), getAmount(financialData[3])),
      isPositive: getAmount(financialData[2]) >= getAmount(financialData[3]),
      color: 'green' as const,
    },
    monthly: {
      label: 'Mensual',
      amount: `S/ ${getAmount(financialData[4]).toFixed(2)}`,
      percentage: calcChange(getAmount(financialData[4]), getAmount(financialData[5])),
      isPositive: getAmount(financialData[4]) >= getAmount(financialData[5]),
      color: 'purple' as const,
    },
  };

  // Format Market Insights
  const maxProductSales = Math.max(...financialData[6].map((p) => Number(p.count)), 1);
  const topProducts = financialData[6].map((p) => ({
    name: p.name,
    count: Number(p.count),
    progress: Math.round((Number(p.count) / maxProductSales) * 100),
  }));
  const maxCategorySales = Math.max(...financialData[7].map((c) => Number(c.count)), 1);
  const topCategories = financialData[7].map((c) => ({
    name: c.name,
    count: Number(c.count),
    progress: Math.round((Number(c.count) / maxCategorySales) * 100),
  }));
  const dayMap: Record<number, string> = {
    0: 'Dom',
    1: 'Lun',
    2: 'Mar',
    3: 'Mie',
    4: 'Jue',
    5: 'Vie',
    6: 'Sab',
  };
  const maxDaySales = Math.max(...financialData[8].map((d) => Number(d.count)), 1);
  const bestDays = [1, 2, 3, 4, 5, 6, 0].map((dayNum) => {
    const found = financialData[8].find((d) => Number(d.day) === dayNum);
    return {
      day: dayMap[dayNum],
      intensity: found ? Math.round((Number(found.count) / maxDaySales) * 100) : 0,
    };
  });

  // Format orders for Urbano Component
  // NOTE: trackingToken is NOT exposed to the seller dashboard.
  // It is only used internally by server actions (fetched directly from DB).
  // This prevents sellers from accessing the customer order portal.
  // The `tickets` bucket is private: sign every receipt in a single storage call
  // instead of one request per order.
  const signedTicketUrls = await getSignedTicketUrls(
    recentOrdersData.map((order) => order.ticketImageUrl),
  );

  const formattedOrders = recentOrdersData.map((order, orderIndex) => {
    const formatDeadline = order.finalizationDeadline
      ? order.finalizationDeadline instanceof Date
        ? order.finalizationDeadline.toISOString()
        : order.finalizationDeadline
      : null;
    const formatCompleted = order.completedAt
      ? order.completedAt instanceof Date
        ? order.completedAt.toISOString()
        : order.completedAt
      : null;

    return {
      id: order.id,
      orderNumber: order.orderNumber,
      productId: order.productId || '',
      productTitle: order.product?.title || 'Producto desconocido',
      productSlug: order.product?.slug || '',
      productImage: order.product?.media?.[0]?.mediaUrl || null,
      amount: order.amount.toString(),
      currency: order.currency,
      paymentMethod: order.paymentMethod,
      status: order.status,
      shippingAddress: order.shippingAddress,
      shippingDistrict: order.shippingDistrict,
      shippingProvince: order.shippingProvince,
      shippingDepartment: order.shippingDepartment,
      shippingType: order.shippingType,
      shippingAgency: order.shippingAgency,
      shippingReference: order.shippingReference,
      shippingPhone: order.shippingPhone,
      buyerEmail: order.buyerEmail,
      // ⚠️ trackingToken NO se envía al cliente — se obtiene directo de la DB en server actions
      // ⚠️ buyerDni se enmascara para evitar que el seller acceda al portal del customer
      maskedDni: maskDni(order.buyerDni),
      ticketImageUrl: signedTicketUrls.at(orderIndex) ?? null,
      finalizationDeadline: formatDeadline,
      completedAt: formatCompleted,
      // ⚠️ metadata NO incluye buyerDni — se sanitiza para seguridad
      metadata: sanitizeMetadata(order.metadata),
      createdAt: order.createdAt instanceof Date ? order.createdAt.toISOString() : order.createdAt,
      businessId: order.businessId,
      courierName: order.courierName,
      trackingNumber: order.trackingNumber,
      pickupCode: order.pickupCode,
      sellerNote: order.sellerNote,
    };
  });

  // Helper functions for security sanitization
  function maskDni(dni: string | null): string {
    if (!dni || dni.length < 4) return '****';
    return '****' + dni.slice(-4);
  }

  function sanitizeMetadata(metadata: any): any {
    if (!metadata) return metadata;
    const sanitized = { ...metadata };
    delete sanitized.buyerDni; // Never expose full DNI to seller client
    return sanitized;
  }

  const planStartDate =
    subscription?.planStartDate instanceof Date
      ? subscription.planStartDate.toISOString()
      : subscription?.planStartDate;
  const planEndDate =
    subscription?.planEndDate instanceof Date
      ? subscription.planEndDate.toISOString()
      : subscription?.planEndDate;

  return (
    <main className={styles.dashboardRoot}>
      <DashboardHeader
        businessName={business.name}
        businessId={business.id}
        logoUrl={business.logoUrl}
        entitlements={entitlements}
        planEndDate={planEndDate}
      />

      {businessLocked && (
        <div className={styles.lockBanner} role="status">
          <p className={styles.lockBannerTitle}>Algunas funciones están desactivadas</p>
          <p className={styles.lockBannerText}>
            Para proteger la información que ven tus clientes, la edición de los datos de identidad
            del negocio (nombre, RUC, dirección, URL) está bloqueada porque el negocio tiene pagos
            registrados. Puedes seguir editando logo, descripción, contacto, stock y disponibilidad.
          </p>
        </div>
      )}

      <StatCards
        totalProducts={productsCount}
        totalCategories={categoriesCount}
        unreadMessages={unreadMessagesCount}
        totalLikes={totalLikes}
        totalSold={totalSold}
        entitlements={entitlements}
      />

      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Análisis de Ventas</h2>
      </div>

      <EarningsStats data={earnings} />

      <MarketInsights topProducts={topProducts} topCategories={topCategories} bestDays={bestDays} />

      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Estado de Inventario</h2>
      </div>

      <InventoryAlerts
        topLiked={topLiked.map((p) => ({ id: p.id, title: p.title, stars: p.stars || 0 }))}
        outOfStock={outOfStock.map((p) => ({ id: p.id, title: p.title }))}
        lowStock={lowStock.map((p) => ({ id: p.id, title: p.title, stock: p.stock }))}
      />

      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Estado de pedidos Recientes </h2>
      </div>

      <RecentOrders
        orders={formattedOrders}
        currentPage={currentPage}
        totalPages={1}
        currentStatus={status || 'all'}
        currentSearch={search || ''}
        currentDate={date || 'all'}
        businessSlug={slug}
      />

      <div className={styles.bottomRow}>
        <div className={styles.bottomMain}>
          <PlanStatusBar
            entitlements={entitlements}
            currentProducts={productsCount}
            currentCategories={categoriesCount}
            planStartDate={planStartDate}
            planEndDate={planEndDate}
            lastUpdatedAt={lastUpdatedAt}
          />
        </div>
        <aside className={styles.bottomAside}>
          <PenaltyInfoCard businessSlug={slug} />
        </aside>
      </div>
    </main>
  );
}
