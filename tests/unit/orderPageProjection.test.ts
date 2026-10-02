// =====================================================
// order/[token]/page.tsx — PII-free public projection (R14)
// =====================================================
// Design D11 / D12, spec R14 (api-access-control).
//
// The C4 exposure: this page used to fetch the WHOLE `payments` row, so anyone
// holding a tracking URL saw the buyer's email, DNI, phone and shipping address
// in the SSR payload. Slices A and B-i landed the money gate and the signed
// cookie; THIS suite is where the cookie becomes real access control.
//
// R14 is asserted STRUCTURALLY, on the `columns` argument actually handed to
// `db.query.payments.findFirst` — not on rendered markup. A rendered-markup
// assertion would only prove that the guards happen to hide the values today,
// and would pass unchanged if the projection were removed while some other
// guard still suppressed the output.
//
// The server component is INVOKED, never RENDERED (`await OrderTrackingPage(...)`
// inside try/catch). It is an async function returning a React element tree, so
// awaiting it runs the fetch and every data read above the JSX while leaving the
// ~15 child components unexecuted — that is what keeps this file at 4 mocks
// instead of 20.
//
// Mutations that MUST break this suite:
//   (a) adding any PII key (or `metadata`) to the allowlist  → case 1 fails
//   (b) dropping the cookie check so the full row is always read → case 1 fails
//   (c) leaving `generateMetadata` unprojected                 → case 3 fails
// =====================================================

import OrderTrackingPage, { generateMetadata } from '@/app/[slug]/(app)/order/[token]/page';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Expected contract, written out independently of the page ──
// Kept as a literal (not imported from the page) on purpose: if the test read
// the production constant, mutation (a) below could never be detected.

const PUBLIC_ORDER_COLUMNS = {
  id: true,
  businessId: true,
  productId: true,
  trackingToken: true,
  orderNumber: true,
  status: true,
  amount: true,
  currency: true,
  paymentMethod: true,
  shippingType: true,
  sellerNote: true,
  courierName: true,
  trackingNumber: true,
  createdAt: true,
  updatedAt: true,
  completedAt: true,
};

/** Both paths MUST keep the public storefront relations loaded (R14). */
const PUBLIC_ORDER_RELATIONS = { product: true, business: true };

/** R14's excluded set, verbatim from the spec's bullet list. */
const FORBIDDEN_COLUMNS = [
  'buyerEmail',
  'buyerPhone',
  'buyerDni',
  'shippingAddress',
  'shippingDistrict',
  'shippingProvince',
  'shippingDepartment',
  'shippingAgency',
  'shippingReference',
  'shippingPhone',
  'shippingUbigeo',
  'pickupCode',
  'ticketUrl',
  'ticketImageUrl',
  'deliveryCodeHash',
  'deliveryCodeExpiresAt',
  'metadata',
];

// ── Mocks ────────────────────────────────────────────

const { mockFindFirstPayments, mockVerifyOrderAccessCookie, notFoundSpy } = vi.hoisted(() => {
  const notFoundSpy = vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  });
  return {
    mockFindFirstPayments: vi.fn(),
    mockVerifyOrderAccessCookie: vi.fn(),
    notFoundSpy,
  };
});

vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      payments: { findFirst: (...args: unknown[]) => mockFindFirstPayments(...args) },
      businesses: { findFirst: vi.fn() },
      businessTeamMembers: { findFirst: vi.fn() },
    },
  },
}));

vi.mock('@/lib/orderAccessCookie', () => ({
  verifyOrderAccessCookie: (...args: unknown[]) => mockVerifyOrderAccessCookie(...args),
}));

vi.mock('next/navigation', () => ({
  notFound: (...args: unknown[]) => notFoundSpy(...args),
}));

// No signed-in user: keeps the seller/team block and the `metadata` pre-auth
// branch out of the way, so the only thing under test is the fetch shape.
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));

// ── Fixtures ─────────────────────────────────────────

const SLUG = 'mi-tienda';
const TOKEN = 'track-token-abc123';

/**
 * 🔒 Sentinel values planted in `paymentRow()` for EVERY PII/secret column the
 * page is allowed to touch, keyed by column. A tree leaf that CONTAINS any of
 * these is a leak, whichever column produced it — so an assertion never has to
 * know the render site in order to catch it.
 */
const PII_SENTINELS = {
  buyerEmail: 'leak@example.com',
  buyerPhone: '999888777',
  buyerDni: '12345678',
  shippingAddress: 'Calle Falsa 123',
  shippingDistrict: 'Distrito Leak',
  shippingProvince: 'Provincia Leak',
  shippingDepartment: 'Departamento Leak',
  shippingAgency: 'Agencia Leak',
  shippingReference: 'Referencia Leak',
  shippingPhone: 'Telefono Envio Leak',
  shippingUbigeo: 'Ubigeo Leak',
  pickupCode: 'PICKUP-ABCD-9999',
  ticketUrl: 'https://example.test/ticket.pdf',
  ticketImageUrl: 'https://example.test/ticket.jpg',
  deliveryCodeHash: 'hash-leak-0001',
  deliveryCodeExpiresAt: '2031-03-03T00:00:00Z',
  metadataAuthId: 'supabase-uuid-1',
  metadataName: 'Ana Leak',
} as const;

const PII_VALUES: string[] = Object.values(PII_SENTINELS);

/**
 * The FULL row, PII included. Drizzle does not hand the page a PII-free object
 * — `columns` decides what comes back from the DATABASE. Modelling that split
 * explicitly (`applyProjection` below) is what lets this suite show the tree is
 * PII-free for the right reason, and lets the hostile test show what happens
 * when the projection stops working.
 */
function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay-1',
    businessId: 'biz-1',
    productId: 'prod-1',
    trackingToken: TOKEN,
    orderNumber: 'ORD-1',
    status: 'paid',
    amount: '150.00',
    currency: 'PEN',
    paymentMethod: 'card',
    shippingType: 'delivery',
    sellerNote: null,
    courierName: null,
    trackingNumber: null,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-02T10:00:00Z'),
    completedAt: null,
    buyerEmail: PII_SENTINELS.buyerEmail,
    buyerPhone: PII_SENTINELS.buyerPhone,
    buyerDni: PII_SENTINELS.buyerDni,
    shippingAddress: PII_SENTINELS.shippingAddress,
    shippingDistrict: PII_SENTINELS.shippingDistrict,
    shippingProvince: PII_SENTINELS.shippingProvince,
    shippingDepartment: PII_SENTINELS.shippingDepartment,
    shippingAgency: PII_SENTINELS.shippingAgency,
    shippingReference: PII_SENTINELS.shippingReference,
    shippingPhone: PII_SENTINELS.shippingPhone,
    shippingUbigeo: PII_SENTINELS.shippingUbigeo,
    pickupCode: PII_SENTINELS.pickupCode,
    ticketUrl: PII_SENTINELS.ticketUrl,
    ticketImageUrl: PII_SENTINELS.ticketImageUrl,
    deliveryCodeHash: PII_SENTINELS.deliveryCodeHash,
    deliveryCodeExpiresAt: PII_SENTINELS.deliveryCodeExpiresAt,
    metadata: {
      customerAuth: { authId: PII_SENTINELS.metadataAuthId, name: PII_SENTINELS.metadataName },
    },
    business: { id: 'biz-1', name: 'Mi Tienda', slug: SLUG },
    product: { id: 'prod-1', name: 'Zapatos' },
    ...overrides,
  };
}

/**
 * Faithful drizzle emulation: `columns` decides what the DATABASE returns, so a
 * projected read yields only the selected scalars PLUS the `with` relations,
 * and an unprojected read yields the whole row. Tests that need to bypass this
 * (the hostile-row test below) install their own implementation instead.
 */
function applyProjection(
  row: Record<string, unknown>,
  arg?: { columns?: Record<string, unknown> },
): Record<string, unknown> {
  const columns = arg?.columns;
  if (!columns) return row;

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
 *
 * Non-element objects (`style`, `dangerouslySetInnerHTML`) are traversed too;
 * `seen` guards against a cyclic prop graph.
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

  // An element: descend into its props, which is where `children` lives.
  if (isElementLike(node)) return collectLeafStrings(node.props, out, seen);
  for (const value of Object.values(node as Record<string, unknown>)) {
    collectLeafStrings(value, out, seen);
  }
  return out;
}

/** Sentinel values from `PII_SENTINELS` that reached the tree, in `PII_VALUES` order. */
function surfacedSentinels(leaves: string[]): string[] {
  return PII_VALUES.filter((secret) => leaves.some((leaf) => leaf.includes(secret)));
}

/** The full argument object the page handed to `findFirst`, by call index. */
function recordedArg(callIndex = 0): Record<string, unknown> {
  const call = mockFindFirstPayments.mock.calls.at(callIndex);
  return (call?.[0] ?? {}) as Record<string, unknown>;
}

/** The `columns` argument the page recorded, or `undefined` when it sent none. */
function recordedColumns(callIndex = 0): Record<string, unknown> | undefined {
  return recordedArg(callIndex).columns as Record<string, unknown> | undefined;
}

/** Runs the component to completion, swallowing its `notFound()` throw. */
async function invokePage() {
  try {
    await OrderTrackingPage({ params: Promise.resolve({ slug: SLUG, token: TOKEN }) });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'NEXT_NOT_FOUND') throw error;
  }
}

beforeEach(() => {
  // vitest.config.ts sets clearMocks/restoreMocks → impls are re-declared per test
  mockFindFirstPayments.mockImplementation(async (arg) => applyProjection(paymentRow(), arg));
  mockVerifyOrderAccessCookie.mockImplementation(async () => false);
});

// ── Tests ────────────────────────────────────────────

describe('order page — PII-free public projection (R14)', () => {
  it('reads an explicit PII-free allowlist when no access cookie is present', async () => {
    mockVerifyOrderAccessCookie.mockImplementation(async () => false);

    await invokePage();

    expect(mockVerifyOrderAccessCookie).toHaveBeenCalledWith(TOKEN);
    // The page body must read the row EXACTLY ONCE. Without this, a second
    // unprojected `payments.findFirst` added later would be invisible: every
    // other assertion in this file reads `recordedArg(0)`, the first call.
    expect(mockFindFirstPayments).toHaveBeenCalledTimes(1);
    expect(recordedColumns()).toEqual(PUBLIC_ORDER_COLUMNS);
  });

  it('keeps every buyer-PII and metadata column out of the public projection', async () => {
    mockVerifyOrderAccessCookie.mockImplementation(async () => false);

    await invokePage();

    const columns = recordedColumns() ?? {};
    const selected = Object.keys(columns);
    expect(selected.length).toBeGreaterThan(0);
    for (const forbidden of FORBIDDEN_COLUMNS) {
      expect(selected).not.toContain(forbidden);
    }
    // `with` must be a SIBLING of `columns`: nested inside it, drizzle would read
    // `with` as a column name and strip the relations from the row.
    expect(columns).not.toHaveProperty('with');
    expect(recordedArg().with).toEqual(PUBLIC_ORDER_RELATIONS);
  });

  it('renders no buyer PII or order secret into the tree without an access cookie', async () => {
    mockVerifyOrderAccessCookie.mockImplementation(async () => false);

    const tree = await OrderTrackingPage({ params: Promise.resolve({ slug: SLUG, token: TOKEN }) });

    const leaves = collectLeafStrings(tree);
    // Non-vacuous: the page must have produced content, otherwise "no PII"
    // would pass on an empty walk.
    expect(leaves.length).toBeGreaterThan(0);

    // The DB applied the allowlist, so the page never held these values at all.
    // This is the end-to-end proof that the projection works, complementing the
    // structural `columns` assertions above.
    expect(surfacedSentinels(leaves)).toEqual([]);
  });

  it('surfaces only already-known PII when the projection stops working', async () => {
    // Hostile database: `columns` is ignored and the whole row comes back, so
    // the page holds real PII with no cookie behind it.
    mockFindFirstPayments.mockImplementation(async () => paymentRow());
    mockVerifyOrderAccessCookie.mockImplementation(async () => false);

    const tree = await OrderTrackingPage({ params: Promise.resolve({ slug: SLUG, token: TOKEN }) });
    const leaves = collectLeafStrings(tree);
    expect(leaves.length).toBeGreaterThan(0);

    // Every PII read point in the page is a *conditional render*
    // (`order.buyerPhone && (…)`, `order.shippingAddress || '—'`), never a
    // suppression: given the value, it renders. So the ALLOWLIST IS THE ONLY
    // CONTROL, and this set is the MEASURED size of that exposure. It is pinned
    // so that any column which starts reaching the tree — an unguarded
    // `order.<pii>` read — fails here instead of shipping.
    expect(surfacedSentinels(leaves)).toEqual([
      PII_SENTINELS.buyerEmail, // :1611 CONTACTO, and :1317 as an OrderChatSection prop
      PII_SENTINELS.buyerPhone, // :1618 CONTACTO
      PII_SENTINELS.buyerDni, // :1624 CONTACTO, and :1319 as an OrderChatSection prop
      PII_SENTINELS.shippingAddress, // :1542 ENVÍO
      PII_SENTINELS.shippingDistrict, // :1546 ENVÍO
      PII_SENTINELS.shippingProvince, // :1547 ENVÍO
      PII_SENTINELS.shippingDepartment, // :1548 ENVÍO
      PII_SENTINELS.shippingAgency, // :1556 ENVÍO
      PII_SENTINELS.shippingReference, // :1563 ENVÍO
      PII_SENTINELS.ticketImageUrl, // :1167 / :1239 / :1354 / :1368 ticket modals
      PII_SENTINELS.metadataName, // :1684 VERIFICACIÓN (metadata.customerAuth.name)
    ]);
    // Columns the page never reads, pinned so a future read of any of them fails
    // above: `shippingPhone`, `shippingUbigeo`, `pickupCode` (gated on
    // `env.orderFlowV2` + status, false for this fixture), `ticketUrl`,
    // `deliveryCodeHash`, `deliveryCodeExpiresAt`, `metadata.customerAuth.authId`.
  });

  it('reads the full row when a valid access cookie is present', async () => {
    mockVerifyOrderAccessCookie.mockImplementation(async () => true);

    await invokePage();

    const arg = recordedArg();
    expect(arg.columns).toBeUndefined();
    expect(arg.with).toEqual(PUBLIC_ORDER_RELATIONS);
  });

  it('projects the metadata fetch too — no unprojected second read of the row', async () => {
    mockFindFirstPayments.mockImplementation(async () => paymentRow());

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: SLUG, token: TOKEN }),
    });

    expect(metadata.title).toBe('Seguimiento: Mi Tienda');
    const columns = recordedColumns();
    expect(columns).toBeDefined();
    for (const forbidden of FORBIDDEN_COLUMNS) {
      expect(Object.keys(columns ?? {})).not.toContain(forbidden);
    }
  });

  it('still calls notFound() for a token shorter than the minimum length', async () => {
    try {
      await OrderTrackingPage({ params: Promise.resolve({ slug: SLUG, token: 'abc' }) });
      expect.unreachable('a short token must not render the page');
    } catch (error) {
      expect((error as Error).message).toBe('NEXT_NOT_FOUND');
    }

    expect(mockFindFirstPayments).not.toHaveBeenCalled();
  });

  it('still calls notFound() when the business slug does not match the URL', async () => {
    mockFindFirstPayments.mockImplementation(async () => paymentRow());

    try {
      await OrderTrackingPage({ params: Promise.resolve({ slug: 'otra-tienda', token: TOKEN }) });
      expect.unreachable('a slug mismatch must not render the page');
    } catch (error) {
      expect((error as Error).message).toBe('NEXT_NOT_FOUND');
    }

    expect(notFoundSpy).toHaveBeenCalled();
  });
});
