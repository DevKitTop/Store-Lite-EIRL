import { buildStorefrontThemeStyleTag } from '@/core/storefront/buildStorefrontThemeVars';
import { sanitizeCssValue } from '@/core/storefront/cssSafety';
import { canonicalizeStorefrontThemePatterns } from '@/core/storefront/patternCatalog';
import { normalizeStorefrontTheme, patternToCssOverlay } from '@/core/storefront/storefrontTheme';
import { allPatternCraftPatterns } from '@/data/patterncraft';
import { describe, expect, it } from 'vitest';

/**
 * Phase 0 regression guard for the sanitizer fold.
 *
 * Catalog CSS is authored multi-line, so the sanitizer collapses insignificant
 * whitespace instead of rejecting it. These cases pin down that folding a value
 * can never turn a hostile value into an accepted one, and that the fold keeps
 * being idempotent for catalog data.
 */

const PALETTE = { primary: '#111111', secondary: '#222222', accent: '#333333' };
const BASE = { version: 2 as const, fontFamily: 'google-sans' as const };

const withOverlay = (cssOverlay: Record<string, unknown>) => ({
  ...BASE,
  light: {
    palette: { ...PALETTE },
    background: { type: 'solid' as const, colors: ['#ffffff'], cssOverlay },
  },
  dark: {
    palette: { ...PALETTE },
    background: { type: 'solid' as const, colors: ['#ffffff'], cssOverlay },
  },
});

const catalogOverlay = (pattern: (typeof allPatternCraftPatterns)[number]) =>
  patternToCssOverlay({
    id: pattern.id,
    style: pattern.style as unknown as Record<string, unknown>,
  });

const persist = (theme: unknown) =>
  normalizeStorefrontTheme(canonicalizeStorefrontThemePatterns(theme as never));

describe('whitespace folding cannot launder hostile CSS (S1)', () => {
  it('rejects declaration breaks, tag closers and control characters after folding', () => {
    const hostile = [
      'red\n;',
      'red\u0000}',
      '  </style>',
      '@\nimport "x"',
      'url\n(https://evil)',
      'red !\nimportant',
    ];

    for (const value of hostile) {
      expect(sanitizeCssValue(value), value).toBeUndefined();
    }
    expect(sanitizeCssValue('   ')).toBeUndefined();
    expect(sanitizeCssValue('\n')).toBeUndefined();
  });

  it('keeps multi-line catalog styling by collapsing it to one safe line', () => {
    expect(sanitizeCssValue('linear-gradient(red,\n  blue)')).toBe('linear-gradient(red, blue)');
  });

  it('is idempotent on every catalog-derived value', () => {
    for (const pattern of allPatternCraftPatterns) {
      for (const value of Object.values(catalogOverlay(pattern))) {
        if (typeof value !== 'string') continue;

        const once = sanitizeCssValue(value);
        if (once === undefined) continue;

        expect(sanitizeCssValue(once), `${pattern.id}: ${value}`).toBe(once);
      }
    }
  });

  it('never emits a style tag an overlay can break out of (S3)', () => {
    const theme = {
      ...BASE,
      light: {
        palette: {
          primary: 'red;}</style><script>alert(1)</script>',
          secondary: '#222222',
          accent: '#333333',
        },
        background: {
          type: 'solid' as const,
          colors: ['#ffffff'],
          cssOverlay: { backgroundImage: 'linear-gradient(red,blue);}</style>' },
        },
      },
    };

    const out = buildStorefrontThemeStyleTag(theme as never, 'light');

    expect(out).not.toContain('</style');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('url(');
  });

  it('keeps every committed pattern overlay after the fold (S2 backstop)', () => {
    const lost = allPatternCraftPatterns.filter(
      (pattern) =>
        persist(withOverlay(catalogOverlay(pattern))).light.background?.cssOverlay?.patternId !==
        pattern.id,
    );

    expect(lost.map((pattern) => pattern.id)).toEqual([]);
  });

  it('treats a null theme payload as an empty theme instead of throwing', () => {
    expect(() =>
      normalizeStorefrontTheme(canonicalizeStorefrontThemePatterns(null as never)),
    ).not.toThrow();
  });
});
