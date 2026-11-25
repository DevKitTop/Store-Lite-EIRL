import { canonicalPatternOverlay } from '@/core/storefront/patternCatalog';
import { patternToCssOverlay, type StorefrontCssOverlay } from '@/core/storefront/storefrontTheme';
import { getPatternCraftById } from '@/data/patterncraft';
import { curatedPatternCatalog, getCuratedPatternById } from '@/data/patterncraft/curated';
import { describe, expect, it } from 'vitest';

const EXPECTED_SCHEMES: Record<string, 'light' | 'dark' | 'both'> = {
  'aurora-edge-glow': 'dark',
  'blue-radial-glow': 'dark',
  'center-spotlight-amber': 'dark',
  'center-spotlight-violet': 'dark',
  'basic-grid': 'both',
  'bottom-fade-grid': 'light',
  'circuit-board-light': 'light',
  'dashed-center-fade-grid': 'both',
  'blue-corner-glow': 'light',
  'bottom-emerald-glow': 'light',
  'azure-depths': 'dark',
  'lavender-cosmic-glow': 'both',
  'aurora-dream-corner-whispers': 'light',
  'beige-texture': 'light',
  'moonlit-fog': 'both',
  'soft-yellow-glow': 'both',
};

const cssText = (overlay: StorefrontCssOverlay | undefined) =>
  Object.entries(overlay ?? {})
    .filter(([key, value]) => key !== 'patternId' && typeof value === 'string')
    .map(([key, value]) => `${key}:${value}`)
    .join(';');

describe('T31 curated storefront catalog', () => {
  it('defines a small catalog with complete metadata', () => {
    expect(curatedPatternCatalog.length).toBeGreaterThanOrEqual(12);
    expect(curatedPatternCatalog.length).toBeLessThanOrEqual(20);

    const ids = curatedPatternCatalog.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const entry of curatedPatternCatalog) {
      const pattern = getPatternCraftById(entry.id);
      expect(pattern, `${entry.id} must exist in the source catalog`).toBeDefined();
      expect(entry.name).toBe(pattern?.name);
      expect(entry.family).toBe(pattern?.category);
      expect(entry.schemeSuitability).toBe(EXPECTED_SCHEMES[entry.id]);
      expect(entry.supportsMask).toBe(pattern?.hasMask);
      expect(entry.supportsBlend).toBe(
        Boolean(pattern?.style.backgroundBlendMode || pattern?.style.mixBlendMode),
      );
    }
  });

  it('resolves every curated id without animation or url values', () => {
    for (const entry of curatedPatternCatalog) {
      const pattern = getCuratedPatternById(entry.id);
      expect(pattern?.id).toBe(entry.id);

      const style = JSON.stringify(pattern?.style ?? {});
      expect(style, `${entry.id} must not use animation`).not.toMatch(/animation/i);
      expect(style, `${entry.id} must not use url()`).not.toMatch(/url\(/i);
    }
  });

  it('renders identically from the curated and canonical resolvers', () => {
    for (const entry of curatedPatternCatalog) {
      const curatedOverlay = patternToCssOverlay({
        id: entry.id,
        style: (getCuratedPatternById(entry.id)?.style ?? {}) as Record<string, unknown>,
      });
      const canonicalOverlay = canonicalPatternOverlay({
        patternId: entry.id,
        backgroundImage: 'url(https://example.com/tampered.svg)',
      });

      expect(canonicalOverlay).toEqual(curatedOverlay);
      expect(cssText(curatedOverlay).length).toBeGreaterThan(0);
    }
  });
});
