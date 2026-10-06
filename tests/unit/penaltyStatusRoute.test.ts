// =====================================================
// GET /api/business/penalty-status — two-branch payload (W-D2 / D5 / R5)
//
// The route has two consumers with different needs:
//   * the public checkout banner (Checkout.tsx:116-130) is fetched
//     anonymously and reads only { canAcceptPayments, culqiBlocked, blacklisted }
//   * the owner dashboard (PenaltiesClient.tsx:31-37) also needs
//     penaltyDebt / penaltyCount
//
// So the route MUST return the banner subset by default and only add the
// penalty figures when the session user owns the business.
// =====================================================

import { GET } from '@/app/api/business/penalty-status/route';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────
// `@/features/storage/actions/authz` is mocked (repo convention:
// penaltiesRoute.test.ts, purchasePlan*.test.ts, settingsActions.test.ts, …)
// so this suite pins the branch this task adds instead of re-testing authz.
// `@/core/database/client` exposes the route's own business lookup
// (`db.query.businesses.findFirst`) so the two branches can be told apart.

const { mockRequireOwnedBusinessById, mockBusinessFindFirst } = vi.hoisted(() => {
  const mockRequireOwnedBusinessById = vi.fn();
  const mockBusinessFindFirst = vi.fn();

  return { mockRequireOwnedBusinessById, mockBusinessFindFirst };
});

vi.mock('@/features/storage/actions/authz', () => ({
  requireOwnedBusinessById: mockRequireOwnedBusinessById,
}));

vi.mock('@/core/database/client', () => ({
  db: { query: { businesses: { findFirst: mockBusinessFindFirst } } },
}));

// ── Fixtures ─────────────────────────────────────────

const BUSINESS_ID = 'biz-owner-1';
const FOREIGN_BUSINESS_ID = 'biz-foreign-2';

/** Storefront business: blocked for payments, no debt figures matter here. */
const BLOCKED_BUSINESS = {
  culqiBlocked: true,
  blacklisted: false,
  penaltyDebt: '450.50',
  penaltyCount: 3,
};

/** Healthy business: the banner subset must report payments as acceptable. */
const HEALTHY_BUSINESS = {
  culqiBlocked: false,
  blacklisted: false,
  penaltyDebt: '0.00',
  penaltyCount: 0,
};

function statusRequest(search = ''): Request {
  return new Request(`http://localhost/api/business/penalty-status${search}`);
}

/** Authz refuses: mirrors the real `No autorizado` throw for anonymous / non-owner. */
function refuseOwner(message = 'No autorizado') {
  mockRequireOwnedBusinessById.mockRejectedValue(new Error(message));
}

/** Authz grants: mirrors the real `requireOwnedBusinessById` resolution. */
function grantOwner(businessId = BUSINESS_ID) {
  mockRequireOwnedBusinessById.mockResolvedValue({
    businessId,
    ownerId: 'user-1',
    slug: 'acme-store',
  });
}

// ── Suite ────────────────────────────────────────────

describe('GET /api/business/penalty-status — two-branch payload', () => {
  beforeEach(() => {
    mockRequireOwnedBusinessById.mockReset();
    mockBusinessFindFirst.mockReset();
    mockBusinessFindFirst.mockResolvedValue(HEALTHY_BUSINESS);
  });

  test('400 when businessId is missing, without consulting authz or the database', async () => {
    const res = await GET(statusRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('businessId es requerido');
    expect(mockRequireOwnedBusinessById).not.toHaveBeenCalled();
    expect(mockBusinessFindFirst).not.toHaveBeenCalled();
  });

  test('404 for an unknown business, before the owner branch resolves', async () => {
    mockBusinessFindFirst.mockResolvedValue(undefined);

    const res = await GET(statusRequest(`?businessId=${BUSINESS_ID}`));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Negocio no encontrado');
    expect(mockBusinessFindFirst).toHaveBeenCalledTimes(1);
    expect(mockRequireOwnedBusinessById).not.toHaveBeenCalled();
  });

  // NOTE: `authz` is mocked, so "anonymous" and "non-owner" both reach the route as
  // the same rejection — the route cannot observe identity. What these cases prove is
  // that BOTH fall into the banner branch, and that the requested businessId reaches
  // the gate verbatim (the route must not substitute a hardcoded or owner id). The
  // anonymous-vs-foreign distinction itself lives inside `authz.ts`, which is
  // pre-existing and out of scope for this work unit.

  test('200 with the banner subset and no penalty figures for an anonymous caller', async () => {
    mockBusinessFindFirst.mockResolvedValue(BLOCKED_BUSINESS);
    refuseOwner();

    const res = await GET(statusRequest(`?businessId=${BUSINESS_ID}`));

    expect(res.status).toBe(200);
    const data = await res.json();

    // R5: exactly the three fields the checkout banner consumes.
    expect(data).toEqual({
      canAcceptPayments: false,
      culqiBlocked: true,
      blacklisted: false,
    });
    expect(Object.keys(data).sort()).toEqual(['blacklisted', 'canAcceptPayments', 'culqiBlocked']);

    // R5: the penalty figures must NOT leak to an anonymous caller.
    expect(data).not.toHaveProperty('penaltyDebt');
    expect(data).not.toHaveProperty('penaltyCount');
    expect(mockRequireOwnedBusinessById).toHaveBeenCalledWith(BUSINESS_ID);
  });

  test('200 with the banner subset for a session that does not own the business', async () => {
    refuseOwner();

    const res = await GET(statusRequest(`?businessId=${FOREIGN_BUSINESS_ID}`));

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data).toEqual({
      canAcceptPayments: true,
      culqiBlocked: false,
      blacklisted: false,
    });
    expect(data).not.toHaveProperty('penaltyDebt');
    expect(data).not.toHaveProperty('penaltyCount');
    expect(mockRequireOwnedBusinessById).toHaveBeenCalledWith(FOREIGN_BUSINESS_ID);
  });

  test('200 with the full payload including the penalty figures for the owner', async () => {
    mockBusinessFindFirst.mockResolvedValue(BLOCKED_BUSINESS);
    grantOwner();

    const res = await GET(statusRequest(`?businessId=${BUSINESS_ID}`));

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data).toEqual({
      culqiBlocked: true,
      blacklisted: false,
      penaltyDebt: '450.50',
      penaltyCount: 3,
      canAcceptPayments: false,
    });
    expect(mockRequireOwnedBusinessById).toHaveBeenCalledWith(BUSINESS_ID);
    expect(mockBusinessFindFirst).toHaveBeenCalledTimes(1);
  });

  test('the owner branch still reports canAcceptPayments from the business flags', async () => {
    mockBusinessFindFirst.mockResolvedValue({
      ...HEALTHY_BUSINESS,
      penaltyDebt: '12.00',
      penaltyCount: 1,
    });
    grantOwner();

    const res = await GET(statusRequest(`?businessId=${BUSINESS_ID}`));

    expect(res.status).toBe(200);
    const data = await res.json();

    // Debt figures alone must not block payments — only culqiBlocked/blacklisted do.
    expect(data.canAcceptPayments).toBe(true);
    expect(data.penaltyDebt).toBe('12.00');
    expect(data.penaltyCount).toBe(1);
    expect(mockRequireOwnedBusinessById).toHaveBeenCalledWith(BUSINESS_ID);
  });

  test('the banner subset also reports canAcceptPayments false when the business is blacklisted', async () => {
    mockBusinessFindFirst.mockResolvedValue({
      culqiBlocked: false,
      blacklisted: true,
      penaltyDebt: '980.00',
      penaltyCount: 7,
    });
    refuseOwner();

    const res = await GET(statusRequest(`?businessId=${BUSINESS_ID}`));

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.canAcceptPayments).toBe(false);
    expect(data.blacklisted).toBe(true);
    expect(data).not.toHaveProperty('penaltyDebt');
    expect(data).not.toHaveProperty('penaltyCount');
  });
});
