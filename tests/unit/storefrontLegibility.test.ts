import { getContrastRatio, getReadableTextColor } from '@/core/storefront/storefrontTheme';
import { describe, expect, it } from 'vitest';

describe('storefront legibility helpers', () => {
  it('uses 4.5:1 as the AA boundary for normal text', () => {
    expect(getContrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio('#777777', '#ffffff')).toBeLessThan(4.5);
  });

  it('computes a readable text pair for the primary color at the AA boundary', () => {
    const readableTextColor = getReadableTextColor('#767676');
    expect(getContrastRatio('#767676', readableTextColor)).toBeGreaterThanOrEqual(4.5);
  });
});
