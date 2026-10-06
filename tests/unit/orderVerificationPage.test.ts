// =====================================================
// Order VERIFICATION PAGE — public verdict + gated surface + throttle (R22, R23)
// =====================================================
// The verify page MUST split into a permanent public verdict and a cookie-gated
// surface, behind a (IP, orderNumber) throttle. This suite reuses the proven
// pattern from orderPageProjection.test.ts: invoke the server component, walk
// the returned tree with a sentinel leaf-collector, and emulate drizzle columns.
// =====================================================

import OrderVerificationPage from '@/app/[slug]/(app)/order/verify/[orderNumber]/page';
import {
  buildOrderVerifyIdentifier,
  buildOrderVerifyIpIdentifier,
  checkOrderVerifyRateLimits,
} from '@/lib/orderAccessRateLimit';
import { RATE_LIMITS, resetRateLimit } from '@/lib/rateLimit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────

const {
  mockFindFirstBusiness,
  mockFindFirstPaymentQa,
  mockFindFirstPaymentQb,
  mockVerifyOrderAccessCookie,
  mockHeaders,
  notFoundSpy,
  mockSelect,
  mockFrom,
  mockWhere,
  PRODUCT_ROW,
} = vi.hoisted(() => {
  const notFoundSpy = vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  });
  return {
    mockFindFirstBusiness: vi.fn(),
    mockFindFirstPaymentQa: vi.fn(),
    mockFindFirstPaymentQb: vi.fn(),
    mockVerifyOrderAccessCookie: vi.fn(),
    mockHeaders: vi.fn(),
    notFoundSpy,
    mockSelect: vi.fn(),
    mockFrom: vi.fn(),
    mockWhere: vi.fn(),
    PRODUCT_ROW: {
      id: 'prod-1',
      title: 'Zapato Premium',
      price: '150.00',
    },
  };
});

vi.mock('@/core/database/client', () => ({
  db: {
    select: mockSelect,
    query: {
      businesses: { findFirst: (...args: unknown[]) => mockFindFirstBusiness(...args) },
      payments: {
        findFirst: (...args: unknown[]) => {
          // First call (Q_A) uses mockFindFirstPaymentQa, second (Q_B) uses mockFindFirstPaymentQb
          const callCount =
            mockFindFirstPaymentQa.mock.calls.length + mockFindFirstPaymentQb.mock.calls.length;
          return callCount % 2 === 0
            ? mockFindFirstPaymentQa(...args)
            : mockFindFirstPaymentQb(...args);
        },
      },
    },
  },
}));

vi.mock('@/lib/orderAccessCookie', () => ({
  verifyOrderAccessCookie: (...args: unknown[]) => mockVerifyOrderAccessCookie(...args),
}));

vi.mock('@/lib/rateLimit', async (importOriginal) => {
  const actual = await importOriginal();
  // Use real limiter for integration, but we'll spy on checkRateLimit
  return {
    ...actual,
    checkRateLimit: vi.fn((...args) => actual.checkRateLimit(...args)),
  };
});

vi.mock('next/navigation', () => ({
  notFound: (...args: unknown[]) => notFoundSpy(...args),
}));

vi.mock('next/headers', () => ({
  headers: mockHeaders,
}));

// ── Fixtures ─────────────────────────────────────────

const SLUG = 'mi-tienda';
const ORDER_NUMBER = 'ORD-123';
const TRACKING_TOKEN = 'track-abc123';
/** A second order, used by the cross-order cookie cases (Task: honest naming). */
const OTHER_ORDER_NUMBER = 'ORD-OTHER';
const OTHER_TRACKING_TOKEN = 'track-xyz789';
// Constructed to avoid sonarjs/no-hardcoded-ip false positive on constant definition
const CLIENT_IP = ['1', '2', '3', '4'].join('.');
const OTHER_IP = ['5', '6', '7', '8'].join('.');
/** RATE_LIMITS.orderVerifyIp — 30 requests / 60s. The coarse ceiling under test. */
const COARSE_MAX = RATE_LIMITS.orderVerifyIp.maxRequests;

const PAYMENT_ROW_PUBLIC = {
  id: 'pay-1',
  businessId: 'biz-1',
  orderNumber: ORDER_NUMBER,
  amount: '150.00',
  currency: 'PEN',
  paymentMethod: 'card',
  status: 'paid',
  buyerDni: '12345678',
  createdAt: new Date('2026-09-07T10:00:00Z'),
  trackingToken: TRACKING_TOKEN,
  // PII columns that MUST NOT be in public projection
  buyerEmail: 'leak@example.com',
  buyerPhone: '999888777',
  shippingAddress: 'Calle Falsa 123',
  metadata: {
    cartItems: [{ id: 'prod-1', name: 'Zapato', quantity: 1, price: 150 }],
  },
  productId: 'prod-1',
};

const PAYMENT_ROW_GATED = {
  ...PAYMENT_ROW_PUBLIC,
  metadata: {
    cartItems: [{ id: 'prod-1', name: 'Zapato', quantity: 1, price: 150 }],
    customerAuth: { authId: 'auth-123', name: 'Juan' },
  },
};

/** A DIFFERENT order: its own number and its own tracking token. */
const PAYMENT_ROW_OTHER = {
  ...PAYMENT_ROW_PUBLIC,
  orderNumber: OTHER_ORDER_NUMBER,
  trackingToken: OTHER_TRACKING_TOKEN,
};

const BUSINESS_ROW = {
  id: 'biz-1',
  name: 'Mi Tienda',
  slug: SLUG,
  // Deliberately disjoint from every PII sentinel below.
  //
  // This used to be '20123456789', which CONTAINS the raw-DNI sentinel '12345678'
  // at offset 2. The business RUC is rendered verbatim by the page, so the PII
  // guard below reported a false positive against a legitimately-rendered public
  // field — and the previous fix "resolved" that by deleting the sentinel from
  // the loop, leaving `PII_SENTINELS` declared and referenced nowhere. De-collide
  // the FIXTURE instead: a guard that only passes because it was weakened is not a
  // guard.
  taxId: '20555666777',
  address: 'Av. Siempre Viva 123',
  logoUrl: null,
};

/**
 * Emulates drizzle column projection for Q_A (public) and Q_B (gated).
 * Q_A columns: no buyerEmail, buyerPhone, shippingAddress, metadata, ticketUrl, productId
 * Q_B columns: full row including metadata, productId
 */
function applyProjection(
  row: Record<string, unknown>,
  arg?: { columns?: Record<string, unknown> },
): Record<string, unknown> {
  const columns = arg?.columns;
  if (!columns) return row; // Q_B - full row

  const selected = new Set(Object.keys(columns));
  const projected = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    if (key === 'product' || key === 'business') continue;
    if (selected.has(key)) projected.set(key, value);
  }
  projected.set('product', row.product);
  projected.set('business', row.business);
  return Object.fromEntries(projected);
}

/** Minimal React element shape — keeps this file free of a React type import. */
interface ElementLike {
  props?: Record<string, unknown> | null;
}

function isElementLike(value: unknown): value is ElementLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { props?: unknown }).props === 'object' &&
    (value as { props?: unknown }).props !== null
  );
}

/**
 * Depth-first walk of an already-CONSTRUCTED React tree, collecting every
 * string/number leaf. Awaiting the page runs its whole body, so the tree exists
 * as plain objects; recursing into `props` reaches `children` plus every other
 * prop (so PII handed to a child COMPONENT as a prop is caught too), while the
 * child component functions are never invoked — which is exactly why no
 * component mocks are needed here.
 */
function collectLeafStrings(node: unknown, out: string[] = [], seen = new WeakSet()): string[] {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (typeof node === 'number' || typeof node === 'bigint') {
    out.push(String(node));
    return out;
  }
  if (node === null || node === undefined || typeof node === 'boolean') return out;
  if (Array.isArray(node)) {
    for (const child of node) collectLeafStrings(child, out, seen);
    return out;
  }
  if (typeof node !== 'object') return out;
  if (seen.has(node)) return out;
  seen.add(node);

  if (isElementLike(node)) return collectLeafStrings(node.props, out, seen);
  for (const value of Object.values(node as Record<string, unknown>)) {
    collectLeafStrings(value, out, seen);
  }
  return out;
}

/** Sentinel values that would indicate PII leakage. */
const PII_SENTINELS = [
  'leak@example.com', // buyerEmail
  '999888777', // buyerPhone
  '12345678', // buyerDni (full)
  'Calle Falsa 123', // shippingAddress
];

/** Runs the component to completion, swallowing its `notFound()` throw. */
async function invokePage(params: { slug: string; orderNumber: string }) {
  try {
    await OrderVerificationPage({ params: Promise.resolve(params) });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'NEXT_NOT_FOUND') throw error;
  }
}

function buildParams(slug = SLUG, orderNumber = ORDER_NUMBER) {
  return { slug, orderNumber };
}

/**
 * Wipes the verify page's limiter buckets for an IP.
 *
 * The real limiter's store is module scope (`rateLimit.ts:32`), so every render
 * in this file permanently charges the coarse per-IP bucket. Without this a case
 * would inherit an already-exhausted budget and pass — or fail — for the wrong
 * reason. Called from `afterEach`, so no case can leak state into the next one.
 */
function clearVerifyThrottle(ip = CLIENT_IP) {
  resetRateLimit(buildOrderVerifyIpIdentifier(ip), RATE_LIMITS.orderVerifyIp);
  resetRateLimit(buildOrderVerifyIdentifier(ip, ORDER_NUMBER), RATE_LIMITS.storefront);
  resetRateLimit(buildOrderVerifyIpIdentifier(OTHER_IP), RATE_LIMITS.orderVerifyIp);
}

/** Burns the coarse per-IP budget so the next render for `ip` is refused. */
function exhaustCoarseBudget(ip = CLIENT_IP) {
  clearVerifyThrottle(ip);
  for (let i = 0; i < COARSE_MAX; i += 1) {
    checkOrderVerifyRateLimits(ip, `BURN-${i}`);
  }
}

beforeEach(() => {
  vi.clearAllMocks();

  // Setup db.select chain for products query: select().from().where() -> Promise
  mockSelect.mockImplementation(() => ({ from: mockFrom }));
  mockFrom.mockImplementation(() => ({ where: mockWhere }));
  mockWhere.mockResolvedValue([PRODUCT_ROW]);

  mockHeaders.mockResolvedValue({
    get: (name: string) => (name === 'x-forwarded-for' ? CLIENT_IP : null),
  });

  mockFindFirstBusiness.mockResolvedValue(BUSINESS_ROW);
  mockFindFirstPaymentQa.mockImplementation(async (args: any) =>
    applyProjection(PAYMENT_ROW_PUBLIC, args),
  );
  mockFindFirstPaymentQb.mockImplementation(async (args: any) =>
    applyProjection(PAYMENT_ROW_GATED, args),
  );
  mockVerifyOrderAccessCookie.mockResolvedValue(false);
});

afterEach(() => {
  // The coarse bucket is shared by every render in this file; leaving it charged
  // would make later cases depend on execution order.
  clearVerifyThrottle();
});

// ── Tests ────────────────────────────────────────────

describe('OrderVerificationPage — R22 surface split + R23 throttle', () => {
  describe('Public verdict (anonymous, no cookie)', () => {
    it('renders valid/invalid verdict, masked DNI, status, amount — no cart, no trackingToken link', async () => {
      mockVerifyOrderAccessCookie.mockResolvedValue(false);

      const tree = await OrderVerificationPage({ params: Promise.resolve(buildParams()) });

      const leaves = collectLeafStrings(tree);
      expect(leaves.length).toBeGreaterThan(0);

      // Public verdict elements present
      expect(
        leaves.some(
          (l) =>
            l.includes('Comprobante Oficial Verificado') || l.includes('Comprobante No Válido'),
        ),
      ).toBe(true);
      expect(leaves.some((l) => l.includes('****5678'))).toBe(true); // masked DNI
      expect(leaves.some((l) => l.includes('S/ 150.00'))).toBe(true); // amount
      expect(leaves.some((l) => l.includes('paid'))).toBe(true); // status

      // Gated content ABSENT
      expect(leaves.some((l) => l.includes('Ver seguimiento de la orden'))).toBe(false); // trackingToken link
      expect(leaves.some((l) => l.includes('Zapato Premium'))).toBe(false); // cart items

      // PII NOT leaked — the mask is what reaches the markup, never the raw value.
      expect(leaves.some((l) => l.includes('****5678'))).toBe(true); // masked DNI rendered
      // Wired back in from `PII_SENTINELS` so the list is the single source of
      // truth. '12345678' is the load-bearing entry: it is the RAW `buyerDni`, and
      // only the mask may render.
      for (const pii of PII_SENTINELS) {
        expect(leaves.some((l) => l.includes(pii))).toBe(false);
      }
    });

    it('renders explicit "no existe" state when payment not found (W-N1)', async () => {
      mockVerifyOrderAccessCookie.mockResolvedValue(false);
      mockFindFirstPaymentQa.mockResolvedValueOnce(null);

      const tree = await OrderVerificationPage({
        params: Promise.resolve(buildParams(SLUG, 'ORD-FAKE')),
      });

      const leaves = collectLeafStrings(tree);
      // W-N1: NULL orderNumber -> explicit "no existe" state, NOT the DNI form
      expect(
        leaves.some(
          (l) =>
            l.includes('Orden no encontrada') ||
            l.includes('no existe') ||
            l.includes('no encontrado'),
        ),
      ).toBe(true);
      expect(
        leaves.some((l) => l.includes('Volver a la tienda') || l.includes('Ir a la tienda')),
      ).toBe(true);
      // Should NOT render DNI form
      expect(leaves.some((l) => l.includes('Documento de Identidad') || l.includes('DNI'))).toBe(
        false,
      );
    });

    it('printed-ticket UX survives: anonymous access still renders useful verdict', async () => {
      mockVerifyOrderAccessCookie.mockResolvedValue(false);

      const tree = await OrderVerificationPage({ params: Promise.resolve(buildParams()) });

      const leaves = collectLeafStrings(tree);
      expect(leaves.length).toBeGreaterThan(0);
      expect(leaves.some((l) => l.includes('Comprobante'))).toBe(true);
      expect(leaves.some((l) => l.includes('S/ 150.00'))).toBe(true);
    });
  });

  describe('Gated surface (valid cookie)', () => {
    it('unlocks cart items and trackingToken link when cookie verifies', async () => {
      mockVerifyOrderAccessCookie.mockResolvedValue(true);

      const tree = await OrderVerificationPage({ params: Promise.resolve(buildParams()) });

      const leaves = collectLeafStrings(tree);
      expect(leaves.some((l) => l.includes('Ver seguimiento de la orden'))).toBe(true);
      expect(leaves.some((l) => l.includes('Zapato Premium'))).toBe(true);
      // React renders {item.quantity}x as two separate text nodes: "1" and "x"
      expect(leaves.some((l) => l === '1')).toBe(true);
      expect(leaves.some((l) => l === 'x')).toBe(true);
    });

    // These two are a MATCHED PAIR on purpose.
    //
    // The old version of the cross-order case set the same
    // `mockResolvedValue(false)` as the plain no-cookie case, so its name
    // promised a cross-order assertion its body never made — it duplicated the
    // no-cookie test under a misleading title.
    //
    // Both now run against a real cookie JAR: a set of tokens holding a valid
    // cookie. `verifyOrderAccessCookie` is stubbed as "is THIS token in the jar",
    // which is exactly the property the real signature has. The control case
    // proves the jar can grant access at all — without it the cross-order case
    // would still pass if the stub returned `false` unconditionally, making the
    // whole thing vacuous. Cross-order enforcement itself is pinned
    // cryptographically at `orderAccessCookie.test.ts:170` (a cookie minted for
    // order A is rejected when pasted into order B's slot).
    it('CONTROL: the cookie jar DOES unlock its OWN order (so the case below is not vacuous)', async () => {
      const jar = new Set<string>([TRACKING_TOKEN]);
      mockVerifyOrderAccessCookie.mockImplementation(async (token: string) => jar.has(token));

      const tree = await OrderVerificationPage({ params: Promise.resolve(buildParams()) });

      const leaves = collectLeafStrings(tree);
      expect(leaves.some((l) => l.includes('Ver seguimiento de la orden'))).toBe(true);
      expect(leaves.some((l) => l.includes('Zapato Premium'))).toBe(true);
    });

    it("another order's cookie does NOT unlock this page", async () => {
      // The buyer holds a VALID cookie — for order A.
      const jar = new Set<string>([TRACKING_TOKEN]);
      mockVerifyOrderAccessCookie.mockImplementation(async (token: string) => jar.has(token));

      // The page under test is order B, whose row carries B's own token.
      mockFindFirstPaymentQa.mockImplementation(async (args: any) =>
        applyProjection(PAYMENT_ROW_OTHER, args),
      );

      const tree = await OrderVerificationPage({
        params: Promise.resolve(buildParams(SLUG, OTHER_ORDER_NUMBER)),
      });

      // The page handed the verifier B's token — not A's, and not nothing. If it
      // passed the wrong token the jar would have said yes and this would leak.
      expect(mockVerifyOrderAccessCookie).toHaveBeenCalledTimes(1);
      expect(mockVerifyOrderAccessCookie).toHaveBeenCalledWith(OTHER_TRACKING_TOKEN);
      expect(mockVerifyOrderAccessCookie).not.toHaveBeenCalledWith(TRACKING_TOKEN);

      const leaves = collectLeafStrings(tree);
      expect(leaves.some((l) => l.includes('Ver seguimiento de la orden'))).toBe(false);
      expect(leaves.some((l) => l.includes('Zapato Premium'))).toBe(false);
      // R22: the page is NOT gated in full — the public verdict still renders.
      expect(leaves.some((l) => l.includes('Comprobante Oficial Verificado'))).toBe(true);
    });
  });

  // The gate used to be recomputed inline at four sites in the page. A delete at
  // the render site left the suite green, so these cases pin the ONE binding and
  // the ONE cookie call that the four consumers now share.
  describe('Gated-surface gate — single resolver binding', () => {
    it('calls verifyOrderAccessCookie exactly once per render, with this order token', async () => {
      mockVerifyOrderAccessCookie.mockResolvedValue(true);

      await invokePage(buildParams());

      expect(mockVerifyOrderAccessCookie).toHaveBeenCalledTimes(1);
      expect(mockVerifyOrderAccessCookie).toHaveBeenCalledWith(TRACKING_TOKEN);
    });

    it('never calls the cookie verifier when the row carries no trackingToken', async () => {
      const tokenless = { ...PAYMENT_ROW_PUBLIC, trackingToken: null };
      mockFindFirstPaymentQa.mockImplementation(async (args: any) =>
        applyProjection(tokenless, args),
      );
      mockVerifyOrderAccessCookie.mockResolvedValue(true);

      await invokePage(buildParams());

      expect(mockVerifyOrderAccessCookie).not.toHaveBeenCalled();
    });

    it('both gated surfaces toggle together on the one boolean', async () => {
      mockVerifyOrderAccessCookie.mockResolvedValue(true);
      const granted = collectLeafStrings(
        await OrderVerificationPage({ params: Promise.resolve(buildParams()) }),
      );
      expect(granted.some((l) => l.includes('Zapato Premium'))).toBe(true);
      expect(granted.some((l) => l.includes('Ver seguimiento de la orden'))).toBe(true);

      mockVerifyOrderAccessCookie.mockResolvedValue(false);
      const denied = collectLeafStrings(
        await OrderVerificationPage({ params: Promise.resolve(buildParams()) }),
      );
      expect(denied.some((l) => l.includes('Zapato Premium'))).toBe(false);
      expect(denied.some((l) => l.includes('Ver seguimiento de la orden'))).toBe(false);
    });
  });

  describe('Column projection — Q_A public vs Q_B gated', () => {
    it('Q_A (public) selects only public columns, excludes buyerEmail, buyerPhone, shippingAddress, metadata, productId, ticketUrl', async () => {
      mockVerifyOrderAccessCookie.mockResolvedValue(false);

      await invokePage(buildParams());

      // Q_A call should have columns with public fields only
      const qaCall = mockFindFirstPaymentQa.mock.calls[0];
      expect(qaCall).toBeDefined();
      const qaArg = qaCall[0];
      expect(qaArg.columns).toBeDefined();
      const qaCols = Object.keys(qaArg.columns);
      expect(qaCols).toContain('orderNumber');
      expect(qaCols).toContain('status');
      expect(qaCols).toContain('amount');
      expect(qaCols).toContain('trackingToken');
      // Forbidden columns absent from Q_A
      expect(qaCols).not.toContain('buyerEmail');
      expect(qaCols).not.toContain('buyerPhone');
      expect(qaCols).not.toContain('shippingAddress');
      expect(qaCols).not.toContain('metadata');
      expect(qaCols).not.toContain('productId');
      expect(qaCols).not.toContain('ticketUrl');
    });

    it('Q_B (gated) selects explicit gated columns (metadata + productId) when cookie verifies', async () => {
      mockVerifyOrderAccessCookie.mockResolvedValue(true);

      await invokePage(buildParams());

      // Q_B call should have GATED_VERIFICATION_COLUMNS (explicit projection, not full row)
      const qbCall = mockFindFirstPaymentQb.mock.calls[0];
      expect(qbCall).toBeDefined();
      const qbArg = qbCall[0];
      // Implementation uses explicit column projection for Q_B too (safer than full row)
      expect(qbArg.columns).toBeDefined();
      const qbCols = Object.keys(qbArg.columns);
      expect(qbCols).toContain('metadata');
      expect(qbCols).toContain('productId');
      // Also includes all public columns
      expect(qbCols).toContain('orderNumber');
      expect(qbCols).toContain('status');
      expect(qbCols).toContain('amount');
      expect(qbCols).toContain('trackingToken');
    });

    it('Q_B is NOT executed when cookie does not verify', async () => {
      mockVerifyOrderAccessCookie.mockResolvedValue(false);

      await invokePage(buildParams());

      expect(mockFindFirstPaymentQb).not.toHaveBeenCalled();
    });
  });

  describe('R23 — dual-key throttle: (IP, orderNumber) + coarse per-IP', () => {
    // The old case here asserted `expect(true).toBe(true)` with a comment
    // admitting it needed "rate limit store control". The store is reachable —
    // `resetRateLimit` is exported and the limiter is real under the spy — so
    // there was never a reason to ship a placeholder for R23 §3.

    it('the throttle identity comes from headers(): two header IPs are independent', async () => {
      exhaustCoarseBudget(CLIENT_IP);

      await invokePage(buildParams());

      expect(mockHeaders).toHaveBeenCalled();
      // CLIENT_IP is out of budget, so the page must not reach the database.
      expect(mockFindFirstBusiness).not.toHaveBeenCalled();

      // A different x-forwarded-for is a different bucket, and is served.
      mockHeaders.mockResolvedValue({
        get: (name: string) => (name === 'x-forwarded-for' ? OTHER_IP : null),
      });
      await invokePage(buildParams());

      expect(mockFindFirstBusiness).toHaveBeenCalled();
    });

    it('an exhausted budget renders the SAME neutral state for an existing and a non-existent order', async () => {
      exhaustCoarseBudget(CLIENT_IP);

      // (a) an order that EXISTS.
      const existing = await OrderVerificationPage({ params: Promise.resolve(buildParams()) });
      const existingJson = JSON.stringify(existing);

      // (b) an order that does NOT exist. The stub is irrelevant — the throttle
      // refuses before any query runs, which is precisely what makes the two
      // responses comparable.
      mockFindFirstPaymentQa.mockResolvedValueOnce(null);
      const missing = await OrderVerificationPage({
        params: Promise.resolve(buildParams(SLUG, 'ORD-DOES-NOT-EXIST')),
      });
      const missingJson = JSON.stringify(missing);

      // Byte-identical output: order existence is not inferable from a
      // throttled response (R23 §3).
      expect(existingJson).toBe(missingJson);

      const leaves = collectLeafStrings(existing);
      expect(leaves.some((l) => l.includes('Demasiados intentos'))).toBe(true);

      // And nothing order-specific survives in it.
      for (const leak of ['****5678', 'S/ 150.00', ORDER_NUMBER, 'Zapato Premium']) {
        expect(existingJson).not.toContain(leak);
      }
      expect(existingJson).not.toContain('Ver seguimiento de la orden');
    });

    it('rotating orderNumber from one IP cannot escape the throttle (page level)', async () => {
      exhaustCoarseBudget(CLIENT_IP);
      // Re-open the budget so the rotation case itself starts clean, then walk
      // order numbers the way the original bypass probe did.
      clearVerifyThrottle(CLIENT_IP);
      mockFindFirstPaymentQa.mockResolvedValue(null);

      let served = 0;
      for (let i = 0; i < COARSE_MAX + 5; i += 1) {
        await invokePage(buildParams(SLUG, `ROT-${i}`));
        if (mockFindFirstBusiness.mock.calls.length > 0) served += 1;
        mockFindFirstBusiness.mockClear();
      }

      // Every request carried a DIFFERENT order number, so a per-(IP,
      // orderNumber) bucket alone would have served all COARSE_MAX + 5.
      expect(served).toBe(COARSE_MAX);
    });

    it('an under-budget request is served normally and reaches the database', async () => {
      clearVerifyThrottle(CLIENT_IP);

      const tree = await OrderVerificationPage({ params: Promise.resolve(buildParams()) });

      expect(mockFindFirstBusiness).toHaveBeenCalled();
      expect(collectLeafStrings(tree).some((l) => l.includes('Comprobante'))).toBe(true);
    });
  });

  describe('NULL orderNumber (W-N1) — explicit "no existe" state', () => {
    it('renders explicit non-submittable state when orderNumber is NULL', async () => {
      const nullPayment = {
        ...PAYMENT_ROW_PUBLIC,
        orderNumber: null,
        trackingToken: TRACKING_TOKEN,
      };
      mockFindFirstPaymentQa.mockImplementation(async (args: any) =>
        applyProjection(nullPayment, args),
      );
      mockVerifyOrderAccessCookie.mockResolvedValue(false);

      const tree = await OrderVerificationPage({
        params: Promise.resolve(buildParams(SLUG, 'NULL')),
      });

      const leaves = collectLeafStrings(tree);
      // Should show "no existe" state with link back to storefront
      // NOT the DNI form
      expect(
        leaves.some(
          (l) => l.includes('no existe') || l.includes('No existe') || l.includes('no encontrado'),
        ),
      ).toBe(true);
      expect(
        leaves.some((l) => l.includes('Volver a la tienda') || l.includes('Ir a la tienda')),
      ).toBe(true);
      // Should NOT render DNI form
      expect(leaves.some((l) => l.includes('Documento de Identidad') || l.includes('DNI'))).toBe(
        false,
      );
    });
  });

  // The `?dni=` prefill case that used to live here was a second
  // `expect(true).toBe(true)` placeholder. It asserted nothing, it described
  // behaviour this page does not have, and `?dni=` handling belongs to slice C
  // (PR #210) — R24 in fact FORBIDS consuming the parameter as a credential or
  // demoting it to a prefill. A fake assertion is worse than no case: it reads
  // like coverage. Deleted rather than implemented here.
});
