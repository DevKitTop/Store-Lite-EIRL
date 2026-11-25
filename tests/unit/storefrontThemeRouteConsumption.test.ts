import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  buildStorefrontThemeStyleTag,
  buildStorefrontThemeVars,
  createDefaultStorefrontTheme,
} from '@/core/storefront';
import { describe, expect, it } from 'vitest';

const readProjectFile = (relativePath: string) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

const theme = createDefaultStorefrontTheme();
const vars = buildStorefrontThemeVars(theme, 'dark');

describe('T29 storefront theme route consumption', () => {
  it('emits the rgb alias consumed by the product preview sheet', () => {
    expect(vars['--md-sys-color-surface-container-high-rgb']).toMatch(
      /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/,
    );
  });

  it('emits every storefront token consumed by product detail, related products, about, and preview styles', () => {
    const stylesheets = [
      'app/[slug]/(app)/product/[productId]/components/ProductDetail.module.css',
      'app/[slug]/(app)/product/[productId]/components/RelatedProductsSection.module.css',
      'app/[slug]/(app)/storefrontAbout.module.css',
      'app/[slug]/(app)/components/ProductPreviewSheet.module.css',
    ];

    for (const relativePath of stylesheets) {
      const source = readProjectFile(relativePath);
      const consumed = Array.from(
        source.matchAll(/var\((--(?:md-sys-color|storefront)-[a-z-]+)/g),
        (match) => match[1],
      );

      expect(consumed.length, `${relativePath} must consume storefront tokens`).toBeGreaterThan(0);
      for (const token of consumed) {
        expect(Object.keys(vars), `${relativePath} consumes ${token}`).toContain(token);
      }
    }
  });

  it('serializes rgb aliases into the server style tag', () => {
    const styleTag = buildStorefrontThemeStyleTag(theme, 'dark');

    expect(styleTag).toContain('--md-sys-color-surface-container-high-rgb:');
  });

  it('keeps the editor preview as a local inline override', () => {
    const businessPage = readProjectFile('app/[slug]/(app)/BusinessPageContent.tsx');
    const layout = readProjectFile('app/[slug]/(app)/layout.tsx');

    expect(layout).toContain('<StorefrontThemeScope');
    expect(layout).toContain('{children}');
    expect(layout).toContain('{modal}');
    expect(businessPage).toContain('buildStorefrontThemeVars(editableTheme, activeScheme)');
    expect(businessPage).toContain('style={themeStyles}');
    expect(businessPage).not.toContain('document.documentElement.style');
  });
});
