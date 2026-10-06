'use client';

import { PERU_LOCATIONS } from '@/core/logistics/peruLocations';
import type { CartItem } from '@/features/storage/context/CartContext';
import { createClient } from '@/lib/supabase/client';
import { AlertSnackbar, Icon } from '@/shared/components/ui';
import { prefillBuyerName } from '@/shared/payments/buyerName';
import type { AuthTokenResponse } from '@supabase/supabase-js';
import { useParams, useRouter } from 'next/navigation';
import posthog from 'posthog-js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { downloadTicketFromUrl, requestServerTicket } from '../services/ticketService';
import styles from './Checkout.module.css';
import { CheckoutPaymentStep } from './CheckoutPaymentStep';
import { CheckoutShippingStep } from './CheckoutShippingStep';
import { CheckoutSuccessView } from './CheckoutSuccessView';
import { useCheckoutPayment, YAPE_LIMITS } from './hooks/useCheckoutPayment';
import { PaymentInstructionsView } from './PaymentInstructionsView';

interface CheckoutProps {
  totalAmount: number;
  cartItems: [CartItem, ...CartItem[]];
  culqiPublicKey?: string;
  onSuccess: () => void;
  onCancel: () => void;
  // Props para el ticket y recojo
  businessName?: string;
  businessRuc?: string;
  businessAddress?: string;
  businessCity?: string;
  businessLogoUrl?: string;
  // Props para el backend
  businessId: string;
}

export type Courier = 'urbano_agencia' | 'urbano_domicilio' | 'recojo';

export interface ShippingInfo {
  courier: Courier;
  department: string;
  province: string;
  district: string;
  ubigeo?: string;
  agency?: string;
  address?: string;
  reference?: string;
  phone: string;
  dni: string;
}

export default function Checkout({
  totalAmount,
  cartItems,
  culqiPublicKey,
  onSuccess,
  onCancel,
  businessName = 'Mi Tienda',
  businessRuc,
  businessAddress,
  businessCity,
  businessLogoUrl,
  businessId,
}: CheckoutProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<{
    orderNumber: string;
    paymentMethod: string;
    trackingToken?: string;
  } | null>(null);
  const [paymentInstructions, setPaymentInstructions] = useState<{
    culqiOrderId: string;
    paymentMethod: string;
    paymentCode: string | null;
    qrUrl: string | null;
    expirationDate: string | null;
  } | null>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  // Alert State
  const [alert, setAlert] = useState<{
    open: boolean;
    description: string;
    color: 'primary' | 'success' | 'error' | 'warning';
    icon: string;
  }>({
    open: false,
    description: '',
    color: 'success',
    icon: 'check_circle',
  });

  // Shipping State
  const [shippingInfo, setShippingInfo] = useState<ShippingInfo>({
    courier: 'urbano_domicilio',
    department: '',
    province: '',
    district: '',
    ubigeo: '',
    agency: '',
    address: '',
    reference: '',
    phone: '',
    dni: '',
  });

  // Payment State
  const [email, setEmail] = useState('');
  const [customerName, setCustomerName] = useState('');

  // ─── Penalty status warning ───
  const [penaltyStatus, setPenaltyStatus] = useState<{
    canAcceptPayments: boolean;
    culqiBlocked: boolean;
    blacklisted: boolean;
  } | null>(null);

  useEffect(() => {
    if (!businessId) return;
    fetch(`/api/business/penalty-status?businessId=${businessId}`)
      .then((res) => res.json())
      .then((data) => setPenaltyStatus(data))
      .catch(() => {
        /* don't show banner on fetch error */
      });
  }, [businessId]);

  // ─── Google Customer Auth ───
  const params = useParams();
  const slug = params?.slug as string;
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  interface CustomerAuth {
    provider: string;
    authId: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  }
  const [customerAuth, setCustomerAuth] = useState<CustomerAuth | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isAwaitingAuth, setIsAwaitingAuth] = useState(false);

  // Domain for the customer auth popup
  const AUTH_ORIGIN =
    process.env.NEXT_PUBLIC_AUTH_ORIGIN ||
    (typeof window !== 'undefined' ? window.location.origin : '');

  // ─── Detect existing Supabase session (from chat Google auth) ───
  useEffect(() => {
    const checkSession = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user?.app_metadata?.provider === 'google') {
          const user = session.user;
          setCustomerAuth({
            provider: 'google',
            authId: user.id,
            name: user.user_metadata?.full_name || '',
            email: user.email || '',
            avatarUrl: user.user_metadata?.avatar_url || null,
          });
          // Pre-fill email but user can still edit it
          setEmail(user.email || '');
          // Pre-fill buyer name from Google profile when the field is empty
          setCustomerName((prev) => prefillBuyerName(prev, user.user_metadata?.full_name));
        }
      } catch (err) {
        console.error('[Checkout] Error checking session:', err);
      } finally {
        setIsCheckingSession(false);
      }
    };
    checkSession();
  }, [supabase]);

  // ─── Listen for auth tokens from popup ───
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.origin !== AUTH_ORIGIN) return;

      if (event.data?.type === 'AUTH_SUCCESS' && event.data?.slug === slug) {
        setIsAwaitingAuth(false);
        supabase.auth
          .setSession({
            access_token: event.data.access_token,
            refresh_token: event.data.refresh_token,
          })
          .then((result: AuthTokenResponse) => {
            const { data } = result;
            if (data.session?.user?.app_metadata?.provider === 'google') {
              const user = data.session.user;
              setCustomerAuth({
                provider: 'google',
                authId: user.id,
                name: user.user_metadata?.full_name || '',
                email: user.email || '',
                avatarUrl: user.user_metadata?.avatar_url || null,
              });
              setEmail(user.email || '');
              // Pre-fill buyer name from Google profile when the field is empty
              setCustomerName((prev) => prefillBuyerName(prev, user.user_metadata?.full_name));
            }
          })
          .catch((err: unknown) => {
            console.error('[Checkout] Error setting session:', err);
          });
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [slug, supabase, AUTH_ORIGIN]);

  // ─── Open Google sign-in popup ───
  const handleGoogleSignIn = useCallback(() => {
    const popupUrl = new URL(`${AUTH_ORIGIN}/auth/customer`);
    popupUrl.searchParams.set('slug', slug);
    popupUrl.searchParams.set('name', businessName);
    if (businessLogoUrl) popupUrl.searchParams.set('logo', businessLogoUrl);
    popupUrl.searchParams.set('origin', window.location.origin);

    const popup = window.open(popupUrl.toString(), 'customer-auth', 'width=600,height=700,popup=1');

    if (!popup || popup.closed) {
      console.warn('[Checkout] Popup was blocked');
      return;
    }

    setIsAwaitingAuth(true);

    // Poll for popup closure
    const checkClosed = setInterval(() => {
      if (popup.closed) {
        clearInterval(checkClosed);
        setIsAwaitingAuth(false);
      }
    }, 500);
  }, [slug, businessName, businessLogoUrl, AUTH_ORIGIN]);

  // Derived total — shipping is free, no cost added
  const finalTotal = totalAmount;

  // Derived select options
  const departments = PERU_LOCATIONS.map((d) => ({ value: d.name, label: d.name }));
  const provinces =
    PERU_LOCATIONS.find((d) => d.name === shippingInfo.department)?.provinces.map((p) => ({
      value: p.name,
      label: p.name,
    })) || [];
  const districts =
    PERU_LOCATIONS.find((d) => d.name === shippingInfo.department)
      ?.provinces.find((p) => p.name === shippingInfo.province)
      ?.districts.map((d) => ({ value: d.name, label: d.name })) || [];

  // Mount effect
  useEffect(() => {
    setMounted(true);
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  // Effect to close Culqi modal when showing receipt
  useEffect(() => {
    if (showReceipt && window.Culqi && window.Culqi.close) {
      window.Culqi.close();
    }
  }, [showReceipt]);

  // ─── useCheckoutPayment hook ───
  const {
    culqiReady,
    isCulqiProcessing,
    isPaymentProcessing,
    handlePayment: hookHandlePayment,
  } = useCheckoutPayment({
    culqiPublicKey,
    businessId,
    businessName,
    cartItems,
    shippingInfo,
    email,
    customerName,
    customerAuth,
    finalTotal,
    slug,
    businessAddress,
    businessCity,
    onOrderPaid: useCallback(
      (order) => {
        posthog.capture('order_completed', {
          order_number: order.orderNumber,
          payment_method: order.paymentMethod,
          total_amount: finalTotal,
          item_count: cartItems.length,
          store_slug: slug,
        });
        setCompletedOrder(order);
        setShowReceipt(true);
        setShowConfetti(true);
        setAlert({
          open: true,
          description: '¡Pago procesado exitosamente!',
          color: 'success',
          icon: 'check_circle',
        });
      },
      [finalTotal, cartItems.length, slug],
    ),
    onPaymentInstructions: useCallback((instructions) => {
      setPaymentInstructions(instructions);
    }, []),
    onError: useCallback((message: string) => {
      setAlert({
        open: true,
        description: message,
        color: 'error',
        icon: 'error',
      });
    }, []),
  });

  // ─── handleNextStep validation ───
  const handleNextStep = () => {
    if (step === 1) {
      if (shippingInfo.courier === 'recojo') {
        if (shippingInfo.phone.length !== 9) {
          setAlert({
            open: true,
            description: 'Por favor, ingresá un teléfono de contacto de 9 dígitos.',
            color: 'warning',
            icon: 'phone',
          });
          return;
        }
      } else {
        if (
          !shippingInfo.department ||
          !shippingInfo.province ||
          !shippingInfo.district ||
          shippingInfo.phone.length !== 9
        ) {
          setAlert({
            open: true,
            description:
              'Por favor, completá todos los campos de ubicación y un teléfono de 9 dígitos.',
            color: 'warning',
            icon: 'contact_support',
          });
          return;
        }
        if (shippingInfo.courier === 'urbano_domicilio' && !shippingInfo.address?.trim()) {
          setAlert({
            open: true,
            description: 'Ingresá la dirección exacta de entrega a domicilio.',
            color: 'warning',
            icon: 'home',
          });
          return;
        }
      }
      posthog.capture('checkout_shipping_completed', {
        courier: shippingInfo.courier,
        department: shippingInfo.department,
        store_slug: slug,
      });
      setStep(2);
    }
  };

  // ─── handleDownloadTicket ───
  const handleDownloadTicket = useCallback(async () => {
    if (!completedOrder?.orderNumber) return;

    try {
      setLoading(true);

      const orderNumber = completedOrder.orderNumber;
      // The buyer has no session here, so their trackingToken is the proof the
      // server accepts (design D3). Without it the route answers 401.
      const result = await requestServerTicket(orderNumber, true, completedOrder.trackingToken);

      if (!result.success || !result.publicUrl) {
        throw new Error(result.error || 'No se pudo generar el ticket');
      }

      await downloadTicketFromUrl(result.publicUrl, orderNumber);

      setAlert({
        open: true,
        description: '¡Ticket descargado exitosamente!',
        color: 'success',
        icon: 'download_done',
      });
    } catch (err) {
      console.error('Error at handleDownloadTicket:', err);
      setAlert({
        open: true,
        description: 'No se pudo generar el ticket. Por favor, intenta nuevamente.',
        color: 'error',
        icon: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [completedOrder]);

  // ─── handleClose ───
  const handleClose = useCallback(() => {
    setShowReceipt(false);
    onSuccess();
  }, [onSuccess]);

  const handlePayment = () => {
    posthog.capture('payment_initiated', {
      total_amount: finalTotal,
      item_count: cartItems.length,
      store_slug: slug,
    });
    hookHandlePayment();
  };

  if (!mounted) return null;

  // SUCCESS VIEW
  if (showReceipt && completedOrder) {
    return (
      <CheckoutSuccessView
        completedOrder={completedOrder}
        cartItems={cartItems}
        totalAmount={totalAmount}
        finalTotal={finalTotal}
        shippingInfo={shippingInfo}
        businessName={businessName}
        businessRuc={businessRuc}
        businessAddress={businessAddress}
        businessCity={businessCity}
        businessLogoUrl={businessLogoUrl}
        email={email}
        receiptRef={receiptRef}
        loading={loading}
        showConfetti={showConfetti}
        onDownloadTicket={handleDownloadTicket}
        onClose={handleClose}
        slug={slug}
      />
    );
  }

  // PAYMENT INSTRUCTIONS OVERLAY (for async methods)
  if (paymentInstructions) {
    return (
      <PaymentInstructionsView
        paymentInstructions={paymentInstructions}
        alert={alert}
        onDismiss={() => setPaymentInstructions(null)}
        onAlertClose={() => setAlert((prev) => ({ ...prev, open: false }))}
      />
    );
  }

  // STANDARD CHECKOUT FLOW
  const handlePaymentProcessing = isCulqiProcessing || isPaymentProcessing;
  const loadingMessage = isPaymentProcessing
    ? {
        title: 'Procesando pago',
        subtitle: 'No cierres esta ventana ni vuelvas a pagar. Estamos confirmando la transaccion.',
      }
    : { title: 'Abriendo pasarela de pagos', subtitle: 'Serás redirigido a Culqi de forma segura' };

  return createPortal(
    <div className={styles.checkoutOverlay}>
      {/* Loading Overlay cuando se procesa el pago o se abre Culqi */}
      {handlePaymentProcessing && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(255,255,255,0.95)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            borderRadius: '28px',
            gap: '16px',
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              border: '4px solid #E5E7EB',
              borderTopColor: '#0061A4',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
            }}
          />
          <div style={{ textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: '18px', fontWeight: '700', color: '#111827' }}>
              {loadingMessage.title}
            </p>
            <p style={{ margin: '8px 0 0', fontSize: '14px', color: '#6B7280' }}>
              {loadingMessage.subtitle}
            </p>
          </div>
          <style
            dangerouslySetInnerHTML={{
              __html: `
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `,
            }}
          />
        </div>
      )}
      <div className={styles.checkoutModal} onClick={(e) => e.stopPropagation()}>
        {/* Warning Banner for blocked/penalty businesses */}
        {penaltyStatus && !penaltyStatus.canAcceptPayments && (
          <div className={styles.warningBanner}>
            {penaltyStatus.blacklisted
              ? '🚫 Esta tienda ha sido cerrada permanentemente. No deberías realizar compras aquí.'
              : '⚠️ Esta tienda tiene multas pendientes. Store Lite no se responsabiliza por transacciones entre usuarios. La responsabilidad legal recae en el negocio.'}
          </div>
        )}

        {/* Header with Back/Close Buttons */}
        <div className={styles.header}>
          <div className={styles.headerTitleGroup}>
            {step === 2 && (
              <button
                className={styles.backBtn}
                onClick={() => setStep(1)}
                disabled={handlePaymentProcessing}
              >
                <Icon>arrow_back</Icon>
              </button>
            )}
            <h2 className={styles.title}>
              {step === 1 ? 'Paso 1: ¿Cómo lo recibes?' : 'Paso 2: Confirmar Compra'}
            </h2>
          </div>
          <button className={styles.closeBtn} onClick={onCancel} disabled={handlePaymentProcessing}>
            <Icon>close</Icon>
          </button>
        </div>

        {/* Stepper Indicator */}
        <div className={styles.stepperContainer}>
          <div className={`${styles.stepIndicator} ${step >= 1 ? styles.active : ''}`}>1</div>
          <div className={styles.stepLine} />
          <div className={`${styles.stepIndicator} ${step >= 2 ? styles.active : ''}`}>2</div>
        </div>

        {/* Main Form Body */}
        <div className={styles.body}>
          {step === 1 ? (
            <CheckoutShippingStep
              cartItems={cartItems}
              totalAmount={totalAmount}
              shippingInfo={shippingInfo}
              onShippingInfoChange={(updater) => setShippingInfo(updater)}
              departments={departments}
              provinces={provinces}
              districts={districts}
              businessAddress={businessAddress}
              businessCity={businessCity}
              onNext={() => setStep(2)}
            />
          ) : (
            <CheckoutPaymentStep
              cartItems={cartItems}
              shippingInfo={shippingInfo}
              onShippingInfoChange={(updater) => setShippingInfo(updater)}
              finalTotal={finalTotal}
              email={email}
              onEmailChange={setEmail}
              customerName={customerName}
              onCustomerNameChange={setCustomerName}
              customerAuth={customerAuth}
              isCheckingSession={isCheckingSession}
              isAwaitingAuth={isAwaitingAuth}
              onGoogleSignIn={handleGoogleSignIn}
              loading={loading}
            />
          )}
        </div>

        {/* Footer with Main Action Button */}
        <div className={styles.footer}>
          {step === 1 ? (
            <button className={styles.nextBtn} onClick={handleNextStep}>
              Continuar <Icon>arrow_forward</Icon>
            </button>
          ) : (
            <>
              {finalTotal > YAPE_LIMITS.max && (
                <div className={styles.yapeWarning}>
                  <Icon size={16}>info</Icon>
                  <span>
                    Yape solo hasta <strong>S/ {YAPE_LIMITS.max.toFixed(2)}</strong>. Para montos
                    mayores, usá tarjeta de débito o crédito.
                  </span>
                </div>
              )}
              <button
                className={styles.payBtn}
                onClick={handlePayment}
                disabled={loading || isCulqiProcessing || isPaymentProcessing}
              >
                {loading || isCulqiProcessing || isPaymentProcessing ? (
                  <>
                    <span className={styles.spinner} />
                    {isPaymentProcessing ? 'Procesando pago...' : 'Abriendo pasarela...'}
                  </>
                ) : (
                  <>Ir a Pagar S/ {finalTotal.toFixed(2)}</>
                )}
              </button>
            </>
          )}
          <div className={styles.secureBadge}>
            <Icon size={14}>verified_user</Icon> Pagos por Culqi
          </div>
        </div>
      </div>
      <AlertSnackbar
        open={alert.open}
        description={alert.description}
        color={alert.color}
        icon={alert.icon}
        onClose={() => setAlert((prev) => ({ ...prev, open: false }))}
      />
    </div>,
    document.body,
  );
}
