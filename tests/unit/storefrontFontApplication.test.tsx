import {
  buildStorefrontThemeStyleTag,
  buildStorefrontThemeVars,
  createStorefrontThemeFromPalette,
  STOREFRONT_FONT_OPTIONS,
} from '@/core/storefront';
import { render } from '@testing-library/react';
import React from 'react';
import { createPortal } from 'react-dom';
import { describe, expect, it } from 'vitest';

const TYPOGRAPHY_TOKENS = [
  '--md-ref-typeface-brand',
  '--md-ref-typeface-plain',
  '--md-sys-typescale-display-large-font-family-name',
  '--md-sys-typescale-display-medium-font-family-name',
  '--md-sys-typescale-display-small-font-family-name',
  '--md-sys-typescale-headline-large-font-family-name',
  '--md-sys-typescale-headline-medium-font-family-name',
  '--md-sys-typescale-headline-small-font-family-name',
  '--md-sys-typescale-title-large-font-family-name',
  '--md-sys-typescale-title-medium-font-family-name',
  '--md-sys-typescale-title-small-font-family-name',
  '--md-sys-typescale-body-large-font-family-name',
  '--md-sys-typescale-body-medium-font-family-name',
  '--md-sys-typescale-body-small-font-family-name',
  '--md-sys-typescale-label-large-font-family-name',
  '--md-sys-typescale-label-medium-font-family-name',
  '--md-sys-typescale-label-small-font-family-name',
] as const;

const PALETTE = {
  primary: '#6366f1',
  secondary: '#a855f7',
  accent: '#ec4899',
};

function themeForFont(fontFamily: (typeof STOREFRONT_FONT_OPTIONS)[number]['value']) {
  return createStorefrontThemeFromPalette(PALETTE, { fontFamily });
}

function normalizeCssValue(value: string) {
  return value.replace(/\s+/g, '');
}

describe('storefront font application', () => {
  it.each(STOREFRONT_FONT_OPTIONS)(
    'applies $value to MD3 typography tokens inside the storefront scope',
    (option) => {
      const vars = buildStorefrontThemeVars(themeForFont(option.value), 'light');
      const { container } = render(
        <div data-testid="storefront-scope" style={vars as React.CSSProperties}>
          {React.createElement('md-filled-button', { 'data-testid': 'buy-button' }, 'Comprar')}
          {React.createElement('md-outlined-text-field', { 'data-testid': 'search-field' }, null)}
          {React.createElement('md-chip', { 'data-testid': 'category-chip' }, 'Ofertas')}
        </div>,
      );

      const button = container.querySelector<HTMLElement>('[data-testid="buy-button"]');
      const field = container.querySelector<HTMLElement>('[data-testid="search-field"]');
      const chip = container.querySelector<HTMLElement>('[data-testid="category-chip"]');
      expect(button).not.toBeNull();
      expect(field).not.toBeNull();
      expect(chip).not.toBeNull();

      for (const token of TYPOGRAPHY_TOKENS) {
        expect(normalizeCssValue(getComputedStyle(button!).getPropertyValue(token))).toBe(
          normalizeCssValue(option.cssValue),
        );
        expect(normalizeCssValue(getComputedStyle(field!).getPropertyValue(token))).toBe(
          normalizeCssValue(option.cssValue),
        );
        expect(normalizeCssValue(getComputedStyle(chip!).getPropertyValue(token))).toBe(
          normalizeCssValue(option.cssValue),
        );
      }
    },
  );

  it('applies the selected font to portal content rendered under the storefront layout', () => {
    const option = STOREFRONT_FONT_OPTIONS.find((entry) => entry.value === 'roboto')!;
    const styleTag = buildStorefrontThemeStyleTag(themeForFont(option.value), 'dark');
    const headStyle = document.createElement('style');
    headStyle.textContent = styleTag;
    document.head.appendChild(headStyle);

    const portalHost = document.createElement('div');
    portalHost.dataset.testid = 'portal-host';
    document.body.appendChild(portalHost);

    try {
      render(
        createPortal(
          React.createElement('md-filled-button', { 'data-testid': 'portal-button' }, 'Agregar'),
          portalHost,
        ),
      );

      const button = portalHost.querySelector<HTMLElement>('[data-testid="portal-button"]');
      expect(button).not.toBeNull();

      for (const token of TYPOGRAPHY_TOKENS) {
        expect(normalizeCssValue(getComputedStyle(button!).getPropertyValue(token))).toBe(
          normalizeCssValue(option.cssValue),
        );
      }
    } finally {
      headStyle.remove();
      portalHost.remove();
    }
  });

  it('does not override platform font tokens or emit a bare font-family declaration', () => {
    const vars = buildStorefrontThemeVars(themeForFont('poppins'), 'light');
    const styleTag = buildStorefrontThemeStyleTag(themeForFont('poppins'), 'light');

    expect(Object.keys(vars).some((key) => key.startsWith('--mio-theme-'))).toBe(false);
    expect(Object.keys(vars)).not.toContain('font-family');
    expect(styleTag).not.toMatch(/(^|;)--mio-theme-[^:]*:/);
    expect(styleTag).not.toMatch(/(^|;)font-family:/);
  });
});
