import { buildStorefrontThemeVars } from '@/core/storefront/buildStorefrontThemeVars';
import {
  STOREFRONT_FONT_OPTIONS,
  resolveStorefrontFontFamily,
  type StorefrontFontFamily,
} from '@/core/storefront/storefrontFontRegistry';
import {
  createDefaultStorefrontTheme,
  normalizeStorefrontTheme,
  type StorefrontTheme,
} from '@/core/storefront/storefrontTheme';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string): string =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  readFileSync(path.join(process.cwd(), relativePath), 'utf8');

const DEFAULT_CSS =
  "var(--font-google-sans-flex), 'Google Sans', var(--mio-theme-text-font-family), sans-serif";

describe('T16 shared font contract', () => {
  it('keeps existing CSS values byte-for-byte and adds Poppins', () => {
    expect(STOREFRONT_FONT_OPTIONS.map((option) => `${option.value}=${option.cssValue}`)).toEqual([
      `google-sans=${DEFAULT_CSS}`,
      'inter=var(--font-storefront-inter), var(--mio-theme-text-font-family), sans-serif',
      'roboto=var(--font-storefront-roboto), var(--mio-theme-text-font-family), sans-serif',
      'poppins=var(--font-storefront-poppins), var(--mio-theme-text-font-family), sans-serif',
    ]);
  });

  it('emits the registry CSS value into theme vars for every option', () => {
    for (const option of STOREFRONT_FONT_OPTIONS) {
      const theme = { ...createDefaultStorefrontTheme(), fontFamily: option.value };
      expect(buildStorefrontThemeVars(theme, 'light')['--storefront-font-family']).toBe(
        resolveStorefrontFontFamily(option.value),
      );
    }
  });

  it('falls back to default CSS for invalid font ids at runtime', () => {
    for (const invalid of ['comic-sans', '', null, undefined]) {
      expect(resolveStorefrontFontFamily(invalid as StorefrontFontFamily)).toBe(DEFAULT_CSS);
      const theme = {
        ...createDefaultStorefrontTheme(),
        fontFamily: invalid,
      } as unknown as StorefrontTheme;
      expect(buildStorefrontThemeVars(theme, 'light')['--storefront-font-family']).toBe(
        DEFAULT_CSS,
      );
      expect(normalizeStorefrontTheme(theme).fontFamily).toBe('google-sans');
    }
  });

  it('keeps every option variable declared in app/layout.tsx', () => {
    const layout = read('app/layout.tsx');
    for (const option of STOREFRONT_FONT_OPTIONS) {
      for (const match of option.cssValue.matchAll(/var\((--font-[a-z0-9-]+)\)/g)) {
        expect(layout).toContain(`variable: '${match[1]}'`);
      }
    }
  });

  it('keeps a single font map in all documented consumers', () => {
    for (const file of [
      'src/core/storefront/storefrontTheme.ts',
      'src/core/storefront/buildStorefrontThemeVars.ts',
      'app/[slug]/(app)/settings/constants.tsx',
      'app/[slug]/(app)/settings/components/StorefrontThemeEditor.tsx',
      'app/[slug]/(app)/components/StorefrontEditor.tsx',
    ]) {
      expect(read(file)).not.toMatch(/\bcase\s+['"](?:google-sans|inter|roboto|poppins)['"]/);
      expect(read(file)).not.toContain('const FONT_OPTIONS = [');
    }
  });
});
