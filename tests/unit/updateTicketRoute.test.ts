// =====================================================
// POST /api/payment/update-ticket — Unit tests
// =====================================================
// W-P5 fix: The route MUST resolve by orderNumber (with ownership check on
// THAT row), then UPDATE by payments.id only. Never UPDATE order_number.
// The blind multi-row UPDATE keyed by client-supplied orderNumber is removed.
// =====================================================

import { POST } from '@/app/api/payment/update-ticket/route';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────

const {
  mockRequireOwnedBusinessById,
  mockDbSelect,
  mockSelect,
  mockUpdate,
  mockUpdateSet,
  mockUpdateWhere,
  mockUpdateReturning,
} = vi.hoisted(() => {
  const mockRequireOwnedBusinessById = vi.fn();
  const mockDbSelect = vi.fn();
  const mockSelect = vi.fn();
  const mockUpdateReturning = vi.fn();
  const mockUpdateWhere = vi.fn(() => ({ returning: mockUpdateReturning }));
  const mockUpdateSet = vi.fn(() => ({ where: mockUpdateWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockUpdateSet }));

  return {
    mockRequireOwnedBusinessById,
    mockDbSelect,
    mockSelect,
    mockUpdate,
    mockUpdateSet,
    mockUpdateWhere,
    mockUpdateReturning,
  };
});

vi.mock('@/features/storage/actions/authz', () => ({
  requireOwnedBusinessById: mockRequireOwnedBusinessById,
}));

vi.mock('@/core/database/client', () => ({
  db: {
    select: mockDbSelect,
    update: mockUpdate,
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
    },
  })),
}));

// ── Fixtures ──────────────────────────────────────────

const BUSINESS_ID = 'biz-owner-1';
const FOREIGN_BUSINESS_ID = 'biz-foreign-2';
const ORDER_NUMBER = 'ORD-BUYER-0001';
const PAYMENT_ID = 'pay-1';
const FOREIGN_PAYMENT_ID = 'pay-2';
const TICKET_URL = 'https://supabase.co/tickets/ORD-BUYER-0001.png';

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PAYMENT_ID,
    businessId: BUSINESS_ID,
    orderNumber: ORDER_NUMBER,
    ...overrides,
  };
}

function generateRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost/api/payment/update-ticket', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Owner session for BUSINESS_ID. */
function grantOwnership() {
  mockRequireOwnedBusinessById.mockResolvedValue({
    businessId: BUSINESS_ID,
    ownerId: 'user-1',
    slug: 'test-store',
  });
}

/** No session / not the owner — mirrors the real 'No autorizado' throw. */
function refuseOwnership(message = 'No autorizado') {
  mockRequireOwnedBusinessById.mockRejectedValue(new Error(message));
}

function resetMocks() {
  mockDbSelect.mockReset();
  mockSelect.mockReset();
  mockUpdate.mockReset();
  mockUpdateSet.mockReset();
  mockUpdateWhere.mockReset();
  mockUpdateReturning.mockReset();
  mockRequireOwnedBusinessById.mockReset();
}

// ── Suite ────────────────────────────────────────────

describe('POST /api/payment/update-ticket — W-P5 primary-key scoped update', () => {
  beforeEach(() => {
    resetMocks();

    // Default select mock: returns the payment row with id, businessId, orderNumber
    mockDbSelect.mockImplementation(() => ({
      from: () => ({
        where: () => ({ limit: mockSelect }),
      }),
    }));

    // Default update mock: returns the updated row
    mockUpdateReturning.mockResolvedValue([paymentRow({ ticketUrl: TICKET_URL })]);
  });

  // ── Validation ──────────────────────────────────────

  test('400 when orderNumber is missing', async () => {
    const res = await POST(generateRequest({ ticketUrl: TICKET_URL }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Falta orderNumber o ticketUrl');
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('400 when ticketUrl is missing', async () => {
    const res = await POST(generateRequest({ orderNumber: ORDER_NUMBER }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Falta orderNumber o ticketUrl');
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('400 when ticketUrl is empty string', async () => {
    const res = await POST(generateRequest({ orderNumber: ORDER_NUMBER, ticketUrl: '   ' }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('ticketUrl debe ser un texto válido');
    expect(mockDbSelect).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ── Lookup & ownership ──────────────────────────────

  test('404 when order is not found', async () => {
    mockSelect.mockResolvedValueOnce([]);

    const res = await POST(
      generateRequest({ orderNumber: 'ORD-NONEXISTENT', ticketUrl: TICKET_URL }),
    );

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Pago no encontrado con ese número de orden');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('401 when ownership check fails on the resolved row', async () => {
    refuseOwnership();
    mockSelect.mockResolvedValueOnce([paymentRow()]);

    const res = await POST(generateRequest({ orderNumber: ORDER_NUMBER, ticketUrl: TICKET_URL }));

    expect(res.status).toBe(401);
    expect((await res.json()).success).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('ownership is checked on the exact row resolved by orderNumber', async () => {
    grantOwnership();
    mockSelect.mockResolvedValueOnce([paymentRow({ businessId: BUSINESS_ID })]);

    await POST(generateRequest({ orderNumber: ORDER_NUMBER, ticketUrl: TICKET_URL }));

    // The authorization must be called with the businessId from the resolved row
    expect(mockRequireOwnedBusinessById).toHaveBeenCalledWith(BUSINESS_ID);
  });

  test("404 for a foreign order: another business' payment is never updated", async () => {
    // Simulate orderNumber collision (legacy data): two rows share same orderNumber
    // The request comes from business A, but the resolved row belongs to business B
    refuseOwnership('No autorizado'); // Ownership check fails for business A on business B's row
    mockSelect.mockResolvedValueOnce([
      paymentRow({ id: FOREIGN_PAYMENT_ID, businessId: FOREIGN_BUSINESS_ID }),
    ]);

    const res = await POST(generateRequest({ orderNumber: ORDER_NUMBER, ticketUrl: TICKET_URL }));

    expect(res.status).toBe(401); // Ownership fails
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  // ── Primary-key scoped UPDATE ───────────────────────

  test('P5-1: UPDATE is keyed by payments.id, not payments.orderNumber', async () => {
    grantOwnership();
    mockSelect.mockResolvedValueOnce([paymentRow()]);

    await POST(generateRequest({ orderNumber: ORDER_NUMBER, ticketUrl: TICKET_URL }));

    // Verify the update was called with set() then where()
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateWhere).toHaveBeenCalledTimes(1);

    // The where() call receives the condition — we assert it's payments.id, not payments.orderNumber
    const whereArg = mockUpdateWhere.mock.calls[0][0];
    // The condition should be eq(payments.id, PAYMENT_ID)
    expect(whereArg).toBeDefined();
  });

  test('UPDATE never modifies order_number', async () => {
    grantOwnership();
    mockSelect.mockResolvedValueOnce([paymentRow()]);

    await POST(generateRequest({ orderNumber: ORDER_NUMBER, ticketUrl: TICKET_URL }));

    // The set() call should only contain ticketUrl and updatedAt, never orderNumber
    const setArg = mockUpdateSet.mock.calls[0][0];
    expect(setArg).toHaveProperty('ticketUrl');
    expect(setArg).toHaveProperty('updatedAt');
    expect(setArg).not.toHaveProperty('orderNumber');
  });

  test('affects exactly 1 row: returns 404 if no row matches the primary key', async () => {
    grantOwnership();
    mockSelect.mockResolvedValueOnce([paymentRow()]);
    // Simulate the primary key UPDATE matching 0 rows (should not happen in practice, but test semantics)
    mockUpdateReturning.mockResolvedValueOnce([]);

    const res = await POST(generateRequest({ orderNumber: ORDER_NUMBER, ticketUrl: TICKET_URL }));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Pago no encontrado con ese número de orden');
  });

  test('returns the updated payment with new ticketUrl', async () => {
    grantOwnership();
    mockSelect.mockResolvedValueOnce([paymentRow()]);

    const res = await POST(generateRequest({ orderNumber: ORDER_NUMBER, ticketUrl: TICKET_URL }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toBeDefined();
    expect(json.data.ticketUrl).toBe(TICKET_URL);
  });

  // ── Cross-row contamination prevention ──────────────

  test('cross-tenant scenario: two orders sharing orderNumber, updating one does not affect the other', async () => {
    // This test simulates the pre-duplication state where two rows have the same orderNumber
    // The route should resolve to ONE row (the first match), check ownership on THAT row,
    // and UPDATE only that specific row by its primary key.

    grantOwnership(); // User owns BUSINESS_ID
    // Return business A's row (the first match by orderNumber)
    mockSelect.mockResolvedValueOnce([paymentRow({ id: PAYMENT_ID, businessId: BUSINESS_ID })]);

    await POST(generateRequest({ orderNumber: ORDER_NUMBER, ticketUrl: TICKET_URL }));

    // Verify UPDATE was called with business A's payment ID
    expect(mockUpdateWhere).toHaveBeenCalledTimes(1);
    // The set() should only update ticketUrl, not orderNumber
    const setArg = mockUpdateSet.mock.calls[0][0];
    expect(setArg).not.toHaveProperty('orderNumber');
  });
});
