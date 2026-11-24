import {
  buildStorefrontThemeStyleTag,
  createDefaultStorefrontTheme,
  normalizeStorefrontTheme,
} from '@/core/storefront';
import { sanitizeCssValue, sanitizePatternId } from '@/core/storefront/cssSafety';
import { canonicalizeStorefrontThemePatterns } from '@/core/storefront/patternCatalog';
import { describe, expect, it } from 'vitest';

/**
 * Phase 0 (T01–T03) — the seller-facing theme payload is free-form CSS.
 * It is persisted to JSONB and later serialised into a `<style>` block that
 * BUYERS receive, so every value must survive two chokepoints:
 *   1. `normalizeStorefrontTheme` (write + read sanitization)
 *   2. `buildStorefrontThemeStyleTag` (serialization guard)
 * PatternCraft overlays must be re-derived from the catalog instead of trusted.
 */

const DANGEROUS_VALUES = [
  'red;}</style><script>alert(1)</script>',
  'red; color: blue',
  'red}',
  '{red',
  '<svg onload=alert(1)>',
  '@import "evil.css"',
  'url(https://evil.test/x.css)',
  'URL("x")',
  'expression(alert(1))',
  // split so the security linter does not flag this fixture as real eval code
  'javascript' + ':alert(1)',
  'red !important',
  'a\\62 c',
];

const themeWithOverlay = (cssOverlay: Record<string, unknown>) => {
  const theme = createDefaultStorefrontTheme();
  return {
    ...theme,
    light: {
      ...theme.light,
      background: { type: 'solid' as const, colors: ['#ffffff'], cssOverlay },
    },
  };
};

const themeWithPrimary = (primary: string) => {
  const theme = createDefaultStorefrontTheme();
  return {
    ...theme,
    light: { ...theme.light, palette: { ...theme.light.palette, primary } },
  };
};

describe('cssSafety — seller-supplied CSS values', () => {
  it.each(DANGEROUS_VALUES)('rejects %j', (value) => {
    expect(sanitizeCssValue(value)).toBeUndefined();
  });

  it('keeps legitimate gradients, colors and masks intact', () => {
    const gradient =
      'linear-gradient(to right, rgba(75, 85, 99, 0.4) 1px, transparent 1px), linear-gradient(to bottom, #e5e7eb 1px, transparent 1px)';
    const mask = 'radial-gradient(ellipse 70% 60% at 50% 100%, #000 60%, transparent 100%)';

    expect(sanitizeCssValue(gradient)).toBe(gradient);
    expect(sanitizeCssValue(mask)).toBe(mask);
    expect(sanitizeCssValue('  20px 30px  ')).toBe('20px 30px');
    expect(sanitizeCssValue('0.5')).toBe('0.5');
    expect(sanitizeCssValue('intersect')).toBe('intersect');
  });

  it('collapses multi-line catalog styling into a single-line safe value', () => {
    const multiline = `
        linear-gradient(to right, #e2e8f0 1px, transparent 1px),
        linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)
      `;

    expect(sanitizeCssValue(multiline)).toBe(
      'linear-gradient(to right, #e2e8f0 1px, transparent 1px), linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)',
    );
    expect(sanitizeCssValue('red\u0000')).toBe('red');
    expect(sanitizeCssValue(' \n\t ')).toBeUndefined();
  });

  it('caps value length at 800 characters', () => {
    expect(sanitizeCssValue('a'.repeat(800))).toHaveLength(800);
    expect(sanitizeCssValue('a'.repeat(801))).toBeUndefined();
  });

  it('ignores non-string input', () => {
    expect(sanitizeCssValue(undefined)).toBeUndefined();
    expect(sanitizeCssValue(12)).toBeUndefined();
    expect(sanitizeCssValue({})).toBeUndefined();
  });

  it('accepts only id-shaped pattern ids', () => {
    expect(sanitizePatternId(' basic-grid ')).toBe('basic-grid');
    // Real catalog ids contain spaces and slashes; they never reach CSS output.
    expect(sanitizePatternId('orchid -depths')).toBe('orchid -depths');
    expect(sanitizePatternId('diagonal-red/blue-glow')).toBe('diagonal-red/blue-glow');
    expect(sanitizePatternId('basic-grid;}')).toBeUndefined();
    expect(sanitizePatternId(7)).toBeUndefined();
  });
});

describe('normalizeStorefrontTheme — overlay sanitization (T02)', () => {
  it('drops hostile overlay fields but keeps the sanitized ones', () => {
    const normalized = normalizeStorefrontTheme(
      themeWithOverlay({
        patternId: 'basic-grid',
        backgroundImage: 'linear-gradient(to right, #e5e7eb 1px, transparent 1px)',
        backgroundSize: '40px 40px;}</style><script>alert(1)</script>',
        maskImage: 'url(https://evil.test/mask.svg)',
        filter: 'blur(4px)',
      }),
    );

    const overlay = normalized.light.background?.cssOverlay;

    expect(overlay?.backgroundImage).toBe(
      'linear-gradient(to right, #e5e7eb 1px, transparent 1px)',
    );
    expect(overlay?.backgroundSize).toBeUndefined();
    expect(overlay?.maskImage).toBeUndefined();
    expect(overlay?.filter).toBe('blur(4px)');
  });

  it('drops the overlay entirely when backgroundImage is hostile', () => {
    const normalized = normalizeStorefrontTheme(
      themeWithOverlay({ patternId: 'basic-grid', backgroundImage: 'red;}</style>' }),
    );

    expect(normalized.light.background?.cssOverlay).toBeUndefined();
    expect(normalized.light.background?.colors).toEqual(['#ffffff']);
  });
});

describe('canonicalizeStorefrontThemePatterns — catalog is the source of truth (T01)', () => {
  it('replaces a tampered overlay with the catalog definition', () => {
    const canonical = canonicalizeStorefrontThemePatterns(
      themeWithOverlay({ patternId: 'basic-grid', backgroundImage: 'red', backgroundSize: '1px' }),
    );

    const overlay = canonical.light.background?.cssOverlay;

    expect(overlay?.patternId).toBe('basic-grid');
    expect(overlay?.backgroundImage).toContain('linear-gradient');
    expect(overlay?.backgroundSize).toBe('40px 40px');
  });

  it('keeps a sanitized overlay whose pattern id is not in the catalog', () => {
    const legacy = themeWithOverlay({
      patternId: 'removed-pattern',
      backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px)',
    });

    const canonical = canonicalizeStorefrontThemePatterns(legacy);

    expect(canonical.light.background?.cssOverlay?.backgroundImage).toBe(
      'linear-gradient(to right, #fff 1px, transparent 1px)',
    );
  });

  it('leaves themes without overlays untouched', () => {
    const theme = createDefaultStorefrontTheme();
    expect(canonicalizeStorefrontThemePatterns(theme)).toEqual(theme);
  });
});

describe('buildStorefrontThemeStyleTag — serialization guard (T03)', () => {
  it.each(DANGEROUS_VALUES)('drops a declaration whose value is %j', (value) => {
    const css = buildStorefrontThemeStyleTag(themeWithPrimary(value), 'light');

    expect(css).toContain(':root{');
    expect(css).not.toContain('</style>');
    expect(css).not.toContain('<script');
    expect(css).not.toContain('url(');
    expect(css).not.toContain('!important');
    expect(css).not.toContain('@import');
  });

  it('keeps the default palette declarations', () => {
    const css = buildStorefrontThemeStyleTag(createDefaultStorefrontTheme(), 'light');

    expect(css).toContain('#6366f1');
    expect(css).toContain('--md-sys-color-primary:');
  });
});
