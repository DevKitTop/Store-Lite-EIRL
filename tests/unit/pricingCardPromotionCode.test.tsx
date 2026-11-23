import { PricingCard } from '@/app/pricing/components/PricingCard';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

const purchaseMock = vi.hoisted(() => vi.fn());

vi.mock('@/features/billing/hooks/usePurchasePlan', () => ({
  usePurchasePlan: () => ({
    purchase: purchaseMock,
    loading: false,
    error: null,
    result: null,
    capturingData: null,
    ticketRef: { current: null },
    reset: vi.fn(),
  }),
}));

vi.mock('@/features/billing/components/CulqiCheckout', () => ({
  CulqiCheckout: ({ onTokenSuccess }: { onTokenSuccess: (token: string) => void }) => (
    <button onClick={() => onTokenSuccess('tok_test')}>Culqi token</button>
  ),
}));

vi.mock('@/features/billing/components/PlanTicketTemplate', () => ({
  PlanTicketTemplate: () => null,
}));

vi.mock('@/lib/meta/events', () => ({
  trackInitiateCheckout: vi.fn(),
  trackPurchase: vi.fn(),
}));

vi.mock('@/lib/meta/eventId', () => ({ generateEventId: () => 'event-1' }));
vi.mock('@/shared/payments/culqiScript', () => ({
  loadCulqiScript: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

describe('PricingCard promotion code', () => {
  test('passes the resolved promotion code to the purchase hook', async () => {
    purchaseMock.mockReset();
    purchaseMock.mockResolvedValue({
      planPaymentId: 'payment-1',
      ticketNumber: 'TICKET-1',
      planActivatedUntil: '2026-12-22T00:00:00.000Z',
      amountTotal: 35.1,
    });

    render(
      <PricingCard
        title="Lite Pago"
        description="Plan con pagos"
        price="35.10"
        period="mes"
        features={[{ text: 'Pagos' }]}
        buttonText="Comprar"
        businesses={[{ id: 'business-1', name: 'Mi tienda' }]}
        preselectedBusinessId="business-1"
        promotionCode="NAVIDAD2026"
      />,
    );

    fireEvent.click(screen.getByText('Culqi token'));

    expect(purchaseMock).toHaveBeenCalledTimes(1);
    expect(purchaseMock.mock.calls[0][0]).toMatchObject({ promotionCode: 'NAVIDAD2026' });
  });
});
