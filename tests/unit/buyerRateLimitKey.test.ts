// =====================================================
// Buyer-scoped rate-limit key (W-P2)
// =====================================================
// The charge limiter gains a buyer dimension so one buyer cannot hammer the
// endpoint across many product/business combinations. Because the identity is
// PII (email / DNI), only a hash may ever reach the key.

import { buildBuyerRateLimitKey, hashBuyerIdentity } from '@/core/payments/buyerRateLimitKey';
import { describe, expect, test } from 'vitest';

const BASE = {
  businessId: '550e8400-e29b-41d4-a716-446655440000',
  productId: '660e8400-e29b-41d4-a716-446655440001',
};

describe('buildBuyerRateLimitKey', () => {
  test('returns null when the request carries no buyer identity', () => {
    expect(buildBuyerRateLimitKey({ ...BASE })).toBeNull();
    expect(buildBuyerRateLimitKey({ ...BASE, email: '', dni: '', authId: null })).toBeNull();
    expect(buildBuyerRateLimitKey({ ...BASE, email: '   ', dni: '  ' })).toBeNull();
  });

  test('is scoped by business and product and marks the buyer dimension', () => {
    const key = buildBuyerRateLimitKey({ ...BASE, email: 'buyer@test.com' });
    expect(key).toBeTruthy();
    expect(key?.startsWith(`${BASE.businessId}:${BASE.productId}:buyer:`)).toBe(true);
  });

  test('never contains the raw email or DNI', () => {
    const email = 'sensitive.buyer@example.com';
    const dni = '12345678';

    const emailKey = buildBuyerRateLimitKey({ ...BASE, email });
    expect(emailKey).not.toContain(email);
    expect(emailKey).not.toContain('example.com');

    const dniKey = buildBuyerRateLimitKey({ ...BASE, dni });
    expect(dniKey).not.toContain(dni);
  });

  test('different buyers produce different keys', () => {
    const a = buildBuyerRateLimitKey({ ...BASE, email: 'a@test.com' });
    const b = buildBuyerRateLimitKey({ ...BASE, email: 'b@test.com' });
    expect(a).not.toBe(b);
  });

  test('email is case- and whitespace-insensitive', () => {
    const a = buildBuyerRateLimitKey({ ...BASE, email: 'Buyer@Test.com' });
    const b = buildBuyerRateLimitKey({ ...BASE, email: '  buyer@test.com  ' });
    expect(a).toBe(b);
  });

  test('prefers email, then DNI, then authId', () => {
    const withAll = buildBuyerRateLimitKey({
      ...BASE,
      email: 'buyer@test.com',
      dni: '12345678',
      authId: 'auth-1',
    });
    const emailOnly = buildBuyerRateLimitKey({ ...BASE, email: 'buyer@test.com' });
    expect(withAll).toBe(emailOnly);

    const dniOnly = buildBuyerRateLimitKey({ ...BASE, dni: '12345678' });
    expect(dniOnly).not.toBe(emailOnly);
    expect(buildBuyerRateLimitKey({ ...BASE, dni: '12345678', authId: 'auth-1' })).toBe(dniOnly);

    const authOnly = buildBuyerRateLimitKey({ ...BASE, authId: 'auth-1' });
    expect(authOnly).toBeTruthy();
    expect(authOnly).not.toBe(dniOnly);
  });

  test('an email and a DNI with the same text do not collide', () => {
    // The hashed input is namespaced by identity type, so `email:x` can never
    // hash to the same value as `dni:x`.
    const asEmail = buildBuyerRateLimitKey({ ...BASE, email: 'same' });
    const asDni = buildBuyerRateLimitKey({ ...BASE, dni: 'same' });
    expect(asEmail).not.toBe(asDni);
  });
});

describe('hashBuyerIdentity', () => {
  test('is deterministic and 32 hex characters', () => {
    const h1 = hashBuyerIdentity('email:buyer@test.com');
    const h2 = hashBuyerIdentity('email:buyer@test.com');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{32}$/);
  });
});
