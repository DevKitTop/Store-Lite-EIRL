import { isSafeCssDeclaration, sanitizeCssValue } from './cssSafety';
import { resolveStorefrontFontFamily } from './storefrontFontRegistry';
import type { StorefrontColorScheme, StorefrontTheme } from './storefrontTheme';
import {
  buildBackgroundCSS,
  getReadableTextColor,
  getStorefrontColorConfig,
} from './storefrontTheme';
import { deriveStorefrontTonalContainer } from './tonalPalette';

function colorToRgbChannels(color: string): string | undefined {
  const value = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);

  if (hex) {
    const expanded =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((channel) => channel + channel)
            .join('')
        : hex[1];
    return [0, 2, 4]
      .map((index) => Number.parseInt(expanded.slice(index, index + 2), 16))
      .join(', ');
  }

  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\b/i.exec(value);
  if (!rgb) return undefined;

  const channels = [rgb[1], rgb[2], rgb[3]].map(Number);
  return channels.every((channel) => channel >= 0 && channel <= 255)
    ? channels.join(', ')
    : undefined;
}

function withRgbColorAliases(vars: Record<string, string>): Record<string, string> {
  const aliases: Record<string, string> = {};

  for (const [key, value] of Object.entries(vars)) {
    if (!key.startsWith('--md-sys-color-') || key.endsWith('-rgb')) continue;
    const channels = colorToRgbChannels(value);
    if (channels) aliases[`${key}-rgb`] = channels;
  }

  return { ...vars, ...aliases };
}

/**
 * Builds the complete set of CSS custom properties for a storefront theme.
 *
 * This is a **pure function** with no DOM access — safe for both server (SSR)
 * and client use.  It replicates the inline computation previously embedded
 * inside BusinessPageContentUI so that the same values can be injected as a
 * <style> tag during SSR to eliminate the theme flash on initial page load.
 */
export function buildStorefrontThemeVars(
  theme: StorefrontTheme,
  scheme: StorefrontColorScheme,
): Record<string, string> {
  const colorConfig = getStorefrontColorConfig(theme, scheme);
  const palette = colorConfig.palette;
  const isDark = scheme === 'dark';
  const onSurface = isDark ? '#f3f4f6' : '#111827';
  const onSurfaceVariant = isDark ? '#cbd5e1' : '#4b5563';
  const primaryContainer = deriveStorefrontTonalContainer(palette.primary, scheme);
  const secondaryContainer = deriveStorefrontTonalContainer(palette.secondary, scheme);
  const tertiaryContainer = deriveStorefrontTonalContainer(palette.accent, scheme);
  const error = isDark ? '#f2b8b5' : '#b3261e';
  const errorContainer = deriveStorefrontTonalContainer(error, scheme);
  const inversePrimary = deriveStorefrontTonalContainer(palette.primary, scheme, 0.4);
  const ff = resolveStorefrontFontFamily(theme.fontFamily);

  // The scoped ::before surface consumes every background var. Keeping the
  // complete set here gives SSR, hydration, and the editor preview one
  // identical paint path; no canvas outside the store scope is mutated.
  const bgVars = buildBackgroundCSS(colorConfig.background);

  return withRgbColorAliases({
    '--storefront-font-family': ff,
    '--md-ref-typeface-brand': ff,
    '--md-ref-typeface-plain': ff,
    '--md-sys-typescale-display-large-font-family-name': ff,
    '--md-sys-typescale-display-medium-font-family-name': ff,
    '--md-sys-typescale-display-small-font-family-name': ff,
    '--md-sys-typescale-headline-large-font-family-name': ff,
    '--md-sys-typescale-headline-medium-font-family-name': ff,
    '--md-sys-typescale-headline-small-font-family-name': ff,
    '--md-sys-typescale-title-large-font-family-name': ff,
    '--md-sys-typescale-title-medium-font-family-name': ff,
    '--md-sys-typescale-title-small-font-family-name': ff,
    '--md-sys-typescale-body-large-font-family-name': ff,
    '--md-sys-typescale-body-medium-font-family-name': ff,
    '--md-sys-typescale-body-small-font-family-name': ff,
    '--md-sys-typescale-label-large-font-family-name': ff,
    '--md-sys-typescale-label-medium-font-family-name': ff,
    '--md-sys-typescale-label-small-font-family-name': ff,
    '--storefront-primary': palette.primary,
    '--storefront-on-surface': onSurface,
    '--storefront-on-surface-variant': onSurfaceVariant,
    '--md-sys-color-primary': palette.primary,
    '--md-sys-color-on-primary': getReadableTextColor(palette.primary),
    '--md-sys-color-primary-container': primaryContainer,
    '--md-sys-color-on-primary-container': getReadableTextColor(primaryContainer),
    '--md-sys-color-secondary': palette.secondary,
    '--md-sys-color-on-secondary': getReadableTextColor(palette.secondary),
    '--md-sys-color-secondary-container': secondaryContainer,
    '--md-sys-color-on-secondary-container': getReadableTextColor(secondaryContainer),
    '--md-sys-color-tertiary': palette.accent,
    '--md-sys-color-on-tertiary': getReadableTextColor(palette.accent),
    '--md-sys-color-tertiary-container': tertiaryContainer,
    '--md-sys-color-on-tertiary-container': getReadableTextColor(tertiaryContainer),
    '--md-sys-color-surface': isDark ? 'rgba(15, 17, 23, 0.82)' : 'rgba(255, 255, 255, 0.78)',
    '--md-sys-color-surface-container-lowest': isDark
      ? 'rgba(18, 20, 32, 0.62)'
      : 'rgba(252, 252, 253, 0.62)',
    '--md-sys-color-on-surface': onSurface,
    '--md-sys-color-surface-variant': isDark
      ? 'rgba(22, 27, 36, 0.72)'
      : 'rgba(245, 247, 251, 0.68)',
    '--md-sys-color-on-surface-variant': onSurfaceVariant,
    '--md-sys-color-surface-container-low': isDark
      ? 'rgba(24, 29, 41, 0.68)'
      : 'rgba(248, 250, 252, 0.66)',
    '--md-sys-color-surface-container': isDark
      ? 'rgba(29, 36, 50, 0.72)'
      : 'rgba(241, 245, 249, 0.70)',
    '--md-sys-color-surface-container-high': isDark
      ? 'rgba(36, 45, 61, 0.76)'
      : 'rgba(233, 238, 246, 0.75)',
    '--md-sys-color-surface-container-highest': isDark
      ? 'rgba(45, 55, 72, 0.80)'
      : 'rgba(223, 230, 241, 0.80)',
    '--md-sys-color-outline': isDark ? '#938f99' : '#79747e',
    '--md-sys-color-outline-variant': isDark ? '#475569' : '#cbd5e1',
    '--md-sys-color-error': error,
    '--md-sys-color-on-error': getReadableTextColor(error),
    '--md-sys-color-error-container': errorContainer,
    '--md-sys-color-on-error-container': getReadableTextColor(errorContainer),
    '--md-sys-color-inverse-surface': isDark ? '#e6e0e9' : '#303033',
    '--md-sys-color-inverse-on-surface': isDark ? '#303033' : '#f5f5f5',
    '--md-sys-color-inverse-primary': inversePrimary,
    '--md-sys-color-shadow': '#000000',
    '--md-sys-color-scrim': '#000000',
    ...bgVars,
  });
}

/**
 * Serialises theme CSS vars into a `<style>` block targeting `:root`.
 *
 * Inject the returned string via `<style dangerouslySetInnerHTML>` in the
 * server component to eliminate the flash of unstyled content (FOUC) that
 * occurs when theme vars are applied only on the client via useLayoutEffect.
 */
export function buildStorefrontThemeStyleTag(
  theme: StorefrontTheme,
  scheme: StorefrontColorScheme,
): string {
  const vars = buildStorefrontThemeVars(theme, scheme);
  const declarations = Object.entries(vars)
    // Hardening: palette values are free-form seller-supplied strings that end
    // up inside a `<style>` element. Emit only a custom property whose value
    // passes the same allowlist used when persisting the theme, so a value can
    // never close the element, start a new rule/at-rule, or fetch a URL.
    .filter(([key]) => isSafeCssDeclaration(key))
    .map(([key, value]) => [key, sanitizeCssValue(value)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
  const selectedFont = sanitizeCssValue(vars['--storefront-font-family']);
  const buttonFontCascade = selectedFont
    ? [
        'md-filled-button',
        'md-outlined-button',
        'md-text-button',
        'md-elevated-button',
        'md-filled-tonal-button',
      ]
        .map((selector) => `:root ${selector}`)
        .join(',') + `{--md-sys-typescale-label-large-font-family-name:${selectedFont}}`
    : '';

  return `:root{${declarations}}${buttonFontCascade}`;
}
