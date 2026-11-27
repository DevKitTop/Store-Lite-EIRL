import {
  buildStorefrontThemeStyleTag,
  createStorefrontThemeFromPalette,
  STOREFRONT_FONT_OPTIONS,
} from '@/core/storefront';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const TOKEN = '--md-sys-typescale-label-large-font-family-name';
const PALETTE = { primary: '#6366f1', secondary: '#a855f7', accent: '#ec4899' };

describe('storefront font isolation (S4)', () => {
  it('keeps global MD3 typography defaults intact', () => {
    const themeFonts = readFileSync('src/styles/theme-fonts.css', 'utf8');
    const buttons = readFileSync('src/styles/components/buttons.css', 'utf8');

    expect(themeFonts).toContain('font-family: var(--mio-theme-text-font-family);');
    expect(buttons).toContain(`${TOKEN}: var(--mio-theme-text-font-family);`);
    expect(buttons).not.toMatch(/--storefront-font-family|--md-ref-typeface/);
  });

  it.each(STOREFRONT_FONT_OPTIONS)('emits no bare :root font-family for $value', (option) => {
    const theme = createStorefrontThemeFromPalette(PALETTE, { fontFamily: option.value });
    const tag = buildStorefrontThemeStyleTag(theme, 'light');

    expect(tag).not.toMatch(/(?<!-)font-family\s*:/i);
    const cascade = tag.slice(tag.indexOf('}') + 1);
    expect(cascade.startsWith(':root md-')).toBe(true);
    expect(cascade).toContain(TOKEN);
    expect(cascade.split('{')[0]).not.toMatch(/(^|,)\s*:root\s*[,{]/);
  });
});
