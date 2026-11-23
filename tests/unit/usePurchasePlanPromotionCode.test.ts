import { usePurchasePlan } from '@/features/billing/hooks/usePurchasePlan';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('usePurchasePlan promotionCode', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        planPaymentId: 'payment-1',
        ticketNumber: 'TICKET-1',
        planActivatedUntil: '2026-12-22T00:00:00.000Z',
        amountTotal: 35.1,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  test('sends the resolved promotion code to the checkout API', async () => {
    const { result } = renderHook(() => usePurchasePlan());

    await act(async () => {
      await result.current.purchase({
        token: 'tok_test',
        planType: 'lite_pago',
        period: 'monthly',
        businessId: 'business-1',
        buyerEmail: 'owner@example.com',
        buyerFullName: 'Owner',
        buyerDocumentType: 'RUC',
        buyerDocumentNumber: '12345678901',
        promotionCode: 'NAVIDAD2026',
      });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/billing/purchase-plan');
    expect(JSON.parse(init.body)).toMatchObject({ promotionCode: 'NAVIDAD2026' });
  });
});
