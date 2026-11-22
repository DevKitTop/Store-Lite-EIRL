import { env } from '@/config/env';
import { db } from '@/core/database/client';
import { businesses } from '@/core/database/schema';
import { getPromotionCandidates } from '@/features/promotions/getApplicablePromotion';
import {
  resolvePricingPromotion,
  type PricingPromotionSummary,
} from '@/features/promotions/pricingPromotions';
import { formatSoles, PLAN_PRICES } from '@/shared/billing/planPrices';
import { Icon } from '@/shared/components/ui/data-display';
import { createServerClient } from '@supabase/ssr';
import { eq } from 'drizzle-orm';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { PricingBackButton } from './components/PricingBackButton';
import type { BusinessPlanOption, PricingCardProps } from './components/PricingCard';
import { PricingCard } from './components/PricingCard';
import './pricing.css';

export const metadata: Metadata = {
  title: 'Planes y precios',
  description:
    'Crea tu tienda online en minutos y elige el plan ideal para tu negocio. Acepta pagos con tarjetas vía Culqi y haz crecer tu marca en Perú.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/pricing' },
};

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const cookieStore = await cookies();
  const searchParamsAwaited = await searchParams;
  const slug = searchParamsAwaited.slug as string;
  const rawPromotionCode = searchParamsAwaited.promotionCode;
  const providedPromotionCode =
    typeof rawPromotionCode === 'string' && rawPromotionCode.trim()
      ? rawPromotionCode.trim()
      : null;

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

  let myBusinesses: BusinessPlanOption[] = [];
  if (user) {
    const rawBusinesses = await db.query.businesses.findMany({
      where: eq(businesses.ownerId, user.id),
      orderBy: (businesses, { desc }) => [desc(businesses.createdAt)],
      with: {
        subscriptions: {
          where: (subscriptions, { eq }) => eq(subscriptions.planStatus, 'active'),
          limit: 1,
        },
      },
    });
    myBusinesses = rawBusinesses.map((b) => ({
      ...b,
      planType: b.subscriptions?.[0]?.planType || 'lite',
      planEndDate: b.subscriptions?.[0]?.planEndDate,
    }));
  }

  const preselectedBusinessId = myBusinesses.find((b) => b.slug === slug)?.id;

  let monthlyPromotion: PricingPromotionSummary | null = null;
  let annualPromotion: PricingPromotionSummary | null = null;
  let promotionCodeError = false;

  if (user) {
    const [monthlyCandidates, annualCandidates] = await Promise.all([
      getPromotionCandidates({
        ownerId: user.id,
        planType: 'lite_pago',
        period: 'monthly',
        listPriceCents: PLAN_PRICES.lite_pago.monthly,
        providedCode: providedPromotionCode,
      }),
      getPromotionCandidates({
        ownerId: user.id,
        planType: 'lite_pago',
        period: 'annual',
        listPriceCents: PLAN_PRICES.lite_pago.annual,
        providedCode: providedPromotionCode,
      }),
    ]);

    const monthlyResolved = resolvePricingPromotion(
      monthlyCandidates,
      PLAN_PRICES.lite_pago.monthly,
      providedPromotionCode,
    );
    const annualResolved = resolvePricingPromotion(
      annualCandidates,
      PLAN_PRICES.lite_pago.annual,
      providedPromotionCode,
    );

    monthlyPromotion = monthlyResolved.promotion;
    annualPromotion = annualResolved.promotion;
    promotionCodeError = monthlyResolved.invalidCode || annualResolved.invalidCode;
  }

  const plans: PricingCardProps[] = [
    {
      title: 'Lite Pago',
      description:
        'La base sólida e inteligente para formalizar y despegar tu primer gran proyecto.',
      price: formatSoles(monthlyPromotion?.finalPriceCents ?? PLAN_PRICES.lite_pago.monthly),
      annualPrice: formatSoles(annualPromotion?.finalPriceCents ?? PLAN_PRICES.lite_pago.annual),
      originalPrice: monthlyPromotion ? formatSoles(PLAN_PRICES.lite_pago.monthly) : undefined,
      annualOriginalPrice: annualPromotion ? formatSoles(PLAN_PRICES.lite_pago.annual) : undefined,
      marketingNote: monthlyPromotion
        ? `Código ${monthlyPromotion.code} aplicado`
        : 'Ahorra 2 meses con pago anual',
      period: 'mes',
      buttonText: 'Comenzar ahora',
      buttonVariant: 'filled',
      isHighlighted: true,
      badgeText: monthlyPromotion?.name ?? 'Más popular',
      badgeType: 'primary',
      promotionCode: monthlyPromotion?.code,
      features: [
        { text: 'Pasarela completa: Pagos digitales y tarjetas bancarias' },
        { text: 'Almacenamiento premium para 300 productos' },
        { text: 'Personalización avanzada: Edición del negocio' },
        { text: 'SEO avanzado: controla cómo te encuentra Google' },
        { text: 'Centro de mando: Dashboard de ventas y métricas de progreso' },
        { text: 'Colaboración élite: Equipo de trabajo con 2 usuarios adicionales' },
        { text: 'Tu propia tienda en Store Lite (subdominio)' },
      ],
    },
    {
      title: 'Lite Plus',
      description:
        'Para marcas que necesitan el máximo rendimiento y todas las herramientas para escalar.',
      price: formatSoles(PLAN_PRICES.lite_plus.monthly),
      annualPrice: formatSoles(PLAN_PRICES.lite_plus.annual),
      marketingNote: 'Ahorra 2 meses con pago anual',
      period: 'mes',
      buttonText: 'Impulsar mi negocio',
      buttonVariant: 'tonal',
      badgeText: 'Edición Limitada',
      badgeType: 'secondary',
      features: [
        { text: 'Ecosistema total: Incluye todos los beneficios previos' },
        { text: 'Potencial ampliado: 600 productos' },
        { text: 'Presentación premium con hasta 3 imágenes por producto' },
        { text: 'Escalabilidad extendida: 4 usuarios adicionales para tu equipo' },
        { text: 'Dashboard avanzado con métricas en tiempo real' },
      ],
    },
  ];

  const headerIcons = [
    { label: 'Chat', icon: 'chat' },
    { label: 'Productos', icon: 'shopping_bag' },
    { label: 'Seguridad', icon: 'security' },
    { label: 'Soporte', icon: 'support_agent' },
  ];

  return (
    <div className="pricing-page-container">
      <div className="pricing-shell-row">
        <div className="pricing-content-shell">
          <div className="pricing-top-actions">
            <PricingBackButton />
          </div>

          <div className="pricing-header">
            <div className="pricing-header-icons" aria-label="Características principales">
              {headerIcons.map(({ label, icon }) => (
                <div key={label} className="pricing-header-icon-item" title={label}>
                  <span className="pricing-header-icon" aria-hidden="true">
                    <Icon>{icon}</Icon>
                  </span>
                </div>
              ))}
            </div>

            <h1 className="pricing-title">Planes y Precios</h1>
            <p className="pricing-subtitle">
              Elige el plan que mejor se adapte al tamaño y las necesidades de tu negocio. Cambia o
              cancela en cualquier momento.
            </p>
          </div>

          {user ? (
            <form className="pricing-promotion-form" action="/pricing" method="get">
              {slug ? <input type="hidden" name="slug" value={slug} /> : null}
              <label htmlFor="promotionCode">¿Tienes un código de descuento?</label>
              <div className="pricing-promotion-form-row">
                <input
                  id="promotionCode"
                  name="promotionCode"
                  defaultValue={providedPromotionCode ?? ''}
                  placeholder="Ingresa tu código"
                  autoComplete="off"
                />
                <button type="submit">Aplicar</button>
                {providedPromotionCode ? (
                  <a href={slug ? `/pricing?slug=${encodeURIComponent(slug)}` : '/pricing'}>
                    Quitar
                  </a>
                ) : null}
              </div>
              {promotionCodeError ? (
                <p className="pricing-promotion-error" role="alert">
                  El código de descuento no es válido o no aplica a este plan.
                </p>
              ) : null}
              {monthlyPromotion && !promotionCodeError ? (
                <p className="pricing-promotion-success" role="status">
                  Código {monthlyPromotion.code} aplicado: pagas S/{' '}
                  {formatSoles(monthlyPromotion.finalPriceCents)} al mes.
                </p>
              ) : null}
            </form>
          ) : null}

          <div className="pricing-grid">
            {plans.map((plan, index) => (
              <PricingCard
                key={index}
                {...plan}
                businesses={myBusinesses}
                preselectedBusinessId={preselectedBusinessId}
              />
            ))}
          </div>

          {/* ── Sobre los pagos con Culqi ── */}
          <div className="pricing-culqi-note" role="note">
            <p className="pricing-culqi-note-title">
              <Icon>credit_card</Icon>
              Sobre los pagos con Culqi
            </p>
            <ul className="pricing-culqi-note-list">
              <li>
                <strong>Culqi</strong> es la pasarela de pagos que procesa los cobros de su tienda:
                tarjetas de crédito y débito (Visa, Mastercard, American Express), Yape, Plin,
                billeteras móviles, Cuotéalo BCP y PagoEfectivo.
              </li>
              <li>
                Está incluida en los planes <strong>Lite Pago</strong> y <strong>Lite Plus</strong>.
              </li>
              <li>
                Antes de activar pagos reales,{' '}
                <strong>Culqi valida su comercio de forma independiente</strong>: su tienda debe
                cumplir requisitos (al menos 5 productos con imagen, precio y descripción, Términos
                y Condiciones, Políticas de Devoluciones, Libro de Reclamaciones, datos de contacto
                y redes sociales).
              </li>
            </ul>
            <p className="pricing-culqi-note-warning">
              ⚠️ La validación de Culqi demora entre 1 y 3 días hábiles. Tenga en cuenta este tiempo
              al elegir la duración de su plan. Puede preparar su tienda con el checklist de
              requisitos en Configuración → Pagos, incluso antes de suscribirse.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
