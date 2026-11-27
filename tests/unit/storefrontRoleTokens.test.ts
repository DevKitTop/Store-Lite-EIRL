import { describe, expect, it } from 'vitest';

import { buildStorefrontThemeVars } from '@/core/storefront/buildStorefrontThemeVars';
import { createDefaultStorefrontTheme, getContrastRatio } from '@/core/storefront/storefrontTheme';
import { deriveStorefrontTonalContainer } from '@/core/storefront/tonalPalette';

const theme = createDefaultStorefrontTheme();

describe('storefront role tokens', () => {
  it('derives a light-scheme container toward the light surface', () => {
    const base = theme.light.palette.primary;
    const container = deriveStorefrontTonalContainer(base, 'light');

    expect(container).toMatch(/^#[0-9a-f]{6}$/i);
    expect(container).not.toBe(base);
    expect(getContrastRatio(container, '#ffffff')).toBeLessThan(getContrastRatio(base, '#ffffff'));
  });

  it('derives a dark-scheme container toward the dark surface', () => {
    const base = theme.dark.palette.primary;
    const container = deriveStorefrontTonalContainer(base, 'dark');

    expect(container).toMatch(/^#[0-9a-f]{6}$/i);
    expect(container).not.toBe(base);
    expect(getContrastRatio(container, '#000000')).toBeLessThan(getContrastRatio(base, '#000000'));
  });

  it('emits derived containers in the complete token map', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const vars = buildStorefrontThemeVars(theme, scheme);
      const palette = scheme === 'light' ? theme.light.palette : theme.dark.palette;

      expect(vars['--md-sys-color-primary-container']).toBe(
        deriveStorefrontTonalContainer(palette.primary, scheme),
      );
      expect(vars['--md-sys-color-secondary-container']).toBe(
        deriveStorefrontTonalContainer(palette.secondary, scheme),
      );
      expect(vars['--md-sys-color-tertiary-container']).toBe(
        deriveStorefrontTonalContainer(palette.accent, scheme),
      );
    }
  });

  it('snapshots the complete token map for each scheme', () => {
    expect(buildStorefrontThemeVars(theme, 'light')).toMatchSnapshot();
    expect(buildStorefrontThemeVars(theme, 'dark')).toMatchSnapshot();
  });
});
