import { db } from '@/core/database/client';
import { businesses, payments, products } from '@/core/database/schema';
import { checkOrderVerifyRateLimits } from '@/lib/orderAccessRateLimit';
import { resolveOrderVerificationAccess } from '@/lib/orderVerificationAccess';
import { getClientIdentifierFromHeaders } from '@/lib/rateLimit';
import { and, eq, inArray } from 'drizzle-orm';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

function maskDni(dni?: string | null): string {
  if (!dni) return 'No registrado';
  if (dni.length <= 4) return dni;
  return `****${dni.slice(-4)}`;
}

function formatCurrency(amount: string | number, currency = 'PEN'): string {
  const num = typeof amount === 'string' ? Number.parseFloat(amount) : amount;
  const symbol = currency === 'USD' ? '$' : 'S/';
  return `${symbol} ${num.toFixed(2)}`;
}

/**
 * Public columns for the verification page verdict (Q_A).
 *
 * The projection boundary is NOT "no PII" — it is "no PII that is never
 * rendered". Three things are deliberately in here:
 *
 *   * `buyerDni` — R22 REQUIRES the public verdict to carry a masked DNI last-4
 *     (`maskDni`, below). Masking needs the value, so the column is selected and
 *     only the mask reaches the markup. The raw DNI is never rendered; the
 *     anonymous render is pinned by `orderVerificationPage.test.ts`.
 *   * `trackingToken` — selected SERVER-LOCALLY only, per design.md D2
 *     ("Q_A returns trackingToken (server-local only)"). It is needed to derive
 *     the cookie name `order_access_{token}`, which cannot be named before the row
 *     is read. The gate is on RENDERING the link, not on selecting the column:
 *     the value stays in this module, is never returned, never logged, and never
 *     passed to a component prop (D2 leak table).
 *   * `id` — carried through for the Q_A/Q_B fallback merge below.
 *
 * The genuine MUST-NOT-be-selected boundary is `buyerEmail` and `ticketUrl`
 * (R22): neither is rendered on any path, so selecting them would put data in
 * the query result that no gate governs.
 */
const PUBLIC_VERIFICATION_COLUMNS = {
  id: true,
  orderNumber: true,
  amount: true,
  currency: true,
  paymentMethod: true,
  status: true,
  buyerDni: true,
  createdAt: true,
  trackingToken: true,
} as const;

/**
 * Gated columns for the verification page surface (Q_B).
 * Includes metadata and productId for cart rendering.
 */
const GATED_VERIFICATION_COLUMNS = {
  ...PUBLIC_VERIFICATION_COLUMNS,
  metadata: true,
  productId: true,
} as const;

const BUSINESS_COLUMNS = {
  id: true,
  name: true,
  slug: true,
  taxId: true,
  address: true,
  logoUrl: true,
} as const;

// Type helpers for conditional query results
interface PaymentPublic {
  id: string;
  orderNumber: string | null;
  amount: string;
  currency: string;
  paymentMethod: string;
  status: string;
  buyerDni: string | null;
  createdAt: Date;
  trackingToken: string;
}

export default async function OrderVerificationPage({
  params,
}: {
  params: Promise<{ slug: string; orderNumber: string }>;
}) {
  const { slug, orderNumber } = await params;
  const cleanOrderNumber = orderNumber.startsWith('#') ? orderNumber.slice(1) : orderNumber;

  // ── R23: Rate limit keyed by (IP, orderNumber) + coarse per-IP backstop ──
  // Runs BEFORE any database access, so a refused request costs nothing and
  // cannot leak order existence. Identity comes from headers() because a Server
  // Component has no NextRequest; `getClientIdentifierFromHeaders` is the shared
  // resolution so this page cannot drift from proxy.ts on hop priority.
  //
  // `checkOrderVerifyRateLimits` charges BOTH buckets atomically — the spec's
  // per-(IP, orderNumber) bucket AND a coarse per-IP bucket that contains no order
  // number. The second one is what stops enumeration: rotating `orderNumber`
  // mints a fresh fine bucket every request, which measured 200/200 served. The
  // RAW ip is passed here — this call composes the key itself.
  const clientIp = getClientIdentifierFromHeaders(await headers());
  const rateLimit = checkOrderVerifyRateLimits(clientIp, cleanOrderNumber);
  if (!rateLimit.allowed) {
    // Render neutral throttled state instead of 429 to preserve printed-ticket UX
    return renderThrottledState();
  }

  // ── 1. Lookup Business ──────────────────────────────────────────────
  const business = await db.query.businesses.findFirst({
    where: eq(businesses.slug, slug),
    columns: BUSINESS_COLUMNS,
  });

  if (!business) {
    notFound();
  }

  // ── 2. Q_A: Public verdict read (always runs) ───────────────────────
  // Selects only public columns — no PII, no metadata, no productId
  const paymentQa = await db.query.payments.findFirst({
    where: and(eq(payments.businessId, business.id), eq(payments.orderNumber, cleanOrderNumber)),
    columns: PUBLIC_VERIFICATION_COLUMNS,
  });

  const trackingToken = paymentQa?.trackingToken;

  // ── W-N1: Explicit NULL orderNumber state ──────────────────────────
  if (!paymentQa?.orderNumber) {
    return renderNullOrderState(slug);
  }

  // ── 3. Cookie gate for gated surface ────────────────────────────────
  // ONE resolver, ONE binding. Every gated site below (Q_B read, cart build,
  // cart render, tracking link) reads `hasFullAccess` — none of them re-derives
  // it, and `verifyOrderAccessCookie` is not called anywhere in this module.
  const hasFullAccess = await resolveOrderVerificationAccess(trackingToken);

  // ── 4. Q_B: Gated surface read (only if cookie verifies) ────────────
  let paymentQb:
    | {
        id: string;
        orderNumber: string | null;
        amount: string;
        currency: string;
        paymentMethod: string;
        status: string;
        buyerDni: string | null;
        createdAt: Date;
        trackingToken: string;
        metadata: unknown;
        productId: string;
      }
    | null
    | undefined = null;
  // `hasFullAccess === true` already implies a non-empty `trackingToken`: the
  // resolver returns false without one. No second guard needed here.
  if (hasFullAccess) {
    paymentQb = await db.query.payments.findFirst({
      where: and(eq(payments.businessId, business.id), eq(payments.orderNumber, cleanOrderNumber)),
      columns: GATED_VERIFICATION_COLUMNS,
    });
  }

  // Use Q_B for gated data, fall back to Q_A for public fields
  const payment = paymentQb ?? paymentQa;
  const isValid = Boolean(payment && payment.status !== 'failed');

  // ── 5. Build cart items (only for gated surface) ────────────────────
  let cartItems: { name: string; quantity: number; price: number }[] = [];
  if (hasFullAccess && paymentQb) {
    const paymentGated = paymentQb as { metadata?: Record<string, unknown>; productId: string };
    const metadata = paymentGated.metadata ?? null;
    const rawCartItems =
      (metadata?.cartItems as {
        id?: string;
        productId?: string;
        name?: string;
        quantity?: number;
        price?: number | string;
      }[]) || [];

    const itemMap = new Map<string, number>();
    if (rawCartItems.length > 0) {
      for (const item of rawCartItems) {
        const pId = item.id || item.productId;
        if (pId) {
          itemMap.set(pId, (itemMap.get(pId) || 0) + (item.quantity || 1));
        }
      }
    } else if (paymentGated.productId) {
      itemMap.set(paymentGated.productId, 1);
    }

    const productIds = Array.from(itemMap.keys());
    const dbProducts =
      productIds.length > 0
        ? await db
            .select({
              id: products.id,
              title: products.title,
              price: products.price,
            })
            .from(products)
            .where(inArray(products.id, productIds))
        : [];

    const productDbMap = new Map(dbProducts.map((p) => [p.id, p]));
    cartItems = productIds.map((pId) => {
      const dbProd = productDbMap.get(pId);
      const qty = itemMap.get(pId) || 1;
      return {
        name: dbProd?.title || 'Producto',
        quantity: qty,
        price: dbProd ? Number(dbProd.price) : Number(payment?.amount || 0) / qty,
      };
    });
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '32px 16px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          backgroundColor: '#ffffff',
          borderRadius: '24px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        {/* Verification Status Header */}
        <div
          style={{
            padding: '24px 20px',
            backgroundColor: isValid ? '#f0fdf4' : '#fef2f2',
            borderBottom: `1px solid ${isValid ? '#bbf7d0' : '#fecaca'}`,
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: isValid ? '#22c55e' : '#ef4444',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
              fontWeight: 'bold',
              marginBottom: '12px',
            }}
          >
            {isValid ? '✓' : '✕'}
          </div>
          <h1
            style={{
              margin: '0 0 4px',
              fontSize: '18px',
              fontWeight: 800,
              color: isValid ? '#166534' : '#991b1b',
            }}
          >
            {isValid ? 'Comprobante Oficial Verificado' : 'Comprobante No Válido'}
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '12px',
              color: isValid ? '#15803d' : '#b91c1c',
            }}
          >
            {isValid
              ? 'Este comprobante fue emitido legítimamente por la tienda oficial.'
              : 'No se encontró un registro oficial con los datos proporcionados.'}
          </p>
        </div>

        {/* Business & Order Details */}
        {isValid && payment ? (
          <div style={{ padding: '24px' }}>
            {/* Store Information */}
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <h2
                style={{
                  margin: '0 0 4px',
                  fontSize: '17px',
                  fontWeight: 700,
                  color: '#0f172a',
                }}
              >
                {business.name}
              </h2>
              {business.taxId && (
                <p style={{ margin: 0, fontSize: '12px', color: '#64748b' }}>
                  RUC: {business.taxId}
                </p>
              )}
            </div>

            {/* Order Card */}
            <div
              style={{
                backgroundColor: '#f8fafc',
                borderRadius: '16px',
                padding: '14px 16px',
                marginBottom: '20px',
                border: '1px solid #e2e8f0',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '10px',
                  fontSize: '12px',
                }}
              >
                <span style={{ color: '#64748b' }}>N° de Orden</span>
                <span style={{ fontWeight: 700, fontFamily: 'monospace', color: '#0f172a' }}>
                  {payment.orderNumber}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '10px',
                  fontSize: '12px',
                }}
              >
                <span style={{ color: '#64748b' }}>Fecha de Emisión</span>
                <span style={{ fontWeight: 600, color: '#0f172a' }}>
                  {payment.createdAt.toLocaleDateString('es-PE', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '12px',
                }}
              >
                <span style={{ color: '#64748b' }}>Estado</span>
                <span
                  style={{
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    fontSize: '11px',
                    color: '#15803d',
                    backgroundColor: '#dcfce7',
                    padding: '2px 8px',
                    borderRadius: '12px',
                  }}
                >
                  {payment.status}
                </span>
              </div>
            </div>

            {/* Products List (GATED SURFACE) */}
            {hasFullAccess && cartItems.length > 0 && (
              <div style={{ marginBottom: '20px' }}>
                <h3
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: '#64748b',
                    margin: '0 0 10px',
                  }}
                >
                  Productos
                </h3>
                <div style={{ borderTop: '1px solid #f1f5f9' }}>
                  {cartItems.map((item, index) => (
                    <div
                      key={index}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '8px 0',
                        borderBottom: '1px solid #f1f5f9',
                        fontSize: '13px',
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 600 }}>{item.quantity}x</span>{' '}
                        <span style={{ color: '#334155' }}>{item.name}</span>
                      </div>
                      <span style={{ fontWeight: 700, color: '#0f172a' }}>
                        {formatCurrency(item.price * item.quantity, payment.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Total */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: '#0061a4',
                color: '#ffffff',
                padding: '16px 20px',
                borderRadius: '16px',
                marginBottom: '20px',
              }}
            >
              <span style={{ fontWeight: 700, fontSize: '13px', textTransform: 'uppercase' }}>
                Total Abonado
              </span>
              <span style={{ fontWeight: 800, fontSize: '22px' }}>
                {formatCurrency(payment.amount, payment.currency)}
              </span>
            </div>

            {/* Customer Privacy-Preserving Info */}
            <div
              style={{
                fontSize: '11px',
                color: '#64748b',
                marginBottom: '24px',
                lineHeight: '1.6',
                backgroundColor: '#f8fafc',
                padding: '12px 16px',
                borderRadius: '12px',
              }}
            >
              <div>
                <strong>Titular:</strong> {maskDni(payment.buyerDni)}
              </div>
              <div>
                <strong>Método:</strong> {payment.paymentMethod}
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Tracking link (GATED SURFACE) */}
              {hasFullAccess && payment.trackingToken && (
                <Link
                  href={`/${slug}/order/${payment.trackingToken}`}
                  style={{
                    display: 'block',
                    textAlign: 'center',
                    backgroundColor: '#0f172a',
                    color: '#ffffff',
                    padding: '12px',
                    borderRadius: '12px',
                    textDecoration: 'none',
                    fontWeight: 600,
                    fontSize: '13px',
                  }}
                >
                  Ver seguimiento de la orden
                </Link>
              )}
              <Link
                href={`/${slug}`}
                style={{
                  display: 'block',
                  textAlign: 'center',
                  backgroundColor: '#f1f5f9',
                  color: '#475569',
                  padding: '12px',
                  borderRadius: '12px',
                  textDecoration: 'none',
                  fontWeight: 600,
                  fontSize: '13px',
                }}
              >
                Ir a la tienda
              </Link>
            </div>
          </div>
        ) : (
          <div style={{ padding: '24px', textAlign: 'center' }}>
            <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '20px' }}>
              El código o número de orden escaneado no coincide con ninguna transacción aprobada en
              el sistema.
            </p>
            <Link
              href={`/${slug}`}
              style={{
                display: 'inline-block',
                backgroundColor: '#0f172a',
                color: '#ffffff',
                padding: '12px 24px',
                borderRadius: '12px',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: '13px',
              }}
            >
              Volver a la tienda
            </Link>
          </div>
        )}
      </div>

      {/* Footer Notice */}
      <p style={{ marginTop: '24px', fontSize: '11px', color: '#94a3b8', textAlign: 'center' }}>
        Sistema de validación criptográfica de comprobantes digitales • Store Lite
      </p>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

// maskDni and formatCurrency are defined at the top of the file

/** Render neutral throttled state (R23) - no 429, no order disclosure. */
function renderThrottledState() {
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '32px 16px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          backgroundColor: '#ffffff',
          borderRadius: '24px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '32px 20px', textAlign: 'center' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: '#fef3c7',
              color: '#f59e0b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '28px',
              fontWeight: 'bold',
              margin: '0 auto 16px',
            }}
          >
            ⏳
          </div>
          <h1 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 800, color: '#92400e' }}>
            Demasiados intentos
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#92400e', lineHeight: 1.5 }}>
            Hiciste muchas consultas en poco tiempo. Por favor, espera unos minutos e inténtalo de
            nuevo.
          </p>
        </div>
        <p style={{ marginTop: '24px', fontSize: '11px', color: '#94a3b8', textAlign: 'center' }}>
          Sistema de validación criptográfica de comprobantes digitales • Store Lite
        </p>
      </div>
    </div>
  );
}

/** W-N1: Render explicit "no existe" state for NULL orderNumber. */
function renderNullOrderState(slug: string) {
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '32px 16px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          backgroundColor: '#ffffff',
          borderRadius: '24px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01)',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '32px 20px', textAlign: 'center' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: '#fee2e2',
              color: '#ef4444',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '28px',
              fontWeight: 'bold',
              margin: '0 auto 16px',
            }}
          >
            📭
          </div>
          <h1 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 800, color: '#991b1b' }}>
            Orden no encontrada
          </h1>
          <p style={{ margin: '0 0 8px', fontSize: '13px', color: '#991b1b', lineHeight: 1.5 }}>
            Este número de orden no existe en nuestros registros.
          </p>
          <p style={{ margin: '0 0 16px', fontSize: '12px', color: '#64748b' }}>
            Si realizaste una compra reciente, contactá al vendedor para obtener tu comprobante.
          </p>
          <p style={{ margin: '0 0 24px', fontSize: '12px', color: '#64748b' }}>
            O verificá tu identidad con Google si compraste con esa cuenta.
          </p>
          <Link
            href={`/${slug}`}
            style={{
              display: 'inline-block',
              backgroundColor: '#0f172a',
              color: '#ffffff',
              padding: '12px 24px',
              borderRadius: '12px',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '13px',
            }}
          >
            Volver a la tienda
          </Link>
        </div>
        <p style={{ marginTop: '24px', fontSize: '11px', color: '#94a3b8', textAlign: 'center' }}>
          Sistema de validación criptográfica de comprobantes digitales • Store Lite
        </p>
      </div>
    </div>
  );
}
