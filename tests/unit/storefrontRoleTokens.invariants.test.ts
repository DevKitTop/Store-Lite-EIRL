import { describe, expect, it } from 'vitest';

import {
  buildStorefrontThemeStyleTag,
  buildStorefrontThemeVars,
} from '@/core/storefront/buildStorefrontThemeVars';
import { isSafeCssDeclaration, sanitizeCssValue } from '@/core/storefront/cssSafety';
import {
  createDefaultStorefrontTheme,
  getContrastRatio,
  getReadableTextColor,
} from '@/core/storefront/storefrontTheme';
import { deriveStorefrontTonalContainer } from '@/core/storefront/tonalPalette';

const theme = createDefaultStorefrontTheme();
const schemes = ['light', 'dark'] as const;

describe('storefront role token invariants', () => {
  it('derives containers and readable on-colors', () => {
    for (const scheme of schemes) {
      const vars = buildStorefrontThemeVars(theme, scheme);
      const palette = scheme === 'dark' ? theme.dark.palette : theme.light.palette;
      const expectations = [
        {
          base: palette.primary,
          container: vars['--md-sys-color-primary-container'],
          onContainer: vars['--md-sys-color-on-primary-container'],
        },
        {
          base: palette.secondary,
          container: vars['--md-sys-color-secondary-container'],
          onContainer: vars['--md-sys-color-on-secondary-container'],
        },
        {
          base: palette.accent,
          container: vars['--md-sys-color-tertiary-container'],
          onContainer: vars['--md-sys-color-on-tertiary-container'],
        },
      ];
      for (const { base, container, onContainer } of expectations) {
        expect(container).toBe(deriveStorefrontTonalContainer(base, scheme));
        expect(container).not.toBe(base);
        expect(onContainer).toBe(getReadableTextColor(container ?? base));
        if (!container || !onContainer) continue;
        expect(getContrastRatio(container, onContainer)).toBeGreaterThanOrEqual(4.5);
      }
      const error = vars['--md-sys-color-error'];
      const errorContainer = vars['--md-sys-color-error-container'];
      expect(errorContainer).toBe(deriveStorefrontTonalContainer(error ?? '#000', scheme));
      if (!errorContainer) continue;
      expect(
        getContrastRatio(errorContainer, vars['--md-sys-color-on-error-container'] ?? '#000'),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('emits scheme-coherent outline/error/inverse roles (S1,S4)', () => {
    const light = buildStorefrontThemeVars(theme, 'light');
    const dark = buildStorefrontThemeVars(theme, 'dark');
    const expectations = [
      {
        lightValue: light['--md-sys-color-outline'],
        darkValue: dark['--md-sys-color-outline'],
        expectedLight: '#79747e',
        expectedDark: '#938f99',
      },
      {
        lightValue: light['--md-sys-color-error'],
        darkValue: dark['--md-sys-color-error'],
        expectedLight: '#b3261e',
        expectedDark: '#f2b8b5',
      },
      {
        lightValue: light['--md-sys-color-error-container'],
        darkValue: dark['--md-sys-color-error-container'],
        expectedLight: '#e2adaa',
        expectedDark: '#655053',
      },
      {
        lightValue: light['--md-sys-color-inverse-surface'],
        darkValue: dark['--md-sys-color-inverse-surface'],
        expectedLight: '#303033',
        expectedDark: '#e6e0e9',
      },
      {
        lightValue: light['--md-sys-color-inverse-on-surface'],
        darkValue: dark['--md-sys-color-inverse-on-surface'],
        expectedLight: '#f5f5f5',
        expectedDark: '#303033',
      },
      {
        lightValue: light['--md-sys-color-inverse-primary'],
        darkValue: dark['--md-sys-color-inverse-primary'],
        expectedLight: '#a1a3f7',
        expectedDark: '#535b9e',
      },
      {
        lightValue: light['--md-sys-color-shadow'],
        darkValue: dark['--md-sys-color-shadow'],
        expectedLight: '#000000',
        expectedDark: '#000000',
      },
      {
        lightValue: light['--md-sys-color-scrim'],
        darkValue: dark['--md-sys-color-scrim'],
        expectedLight: '#000000',
        expectedDark: '#000000',
      },
    ];
    for (const { lightValue, darkValue, expectedLight, expectedDark } of expectations) {
      expect(lightValue).toMatch(/^#[0-9a-f]{6}$/i);
      expect(darkValue).toMatch(/^#[0-9a-f]{6}$/i);
      expect(lightValue).toBe(expectedLight);
      expect(darkValue).toBe(expectedDark);
    }
  });

  it('clamps ratios and passes invalid hex through', () => {
    expect(deriveStorefrontTonalContainer('#123456', 'light', -1)).toBe('#123456');
    expect(deriveStorefrontTonalContainer('#123456', 'light', 2)).toBe('#ffffff');
    expect(deriveStorefrontTonalContainer('garbage', 'dark')).toBe('garbage');
    expect(deriveStorefrontTonalContainer('#ffffff', 'light')).toBe('#ffffff');
  });

  it('writes no global DOM state and emits only sanitizer-safe values (invariants)', () => {
    const before = JSON.stringify(theme);
    const styleBefore = document.documentElement.getAttribute('style');
    const tagsBefore = document.head.querySelectorAll('style').length;
    const forced = {
      ...theme,
      light: {
        ...theme.light,
        palette: {
          ...theme.light.palette,
          primary: 'url(javascript:alert(1))</style>',
        },
      },
    };
    const tag = buildStorefrontThemeStyleTag(forced, 'light');
    const rootEnd = tag.indexOf('}');
    expect(tag.startsWith(':root{')).toBe(true);
    expect(tag.slice(6, rootEnd)).not.toMatch(/[<>{}@]|url\(/i);
    expect(tag.slice(rootEnd + 1)).toMatch(
      /^:root md-filled-button,:root md-outlined-button,:root md-text-button,:root md-elevated-button,:root md-filled-tonal-button\{[^{}<>@]*\}$/i,
    );
    for (const [key, value] of Object.entries(buildStorefrontThemeVars(forced, 'light'))) {
      expect(isSafeCssDeclaration(key), key).toBe(true);
      expect(sanitizeCssValue(value) === value || sanitizeCssValue(value) === undefined, key).toBe(
        true,
      );
    }
    expect(JSON.stringify(theme)).toBe(before);
    expect(document.documentElement.getAttribute('style')).toBe(styleBefore);
    expect(document.head.querySelectorAll('style').length).toBe(tagsBefore);
  });
});
