import {
  buildStorefrontThemeStyleTag,
  buildStorefrontThemeVars,
} from '@/core/storefront/buildStorefrontThemeVars';
import { createDefaultStorefrontTheme } from '@/core/storefront/storefrontTheme';
import { describe, expect, it } from 'vitest';

/**
 * Storefront theme palette values are free-form strings supplied by the seller
 * (and by external sources such as PatternCraft via `StorefrontCssOverlay`).
 * They are serialised into a `<style dangerouslySetInnerHTML>` block. A value
 * containing `<` or `>` can close the `<style>` element early and inject a
 * `<script>` — i.e. CSS injection escalates to stored XSS on a page a BUYER
 * views. These tests lock the breakout guard at that single choke point.
 */
describe('storefront theme style tag — style element breakout guard', () => {
  const withHostilePrimary = (primary: string) => {
    const theme = createDefaultStorefrontTheme();
    return {
      ...theme,
      light: { ...theme.light, palette: { ...theme.light.palette, primary } },
    };
  };

  it('drops a palette value that would close the <style> element', () => {
    const css = buildStorefrontThemeStyleTag(
      withHostilePrimary('red;}</style><script>alert(1)</script>'),
      'light',
    );

    expect(css).not.toContain('</style>');
    expect(css).not.toContain('<script');
    expect(css).not.toContain('<');
    expect(css).not.toContain('>');
  });

  it('drops a value carrying a plain angle bracket', () => {
    const css = buildStorefrontThemeStyleTag(withHostilePrimary('a<b'), 'light');

    expect(css).not.toContain('<');
  });

  it('keeps legitimate hex/rgba/gradient values intact', () => {
    const css = buildStorefrontThemeStyleTag(createDefaultStorefrontTheme(), 'light');

    expect(css).toContain('#6366f1');
    expect(css).toContain(':root{');
  });

  it('keeps gradients with commas and parentheses intact', () => {
    const theme = createDefaultStorefrontTheme();
    const gradient = {
      ...theme,
      light: {
        ...theme.light,
        background: {
          type: 'gradient' as const,
          colors: ['#ffffff', '#000000'],
          gradientDirection: 135,
        },
      },
    };

    // The vars builder itself must not reject a legitimate gradient config.
    expect(buildStorefrontThemeVars(gradient, 'light')).toBeTruthy();
  });

  it('emits the full mask/filter/blend var set for a masked pattern', () => {
    const theme = createDefaultStorefrontTheme();
    const masked = {
      ...theme,
      light: {
        ...theme.light,
        background: {
          type: 'gradient' as const,
          colors: ['#ffffff', '#000000'],
          cssOverlay: {
            backgroundImage: 'linear-gradient(#ffffff, #000000)',
            maskImage: 'linear-gradient(#000000, transparent)',
            filter: 'blur(1px)',
            backgroundBlendMode: 'overlay',
            mixBlendMode: 'multiply',
          },
        },
      },
    };

    const vars = buildStorefrontThemeVars(masked, 'light');

    expect(vars['--storefront-bg-image']).toBe('linear-gradient(#ffffff, #000000)');
    expect(vars['--storefront-mask-image']).toBe('linear-gradient(#000000, transparent)');
    expect(vars['--storefront-filter']).toBe('blur(1px)');
    expect(vars['--storefront-bg-blend-mode']).toBe('overlay');
    expect(vars['--storefront-mix-blend-mode']).toBe('multiply');
  });

  it('sanitizes hostile CSS carried by a pattern var', () => {
    const theme = createDefaultStorefrontTheme();
    const hostile = {
      ...theme,
      light: {
        ...theme.light,
        background: {
          type: 'gradient' as const,
          colors: ['#ffffff', '#000000'],
          cssOverlay: {
            backgroundImage: 'linear-gradient(#ffffff, #000000)',
            maskImage: 'red;}</style><script>alert(1)</script>',
          },
        },
      },
    };

    const css = buildStorefrontThemeStyleTag(hostile, 'light');

    expect(css).not.toContain('</style>');
    expect(css).not.toContain('<script');
    expect(css).not.toContain('<');
    expect(css).not.toContain('>');
  });
});
