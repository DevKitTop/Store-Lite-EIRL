// =====================================================
// Order tracking shared types — Unit tests
// =====================================================
// Strict TDD: RED phase — these tests will fail because
// types.ts doesn't exist yet. They verify the shape of
// CallerProof.

import type { CallerProof } from '@/app/[slug]/order/[token]/types';
import { describe, expect, test } from 'vitest';

describe('CallerProof type shape', () => {
  test('has optional dni field (string)', () => {
    const proof: CallerProof = { dni: '12345678' };
    expect(typeof proof.dni).toBe('string');
  });

  test('has optional authId field (string)', () => {
    const proof: CallerProof = { authId: 'auth-001' };
    expect(typeof proof.authId).toBe('string');
  });

  test('both fields can be present', () => {
    const proof: CallerProof = { dni: '12345678', authId: 'auth-001' };
    expect(proof.dni).toBe('12345678');
    expect(proof.authId).toBe('auth-001');
  });
});
