// =====================================================
// useCulqiCallback — Hook-level tests
// =====================================================
// Strict TDD: tests written BEFORE implementation.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// ── Mocks (must be before imports) ───────────────────

const mockChargePayment = vi.fn();
vi.mock('@/shared/payments/paymentApi', () => ({
  chargePayment: mockChargePayment,
}));

const mockPosthogCapture = vi.fn();
vi.mock('posthog-js', () => ({
  posthog: { capture: mockPosthogCapture },
}));

// ── Helpers ──────────────────────────────────────────

function createMockCartItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    name: 'Camiseta Algodón',
    category: 'Ropa',
    stock: 10,
    price: '150',
    currency: 'PEN',
    status: 'Active',
    image: '/img/test.jpg',
    quantity: 2,
    ...overrides,
  };
}

function createDefaultOptions(overrides: Record<string, unknown> = {}) {
  const paymentGuardRef = { current: false };
  const culqiCallbackGuardRef = { current: false };
  const onOrderPaid = vi.fn();
  const onPaymentInstructions = vi.fn();
  const onError = vi.fn();
  const onCulqiProcessingChange = vi.fn();
  const onPaymentProcessingChange = vi.fn();

  return {
    culqiReady: true,
    finalTotal: 500,
    businessId: 'test-business-uuid',
    cartItems: [createMockCartItem()] as [
      typeof createMockCartItem extends (...args: unknown[]) => infer R ? R : never,
    ],
    email: 'test@example.com',
    customerName: 'Juan Perez',
    shippingInfo: {
      courier: 'recojo',
      department: '',
      province: '',
      district: '',
      phone: '999888777',
      dni: '12345678',
      cost: 0,
    },
    slug: 'test-slug',
    customerAuth: null,
    onCulqiProcessingChange,
    onPaymentProcessingChange,
    paymentGuardRef,
    culqiCallbackGuardRef,
    onOrderPaid,
    onPaymentInstructions,
    onError,
    ...overrides,
  };
}

// ── Suite ────────────────────────────────────────────

describe('useCulqiCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Clean up globals
    delete (window as any).Culqi;
    delete (window as any).culqi;
  });

  afterEach(() => {
    delete (window as any).Culqi;
    delete (window as any).culqi;
  });

  test('registers window.culqi when culqiReady is true', async () => {
    const { useCulqiCallback } = await import('@/features/payment/hooks/useCulqiCallback');
    const options = createDefaultOptions();

    renderHook(() => useCulqiCallback(options));

    expect(window.culqi).toBeDefined();
    expect(typeof window.culqi).toBe('function');
  });

  test('does NOT register window.culqi when culqiReady is false', async () => {
    const { useCulqiCallback } = await import('@/features/payment/hooks/useCulqiCallback');

    renderHook(() => useCulqiCallback(createDefaultOptions({ culqiReady: false })));

    expect(window.culqi).toBeUndefined();
  });

  test('token flow calls onOrderPaid on successful charge', async () => {
    mockChargePayment.mockResolvedValue({
      success: true,
      charge: { id: 'ch_123', status: 'paid' },
      payment: { trackingToken: 'tt_abc', orderNumber: 'ORD-TEST12345678' },
    });

    const { useCulqiCallback } = await import('@/features/payment/hooks/useCulqiCallback');
    const options = createDefaultOptions();
    renderHook(() => useCulqiCallback(options));

    // Simulate Culqi token callback
    (window as any).Culqi = {
      token: { id: 'tok_test_abc', type: 'card' },
      close: vi.fn(),
    };

    expect(window.culqi).toBeDefined();
    await act(async () => {
      await (window.culqi as () => Promise<void>)();
    });

    expect(mockChargePayment).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'tok_test_abc', customerName: 'Juan Perez' }),
    );
    await waitFor(() => {
      expect(options.onOrderPaid).toHaveBeenCalledWith(
        expect.objectContaining({ paymentMethod: 'Tarjeta' }),
      );
    });
    expect(options.paymentGuardRef.current).toBe(false);
  });

  test('token flow calls onError when chargePayment fails', async () => {
    mockChargePayment.mockRejectedValue(new Error('Payment declined'));

    const { useCulqiCallback } = await import('@/features/payment/hooks/useCulqiCallback');
    const options = createDefaultOptions();
    renderHook(() => useCulqiCallback(options));

    (window as any).Culqi = {
      token: { id: 'tok_test_abc', type: 'card' },
      close: vi.fn(),
    };

    await act(async () => {
      await (window.culqi as () => Promise<void>)();
    });

    await waitFor(() => {
      expect(options.onError).toHaveBeenCalledWith('Payment declined');
    });
  });

  test('order flow with async payment calls onPaymentInstructions', async () => {
    const { useCulqiCallback } = await import('@/features/payment/hooks/useCulqiCallback');
    const options = createDefaultOptions();
    renderHook(() => useCulqiCallback(options));

    (window as any).Culqi = {
      order: {
        id: 'ord_culqi_abc',
        payment_method: 'pago_efectivo',
        cip_code: '1234567890',
        action: {},
        expiration_date: Math.floor(Date.now() / 1000) + 86400,
      },
      close: vi.fn(),
    };

    await act(async () => {
      await (window.culqi as () => Promise<void>)();
    });

    await waitFor(() => {
      expect(options.onPaymentInstructions).toHaveBeenCalledWith(
        expect.objectContaining({
          culqiOrderId: 'ord_culqi_abc',
          paymentMethod: 'pago_efectivo',
          paymentCode: '1234567890',
        }),
      );
    });
  });

  test('cleanup resets window.culqi on unmount', async () => {
    const { useCulqiCallback } = await import('@/features/payment/hooks/useCulqiCallback');
    const options = createDefaultOptions();

    const { unmount } = renderHook(() => useCulqiCallback(options));

    expect(window.culqi).toBeDefined();

    unmount();

    expect(window.culqi).toBeUndefined();
  });

  test('guard ref prevents re-entry when culqiCallbackGuardRef is true', async () => {
    const { useCulqiCallback } = await import('@/features/payment/hooks/useCulqiCallback');
    const options = createDefaultOptions();
    options.culqiCallbackGuardRef.current = true; // Guard already locked

    renderHook(() => useCulqiCallback(options));

    (window as any).Culqi = {
      token: { id: 'tok_test_abc', type: 'card' },
      close: vi.fn(),
    };

    await act(async () => {
      await (window.culqi as () => Promise<void>)();
    });

    // chargePayment should NOT be called because guard prevented it
    expect(mockChargePayment).not.toHaveBeenCalled();
  });

  test('order flow paid calls onOrderPaid with charge', async () => {
    mockChargePayment.mockResolvedValue({
      success: true,
      charge: { id: 'ch_456', status: 'paid' },
      payment: { trackingToken: 'tt_def', orderNumber: 'ORD-TEST12345678' },
    });

    const { useCulqiCallback } = await import('@/features/payment/hooks/useCulqiCallback');
    const options = createDefaultOptions();
    renderHook(() => useCulqiCallback(options));

    (window as any).Culqi = {
      order: {
        id: 'ord_culqi_paid',
        status: 'paid',
        amount: 50000,
      },
      close: vi.fn(),
    };

    await act(async () => {
      await (window.culqi as () => Promise<void>)();
    });

    await waitFor(() => {
      expect(mockChargePayment).toHaveBeenCalledWith(
        expect.objectContaining({ culqiOrderId: 'ord_culqi_paid', customerName: 'Juan Perez' }),
      );
    });
    await waitFor(() => {
      expect(options.onOrderPaid).toHaveBeenCalled();
    });
  });

  test('analytics capture is called on successful token payment', async () => {
    mockChargePayment.mockResolvedValue({
      success: true,
      charge: { id: 'ch_789', status: 'paid' },
      payment: { trackingToken: 'tt_ghi', orderNumber: 'ORD-TEST12345678' },
    });

    const { useCulqiCallback } = await import('@/features/payment/hooks/useCulqiCallback');
    const options = createDefaultOptions();
    renderHook(() => useCulqiCallback(options));

    (window as any).Culqi = {
      token: { id: 'tok_yape_1', type: 'yape' },
      close: vi.fn(),
    };

    await act(async () => {
      await (window.culqi as () => Promise<void>)();
    });

    await waitFor(() => {
      expect(mockPosthogCapture).toHaveBeenCalledWith(
        'order_created',
        expect.objectContaining({ businessSlug: 'test-slug' }),
      );
      expect(mockPosthogCapture).toHaveBeenCalledWith(
        'payment_completed',
        expect.objectContaining({ method: 'Yape' }),
      );
    });
  });

  // ============================================================
  // W-P4: Client drops local generation, consumes server orderNumber
  // ============================================================

  describe('order number integrity (W-P4)', () => {
    beforeEach(() => {
      vi.clearAllMocks();

      delete (window as any).Culqi;
      delete (window as any).culqi;
    });

    afterEach(() => {
      delete (window as any).Culqi;
      delete (window as any).culqi;
    });

    test('P4-1/P4-8: token flow does NOT send metadata.orderNumber; onOrderPaid receives server-generated orderNumber', async () => {
      // This test will FAIL until useCulqiCallback:
      // 1. Removes local orderNumber generation
      // 2. Does NOT include orderNumber in metadata sent to chargePayment
      // 3. Reads paymentResult.payment.orderNumber from server response
      // 4. Passes server orderNumber to onOrderPaid and analytics

      const serverOrderNumber = 'ORD-3F9A2B1C4D5E';
      mockChargePayment.mockResolvedValue({
        success: true,
        charge: { id: 'ch_123', status: 'paid' },
        payment: { trackingToken: 'tt_abc', orderNumber: serverOrderNumber },
      });

      const { useCulqiCallback } = await import('@/features/payment/hooks/useCulqiCallback');
      const options = createDefaultOptions();
      renderHook(() => useCulqiCallback(options));

      (window as any).Culqi = {
        token: { id: 'tok_test_abc', type: 'card' },
        close: vi.fn(),
      };

      await act(async () => {
        await (window.culqi as () => Promise<void>)();
      });

      // Verify chargePayment was called
      await waitFor(() => {
        expect(mockChargePayment).toHaveBeenCalled();
      });

      // Verify NO orderNumber in the metadata sent to chargePayment
      const chargeCall = mockChargePayment.mock.calls[0][0] as Record<string, unknown>;
      expect(chargeCall.metadata).not.toHaveProperty('orderNumber');

      // Verify onOrderPaid received the SERVER-generated orderNumber
      await waitFor(() => {
        expect(options.onOrderPaid).toHaveBeenCalledWith(
          expect.objectContaining({
            orderNumber: serverOrderNumber,
            paymentMethod: 'Tarjeta',
          }),
        );
      });

      // Verify analytics uses server orderNumber
      await waitFor(() => {
        expect(mockPosthogCapture).toHaveBeenCalledWith(
          'order_created',
          expect.objectContaining({ orderId: serverOrderNumber }),
        );
        expect(mockPosthogCapture).toHaveBeenCalledWith(
          'payment_completed',
          expect.objectContaining({ paymentId: 'ch_123' }),
        );
      });
    });

    test('P4-1/P4-8: order flow (paid) does NOT send metadata.orderNumber; onOrderPaid receives server orderNumber', async () => {
      const serverOrderNumber = 'ORD-A1B2C3D4E5F6';
      mockChargePayment.mockResolvedValue({
        success: true,
        charge: { id: 'ch_456', status: 'paid' },
        payment: { trackingToken: 'tt_def', orderNumber: serverOrderNumber },
      });

      const { useCulqiCallback } = await import('@/features/payment/hooks/useCulqiCallback');
      const options = createDefaultOptions();
      renderHook(() => useCulqiCallback(options));

      (window as any).Culqi = {
        order: {
          id: 'ord_culqi_paid',
          status: 'paid',
          amount: 50000,
        },
        close: vi.fn(),
      };

      await act(async () => {
        await (window.culqi as () => Promise<void>)();
      });

      // Verify chargePayment was called
      await waitFor(() => {
        expect(mockChargePayment).toHaveBeenCalled();
      });

      // Verify NO orderNumber in the metadata sent to chargePayment
      const chargeCall = mockChargePayment.mock.calls[0][0] as Record<string, unknown>;
      expect(chargeCall.metadata).not.toHaveProperty('orderNumber');

      // Verify onOrderPaid received the SERVER-generated orderNumber
      await waitFor(() => {
        expect(options.onOrderPaid).toHaveBeenCalledWith(
          expect.objectContaining({
            orderNumber: serverOrderNumber,
            paymentMethod: 'Tarjeta',
          }),
        );
      });

      // Verify analytics uses server orderNumber
      await waitFor(() => {
        expect(mockPosthogCapture).toHaveBeenCalledWith(
          'order_created',
          expect.objectContaining({ orderId: serverOrderNumber }),
        );
        expect(mockPosthogCapture).toHaveBeenCalledWith(
          'payment_completed',
          expect.objectContaining({ paymentId: 'ord_culqi_paid' }),
        );
      });
    });
  });
});
