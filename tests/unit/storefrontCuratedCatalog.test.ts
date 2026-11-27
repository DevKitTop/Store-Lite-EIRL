import { canonicalPatternOverlay } from '@/core/storefront/patternCatalog';
import { patternToCssOverlay, type StorefrontCssOverlay } from '@/core/storefront/storefrontTheme';
import { allPatternCraftPatterns, getPatternCraftById } from '@/data/patterncraft';
import {
  classifyPatternSuitability,
  curatedPatternCatalog,
  getCuratedPatternById,
} from '@/data/patterncraft/curated';
import { describe, expect, it } from 'vitest';

const LEGACY_SCHEMES: Record<string, 'light' | 'dark' | 'both'> = {
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

const isRenderablePattern = (style: object) => {
  const serialized = JSON.stringify(style);
  return !/animation/i.test(serialized) && !/url\(/i.test(serialized);
};

const renderableIds = allPatternCraftPatterns
  .filter((pattern) => isRenderablePattern(pattern.style))
  .map((pattern) => pattern.id);

const cssText = (overlay: StorefrontCssOverlay | undefined) =>
  Object.entries(overlay ?? {})
    .filter(([key, value]) => key !== 'patternId' && typeof value === 'string')
    .map(([key, value]) => `${key}:${value}`)
    .join(';');

describe('T31 expanded storefront catalog', () => {
  it('restores every source pattern that renders without animation or url values', () => {
    expect(renderableIds.length).toBeGreaterThan(200);
    expect(curatedPatternCatalog.map((entry) => entry.id)).toEqual(renderableIds);

    for (const id of Object.keys(LEGACY_SCHEMES)) {
      expect(renderableIds, `${id} must stay available`).toContain(id);
    }
  });

  it('defines complete metadata for every restored pattern', () => {
    const ids = curatedPatternCatalog.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const entry of curatedPatternCatalog) {
      const pattern = getPatternCraftById(entry.id);
      expect(pattern, `${entry.id} must exist in the source catalog`).toBeDefined();
      expect(entry.name).toBe(pattern?.name);
      expect(entry.family).toBe(pattern?.category);
      expect(entry.schemeSuitability).toBe(
        LEGACY_SCHEMES[entry.id] ?? classifyPatternSuitability(pattern?.style ?? {}),
      );
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
