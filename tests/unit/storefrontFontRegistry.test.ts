import {
  STOREFRONT_FONT_OPTIONS,
  isStorefrontFontFamily,
  resolveStorefrontFontFamily,
} from '@/core/storefront/storefrontFontRegistry';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readProjectFile = (relativePath: string): string =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  readFileSync(path.join(process.cwd(), relativePath), 'utf8');

const EXISTING_CSS_VALUES = {
  'google-sans':
    "var(--font-google-sans-flex), 'Google Sans', var(--mio-theme-text-font-family), sans-serif",
  inter: 'var(--font-storefront-inter), var(--mio-theme-text-font-family), sans-serif',
  roboto: 'var(--font-storefront-roboto), var(--mio-theme-text-font-family), sans-serif',
  poppins: 'var(--font-storefront-poppins), var(--mio-theme-text-font-family), sans-serif',
} as const;

describe('T16 storefront font registry', () => {
  it('exposes Poppins and preserves the CSS value for every existing font', () => {
    expect(STOREFRONT_FONT_OPTIONS.map((option) => option.value)).toEqual([
      'google-sans',
      'inter',
      'roboto',
      'poppins',
    ]);

    for (const [value, cssValue] of Object.entries(EXISTING_CSS_VALUES)) {
      expect(
        resolveStorefrontFontFamily(value as (typeof STOREFRONT_FONT_OPTIONS)[number]['value']),
      ).toBe(cssValue);
    }
  });

  it('resolves every option to a font variable that app/layout.tsx defines', () => {
    const layoutSource = readProjectFile('app/layout.tsx');

    for (const option of STOREFRONT_FONT_OPTIONS) {
      const cssValue = resolveStorefrontFontFamily(option.value);
      const variables = cssValue.match(/var\((--font-[a-z0-9-]+)\)/g) ?? [];
      expect(variables.length, `${option.value} must use a --font-* variable`).toBeGreaterThan(0);

      for (const variableCall of variables) {
        const variable = variableCall.slice(4, -1);
        expect(layoutSource, `${option.value} -> ${variable}`).toContain(`variable: '${variable}'`);
      }
    }
  });

  it('validates font ids from the registry itself', () => {
    expect(isStorefrontFontFamily('poppins')).toBe(true);
    expect(isStorefrontFontFamily('roboto')).toBe(true);
    expect(isStorefrontFontFamily('comic-sans')).toBe(false);
    expect(isStorefrontFontFamily(null)).toBe(false);
  });

  it('keeps a single font map across the documented consumers', () => {
    const consumerFiles = [
      'src/core/storefront/storefrontTheme.ts',
      'src/core/storefront/buildStorefrontThemeVars.ts',
      'app/[slug]/(app)/settings/constants.tsx',
      'app/[slug]/(app)/settings/components/StorefrontThemeEditor.tsx',
      'app/[slug]/(app)/components/StorefrontEditor.tsx',
    ];

    for (const relativePath of consumerFiles) {
      const source = readProjectFile(relativePath);
      expect(source, `${relativePath} must not define a second font map`).not.toMatch(
        /\bcase\s+['"](?:google-sans|inter|roboto|poppins)['"]/,
      );
      expect(source, `${relativePath} must not define a local FONT_OPTIONS`).not.toContain(
        'const FONT_OPTIONS = [',
      );
    }
  });
});
