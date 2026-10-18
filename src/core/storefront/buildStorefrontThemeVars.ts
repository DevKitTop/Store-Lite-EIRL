import type { StorefrontColorScheme, StorefrontTheme } from './storefrontTheme';
import {
  buildBackgroundCSS,
  getReadableTextColor,
  getStorefrontColorConfig,
} from './storefrontTheme';

/**
 * Resolves the CSS font-family value for a storefront font family identifier.
 */
function resolveStorefrontFontFamily(fontFamily: string): string {
  switch (fontFamily) {
    case 'inter':
      return 'var(--font-storefront-inter), var(--mio-theme-text-font-family), sans-serif';
    case 'roboto':
      return 'var(--font-storefront-roboto), var(--mio-theme-text-font-family), sans-serif';
    case 'poppins':
      return 'var(--font-storefront-poppins), var(--mio-theme-text-font-family), sans-serif';
    case 'google-sans':
    default:
      return "var(--font-google-sans-flex), 'Google Sans', var(--mio-theme-text-font-family), sans-serif";
  }
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
  const ff = resolveStorefrontFontFamily(theme.fontFamily);

  // Build background CSS vars, then strip image-related keys so ::before
  // does not double-paint (the pattern is rendered on <html> instead).
  const bgVars = buildBackgroundCSS(colorConfig.background);
  if (bgVars['--storefront-bg-image']) {
    bgVars['--storefront-bg-image'] = 'none';
    bgVars['--storefront-bg'] = 'transparent';
    delete bgVars['--storefront-bg-size'];
    delete bgVars['--storefront-bg-position'];
    delete bgVars['--storefront-bg-repeat'];
    delete bgVars['--storefront-bg-blend-mode'];
    delete bgVars['--storefront-mask-image'];
    delete bgVars['--storefront-mask-size'];
    delete bgVars['--storefront-mask-position'];
    delete bgVars['--storefront-mask-repeat'];
    delete bgVars['--storefront-mask-composite'];
    delete bgVars['--storefront-filter'];
    delete bgVars['--storefront-opacity'];
    delete bgVars['--storefront-mix-blend-mode'];
    delete bgVars['--storefront-animation'];
    delete bgVars['--storefront-box-shadow'];
    delete bgVars['--storefront-image-rendering'];
  }

  return {
    '--storefront-font-family': ff,
    '--md-sys-color-primary': palette.primary,
    '--md-sys-color-on-primary': getReadableTextColor(palette.primary),
    '--md-sys-color-primary-container': palette.primary,
    '--md-sys-color-on-primary-container': getReadableTextColor(palette.primary),
    '--md-sys-color-secondary': palette.secondary,
    '--md-sys-color-on-secondary': getReadableTextColor(palette.secondary),
    '--md-sys-color-secondary-container': palette.secondary,
    '--md-sys-color-on-secondary-container': getReadableTextColor(palette.secondary),
    '--md-sys-color-tertiary': palette.accent,
    '--md-sys-color-on-tertiary': getReadableTextColor(palette.accent),
    '--md-sys-color-tertiary-container': palette.accent,
    '--md-sys-color-on-tertiary-container': getReadableTextColor(palette.accent),
    '--md-sys-color-surface': isDark ? 'rgba(15, 17, 23, 0.82)' : 'rgba(255, 255, 255, 0.78)',
    '--md-sys-color-surface-container-lowest': isDark
      ? 'rgba(18, 20, 32, 0.62)'
      : 'rgba(252, 252, 253, 0.62)',
    '--md-sys-color-on-surface': isDark ? '#f3f4f6' : '#111827',
    '--md-sys-color-surface-variant': isDark
      ? 'rgba(22, 27, 36, 0.72)'
      : 'rgba(245, 247, 251, 0.68)',
    '--md-sys-color-on-surface-variant': isDark ? '#cbd5e1' : '#4b5563',
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
    '--md-sys-color-outline-variant': isDark ? '#475569' : '#cbd5e1',
    ...bgVars,
  };
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
    // Hardening: palette values are free-form seller-supplied strings. A value
    // containing an angle bracket could close this `<style>` element early and
    // inject a `<script>` (CSS injection escalating to stored XSS on a page a
    // buyer views). Legit CSS values never contain `<` or `>`, so drop such a
    // declaration entirely rather than emit it and break out of the element.
    .filter(([, value]) => !/[<>]/.test(value))
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
  return `:root{${declarations}}`;
}
