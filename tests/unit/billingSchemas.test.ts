// =====================================================
// Billing schemas — two-word customerName refine (R3)
// =====================================================

import {
  cartItemsSchema,
  chargeRequestSchema,
  createOrderRequestSchema,
} from '@/features/billing/schemas';
import { BUYER_NAME_ERROR_MESSAGE } from '@/shared/payments/buyerName';
import { describe, expect, test } from 'vitest';

const validChargePayload = {
  token: 'tok_test_abc123',
  amount: 150000,
  email: 'buyer@test.com',
  businessId: '550e8400-e29b-41d4-a716-446655440000',
  productId: '660e8400-e29b-41d4-a716-446655440001',
};

const validCreateOrderPayload = {
  amount: 5000,
  email: 'buyer@test.com',
  businessId: '550e8400-e29b-41d4-a716-446655440000',
};

describe('chargeRequestSchema — customerName refine', () => {
  test('accepts a two-word customerName', () => {
    const result = chargeRequestSchema.safeParse({
      ...validChargePayload,
      customerName: 'Juan Carlos Perez Gomez',
    });
    expect(result.success).toBe(true);
  });

  test('accepts a two-word customerName with accents', () => {
    const result = chargeRequestSchema.safeParse({
      ...validChargePayload,
      customerName: 'Ernesto Pérez',
    });
    expect(result.success).toBe(true);
  });

  test('rejects a single-token customerName with BUYER_NAME_ERROR_MESSAGE at path customerName', () => {
    const result = chargeRequestSchema.safeParse({
      ...validChargePayload,
      customerName: 'Ernesto',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'customerName');
      expect(issue).toBeDefined();
      expect(issue?.message).toBe(BUYER_NAME_ERROR_MESSAGE);
    }
  });

  test('rejects a customerName with disallowed characters', () => {
    const result = chargeRequestSchema.safeParse({
      ...validChargePayload,
      customerName: 'Juan1 Perez',
    });
    expect(result.success).toBe(false);
  });

  test('accepts an absent customerName', () => {
    const result = chargeRequestSchema.safeParse(validChargePayload);
    expect(result.success).toBe(true);
  });
});

describe('createOrderRequestSchema — customerName refine', () => {
  test('accepts a two-word customerName', () => {
    const result = createOrderRequestSchema.safeParse({
      ...validCreateOrderPayload,
      customerName: 'Juan Perez',
    });
    expect(result.success).toBe(true);
  });

  test('rejects a single-token customerName with BUYER_NAME_ERROR_MESSAGE at path customerName', () => {
    const result = createOrderRequestSchema.safeParse({
      ...validCreateOrderPayload,
      customerName: 'Ernesto',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'customerName');
      expect(issue).toBeDefined();
      expect(issue?.message).toBe(BUYER_NAME_ERROR_MESSAGE);
    }
  });

  test('rejects a customerName with disallowed characters', () => {
    const result = createOrderRequestSchema.safeParse({
      ...validCreateOrderPayload,
      customerName: 'Juan@Perez',
    });
    expect(result.success).toBe(false);
  });

  test('accepts an absent customerName', () => {
    const result = createOrderRequestSchema.safeParse(validCreateOrderPayload);
    expect(result.success).toBe(true);
  });
});

// =====================================================
// Shared cart line contract (R1, slice 2)
// =====================================================

const P1 = '660e8400-e29b-41d4-a716-446655440001';

describe('cartItemsSchema — shared cart line contract', () => {
  test('accepts a line and defaults a missing quantity to 1', () => {
    const result = cartItemsSchema.safeParse([{ id: P1 }]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([{ id: P1, quantity: 1 }]);
    }
  });

  test('rejects quantity 0 and non-integer quantities', () => {
    expect(cartItemsSchema.safeParse([{ id: P1, quantity: 0 }]).success).toBe(false);
    expect(cartItemsSchema.safeParse([{ id: P1, quantity: 1.5 }]).success).toBe(false);
  });
});

describe('chargeRequestSchema — metadata.cartItems via the shared schema', () => {
  function withCart(cartItems: unknown) {
    return { ...validChargePayload, metadata: { cartItems } };
  }

  test('rejects a quantity-0 line (existing tamper guard preserved)', () => {
    expect(chargeRequestSchema.safeParse(withCart([{ id: P1, quantity: 0 }])).success).toBe(false);
  });

  test('defaults a missing line quantity to 1 through the shared schema', () => {
    const result = chargeRequestSchema.safeParse(withCart([{ id: P1 }]));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.metadata?.cartItems).toEqual([{ id: P1, quantity: 1 }]);
    }
  });
});
