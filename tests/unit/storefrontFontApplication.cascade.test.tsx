import {
  buildStorefrontThemeStyleTag,
  createStorefrontThemeFromPalette,
  STOREFRONT_FONT_OPTIONS,
} from '@/core/storefront';
import { resolveStorefrontFontFamily } from '@/core/storefront/storefrontFontRegistry';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import React from 'react';
import { createPortal } from 'react-dom';
import { describe, expect, it } from 'vitest';

const PALETTE = {
  primary: '#6366f1',
  secondary: '#a855f7',
  accent: '#ec4899',
};

const norm = (value: string) => value.replace(/\s+/g, '').replace(/["']/g, '');

function appendStyle(css: string) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  return style;
}

describe('storefront font token cascade', () => {
  it.each(STOREFRONT_FONT_OPTIONS)(
    'overrides the button element font token for $value in the storefront route',
    (option) => {
      const theme = createStorefrontThemeFromPalette(PALETTE, { fontFamily: option.value });
      const expected = norm(resolveStorefrontFontFamily(option.value));
      const globalButtonCss = readFileSync('src/styles/components/buttons.css', 'utf8');
      const globalStyle = appendStyle(globalButtonCss);
      const themeStyle = appendStyle(buildStorefrontThemeStyleTag(theme, 'light'));
      const portalHost = document.createElement('div');
      portalHost.dataset.testid = 'portal-host';
      document.body.appendChild(portalHost);

      try {
        const { container } = render(
          <>
            <div data-testid="storefront-scope">
              {React.createElement('md-filled-button', { 'data-testid': 'button' }, 'Comprar')}
            </div>
            {createPortal(
              React.createElement(
                'md-filled-button',
                { 'data-testid': 'portal-button' },
                'Agregar',
              ),
              portalHost,
            )}
          </>,
        );

        const button = container.querySelector<HTMLElement>('[data-testid="button"]');
        const portalButton = portalHost.querySelector<HTMLElement>('[data-testid="portal-button"]');
        expect(button).not.toBeNull();
        expect(portalButton).not.toBeNull();

        expect(
          norm(
            getComputedStyle(button!).getPropertyValue(
              '--md-sys-typescale-label-large-font-family-name',
            ),
          ),
        ).toBe(expected);
        expect(
          norm(
            getComputedStyle(portalButton!).getPropertyValue(
              '--md-sys-typescale-label-large-font-family-name',
            ),
          ),
        ).toBe(expected);
      } finally {
        themeStyle.remove();
        globalStyle.remove();
        portalHost.remove();
      }
    },
  );
});
