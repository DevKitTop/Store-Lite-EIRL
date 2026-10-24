// =====================================================
// buildWebhookPaymentValues — W-P3.1
// =====================================================
// When a `charge.paid` / `charge.failed` webhook arrives before the charge
// route has inserted the payment row, the webhook must be able to CREATE the
// row instead of silently no-op'ing an UPDATE. This pure builder maps a Culqi
// charge webhook payload into a `payments` insert. It returns `null` whenever
// it cannot build a complete, valid row — the caller then falls back to
// update-only.

import {
  buildWebhookPaymentValues,
  type BuildWebhookPaymentValuesInput,
} from '@/core/payments/webhookPaymentValues';
import { describe, expect, test } from 'vitest';

function baseInput(
  overrides: Partial<BuildWebhookPaymentValuesInput> = {},
): BuildWebhookPaymentValuesInput {
  return {
    chargeId: 'chr_abc123',
    sellerUserId: '770e8400-e29b-41d4-a716-446655440002',
    trackingToken: 'tt_fixed_token',
    orderNumber: 'ORD-FIXED1234',
    data: {
      id: 'chr_abc123',
      amount: 150000,
      currency_code: 'PEN',
      email: 'buyer@test.com',
      reference_code: 'ref_xyz',
      metadata: {
        businessId: '550e8400-e29b-41d4-a716-446655440000',
        productId: '660e8400-e29b-41d4-a716-446655440001',
        platform: 'store-lite',
      },
    },
    ...overrides,
  };
}

describe('buildWebhookPaymentValues', () => {
  test('maps a complete charge payload into a payments insert row', () => {
    const values = buildWebhookPaymentValues(baseInput());

    expect(values).toEqual({
      businessId: '550e8400-e29b-41d4-a716-446655440000',
      productId: '660e8400-e29b-41d4-a716-446655440001',
      sellerUserId: '770e8400-e29b-41d4-a716-446655440002',
      amount: '1500',
      currency: 'PEN',
      paymentMethod: 'card',
      culqiChargeId: 'chr_abc123',
      // A token-backed sale carries no order id. The column is still written
      // explicitly as NULL so the two id kinds can never be confused (D13).
      culqiOrderId: null,
      culqiReferenceCode: 'ref_xyz',
      buyerEmail: 'buyer@test.com',
      orderNumber: 'ORD-FIXED1234',
      trackingToken: 'tt_fixed_token',
    });
  });

  test('carries the ORDER id only for an order-backed sale (D13)', () => {
    expect(
      buildWebhookPaymentValues(baseInput({ culqiOrderId: 'ord_culqi_abc123' }))?.culqiOrderId,
    ).toBe('ord_culqi_abc123');
    // A token-backed sale has no order id: the column stays explicitly NULL so
    // it can never be mistaken for a charge id.
    expect(buildWebhookPaymentValues(baseInput())?.culqiOrderId).toBeNull();
  });

  test('defaults currency to PEN and email to the Culqi placeholder', () => {
    const values = buildWebhookPaymentValues(
      baseInput({
        data: {
          id: 'chr_abc123',
          amount: 100,
          metadata: {
            businessId: '550e8400-e29b-41d4-a716-446655440000',
            productId: '660e8400-e29b-41d4-a716-446655440001',
          },
        },
      }),
    );

    expect(values?.currency).toBe('PEN');
    expect(values?.buyerEmail).toBe('cliente@culqi.com');
    expect(values?.culqiReferenceCode).toBeNull();
  });

  test('returns null when the metadata carries no businessId', () => {
    const values = buildWebhookPaymentValues(
      baseInput({
        data: {
          amount: 150000,
          metadata: { productId: '660e8400-e29b-41d4-a716-446655440001' },
        },
      }),
    );
    expect(values).toBeNull();
  });

  test('returns null when the metadata carries no productId', () => {
    const values = buildWebhookPaymentValues(
      baseInput({
        data: {
          amount: 150000,
          metadata: { businessId: '550e8400-e29b-41d4-a716-446655440000' },
        },
      }),
    );
    expect(values).toBeNull();
  });

  test('returns null when the seller (business owner) cannot be resolved', () => {
    expect(buildWebhookPaymentValues(baseInput({ sellerUserId: null }))).toBeNull();
    expect(buildWebhookPaymentValues(baseInput({ sellerUserId: undefined }))).toBeNull();
    expect(buildWebhookPaymentValues(baseInput({ sellerUserId: '   ' }))).toBeNull();
  });

  test('returns null when the charge id is missing', () => {
    expect(buildWebhookPaymentValues(baseInput({ chargeId: undefined }))).toBeNull();
    expect(buildWebhookPaymentValues(baseInput({ chargeId: '' }))).toBeNull();
  });

  test('returns null when the amount is missing or not a positive number', () => {
    const noAmount = baseInput();
    delete (noAmount.data as { amount?: number }).amount;
    expect(buildWebhookPaymentValues(noAmount)).toBeNull();

    expect(
      buildWebhookPaymentValues(baseInput({ data: { ...baseInput().data, amount: 0 } })),
    ).toBeNull();
    expect(
      buildWebhookPaymentValues(baseInput({ data: { ...baseInput().data, amount: -5 } })),
    ).toBeNull();
    expect(
      buildWebhookPaymentValues(baseInput({ data: { ...baseInput().data, amount: Number.NaN } })),
    ).toBeNull();
  });

  test('tolerates non-object metadata without throwing', () => {
    expect(
      buildWebhookPaymentValues(baseInput({ data: { amount: 100, metadata: 'nope' } })),
    ).toBeNull();
    expect(buildWebhookPaymentValues(baseInput({ data: undefined }))).toBeNull();
  });

  // =====================================================
  // Scalar qty passthrough (R1/A2, slice 2)
  // =====================================================

  describe('metadata.qty passthrough', () => {
    function withQty(qty: unknown) {
      return baseInput({
        data: {
          ...baseInput().data,
          metadata: {
            businessId: '550e8400-e29b-41d4-a716-446655440000',
            productId: '660e8400-e29b-41d4-a716-44665544001',
            platform: 'store-lite',
            qty,
          },
        },
      });
    }

    test('copies a positive integer qty into values.metadata', () => {
      const values = buildWebhookPaymentValues(withQty(3));
      expect(values?.metadata).toEqual({ qty: 3 });
    });

    test('coerces a numeric-string qty to an integer', () => {
      const values = buildWebhookPaymentValues(withQty('3'));
      expect(values?.metadata).toEqual({ qty: 3 });
    });

    test('omits values.metadata when qty is absent', () => {
      const values = buildWebhookPaymentValues(baseInput());
      expect(values).not.toBeNull();
      expect(values).not.toHaveProperty('metadata');
    });

    test.each([0, -1, 2.5, 'abc', null, true])(
      'omits values.metadata when qty is %p (unusable)',
      (bad) => {
        const values = buildWebhookPaymentValues(withQty(bad));
        expect(values).not.toBeNull();
        expect(values).not.toHaveProperty('metadata');
      },
    );
  });
});
