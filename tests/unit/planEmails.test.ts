// =====================================================
// src/lib/email/planEmails — Unit tests
// =====================================================
// Verifies that sendPlanPurchaseConfirmationEmail:
//  - sends the purchase confirmation email with the right
//    recipient, subject and rendered ticket data
//  - skips sending when buyer email or business is missing
// =====================================================

import { beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────
// Must be before module imports (vi.mock is hoisted)

const { mockBusinessFindFirst, mockSendEmail, mockGetSignedTicketUrl } = vi.hoisted(() => ({
  mockBusinessFindFirst: vi.fn(),
  mockSendEmail: vi.fn(),
  mockGetSignedTicketUrl: vi.fn(),
}));

vi.mock('@/core/database/client', () => ({
  db: {
    query: {
      businesses: { findFirst: mockBusinessFindFirst },
    },
  },
}));

vi.mock('@/lib/email/resend', () => ({
  sendEmail: mockSendEmail,
}));

// The receipt lives in a private bucket, so the link inside the email has to be
// signed at send time; the raw stored value would answer 400 from Storage.
vi.mock('@/lib/storage/signedTicket', () => ({
  getSignedTicketUrl: mockGetSignedTicketUrl,
}));

import { sendPlanPurchaseConfirmationEmail } from '@/lib/email/planEmails';

// ── Shared helpers ───────────────────────────────────

function makePlanPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan_pay_123',
    businessId: 'biz_123',
    buyerEmail: 'buyer@example.com',
    buyerFullName: 'ACME SAC',
    buyerDocumentType: 'RUC',
    buyerDocumentNumber: '20123456789',
    planType: 'lite_plus',
    amountTotal: '79.00',
    ticketSeries: 'B001',
    ticketCorrelative: 42,
    ticketUrl: 'https://proj.supabase.co/storage/v1/object/public/tickets/boleta.png',
    planEndDate: new Date('2026-09-16T23:59:59Z'),
    ...overrides,
  };
}

// ── Suite ────────────────────────────────────────────

const STORED_TICKET_URL = 'https://proj.supabase.co/storage/v1/object/public/tickets/boleta.png';
const PLAN_TICKET_URL =
  'https://proj.supabase.co/storage/v1/object/public/tickets_plans/boleta.png';
const FOREIGN_BUCKET_TICKET_URL =
  'https://proj.supabase.co/storage/v1/object/public/products/pic.jpg';
const SIGNED_TICKET_URL =
  'https://cdn.example.test/storage/v1/object/sign/tickets/boleta.png?token=abc';

describe('sendPlanPurchaseConfirmationEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSignedTicketUrl.mockResolvedValue(SIGNED_TICKET_URL);
    mockBusinessFindFirst.mockResolvedValue({ slug: 'mi-tienda', name: 'Mi Tienda' });
  });

  test('sends the confirmation email to the buyer with a boleta subject', async () => {
    await sendPlanPurchaseConfirmationEmail(makePlanPayment(), 'biz_123');

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    const params = mockSendEmail.mock.calls[0][0];
    expect(params.to).toBe('buyer@example.com');
    expect(params.subject).toContain('boleta');
    expect(params.subject).toContain('Store Lite');
  });

  test('renders ticket number, formatted amount and plan name in the html', async () => {
    await sendPlanPurchaseConfirmationEmail(makePlanPayment(), 'biz_123');

    const html = mockSendEmail.mock.calls[0][0].html;
    expect(html).toContain('B001-00000042');
    expect(html).toContain('S/ 79.00');
    expect(html).toContain('Lite Plus');
  });

  test('links the receipt through a signed URL, never the stored public one', async () => {
    await sendPlanPurchaseConfirmationEmail(makePlanPayment(), 'biz_123');

    const html = mockSendEmail.mock.calls[0][0].html;
    expect(mockGetSignedTicketUrl).toHaveBeenCalledWith(STORED_TICKET_URL);
    expect(html).toContain(SIGNED_TICKET_URL);
    expect(html).not.toContain(STORED_TICKET_URL);
  });

  test('signs a receipt stored in the private plan bucket', async () => {
    await sendPlanPurchaseConfirmationEmail(
      makePlanPayment({ ticketUrl: PLAN_TICKET_URL }),
      'biz_123',
    );

    const html = mockSendEmail.mock.calls[0][0].html;
    expect(mockGetSignedTicketUrl).toHaveBeenCalledWith(PLAN_TICKET_URL);
    expect(html).toContain(SIGNED_TICKET_URL);
  });

  test('links a receipt from a bucket we cannot sign as stored, without signing it', async () => {
    await sendPlanPurchaseConfirmationEmail(
      makePlanPayment({ ticketUrl: FOREIGN_BUCKET_TICKET_URL }),
      'biz_123',
    );

    const html = mockSendEmail.mock.calls[0][0].html;
    expect(mockGetSignedTicketUrl).not.toHaveBeenCalled();
    expect(html).toContain(FOREIGN_BUCKET_TICKET_URL);
  });

  test('renders the plan end date line prominently', async () => {
    await sendPlanPurchaseConfirmationEmail(makePlanPayment(), 'biz_123');

    const html = mockSendEmail.mock.calls[0][0].html;
    expect(html).toMatch(/plan está activo hasta el/);
  });

  test('formats ticket number padding for different correlatives', async () => {
    await sendPlanPurchaseConfirmationEmail(makePlanPayment({ ticketCorrelative: 7 }), 'biz_123');

    const html = mockSendEmail.mock.calls[0][0].html;
    expect(html).toContain('B001-00000007');
  });

  test('skips sending when buyer email is missing', async () => {
    await sendPlanPurchaseConfirmationEmail(makePlanPayment({ buyerEmail: null }), 'biz_123');

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  test('skips sending when business is not found', async () => {
    mockBusinessFindFirst.mockResolvedValue(null);

    await sendPlanPurchaseConfirmationEmail(makePlanPayment(), 'biz_123');

    expect(mockSendEmail).not.toHaveBeenCalled();
  });
});
