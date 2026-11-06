// =====================================================
// POST /api/billing/update-plan-ticket — plan receipt intake
//
// The browser renders the receipt and posts the PNG. This route is the only
// writer of the private `tickets_plans` bucket: it uploads with the service
// role, stores the canonical object URL, and answers with a short-lived signed
// URL. A caller can no longer name the bucket or hand in an arbitrary URL.
// =====================================================

import { POST } from '@/app/api/billing/update-plan-ticket/route';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  mockGetUser,
  mockRequireOwnedBusinessById,
  mockLimit,
  mockReturning,
  mockStorageFrom,
  mockUpload,
  mockGetPublicUrl,
  mockGetSignedTicketUrl,
  mockSendPlanEmail,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockRequireOwnedBusinessById: vi.fn(),
  mockLimit: vi.fn(),
  mockReturning: vi.fn(),
  mockStorageFrom: vi.fn(),
  mockUpload: vi.fn(),
  mockGetPublicUrl: vi.fn(),
  mockGetSignedTicketUrl: vi.fn(),
  mockSendPlanEmail: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mockGetUser } }),
}));

vi.mock('@/features/storage/actions/authz', () => ({
  requireOwnedBusinessById: mockRequireOwnedBusinessById,
}));

vi.mock('@/lib/storage/signedTicket', () => ({
  getSignedTicketUrl: mockGetSignedTicketUrl,
}));

vi.mock('@/lib/email/planEmails', () => ({
  sendPlanPurchaseConfirmationEmail: mockSendPlanEmail,
}));

vi.mock('@/core/database/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mockLimit }) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: mockReturning }) }) }),
  },
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ storage: { from: mockStorageFrom } })),
}));

vi.mock('@/config/env', () => ({
  env: { supabaseUrl: 'https://proj.supabase.co', supabaseServiceRoleKey: 'service-role' },
}));

const PLAN_PAYMENT_ID = 'pp-1';
const BUSINESS_ID = 'biz-1';
const CANONICAL_URL =
  'https://proj.supabase.co/storage/v1/object/public/tickets_plans/B001-00000001.png';
const SIGNED_URL =
  'https://proj.supabase.co/storage/v1/object/sign/tickets_plans/B001-00000001.png?token=t';

const PLAN_ROW = {
  businessId: BUSINESS_ID,
  status: 'paid' as const,
  ticketSeries: 'B001',
  ticketCorrelative: 1,
};

function receiptRequest(fields: Record<string, string | File> = {}): Request {
  const form = new FormData();
  form.append('planPaymentId', PLAN_PAYMENT_ID);
  form.append(
    'file',
    new File([new Uint8Array([137, 80, 78, 71])], 'ticket.png', { type: 'image/png' }),
  );
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  // The route only consumes `formData()`. A real `Request` cannot carry the
  // jsdom FormData across realms, and multipart parsing is Next's job, not this
  // route's, so the parsed body is what this suite pins.
  return { formData: async () => form } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  mockRequireOwnedBusinessById.mockResolvedValue({ id: BUSINESS_ID });
  mockLimit.mockResolvedValue([PLAN_ROW]);
  mockReturning.mockResolvedValue([{ ...PLAN_ROW, id: PLAN_PAYMENT_ID, ticketUrl: CANONICAL_URL }]);
  mockUpload.mockResolvedValue({ error: null });
  mockGetPublicUrl.mockReturnValue({ data: { publicUrl: CANONICAL_URL } });
  mockStorageFrom.mockReturnValue({
    upload: mockUpload,
    getPublicUrl: mockGetPublicUrl,
  });
  mockGetSignedTicketUrl.mockResolvedValue(SIGNED_URL);
  mockSendPlanEmail.mockResolvedValue(undefined);
});

describe('POST /api/billing/update-plan-ticket', () => {
  test('rejects an anonymous call before touching storage or the row', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(receiptRequest());

    expect(response.status).toBe(401);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockReturning).not.toHaveBeenCalled();
  });

  test('rejects a request without a PNG file', async () => {
    const form = new FormData();
    form.append('planPaymentId', PLAN_PAYMENT_ID);

    const response = await POST(
      new Request('http://localhost/api/billing/update-plan-ticket', {
        method: 'POST',
        body: form,
      }),
    );

    expect(response.status).toBe(400);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('rejects a non-PNG upload', async () => {
    const response = await POST(
      receiptRequest({ file: new File(['pdf'], 'ticket.pdf', { type: 'application/pdf' }) }),
    );

    expect(response.status).toBe(415);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('answers 404 when the plan payment does not exist', async () => {
    mockLimit.mockResolvedValue([]);

    const response = await POST(receiptRequest());

    expect(response.status).toBe(404);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('answers 401 when the caller does not own the business', async () => {
    mockRequireOwnedBusinessById.mockRejectedValue(new Error('No autorizado'));

    const response = await POST(receiptRequest());

    expect(response.status).toBe(401);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('refuses to issue a receipt for a payment that is not paid', async () => {
    mockLimit.mockResolvedValue([{ ...PLAN_ROW, status: 'pending' }]);

    const response = await POST(receiptRequest());

    expect(response.status).toBe(409);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test('uploads to the plan bucket, stores the canonical URL, and returns a signed link', async () => {
    const response = await POST(receiptRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, signedUrl: SIGNED_URL });
    expect(mockStorageFrom).toHaveBeenCalledWith('tickets_plans');
    expect(mockUpload).toHaveBeenCalledWith('B001-00000001.png', expect.any(Uint8Array), {
      contentType: 'image/png',
      upsert: true,
    });
    expect(mockGetSignedTicketUrl).toHaveBeenCalledWith(CANONICAL_URL);
    expect(mockSendPlanEmail).toHaveBeenCalledTimes(1);
  });

  test('ignores a caller-supplied bucket or ticket URL', async () => {
    const response = await POST(
      receiptRequest({
        bucket: 'products',
        ticketUrl: 'https://evil.example.com/fake.png',
      }),
    );

    expect(response.status).toBe(200);
    expect(mockStorageFrom).toHaveBeenCalledWith('tickets_plans');
    expect(mockStorageFrom).not.toHaveBeenCalledWith('products');
    expect(mockGetSignedTicketUrl).toHaveBeenCalledWith(CANONICAL_URL);
  });

  test('answers 500 when the uploaded receipt cannot be signed', async () => {
    mockGetSignedTicketUrl.mockResolvedValue(null);

    const response = await POST(receiptRequest());

    expect(response.status).toBe(500);
  });
});
