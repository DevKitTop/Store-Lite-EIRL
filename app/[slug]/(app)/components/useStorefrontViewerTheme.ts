'use client';

import {
  readLegacyViewerScheme,
  readViewerSchemeCookie,
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
