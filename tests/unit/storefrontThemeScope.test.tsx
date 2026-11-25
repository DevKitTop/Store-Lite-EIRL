import { StorefrontThemeScope } from '@/app/[slug]/(app)/components/StorefrontThemeScope';
import {
  STOREFRONT_THEME_PREFERENCES_KEY,
  createDefaultStorefrontTheme,
} from '@/core/storefront/storefrontTheme';
import { viewerSchemeCookieName } from '@/core/storefront/viewerScheme';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFindFirst, mockCookies } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockCookies: vi.fn(),
}));

vi.mock('@/core/database/client', () => ({
  db: { query: { businessSettings: { findFirst: mockFindFirst } } },
}));

vi.mock('next/headers', () => ({ cookies: mockCookies }));

const __dirname = dirname(fileURLToPath(import.meta.url));
const layoutPath = join(__dirname, '..', '..', 'app', '[slug]', '(app)', 'layout.tsx');
const homePagePath = join(__dirname, '..', '..', 'app', '[slug]', '(app)', '(home)', 'page.tsx');

function themeFixture() {
  const base = createDefaultStorefrontTheme();
  return {
    ...base,
    light: {
      ...base.light,
      palette: { ...base.light.palette, primary: '#111111' },
    },
    dark: {
      ...base.dark,
      palette: { ...base.dark.palette, primary: '#222222' },
    },
  };
}

function child() {
  return createElement('div', { 'data-testid': 'scope-child' }, 'scoped');
}

beforeEach(() => {
  mockFindFirst.mockReset();
  mockCookies.mockReset();
  mockCookies.mockResolvedValue({
    get: (name: string) =>
      name === viewerSchemeCookieName('demo-store') ? { name, value: 'light' } : undefined,
  });
  mockFindFirst.mockResolvedValue({
    preferences: { [STOREFRONT_THEME_PREFERENCES_KEY]: themeFixture() },
    themeMode: 'dark',
  });
});

describe('StorefrontThemeScope', () => {
  it('reads settings once and emits the cookie-selected theme variable', async () => {
    const markup = renderToStaticMarkup(
      await StorefrontThemeScope({
        businessId: 'business-1',
        slug: 'demo-store',
        children: child(),
      }),
    );

    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    expect(markup).toContain('data-testid="scope-child"');
    expect(markup).toContain('--md-sys-color-primary:#111111');
    expect(markup).not.toContain('--md-sys-color-primary:#222222');
    expect(markup.match(/<style/g)).toHaveLength(1);
  });

  it('does not emit a style tag when the store has no custom theme', async () => {
    mockFindFirst.mockResolvedValue({
      preferences: { locale: 'es' },
      themeMode: 'dark',
    });

    const markup = renderToStaticMarkup(
      await StorefrontThemeScope({
        businessId: 'business-1',
        slug: 'demo-store',
        children: child(),
      }),
    );

    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    expect(markup).toContain('data-testid="scope-child"');
    expect(markup).not.toContain('--md-sys-color-primary');
    expect(markup).not.toMatch(/<style\b/);
  });

  it('injects once from the layout instead of the home page', () => {
    const layout = readFileSync(layoutPath, 'utf-8');
    const homePage = readFileSync(homePagePath, 'utf-8');

    expect(layout).toMatch(/<StorefrontThemeScope/);
    expect(homePage).not.toMatch(/buildStorefrontThemeStyleTag/);
    expect(homePage).not.toMatch(/<style\b/);
  });
});
