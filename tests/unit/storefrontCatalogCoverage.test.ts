import { sanitizeCssValue } from '@/core/storefront/cssSafety';
import { canonicalizeStorefrontThemePatterns } from '@/core/storefront/patternCatalog';
import {
  getStorefrontThemeFromPreferences,
  normalizeStorefrontTheme,
  patternToCssOverlay,
} from '@/core/storefront/storefrontTheme';
import { allPatternCraftPatterns } from '@/data/patterncraft';
import { describe, expect, it } from 'vitest';

/**
 * Phase 0 regression guard.
 *
 * The sanitizer must never cost a seller their pattern: every PatternCraft
 * catalog style has to survive write normalization, read normalization, and
 * catalog reconciliation with its `patternId` intact. Catalog values are
 * authored as multi-line CSS, which is why whitespace is collapsed rather than
 * rejected.
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

const collapse = (value: string | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

/** Same order the server actions use: catalog first, then sanitize/normalize. */
const persist = (theme: unknown) =>
  normalizeStorefrontTheme(canonicalizeStorefrontThemePatterns(theme as never));

describe('PatternCraft catalog survives storefront sanitization (S1/S2)', () => {
  it('keeps every catalog overlay and its patternId through write normalization', () => {
    const lost = allPatternCraftPatterns
      .filter((pattern) => {
        const normalized = normalizeStorefrontTheme(withOverlay(catalogOverlay(pattern)));
        return normalized.light.background?.cssOverlay?.patternId !== pattern.id;
      })
      .map((pattern) => pattern.id);

    expect(lost).toEqual([]);
  });

  it('keeps every catalog overlay on the read path', () => {
    const lost = allPatternCraftPatterns
      .filter((pattern) => {
        const read = getStorefrontThemeFromPreferences({
          storefrontTheme: withOverlay(catalogOverlay(pattern)),
        });
        return read.light.background?.cssOverlay?.patternId !== pattern.id;
      })
      .map((pattern) => pattern.id);

    expect(lost).toEqual([]);
  });

  it('replaces a tampered payload for a known id with catalog CSS', () => {
    const wrong: string[] = [];

    for (const pattern of allPatternCraftPatterns) {
      const expected = catalogOverlay(pattern);
      const persisted = persist(
        withOverlay({
          patternId: pattern.id,
          backgroundImage: 'radial-gradient(red, blue)',
          filter: 'hue-rotate(90deg)',
        }),
      );
      const actual = persisted.light.background?.cssOverlay;

      if (actual?.patternId !== pattern.id) {
        wrong.push(`${pattern.id}:id`);
      } else if (collapse(actual.backgroundImage) !== collapse(expected.backgroundImage)) {
        wrong.push(`${pattern.id}:image`);
      }
    }

    expect(wrong).toEqual([]);
  });

  it('never persists a catalog-derived value the sanitizer rejects', () => {
    const rejected: string[] = [];

    for (const pattern of allPatternCraftPatterns) {
      const persisted = persist(
        withOverlay({ patternId: pattern.id, backgroundImage: 'radial-gradient(red, blue)' }),
      );

      for (const [key, value] of Object.entries(persisted.light.background?.cssOverlay ?? {})) {
        if (key === 'patternId' || typeof value !== 'string') continue;
        if (sanitizeCssValue(value) !== value) rejected.push(`${pattern.id}:${key}`);
      }
    }

    expect(rejected).toEqual([]);
  });
});
