import {
  parseViewerScheme,
  resolveViewerScheme,
  viewerSchemeCookieName,
  viewerSchemeLegacyStorageKey,
} from '@/core/storefront/viewerScheme';
import { describe, expect, it } from 'vitest';

describe('viewerSchemeCookie', () => {
  it('parses only exact light/dark values', () => {
    expect(parseViewerScheme('light')).toBe('light');
    expect(parseViewerScheme('dark')).toBe('dark');
    expect(parseViewerScheme('DARK')).toBeNull();
    expect(parseViewerScheme('')).toBeNull();
    expect(parseViewerScheme(null)).toBeNull();
    expect(parseViewerScheme(undefined)).toBeNull();
  });

  it('uses the same per-store key for cookie and legacy storage', () => {
    expect(viewerSchemeCookieName('mystore')).toBe('storefront-theme-mystore');
    expect(viewerSchemeLegacyStorageKey('mystore')).toBe('storefront-theme-mystore');
  });

  it('gives the cookie precedence over a legacy value and the store default', () => {
    expect(
      resolveViewerScheme({
        cookieValue: 'dark',
        legacyValue: 'light',
        defaultScheme: 'light',
      }),
    ).toBe('dark');
  });

  it('falls back to the legacy value when the cookie is invalid', () => {
    expect(
      resolveViewerScheme({
        cookieValue: 'system',
        legacyValue: 'dark',
        defaultScheme: 'light',
      }),
    ).toBe('dark');
  });

  it('uses the store default when neither source has a valid value', () => {
    expect(
      resolveViewerScheme({
        cookieValue: undefined,
        legacyValue: 'auto',
        defaultScheme: 'dark',
      }),
    ).toBe('dark');
  });
});
