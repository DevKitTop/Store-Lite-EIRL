'use client';

import { CulqiCheckout } from '@/features/billing/components/CulqiCheckout';
import { PlanTicketTemplate } from '@/features/billing/components/PlanTicketTemplate';
import {
  usePurchasePlan,
  type PurchasePlanData,
  type PurchasePlanIssuer,
  type PurchasePlanResult,
} from '@/features/billing/hooks/usePurchasePlan';
import { generateEventId } from '@/lib/meta/eventId';
import { trackInitiateCheckout, trackPurchase } from '@/lib/meta/events';
import { splitIgv } from '@/shared/billing/planPrices';
import { Dialog, Select } from '@/shared/components/ui';
import { Button } from '@/shared/components/ui/buttons/Button';
import { Icon } from '@/shared/components/ui/data-display';
import { loadCulqiScript } from '@/shared/payments/culqiScript';
import confetti from 'canvas-confetti';
import React from 'react';

export interface PricingFeature {
  text: string;
}

export interface BusinessPlanOption {
  id: string;
  slug?: string | null;
  name: string;
  email?: string | null;
  taxId?: string | null;
  address?: string | null;
  planType?: string | null;
}

export interface PricingCardProps {
  title: string;
  description: string;
  price: string;
  /** Precio anual (un mes de contrato anual) — si se pasa, se muestra el toggle Mensual/Anual. */
  annualPrice?: string;
  originalPrice?: string;
  annualOriginalPrice?: string;
  marketingNote?: string;
  period: string;
  features: PricingFeature[];
  buttonText: string;
  isHighlighted?: boolean;
  badgeText?: string;
  badgeType?: 'primary' | 'secondary';
  buttonVariant?: 'filled' | 'outlined' | 'tonal' | 'elevated' | 'text';
  businesses?: BusinessPlanOption[];
  preselectedBusinessId?: string;
  promotionCode?: string | null;
}

type PaymentStep = 'select' | 'billing' | 'payment' | 'success';

const planLabels: Record<string, string> = {
  lite: 'Lite',
  lite_pago: 'Lite Pago',
  lite_plus: 'Lite Plus',
};

export function PricingCard({
  title,
  description,
  price,
  annualPrice,
  originalPrice,
  annualOriginalPrice,
  marketingNote,
  period,
  features,
  buttonText,
  isHighlighted = false,
  badgeText,
  badgeType = 'primary',
  buttonVariant = 'outlined',
  businesses = [],
  preselectedBusinessId,
  promotionCode,
}: PricingCardProps) {
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = React.useState(false);
  const [step, setStep] = React.useState<PaymentStep>('select');
  const [selectedBusiness, setSelectedBusiness] = React.useState('');
  const [orderDetails, setOrderDetails] = React.useState({ id: '', date: '', time: '' });

  // Toggle Mensual/Anual: cuando existe annualPrice, el usuario puede elegir.
  // price = mensual; annualPrice = costo del período anual completo (S/ 390 → "390").
  const [isAnnual, setIsAnnual] = React.useState(false);
  const displayPrice = isAnnual && annualPrice ? annualPrice : price;
  const displayPeriod = isAnnual ? 'anual' : period;

  // Datos SUNAT
  const [buyerEmail, setBuyerEmail] = React.useState('');
  const [buyerFullName, setBuyerFullName] = React.useState('');
  const [buyerDocumentType, setBuyerDocumentType] = React.useState<'DNI' | 'RUC'>('RUC');
  const [buyerDocumentNumber, setBuyerDocumentNumber] = React.useState('');
  const [buyerAddress, setBuyerAddress] = React.useState('');

  const culqiTriggerRef = React.useRef<HTMLDivElement | null>(null);
  const {
    purchase,
    loading: isProcessing,
    error,
    result,
    capturingData,
    ticketRef,
    reset,
  } = usePurchasePlan();

  const cardClassName = `pricing-card ${isHighlighted ? 'pricing-card--highlighted' : ''}`;

  // Sincronizar datos del negocio seleccionado automáticamente
  React.useEffect(() => {
    if (selectedBusiness) {
      const biz = businesses.find((b) => b.id === selectedBusiness);
      if (biz) {
        setBuyerEmail(biz.email || '');
        setBuyerFullName(biz.name || '');
        setBuyerDocumentType('RUC');
        setBuyerDocumentNumber(biz.taxId || '');
        setBuyerAddress(biz.address || '');
      }
    }
  }, [selectedBusiness, businesses]);

  const handleOpenDialog = () => {
    setIsPaymentDialogOpen(true);
    setStep('select');

    // Meta pixel: checkout intent, browser-only (own event id, CAPI has no twin)
    trackInitiateCheckout({ value: Number(displayPrice), currency: 'PEN' }, generateEventId());

    // Pre-cargar Culqi asíncronamente mientras el usuario selecciona negocio
    loadCulqiScript(process.env.NEXT_PUBLIC_CULQI_PK || '').catch((e) =>
      console.error('Error cargando culqi:', e),
    );
    if (preselectedBusinessId) {
      setSelectedBusiness(preselectedBusinessId);
    } else if (businesses.length === 1) {
      setSelectedBusiness(businesses[0].id);
    } else {
      setSelectedBusiness('');
    }

    setOrderDetails({
      id: `TXN-${Math.random().toString(36).substring(2, 10).toUpperCase()}`,
      date: new Date().toLocaleDateString('es-PE'),
      time: new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }),
    });
    reset(); // reset purchase state
  };

  const handleCloseDialog = () => {
    if (isProcessing) return;
    setIsPaymentDialogOpen(false);
  };

  const handlePay = () => {
    setIsPaymentDialogOpen(false);
    // Pequeño delay para dejar que el dialog empiece a cerrar
    setTimeout(() => {
      culqiTriggerRef.current?.click();
    }, 100);
  };

  const selectedBusinessData = businesses.find((b) => b.id === selectedBusiness);
  const selectedBusinessName = selectedBusinessData?.name;
  const hasActivePlan = Boolean(
    selectedBusinessData?.planType && selectedBusinessData.planType !== 'lite',
  );

  const handleCulqiToken = async (token: string) => {
    let planEnum: 'lite' | 'lite_pago' | 'lite_plus' = 'lite';
    // Orden importa: chequear primero las cadenas más largas porque "Lite Pago" y
    // "Lite Plus" contienen "Lite".
    if (title.toLowerCase().includes('lite pago')) planEnum = 'lite_pago';
    else if (title.toLowerCase().includes('lite plus')) planEnum = 'lite_plus';

    setIsPaymentDialogOpen(true); // Asegurarse de que el modal siga abierto
    setStep('payment');

    const res = await purchase({
      token,
      planType: planEnum,
      period: displayPeriod === 'anual' ? 'annual' : 'monthly',
      businessId: selectedBusiness,
      buyerEmail,
      buyerFullName,
      buyerDocumentType,
      buyerDocumentNumber,
      buyerAddress,
      promotionCode,
    });

    if (res) {
      // Meta pixel+server twin: same event_id as the CAPI Purchase (dedup).
      trackPurchase({ value: Number(displayPrice), currency: 'PEN' }, res.eventId);

      setStep('success');
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
      });
    }
  };

  // El precio mostrado es el TOTAL FINAL (incluye IGV 18%).
  // Desglosamos subtotal e IGV para Culqi y la boleta.
  const totalSoles = Number(displayPrice);
  const { subtotalSoles, igvSoles } = splitIgv(totalSoles);

  return (
    <>
      <div className={cardClassName}>
        <PricingCardHeader
          badgeText={badgeText}
          badgeType={badgeType}
          title={title}
          description={description}
          price={displayPrice}
          period={displayPeriod}
          originalPrice={
            isAnnual && annualPrice
              ? (annualOriginalPrice ?? price) // Tachado: precio anual cuando se ve el anual
              : originalPrice
          }
          marketingNote={marketingNote}
        />

        {annualPrice && (
          <div className="pricing-billing-toggle" role="group" aria-label="Período de facturación">
            <button
              type="button"
              className={`pricing-billing-option ${!isAnnual ? 'pricing-billing-option--active' : ''}`}
              onClick={() => setIsAnnual(false)}
              aria-pressed={!isAnnual}
            >
              Mensual
            </button>
            <button
              type="button"
              className={`pricing-billing-option ${isAnnual ? 'pricing-billing-option--active' : ''}`}
              onClick={() => setIsAnnual(true)}
              aria-pressed={isAnnual}
            >
              Anual
            </button>
          </div>
        )}

        <PricingFeaturesList features={features} />

        <div className="pricing-card-action">
          <Button variant={buttonVariant} style={{ width: '100%' }} onClick={handleOpenDialog}>
            {buttonText}
          </Button>
        </div>
      </div>

      <Dialog open={isPaymentDialogOpen} onClose={handleCloseDialog}>
        <div slot="headline">Suscripción a {title}</div>
        <div slot="content">
          <PaymentDialogContent
            step={step}
            title={title}
            businesses={businesses}
            selectedBusiness={selectedBusiness}
            onSelectedBusinessChange={setSelectedBusiness}
            hasActivePlan={hasActivePlan}
            buyerEmail={buyerEmail}
            buyerFullName={buyerFullName}
            buyerDocumentType={buyerDocumentType}
            buyerDocumentNumber={buyerDocumentNumber}
            buyerAddress={buyerAddress}
            orderDetails={orderDetails}
            selectedBusinessName={selectedBusinessName}
            period={displayPeriod}
            price={displayPrice}
            subtotalSoles={subtotalSoles}
            igvSoles={igvSoles}
            isProcessing={isProcessing}
            error={error}
            result={result}
          />
        </div>
        <PaymentDialogActions
          step={step}
          onStepChange={setStep}
          businesses={businesses}
          selectedBusiness={selectedBusiness}
          buyerEmail={buyerEmail}
          buyerFullName={buyerFullName}
          buyerDocumentNumber={buyerDocumentNumber}
          buyerAddress={buyerAddress}
          isProcessing={isProcessing}
          price={displayPrice}
          onPay={handlePay}
          onClose={handleCloseDialog}
        />
      </Dialog>

      {/* Culqi Checkout - Montado permanentemente fuera del dialog para evitar problemas de z-index y background */}
      <CulqiCheckoutNode
        title={title}
        price={displayPrice}
        selectedBusinessName={selectedBusinessName}
        period={displayPeriod}
        buyerFullName={buyerFullName}
        buyerEmail={buyerEmail}
        isProcessing={isProcessing}
        culqiTriggerRef={culqiTriggerRef}
        onTokenSuccess={handleCulqiToken}
      />

      {/* Nodo oculto para renderizar el ticket PNG */}
      <PlanTicketNode
        result={result}
        capturingData={capturingData}
        ticketRef={ticketRef}
        buyerEmail={buyerEmail}
        buyerFullName={buyerFullName}
        buyerDocumentType={buyerDocumentType}
        buyerDocumentNumber={buyerDocumentNumber}
        title={title}
        period={displayPeriod}
        subtotalSoles={subtotalSoles}
        igvSoles={igvSoles}
        totalSoles={totalSoles}
      />
    </>
  );
}

interface PricingCardHeaderProps {
  badgeText?: string;
  badgeType: 'primary' | 'secondary';
  title: string;
  description: string;
  price: string;
  period: string;
  originalPrice?: string;
  marketingNote?: string;
}

function PricingCardHeader({
  badgeText,
  badgeType,
  title,
  description,
  price,
  period,
  originalPrice,
  marketingNote,
}: PricingCardHeaderProps) {
  return (
    <>
      {badgeText && (
        <div
          className={`pricing-card-badge ${badgeType === 'secondary' ? 'pricing-card-badge--secondary' : ''}`}
        >
          {badgeText}
        </div>
      )}

      <div className="pricing-card-header">
        <h3 className="pricing-card-title">{title}</h3>
        <p className="pricing-card-description">{description}</p>
        <div className="pricing-card-price-lockup">
          <div className="pricing-card-price-container">
            <span className="pricing-card-currency">S/</span>
            <span className="pricing-card-price">{price}</span>
            <span className="pricing-card-period">/{period}</span>
            {originalPrice && (
              <span className="pricing-card-original-price">S/ {originalPrice}</span>
            )}
          </div>
          {marketingNote && <div className="pricing-card-discount-pill">{marketingNote}</div>}
        </div>
      </div>
    </>
  );
}

interface PricingFeaturesListProps {
  features: PricingFeature[];
}

function PricingFeaturesList({ features }: PricingFeaturesListProps) {
  return (
    <ul className="pricing-features-list">
      {features.map((feature, index) => (
        <li key={index} className="pricing-feature-item">
          <svg
            className="pricing-feature-icon"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span>{feature.text}</span>
        </li>
      ))}
    </ul>
  );
}

interface SelectBusinessStepContentProps {
  step: PaymentStep;
  businesses: BusinessPlanOption[];
  selectedBusiness: string;
  onSelectedBusinessChange: (value: string) => void;
  hasActivePlan: boolean;
}

function SelectBusinessStepContent({
  step,
  businesses,
  selectedBusiness,
  onSelectedBusinessChange,
  hasActivePlan,
}: SelectBusinessStepContentProps) {
  if (step !== 'select') {
    return null;
  }
  return (
    <div
      className="pricing-business-select-step"
      style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
    >
      <p>¿A qué negocio deseas aplicarle este plan?</p>
      {businesses.length > 0 ? (
        <Select
          label="Seleccionar negocio"
          value={selectedBusiness}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            onSelectedBusinessChange(e.target.value)
          }
          options={[
            { value: '', label: 'Selecciona una opcion...' },
            ...businesses.map((biz) => {
              const hasPlan = biz.planType && biz.planType !== 'lite';
              const planText = hasPlan
                ? ` (Plan Actual: ${planLabels[biz.planType as string] || biz.planType})`
                : '';
              return {
                value: biz.id,
                label: `${biz.name}${planText}`,
              };
            }),
          ]}
          style={{ width: '100%' }}
        />
      ) : (
        <div
          style={{
            padding: '16px',
            background: 'var(--md-sys-color-surface-variant)',
            borderRadius: '8px',
          }}
        >
          <p style={{ margin: 0, color: 'var(--md-sys-color-on-surface-variant)' }}>
            No tienes negocios registrados aún.
          </p>
        </div>
      )}
      {hasActivePlan && (
        <div
          style={{
            padding: '12px',
            background: 'var(--md-sys-color-error-container)',
            color: 'var(--md-sys-color-on-error-container)',
            borderRadius: '8px',
            fontSize: '0.875rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '4px',
            }}
          >
            <Icon size={16}>warning</Icon>
            <strong>Atención</strong>
          </div>
          Este negocio ya cuenta con un plan de pago. Si cambias de plan, el nuevo reemplazará al
          actual inmediatamente. No se emitirán reembolsos ni se acumulará el tiempo restante.
        </div>
      )}
    </div>
  );
}

interface BillingStepContentProps {
  step: PaymentStep;
  buyerEmail: string;
  buyerFullName: string;
  buyerDocumentType: 'DNI' | 'RUC';
  buyerDocumentNumber: string;
  buyerAddress: string;
}

function BillingStepContent({
  step,
  buyerEmail,
  buyerFullName,
  buyerDocumentType,
  buyerDocumentNumber,
  buyerAddress,
}: BillingStepContentProps) {
  if (step !== 'billing') {
    return null;
  }
  return (
    <div
      className="pricing-billing-step"
      style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          color: 'var(--md-sys-color-primary)',
        }}
      >
        <Icon size={24}>verified</Icon>
        <p style={{ margin: 0, fontWeight: '700', fontSize: '1.1rem' }}>
          Verifica tus datos de facturación
        </p>
      </div>

      <p
        style={{
          margin: '0',
          fontSize: '0.9rem',
          color: 'var(--md-sys-color-on-surface-variant)',
        }}
      >
        Usaremos la información de tu negocio para generar el comprobante SUNAT:
      </p>

      <div
        style={{
          padding: '1.25rem',
          background: 'var(--md-sys-color-surface-container-low)',
          borderRadius: '16px',
          border: '1px solid var(--md-sys-color-outline-variant)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: '700',
              color: 'var(--md-sys-color-primary)',
              textTransform: 'uppercase',
            }}
          >
            Razon Social / Nombre
          </span>
          <span style={{ fontSize: '1rem', fontWeight: '500' }}>
            {buyerFullName || 'No especificado'}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: '700',
                color: 'var(--md-sys-color-primary)',
                textTransform: 'uppercase',
              }}
            >
              {buyerDocumentType}
            </span>
            <span style={{ fontSize: '1rem', fontWeight: '500' }}>
              {buyerDocumentNumber || 'No especificado'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: '700',
                color: 'var(--md-sys-color-primary)',
                textTransform: 'uppercase',
              }}
            >
              Correo
            </span>
            <span style={{ fontSize: '1rem', fontWeight: '500', wordBreak: 'break-all' }}>
              {buyerEmail || 'No especificado'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: '700',
              color: 'var(--md-sys-color-primary)',
              textTransform: 'uppercase',
            }}
          >
            Dirección Fiscal
          </span>
          <span style={{ fontSize: '1rem', fontWeight: '500' }}>
            {buyerAddress || 'No especificada'}
          </span>
        </div>
      </div>

      {!buyerDocumentNumber || !buyerAddress ? (
        <div
          style={{
            padding: '12px',
            background: 'var(--md-sys-color-warning-container)',
            color: 'var(--md-sys-color-on-warning-container)',
            borderRadius: '12px',
            fontSize: '0.85rem',
            display: 'flex',
            gap: '10px',
          }}
        >
          <Icon size={20}>info</Icon>
          <span>
            Faltan datos en tu negocio. Te recomendamos completarlos en la configuración del negocio
            para una facturación correcta.
          </span>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: 'var(--md-sys-color-on-surface-variant)',
            fontSize: '0.85rem',
            padding: '0 4px',
          }}
        >
          <Icon size={16}>info</Icon>
          <span>
            Si necesitas cambiar estos datos, puedes hacerlo desde la configuración de tu negocio.
          </span>
        </div>
      )}
    </div>
  );
}

interface PaymentStepContentProps {
  step: PaymentStep;
  title: string;
  orderDetails: { id: string; date: string; time: string };
  selectedBusinessName: string | undefined;
  period: string;
  price: string;
  subtotalSoles: number;
  igvSoles: number;
  isProcessing: boolean;
  error: string | null;
}

const currencyFormatter = new Intl.NumberFormat('es-PE', {
  style: 'currency',
  currency: 'PEN',
  minimumFractionDigits: 2,
});

/** Formatea una fecha en español para el pre-ticket. */
function formatPlanDate(date: Date): string {
  return date.toLocaleDateString('es-PE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Lima',
  });
}

/**
 * Fechas estimadas del periodo contratado, calculadas desde hoy.
 * Solo UI de pre-ticket: la fecha real de activación la confirma el
 * servidor tras el pago (planActivatedUntil).
 */
function getPlanPeriodDates(period: string): { start: string; end: string } {
  const start = new Date();
  const end = new Date(start);
  if (period === 'anual' || period === 'annual') {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return { start: formatPlanDate(start), end: formatPlanDate(end) };
}

function PaymentStepContent({
  step,
  title,
  orderDetails,
  selectedBusinessName,
  period,
  price,
  subtotalSoles,
  igvSoles,
  isProcessing,
  error,
}: PaymentStepContentProps) {
  if (step !== 'payment') {
    return null;
  }
  const planDates = getPlanPeriodDates(period);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
        marginBottom: '1rem',
      }}
    >
      {/* ── Pre-ticket del plan a comprar ── */}
      <div
        style={{
          padding: '1rem',
          background: 'var(--md-sys-color-surface-container-high)',
          borderRadius: '12px',
          border: '1px solid var(--md-sys-color-outline-variant)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '12px',
            paddingBottom: '12px',
            borderBottom: '1px dashed var(--md-sys-color-outline-variant)',
          }}
        >
          <span style={{ fontWeight: '600', color: 'var(--md-sys-color-on-surface)' }}>
            Plan {title}
          </span>
          <span style={{ fontSize: '0.875rem', color: 'var(--md-sys-color-on-surface-variant)' }}>
            {period === 'mes' ? 'Mensual' : 'Anual'}
          </span>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '8px',
          }}
        >
          <span
            style={{
              fontSize: '0.875rem',
              color: 'var(--md-sys-color-on-surface-variant)',
            }}
          >
            N° de Ticket:
          </span>
          <span style={{ fontSize: '0.875rem', fontFamily: 'monospace' }}>{orderDetails.id}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '8px',
          }}
        >
          <span
            style={{
              fontSize: '0.875rem',
              color: 'var(--md-sys-color-on-surface-variant)',
            }}
          >
            Negocio:
          </span>
          <span style={{ fontSize: '0.875rem', fontWeight: '500' }}>{selectedBusinessName}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '8px',
          }}
        >
          <span
            style={{
              fontSize: '0.875rem',
              color: 'var(--md-sys-color-on-surface-variant)',
            }}
          >
            Fecha de inicio:
          </span>
          <span style={{ fontSize: '0.875rem' }}>{planDates.start}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '12px',
            paddingBottom: '12px',
            borderBottom: '1px dashed var(--md-sys-color-outline-variant)',
          }}
        >
          <span
            style={{
              fontSize: '0.875rem',
              color: 'var(--md-sys-color-on-surface-variant)',
            }}
          >
            Fecha de vencimiento:
          </span>
          <span style={{ fontSize: '0.875rem' }}>{planDates.end}</span>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '6px',
          }}
        >
          <span
            style={{
              fontSize: '0.875rem',
              color: 'var(--md-sys-color-on-surface-variant)',
            }}
          >
            Subtotal:
          </span>
          <span style={{ fontSize: '0.875rem' }}>{currencyFormatter.format(subtotalSoles)}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '12px',
            paddingBottom: '12px',
            borderBottom: '1px dashed var(--md-sys-color-outline-variant)',
          }}
        >
          <span
            style={{
              fontSize: '0.875rem',
              color: 'var(--md-sys-color-on-surface-variant)',
            }}
          >
            IGV (18%):
          </span>
          <span style={{ fontSize: '0.875rem' }}>{currencyFormatter.format(igvSoles)}</span>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span style={{ fontWeight: '500', color: 'var(--md-sys-color-on-surface)' }}>
            Total a Pagar ({period === 'mes' ? 'mensual' : 'anual'})
          </span>
          <span
            style={{
              fontSize: '1.25rem',
              fontWeight: 'bold',
              color: 'var(--md-sys-color-primary)',
            }}
          >
            S/ {price}
          </span>
        </div>
      </div>

      <div
        style={{
          padding: '2rem',
          background: 'var(--md-sys-color-surface-container)',
          borderRadius: '12px',
          textAlign: 'center',
          border: '1px dashed var(--md-sys-color-outline-variant)',
        }}
      >
        {isProcessing ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1rem',
            }}
          >
            <Icon
              size={48}
              style={{
                color: 'var(--md-sys-color-primary)',
                animation: 'spin 2s linear infinite',
              }}
            >
              sync
            </Icon>
            <p style={{ margin: 0, fontWeight: '500' }}>Procesando tu pago en el servidor...</p>
            <p
              style={{
                fontSize: '0.875rem',
                color: 'var(--md-sys-color-on-surface-variant)',
                marginTop: '0.5rem',
              }}
            >
              Generando boleta y activando tu suscripción. No cierres esta ventana.
            </p>
          </div>
        ) : (
          <>
            <Icon size={48} style={{ color: 'var(--md-sys-color-primary)', marginBottom: '1rem' }}>
              payments
            </Icon>
            <p style={{ margin: 0, fontWeight: '500' }}>
              Usaremos Culqi para procesar tu pago de forma segura.
            </p>
            <p
              style={{
                fontSize: '0.875rem',
                color: 'var(--md-sys-color-on-surface-variant)',
                marginTop: '0.5rem',
              }}
            >
              Tus datos están protegidos y cifrados. El precio mostrado ya incluye el 18% de IGV.
            </p>
            {error && (
              <div
                style={{
                  marginTop: '1rem',
                  padding: '0.5rem',
                  background: 'var(--md-sys-color-error-container)',
                  color: 'var(--md-sys-color-error)',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                }}
              >
                {error}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface SuccessStepContentProps {
  step: PaymentStep;
  title: string;
  selectedBusinessName: string | undefined;
  price: string;
  period: string;
  result: PurchasePlanResult | null;
  orderDetails: { id: string; date: string; time: string };
}

function SuccessStepContent({
  step,
  title,
  selectedBusinessName,
  price,
  period,
  result,
  orderDetails,
}: SuccessStepContentProps) {
  if (step !== 'success') {
    return null;
  }
  const planEndDateLabel = result?.planActivatedUntil
    ? new Date(result.planActivatedUntil).toLocaleDateString('es-PE', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'America/Lima',
      })
    : '';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: '1rem',
        padding: '0.5rem 0',
      }}
    >
      <div
        style={{
          width: '48px',
          height: '48px',
          borderRadius: '24px',
          background: 'var(--md-sys-color-primary-container)',
          color: 'var(--md-sys-color-on-primary-container)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '0.25rem',
        }}
      >
        <Icon size={24}>check_circle</Icon>
      </div>
      <div>
        <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--md-sys-color-on-surface)' }}>
          ¡Pago Exitoso!
        </h3>
        <p
          style={{
            margin: 0,
            color: 'var(--md-sys-color-on-surface-variant)',
            fontSize: '0.875rem',
          }}
        >
          Tu plan <strong>{title}</strong> ya ha sido activado para{' '}
          <strong>{selectedBusinessName}</strong>.
        </p>
      </div>
      <div
        style={{
          width: '100%',
          padding: '1.25rem',
          background: 'var(--md-sys-color-surface-container)',
          borderRadius: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.5rem',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '-10px',
            left: '-10px',
            width: '20px',
            height: '20px',
            borderRadius: '10px',
            background: 'var(--md-sys-color-surface)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '-10px',
            right: '-10px',
            width: '20px',
            height: '20px',
            borderRadius: '10px',
            background: 'var(--md-sys-color-surface)',
          }}
        />

        <div
          style={{
            fontSize: '0.75rem',
            letterSpacing: '0.05em',
            color: 'var(--md-sys-color-on-surface-variant)',
            textTransform: 'uppercase',
          }}
        >
          Recibo de pago
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.875rem',
          }}
        >
          <span style={{ color: 'var(--md-sys-color-on-surface-variant)' }}>Plan:</span>
          <span style={{ fontWeight: '500' }}>{title}</span>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.875rem',
          }}
        >
          <span style={{ color: 'var(--md-sys-color-on-surface-variant)' }}>Pagado:</span>
          <span style={{ fontWeight: '500' }}>
            S/ {price} ({period})
          </span>
        </div>
        {planEndDateLabel && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.875rem',
            }}
          >
            <span style={{ color: 'var(--md-sys-color-on-surface-variant)' }}>
              Plan activo hasta:
            </span>
            <span style={{ fontWeight: '500' }}>{planEndDateLabel}</span>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.875rem',
          }}
        >
          <span style={{ color: 'var(--md-sys-color-on-surface-variant)' }}>Referencia:</span>
          <span style={{ fontFamily: 'monospace' }}>{orderDetails.id}</span>
        </div>
        <div
          style={{
            height: '1px',
            background: 'var(--md-sys-color-outline-variant)',
            margin: '0.5rem 0',
          }}
        />
        <div style={{ fontSize: '0.75rem', color: 'var(--md-sys-color-on-surface-variant)' }}>
          Tu boleta ({result?.ticketNumber}) fue enviada a tu correo y también está disponible
          abajo.
        </div>
        {result?.ticketUrl && (
          <div style={{ marginTop: '1rem' }}>
            <Button
              variant="outlined"
              onClick={() => window.open(result.ticketUrl, '_blank')}
              style={{ width: '100%' }}
            >
              Ver Boleta
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface PaymentDialogContentProps {
  step: PaymentStep;
  title: string;
  businesses: BusinessPlanOption[];
  selectedBusiness: string;
  onSelectedBusinessChange: (value: string) => void;
  hasActivePlan: boolean;
  buyerEmail: string;
  buyerFullName: string;
  buyerDocumentType: 'DNI' | 'RUC';
  buyerDocumentNumber: string;
  buyerAddress: string;
  orderDetails: { id: string; date: string; time: string };
  selectedBusinessName: string | undefined;
  period: string;
  price: string;
  subtotalSoles: number;
  igvSoles: number;
  isProcessing: boolean;
  error: string | null;
  result: PurchasePlanResult | null;
}

function PaymentDialogContent({
  step,
  title,
  businesses,
  selectedBusiness,
  onSelectedBusinessChange,
  hasActivePlan,
  buyerEmail,
  buyerFullName,
  buyerDocumentType,
  buyerDocumentNumber,
  buyerAddress,
  orderDetails,
  selectedBusinessName,
  period,
  price,
  subtotalSoles,
  igvSoles,
  isProcessing,
  error,
  result,
}: PaymentDialogContentProps) {
  return (
    <div className="pricing-payment-dialog" style={{ padding: '10px 0' }}>
      <SelectBusinessStepContent
        step={step}
        businesses={businesses}
        selectedBusiness={selectedBusiness}
        onSelectedBusinessChange={onSelectedBusinessChange}
        hasActivePlan={hasActivePlan}
      />
      <BillingStepContent
        step={step}
        buyerEmail={buyerEmail}
        buyerFullName={buyerFullName}
        buyerDocumentType={buyerDocumentType}
        buyerDocumentNumber={buyerDocumentNumber}
        buyerAddress={buyerAddress}
      />
      <PaymentStepContent
        step={step}
        title={title}
        orderDetails={orderDetails}
        selectedBusinessName={selectedBusinessName}
        period={period}
        price={price}
        subtotalSoles={subtotalSoles}
        igvSoles={igvSoles}
        isProcessing={isProcessing}
        error={error}
      />
      <SuccessStepContent
        step={step}
        title={title}
        selectedBusinessName={selectedBusinessName}
        price={price}
        period={period}
        result={result}
        orderDetails={orderDetails}
      />
    </div>
  );
}

interface PaymentDialogActionsProps {
  step: PaymentStep;
  onStepChange: (step: PaymentStep) => void;
  businesses: BusinessPlanOption[];
  selectedBusiness: string;
  buyerEmail: string;
  buyerFullName: string;
  buyerDocumentNumber: string;
  buyerAddress: string;
  isProcessing: boolean;
  price: string;
  onPay: () => void;
  onClose: () => void;
}

function PaymentDialogActions({
  step,
  onStepChange,
  businesses,
  selectedBusiness,
  buyerEmail,
  buyerFullName,
  buyerDocumentNumber,
  buyerAddress,
  isProcessing,
  price,
  onPay,
  onClose,
}: PaymentDialogActionsProps) {
  return (
    <div slot="actions">
      {step === 'select' && (
        <>
          <Button variant="text" onClick={onClose}>
            Cancelar
          </Button>
          {businesses.length > 0 ? (
            <Button
              variant="filled"
              onClick={() => onStepChange('billing')}
              disabled={!selectedBusiness}
            >
              Continuar
            </Button>
          ) : (
            <Button variant="filled" onClick={() => (window.location.href = '/list-business')}>
              Ir a Crear Negocio
            </Button>
          )}
        </>
      )}

      {step === 'billing' && (
        <>
          <Button variant="text" onClick={() => onStepChange('select')}>
            Atrás
          </Button>
          <Button
            variant="filled"
            onClick={() => onStepChange('payment')}
            disabled={!buyerEmail || !buyerFullName || !buyerDocumentNumber || !buyerAddress}
          >
            Confirmar y Continuar
          </Button>
        </>
      )}

      {step === 'payment' && (
        <>
          <Button variant="text" onClick={() => onStepChange('billing')} disabled={isProcessing}>
            Atrás
          </Button>
          <div style={{ flex: 1 }}>
            <Button
              variant="filled"
              style={{ width: '100%' }}
              disabled={isProcessing}
              onClick={onPay}
            >
              {isProcessing ? 'Procesando...' : `Pagar con Culqi S/ ${price}`}
            </Button>
          </div>
        </>
      )}

      {step === 'success' && (
        <Button variant="filled" onClick={() => (window.location.href = '/list-business')}>
          Ir a mis Negocios
        </Button>
      )}
    </div>
  );
}

interface CulqiCheckoutNodeProps {
  title: string;
  price: string;
  selectedBusinessName: string | undefined;
  period: string;
  buyerFullName: string;
  buyerEmail: string;
  isProcessing: boolean;
  culqiTriggerRef: React.RefObject<HTMLDivElement | null>;
  onTokenSuccess: (token: string) => Promise<void>;
}

function CulqiCheckoutNode({
  title,
  price,
  selectedBusinessName,
  period,
  buyerFullName,
  buyerEmail,
  isProcessing,
  culqiTriggerRef,
  onTokenSuccess,
}: CulqiCheckoutNodeProps) {
  return (
    <div style={{ display: 'none' }}>
      <CulqiCheckout
        planId={title}
        planName={title}
        amount={Math.round(Number(price) * 100)} // Monto en céntimos — el precio mostrado es el TOTAL FINAL (incluye IGV)
        businessName={selectedBusinessName}
        period={period}
        customerName={buyerFullName}
        customerEmail={buyerEmail}
        onTokenSuccess={onTokenSuccess}
        disabled={isProcessing}
      >
        <div ref={culqiTriggerRef}>Trigger</div>
      </CulqiCheckout>
    </div>
  );
}

const EMPTY_ISSUER: PurchasePlanIssuer = {
  ruc: '',
  name: '',
  address: '',
  district: '',
  province: '',
  department: '',
};

function resolvePlanTicketIssuer(
  result: PurchasePlanResult | null,
  capturingData: (PurchasePlanResult & { buyerData: PurchasePlanData }) | null,
): PurchasePlanIssuer {
  const resultIssuer = result?.issuer ?? EMPTY_ISSUER;
  const capturingIssuer = capturingData?.issuer ?? EMPTY_ISSUER;
  return {
    ruc: resultIssuer.ruc || capturingIssuer.ruc || '10741399852',
    name: resultIssuer.name || capturingIssuer.name || 'MAMANI TACORA ERNESTO ALONSO',
    address: resultIssuer.address || capturingIssuer.address || 'ASC. CIUDAD DE DIOS ZN. 4 COM',
    district: resultIssuer.district || capturingIssuer.district || 'YURA',
    province: resultIssuer.province || capturingIssuer.province || 'AREQUIPA',
    department: resultIssuer.department || capturingIssuer.department || 'AREQUIPA',
  };
}

interface PlanTicketNodeProps {
  result: PurchasePlanResult | null;
  capturingData: (PurchasePlanResult & { buyerData: PurchasePlanData }) | null;
  ticketRef: React.RefObject<HTMLDivElement | null>;
  buyerEmail: string;
  buyerFullName: string;
  buyerDocumentType: 'DNI' | 'RUC';
  buyerDocumentNumber: string;
  title: string;
  period: string;
  subtotalSoles: number;
  igvSoles: number;
  totalSoles: number;
}

function PlanTicketNode({
  result,
  capturingData,
  ticketRef,
  buyerEmail,
  buyerFullName,
  buyerDocumentType,
  buyerDocumentNumber,
  title,
  period,
  subtotalSoles,
  igvSoles,
  totalSoles,
}: PlanTicketNodeProps) {
  const issuer = resolvePlanTicketIssuer(result, capturingData);
  return (
    <div style={{ position: 'absolute', top: '-9999px', left: '-9999px', zIndex: -9999 }}>
      <div ref={ticketRef}>
        {(result || capturingData) && (
          <PlanTicketTemplate
            issuerRuc={issuer.ruc}
            issuerName={issuer.name}
            issuerAddress={issuer.address}
            issuerDistrict={issuer.district}
            issuerProvince={issuer.province}
            issuerDepartment={issuer.department}
            ticketNumber={result?.ticketNumber || capturingData?.ticketNumber || ''}
            ticketIssuedAt={new Date()}
            buyerEmail={buyerEmail}
            buyerFullName={buyerFullName}
            buyerDocumentType={buyerDocumentType}
            buyerDocumentNumber={buyerDocumentNumber}
            planType={title}
            period={period === 'mes' ? 'monthly' : 'annual'}
            planStartDate={new Date()}
            planEndDate={
              new Date(
                result?.planActivatedUntil || capturingData?.planActivatedUntil || new Date(),
              )
            }
            amountSubtotal={subtotalSoles}
            amountIgv={igvSoles}
            amountTotal={result?.amountTotal || totalSoles}
            paymentMethod="Online (Culqi)"
          />
        )}
      </div>
    </div>
  );
}
