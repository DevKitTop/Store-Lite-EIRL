import { beforeEach, describe, expect, test, vi } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('paymentApi', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
  });

  describe('chargePayment', () => {
    test('sends POST to /api/payment/charge with correct payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, payment: { id: 'pay_123' } }),
      });

      const { chargePayment } = await import('@/shared/payments/paymentApi');

      const result = await chargePayment({
        culqiOrderId: 'ord_123',
        amount: 5000,
        currency: 'PEN',
        email: 'buyer@test.com',
        customerName: 'Juan Perez',
        businessId: '550e8400-e29b-41d4-a716-446655440000',
        productId: '660e8400-e29b-41d4-a716-446655440001',
        metadata: { orderNumber: 'ORD-ABC', cartItems: [] },
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/payment/charge',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Idempotency-Key': expect.any(String),
          }),
          body: expect.any(String),
        }),
      );

      // Verify body payload shape
      const bodyArg = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(bodyArg).toMatchObject({
        culqiOrderId: 'ord_123',
        amount: 5000,
        currency: 'PEN',
        customerName: 'Juan Perez',
      });

      expect(result).toEqual({ success: true, payment: { id: 'pay_123' } });
    });

    test('sends POST with token payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, charge: { id: 'ch_123', status: 'paid' } }),
      });

      const { chargePayment } = await import('@/shared/payments/paymentApi');

      const result = await chargePayment({
        token: 'tok_abc',
        amount: 5000,
        currency: 'PEN',
        email: 'buyer@test.com',
        businessId: '550e8400-e29b-41d4-a716-446655440000',
        productId: '660e8400-e29b-41d4-a716-446655440001',
      });

      const bodyArg = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(bodyArg).toMatchObject({
        token: 'tok_abc',
        amount: 5000,
      });
      expect(result.charge?.id).toBe('ch_123');
    });

    test('throws error with extracted message on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Pago rechazado', details: 'Saldo insuficiente' }),
      });

      const { chargePayment } = await import('@/shared/payments/paymentApi');

      await expect(
        chargePayment({
          token: 'tok_abc',
          amount: 5000,
          currency: 'PEN',
          email: 'buyer@test.com',
          businessId: '550e8400-e29b-41d4-a716-446655440000',
          productId: '660e8400-e29b-41d4-a716-446655440001',
        }),
      ).rejects.toThrow('Saldo insuficiente');
    });

    test('throws generic error when no details provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      });

      const { chargePayment } = await import('@/shared/payments/paymentApi');

      await expect(
        chargePayment({
          token: 'tok_abc',
          amount: 5000,
          currency: 'PEN',
          email: 'buyer@test.com',
          businessId: '550e8400-e29b-41d4-a716-446655440000',
          productId: '660e8400-e29b-41d4-a716-446655440001',
        }),
      ).rejects.toThrow('Error al procesar el pago');
    });
  });

  describe('createOrder', () => {
    test('sends POST to /api/payment/create-order with correct payload', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            culqiOrderId: 'ord_456',
            paymentCode: 'cip_789',
            expirationDate: '2026-06-20T10:00:00.000Z',
          }),
      });

      const { createOrder } = await import('@/shared/payments/paymentApi');

      const result = await createOrder({
        amount: 5000,
        email: 'buyer@test.com',
        customerName: 'Juan Perez',
        phone: '999888777',
        businessId: '550e8400-e29b-41d4-a716-446655440000',
        productId: '660e8400-e29b-41d4-a716-446655440001',
        description: 'Compra - 3 productos',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/payment/create-order',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
          body: expect.any(String),
        }),
      );

      const bodyArg = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(bodyArg).toMatchObject({
        amount: 5000,
        email: 'buyer@test.com',
        customerName: 'Juan Perez',
        phone: '999888777',
        productId: '660e8400-e29b-41d4-a716-446655440001',
        businessId: '550e8400-e29b-41d4-a716-446655440000',
        description: 'Compra - 3 productos',
      });

      expect(result).toMatchObject({
        success: true,
        culqiOrderId: 'ord_456',
        paymentCode: 'cip_789',
      });
    });

    test('throws error on failed response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Error en Culqi', details: 'Saldo insuficiente' }),
      });

      const { createOrder } = await import('@/shared/payments/paymentApi');

      await expect(
        createOrder({
          amount: 5000,
          email: 'buyer@test.com',
          businessId: '550e8400-e29b-41d4-a716-446655440000',
        }),
      ).rejects.toThrow('Saldo insuficiente');
    });

    // =====================================================
    // cartItems snapshot forwarding (R1/A1, slice 2)
    // =====================================================

    test('forwards cartItems to the create-order endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, culqiOrderId: 'ord_789' }),
      });

      const { createOrder } = await import('@/shared/payments/paymentApi');

      const cartItems = [
        { id: '660e8400-e29b-41d4-a716-446655440001', quantity: 2 },
        { id: '770e8400-e29b-41d4-a716-446655440002', quantity: 1 },
      ];

      await createOrder({
        amount: 13000,
        email: 'buyer@test.com',
        businessId: '550e8400-e29b-41d4-a716-446655440000',
        cartItems,
      });

      const bodyArg = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(bodyArg.cartItems).toEqual(cartItems);
    });

    test('omits cartItems from the body when not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, culqiOrderId: 'ord_790' }),
      });

      const { createOrder } = await import('@/shared/payments/paymentApi');

      await createOrder({
        amount: 5000,
        email: 'buyer@test.com',
        businessId: '550e8400-e29b-41d4-a716-446655440000',
      });

      const bodyArg = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(bodyArg).not.toHaveProperty('cartItems');
    });
  });
});
