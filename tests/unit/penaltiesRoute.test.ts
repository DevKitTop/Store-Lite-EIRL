// =====================================================
// GET /api/business/penalties — owner gate (W-D1 / D6 / R4)
// The route must refuse anonymous and non-owner callers
// with 401 BEFORE any penalty row is read from the database.
// =====================================================

import { GET } from '@/app/api/business/penalties/route';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────
// `@/features/storage/actions/authz` is mocked (repo convention:
// purchasePlan*.test.ts, settingsActions.test.ts, …) so this suite
// asserts the behavior this task adds — the gate runs after the 400
// validation, refuses with 401, and short-circuits the query.
// `db.select` is the observable "did we reach the database" probe.

const { mockRequireOwnedBusinessById, mockOrderBy, mockWhere, mockFrom, mockSelect } = vi.hoisted(
  () => {
    const mockRequireOwnedBusinessById = vi.fn();
    const mockOrderBy = vi.fn();
    const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
    const mockFrom = vi.fn(() => ({ where: mockWhere }));
    const mockSelect = vi.fn(() => ({ from: mockFrom }));

    return { mockRequireOwnedBusinessById, mockOrderBy, mockWhere, mockFrom, mockSelect };
  },
);

vi.mock('@/features/storage/actions/authz', () => ({
  requireOwnedBusinessById: mockRequireOwnedBusinessById,
}));

vi.mock('@/core/database/client', () => ({
  db: { select: mockSelect },
}));

// ── Fixtures ─────────────────────────────────────────

const BUSINESS_ID = 'biz-owner-1';
const OTHER_BUSINESS_ID = 'biz-someone-else';
const FOREIGN_BUSINESS_ID = 'biz-foreign-2';

const OWNER_PENALTIES = [
  { id: 'pen-1', businessId: BUSINESS_ID, status: 'pending', amount: 120 },
  { id: 'pen-2', businessId: BUSINESS_ID, status: 'paid', amount: 60 },
];

function penaltiesRequest(search = ''): Request {
  return new Request(`http://localhost/api/business/penalties${search}`);
}

/** Authz refuses: mirrors the real `No autorizado` throw. */
function refuseOwner(message = 'No autorizado') {
  mockRequireOwnedBusinessById.mockRejectedValue(new Error(message));
}

// ── Suite ────────────────────────────────────────────

describe('GET /api/business/penalties — owner gate', () => {
  beforeEach(() => {
    mockRequireOwnedBusinessById.mockReset();
    mockOrderBy.mockReset();
    mockSelect.mockReset();
    mockWhere.mockReset();
    mockFrom.mockReset();

    mockWhere.mockImplementation(() => ({ orderBy: mockOrderBy }));
    mockFrom.mockImplementation(() => ({ where: mockWhere }));
    mockSelect.mockImplementation(() => ({ from: mockFrom }));
    mockOrderBy.mockResolvedValue(OWNER_PENALTIES);
  });

  test('400 when businessId is missing, without consulting authz or the database', async () => {
    const res = await GET(penaltiesRequest());

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('businessId es requerido');
    expect(mockRequireOwnedBusinessById).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  test('400 for an invalid status, before the owner gate runs', async () => {
    const res = await GET(penaltiesRequest(`?businessId=${BUSINESS_ID}&status=bogus`));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      "Status inválido. Valores permitidos: pending, paid, cancelled, disputed o 'all'",
    );
    expect(mockRequireOwnedBusinessById).not.toHaveBeenCalled();
    expect(mockSelect).not.toHaveBeenCalled();
  });

  // NOTE: `authz` is mocked, so "anonymous" and "foreign owner" both arrive at the
  // route as the same rejection. What the foreign-owner case proves at route level
  // is that a NON-OWNER business id reaches the gate verbatim — the route must not
  // substitute a hardcoded/owner id — and that the refusal happens before the
  // penalty query. The distinct requested-id proof (an empty or hardcoded id would
  // fail) is carried by the `biz-someone-else` case below. The anonymous-vs-foreign
  // distinction itself lives inside `authz.ts`, which is pre-existing and out of
  // scope for this work unit.

  test('401 for an unauthenticated caller, without reading penalty rows', async () => {
    refuseOwner();

    const res = await GET(penaltiesRequest(`?businessId=${BUSINESS_ID}`));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('No autorizado');
    expect(mockRequireOwnedBusinessById).toHaveBeenCalledWith(BUSINESS_ID);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  test('401 for a session that does not own the business, without reading penalty rows', async () => {
    refuseOwner();

    const res = await GET(penaltiesRequest(`?businessId=${FOREIGN_BUSINESS_ID}`));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('No autorizado');
    expect(mockRequireOwnedBusinessById).toHaveBeenCalledWith(FOREIGN_BUSINESS_ID);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  test('401 with the authz reason when the businessId is unknown', async () => {
    refuseOwner('Negocio no encontrado');

    const res = await GET(penaltiesRequest(`?businessId=${OTHER_BUSINESS_ID}`));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Negocio no encontrado');
    expect(mockRequireOwnedBusinessById).toHaveBeenCalledWith(OTHER_BUSINESS_ID);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  test('200 with the penalty rows for the owner', async () => {
    mockRequireOwnedBusinessById.mockResolvedValue({
      businessId: BUSINESS_ID,
      ownerId: 'user-1',
      slug: 'acme-store',
    });

    const res = await GET(penaltiesRequest(`?businessId=${BUSINESS_ID}`));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.penalties).toEqual(OWNER_PENALTIES);
    expect(mockRequireOwnedBusinessById).toHaveBeenCalledWith(BUSINESS_ID);
    expect(mockSelect).toHaveBeenCalledTimes(1);
    expect(mockOrderBy).toHaveBeenCalledTimes(1);
  });

  test('200 for the owner with a status filter still filtered through the gate', async () => {
    mockRequireOwnedBusinessById.mockResolvedValue({
      businessId: BUSINESS_ID,
      ownerId: 'user-1',
      slug: 'acme-store',
    });

    const res = await GET(penaltiesRequest(`?businessId=${BUSINESS_ID}&status=pending`));

    expect(res.status).toBe(200);
    expect((await res.json()).penalties).toEqual(OWNER_PENALTIES);
    expect(mockRequireOwnedBusinessById).toHaveBeenCalledWith(BUSINESS_ID);
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });
});
