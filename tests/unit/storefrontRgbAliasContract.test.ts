import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildStorefrontThemeStyleTag,
  buildStorefrontThemeVars,
  createDefaultStorefrontTheme,
} from '@/core/storefront';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

const theme = createDefaultStorefrontTheme();

function channels(color: string): string | undefined {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
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

  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})\b/i.exec(color.trim());
  if (!rgb) return undefined;

  const values = [rgb[1], rgb[2], rgb[3]].map(Number);
  return values.every((value) => value >= 0 && value <= 255) ? values.join(', ') : undefined;
}

const themed = (color: string) => {
  const base = createDefaultStorefrontTheme();
  return {
    ...base,
    light: {
      ...base.light,
      palette: { ...base.light.palette, primary: color, secondary: color, accent: color },
    },
    dark: {
      ...base.dark,
      palette: { ...base.dark.palette, primary: color, secondary: color, accent: color },
    },
  };
};

describe('storefront RGB alias contract (T29)', () => {
  it.each(['light', 'dark'] as const)(
    '%s aliases are additive and derived from parseable color tokens',
    (scheme) => {
      const entries = Object.entries(buildStorefrontThemeVars(theme, scheme)) as [string, string][];
      const base = new Map(entries.filter(([key]) => !key.endsWith('-rgb')));
      const aliases = entries.filter(([key]) => key.endsWith('-rgb'));

      expect(aliases.length).toBeGreaterThan(0);
      for (const [key, value] of aliases) {
        const source = key.slice(0, -4);
        expect(key).toMatch(/^--md-sys-color-.+-rgb$/);
        expect(base.has(source)).toBe(true);
        expect(value).toBe(channels(base.get(source) ?? ''));
        expect(value).toMatch(/^\d{1,3}, \d{1,3}, \d{1,3}$/);
      }

      const expectedAliases = Array.from(base.entries())
        .filter(
          ([key, value]) => key.startsWith('--md-sys-color-') && channels(value) !== undefined,
        )
        .map(([key]) => `${key}-rgb`)
        .sort();
      expect(aliases.map(([key]) => key).sort()).toEqual(expectedAliases);
    },
  );

  it.each(['light', 'dark'] as const)(
    '%s style tag preserves declaration order and appends only aliases',
    (scheme) => {
      const tag = buildStorefrontThemeStyleTag(theme, scheme);
      const declarations = tag.slice(6, tag.indexOf('}')).split(';');
      const expected = Object.entries(buildStorefrontThemeVars(theme, scheme)).map(
        ([key, value]) => `${key}:${value}`,
      );

      expect(declarations).toEqual(expected);
    },
  );

  it.each([
    ['#abc', '170, 187, 204'],
    ['#A1B2C3', '161, 178, 195'],
    ['rgb(4, 5, 6)', '4, 5, 6'],
    ['rgba(7, 8, 9, 0.5)', '7, 8, 9'],
    ['garbage', undefined],
    ['rgb(300, 0, 0)', undefined],
    ['rgb(-1, 0, 0)', undefined],
    ['', undefined],
  ] as [string, string | undefined][])('converts %s -> %s', (color, expected) => {
    const vars = new Map(Object.entries(buildStorefrontThemeVars(themed(color), 'light')));
    expect(vars.get('--md-sys-color-primary-rgb')).toBe(expected);
  });

  it('emits every token consumed by storefront product and secondary styles', () => {
    const stylesheets = [
      'app/[slug]/(app)/product/[productId]/components/ProductDetail.module.css',
      'app/[slug]/(app)/product/[productId]/components/RelatedProductsSection.module.css',
      'app/[slug]/(app)/storefrontAbout.module.css',
      'app/[slug]/(app)/components/ProductPreviewSheet.module.css',
    ];
    const emitted = new Set(Object.keys(buildStorefrontThemeVars(theme, 'dark')));

    for (const relativePath of stylesheets) {
      const consumed = Array.from(
        read(relativePath).matchAll(/var\((--(?:md-sys-color|storefront)-[a-z0-9-]+)/g),
        (match) => match[1],
      );
      expect(consumed.length, `${relativePath} must consume storefront tokens`).toBeGreaterThan(0);
      for (const token of consumed) {
        expect(emitted.has(token), `${relativePath} consumes ${token}`).toBe(true);
      }
    }
  });
});
