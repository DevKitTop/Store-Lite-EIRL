'use client';

import {
  readLegacyViewerScheme,
  readViewerSchemeCookie,
  STOREFRONT_VIEWER_THEME_EVENT,
  writeViewerSchemeCookie,
  type ViewerScheme,
} from '@/core/storefront/viewerScheme';
import { useCallback, useEffect, useRef, useState } from 'react';

export type StorefrontViewerTheme = ViewerScheme;

interface UseStorefrontViewerThemeOptions {
  slug: string;
  defaultScheme: ViewerScheme;
}

/**
 * Owns the storefront viewer light/dark preference.
 *
 * Resolution order on mount: visitor cookie > legacy localStorage value >
 * store default. The OS `prefers-color-scheme` preference is never consulted.
 * An explicit toggle writes only the per-store cookie; it never calls the
 * platform ThemeContext setter, so customizing a store cannot change the
 * seller's admin theme.
 */
export function useStorefrontViewerTheme({ slug, defaultScheme }: UseStorefrontViewerThemeOptions) {
  const [viewerTheme, setViewerThemeState] = useState<ViewerScheme | null>(null);
  const viewerThemeRef = useRef<ViewerScheme | null>(null);

  const setViewerTheme = useCallback((scheme: ViewerScheme | null) => {
    viewerThemeRef.current = scheme;
    setViewerThemeState(scheme);
  }, []);

  useEffect(() => {
    const cookieScheme = readViewerSchemeCookie(slug);
    if (cookieScheme !== null) {
      setViewerTheme(cookieScheme);
      return;
    }

    const legacyScheme = readLegacyViewerScheme(slug);
    if (legacyScheme !== null) {
      writeViewerSchemeCookie(slug, legacyScheme);
      setViewerTheme(legacyScheme);
    }
  }, [setViewerTheme, slug]);

  // The navbar's global theme control forwards its resolved scheme here so a
  // mounted storefront reacts immediately, without a reload or an extra cookie
  // read. Only events for the active slug are accepted.
  useEffect(() => {
    const handleGlobalThemeChange = (event: Event) => {
      const detail = (event as CustomEvent<{ slug: string; scheme: ViewerScheme }>).detail;
      if (detail?.slug === slug && (detail.scheme === 'light' || detail.scheme === 'dark')) {
        setViewerTheme(detail.scheme);
      }
    };

    window.addEventListener(STOREFRONT_VIEWER_THEME_EVENT, handleGlobalThemeChange);
    return () => window.removeEventListener(STOREFRONT_VIEWER_THEME_EVENT, handleGlobalThemeChange);
  }, [setViewerTheme, slug]);

  const handleViewerThemeToggle = useCallback(() => {
    const current = viewerThemeRef.current ?? defaultScheme;
    const next: ViewerScheme = current === 'dark' ? 'light' : 'dark';
    setViewerTheme(next);
    writeViewerSchemeCookie(slug, next);
  }, [defaultScheme, setViewerTheme, slug]);

  return {
    viewerTheme,
    setViewerTheme,
    handleViewerThemeToggle,
  };
}
