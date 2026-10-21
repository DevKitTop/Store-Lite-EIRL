import { describe, expect, test } from 'vitest';

// =====================================================
// CREATE ORDER REQUEST SCHEMA — Unit tests
// =====================================================

describe('createOrderRequestSchema', () => {
  test('accepts valid input with all required fields', async () => {
    const { createOrderRequestSchema } = await import('@/features/billing/schemas');

    const result = createOrderRequestSchema.safeParse({
      amount: 5000,
      email: 'buyer@test.com',
      businessId: '550e8400-e29b-41d4-a716-446655440000',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.amount).toBe(5000);
      expect(result.data.email).toBe('buyer@test.com');
      expect(result.data.businessId).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(result.data.currency).toBe('PEN'); // default
    }
  });

  test('accepts valid input with all optional fields', async () => {
    const { createOrderRequestSchema } = await import('@/features/billing/schemas');

    const result = createOrderRequestSchema.safeParse({
      amount: 3000,
      currency: 'USD',
      email: 'buyer@test.com',
      phone: '999888777',
      businessId: '550e8400-e29b-41d4-a716-446655440000',
      productId: '660e8400-e29b-41d4-a716-446655440001',
      description: 'Test order',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBe('999888777');
      expect(result.data.productId).toBe('660e8400-e29b-41d4-a716-446655440001');
      expect(result.data.description).toBe('Test order');
      expect(result.data.currency).toBe('USD');
    }
  });

  test('rejects amount less than 100', async () => {
    const { createOrderRequestSchema } = await import('@/features/billing/schemas');

    const result = createOrderRequestSchema.safeParse({
      amount: 50,
      email: 'buyer@test.com',
      businessId: '550e8400-e29b-41d4-a716-446655440000',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('Monto mínimo');
    }
  });

  test('rejects invalid email', async () => {
    const { createOrderRequestSchema } = await import('@/features/billing/schemas');

    const result = createOrderRequestSchema.safeParse({
      amount: 1000,
      email: 'not-an-email',
      businessId: '550e8400-e29b-41d4-a716-446655440000',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('Email');
    }
  });

  test('rejects missing businessId', async () => {
    const { createOrderRequestSchema } = await import('@/features/billing/schemas');

    const result = createOrderRequestSchema.safeParse({
      amount: 1000,
      email: 'buyer@test.com',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      // Zod v4: missing required field — mentions 'Required'
      expect(result.error.issues.some((i) => i.path.includes('businessId'))).toBe(true);
    }
  });

  test('rejects invalid businessId UUID', async () => {
    const { createOrderRequestSchema } = await import('@/features/billing/schemas');

    const result = createOrderRequestSchema.safeParse({
      amount: 1000,
      email: 'buyer@test.com',
      businessId: 'not-a-uuid',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('ID de negocio inválido');
    }
  });

  test('rejects non-integer amount', async () => {
    const { createOrderRequestSchema } = await import('@/features/billing/schemas');

    const result = createOrderRequestSchema.safeParse({
      amount: 100.5,
      email: 'buyer@test.com',
      businessId: '550e8400-e29b-41d4-a716-446655440000',
    });

    expect(result.success).toBe(false);
  });

  test('allows phone to be optional and nullable', async () => {
    const { createOrderRequestSchema } = await import('@/features/billing/schemas');

    const withoutPhone = createOrderRequestSchema.safeParse({
      amount: 1000,
      email: 'buyer@test.com',
      businessId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(withoutPhone.success).toBe(true);

    const nullPhone = createOrderRequestSchema.safeParse({
      amount: 1000,
      email: 'buyer@test.com',
      businessId: '550e8400-e29b-41d4-a716-446655440000',
      phone: null,
    });
    expect(nullPhone.success).toBe(true);
  });

  test('defaults currency to PEN when not provided', async () => {
    const { createOrderRequestSchema } = await import('@/features/billing/schemas');

    const result = createOrderRequestSchema.safeParse({
      amount: 1000,
      email: 'buyer@test.com',
      businessId: '550e8400-e29b-41d4-a716-446655440000',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toBe('PEN');
    }
  });
});

// =====================================================
// CART SNAPSHOT — optional cartItems (R1 / A1, slice 2)
// =====================================================

describe('createOrderRequestSchema — cartItems snapshot', () => {
  const base = {
    amount: 13000,
    email: 'buyer@test.com',
    businessId: '550e8400-e29b-41d4-a716-446655440000',
  };
  const lineA = { id: '660e8400-e29b-41d4-a716-446655440001', quantity: 2 };
  const lineB = { id: '770e8400-e29b-41d4-a716-446655440002', quantity: 1 };

  test('accepts an optional cartItems snapshot', async () => {
    const { createOrderRequestSchema } = await import('@/features/billing/schemas');

    const result = createOrderRequestSchema.safeParse({ ...base, cartItems: [lineA, lineB] });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cartItems).toEqual([lineA, lineB]);
    }
  });

  test('defaults a missing line quantity to 1', async () => {
    const { createOrderRequestSchema } = await import('@/features/billing/schemas');

    const result = createOrderRequestSchema.safeParse({
      ...base,
      cartItems: [{ id: lineA.id }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cartItems).toEqual([{ id: lineA.id, quantity: 1 }]);
    }
  });

  test('rejects a line with quantity 0', async () => {
    const { createOrderRequestSchema } = await import('@/features/billing/schemas');

    const result = createOrderRequestSchema.safeParse({
      ...base,
      cartItems: [{ id: lineA.id, quantity: 0 }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(['cartItems', 0, 'quantity']);
    }
  });

  test('rejects a non-integer line quantity', async () => {
    const { createOrderRequestSchema } = await import('@/features/billing/schemas');

    const result = createOrderRequestSchema.safeParse({
      ...base,
      cartItems: [{ id: lineA.id, quantity: 1.5 }],
    });

    expect(result.success).toBe(false);
  });

  test('strips client bookkeeping fields down to the {id, quantity} snapshot shape', async () => {
    const { createOrderRequestSchema } = await import('@/features/billing/schemas');

    const result = createOrderRequestSchema.safeParse({
      ...base,
      cartItems: [{ id: lineA.id, quantity: 2, name: 'Camiseta', price: '150', stock: 10 }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // The persisted snapshot must match the exact `validateAmount` line shape —
      // client bookkeeping fields (name/price/stock) never reach the DB.
      expect(result.data.cartItems).toEqual([{ id: lineA.id, quantity: 2 }]);
    }
  });
});
