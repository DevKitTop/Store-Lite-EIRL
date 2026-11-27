/**
 * Server-side reconciliation of storefront pattern overlays against the
 * PatternCraft catalog.
 *
 * A saved theme carries `cssOverlay` with a `patternId` plus the CSS that was
 * derived from it. The CSS is client-supplied, so it must never be trusted: when
 * the id resolves in the catalog, the overlay is rebuilt from catalog data.
 * Overlays whose id is no longer in the catalog keep their sanitized CSS so
 * existing stores keep rendering (decision D9).
 *
 * IMPORTANT: this module pulls the PatternCraft catalog (≈70 KB of pattern
 * data). Import it from server code only — never from a client component or from
 * `buildStorefrontThemeVars`, which is shared with the browser.
 */

import { getPatternCraftById } from '@/data/patterncraft';
import {
  patternToCssOverlay,
  type StorefrontColorConfig,
  type StorefrontCssOverlay,
  type StorefrontTheme,
} from './storefrontTheme';

/**
 * Re-derives a CSS overlay from the catalog. Returns the input overlay
 * unchanged when it has no id or the id is unknown; returns `undefined` when
 * there is no overlay at all.
 */
export function canonicalPatternOverlay(
  overlay: StorefrontCssOverlay | undefined,
): StorefrontCssOverlay | undefined {
  if (!overlay) return undefined;

  const patternId = overlay.patternId;
  if (typeof patternId !== 'string' || patternId.length === 0) return overlay;

  const pattern = getPatternCraftById(patternId);
  if (!pattern) return overlay;

  return patternToCssOverlay({
    id: pattern.id,
    style: pattern.style as unknown as Record<string, unknown>,
  });
}

function canonicalizeColorConfig(config: StorefrontColorConfig | undefined) {
  if (!config?.background?.cssOverlay) return config;

  return {
    ...config,
    background: {
      ...config.background,
      cssOverlay: canonicalPatternOverlay(config.background.cssOverlay),
    },
  };
}

/**
 * Returns the theme with every `cssOverlay` whose `patternId` exists in the
 * catalog rebuilt from the catalog definition.
 */
export function canonicalizeStorefrontThemePatterns(theme: StorefrontTheme): StorefrontTheme {
  // Client payloads are untrusted: a null/non-object theme must be left for
  // `normalizeStorefrontTheme` to handle, exactly as it did before this step.
  if (typeof theme !== 'object' || theme === null) return theme;

  return {
    ...theme,
    light: canonicalizeColorConfig(theme.light) ?? theme.light,
    dark: canonicalizeColorConfig(theme.dark) ?? theme.dark,
  };
}
