import { resolveStorefrontDefaultScheme } from '@/core/storefront/resolveStorefrontDefaultScheme';
import { describe, expect, it } from 'vitest';

describe('resolveStorefrontDefaultScheme', () => {
  it('prefers a valid visitor cookie over the stored store scheme', () => {
    expect(resolveStorefrontDefaultScheme({ cookieValue: 'dark', storedScheme: 'light' })).toBe(
      'dark',
    );
  });

  it('uses a valid stored scheme when the cookie is invalid', () => {
    expect(resolveStorefrontDefaultScheme({ cookieValue: 'system', storedScheme: 'dark' })).toBe(
      'dark',
    );
  });

  it('falls back to light when neither value is valid', () => {
    expect(resolveStorefrontDefaultScheme({ cookieValue: null, storedScheme: 'auto' })).toBe(
      'light',
    );
  });
});
