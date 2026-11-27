'use client';

import type { StorefrontColorScheme, StorefrontTheme } from '@/core/storefront';
import { createDefaultStorefrontTheme } from '@/core/storefront';
import { buildStorefrontThemeVars } from '@/core/storefront/buildStorefrontThemeVars';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { resolveActiveScheme } from './schemeResolution';
import styles from './StorefrontThemeShell.module.css';
import { ThemeToggle } from './ThemeToggle';
import { useStorefrontViewerTheme } from './useStorefrontViewerTheme';

// The editor is mounted on public storefront routes so the existing style
// shortcut is always reachable. Server actions still authorize every write.
const StorefrontEditor = dynamic(
  () => import('./StorefrontEditor').then((mod) => mod.StorefrontEditor),
  { ssr: false, loading: () => null },
);

const PUBLIC_EXACT_SEGMENTS = new Set([
  'devoluciones',
  'libro-reclamaciones',
  'terminos',
  'privacidad',
]);

interface StorefrontThemeShellProps {
  businessId: string;
  slug: string;
  storefrontTheme?: StorefrontTheme;
  defaultScheme: 'light' | 'dark';
  canCustomizeStorefront: boolean;
  isAdminView: boolean;
  children: ReactNode;
}

function isPublicStorefrontRoute(pathname: string, slug: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== slug) return false;
  if (segments.length === 1) return true;
  return (
    segments[1] === 'product' || segments[1] === 'order' || PUBLIC_EXACT_SEGMENTS.has(segments[1])
  );
}

/**
 * Single owner of the storefront's runtime theme. The server resolves the
 * saved theme and default scheme, then this client shell keeps the viewer
 * toggle, staff preview, CSS variables, background surface and editor entry
 * point in sync on every public storefront route.
 */
export function StorefrontThemeShell({
  businessId,
  slug,
  storefrontTheme,
  defaultScheme,
  canCustomizeStorefront,
  isAdminView,
  children,
}: StorefrontThemeShellProps) {
  const pathname = usePathname();
  const isPublicRoute = isPublicStorefrontRoute(pathname ?? '', slug);
  const { viewerTheme, setViewerTheme, handleViewerThemeToggle } = useStorefrontViewerTheme({
    slug,
    defaultScheme,
  });

  const baseTheme = useMemo(
    () => storefrontTheme ?? createDefaultStorefrontTheme(),
    [storefrontTheme],
  );
  const [editableTheme, setEditableTheme] = useState<StorefrontTheme>(baseTheme);
  const [previewScheme, setPreviewScheme] = useState<StorefrontColorScheme | undefined>(undefined);

  // A saved theme revalidated by the editor action replaces the local draft.
  useEffect(() => {
    setEditableTheme(baseTheme);
  }, [baseTheme]);

  // Staff preview schemes are intentionally per-browser, like the viewer
  // cookie, so a preview does not leak into another session.
  useEffect(() => {
    if (!canCustomizeStorefront) return;
    try {
      const stored = localStorage.getItem(`storefront-preview-scheme-${slug}`);
      if (stored === 'light' || stored === 'dark') {
        setPreviewScheme(stored);
      }
    } catch {
      // Safari private mode — no-op.
    }
  }, [canCustomizeStorefront, slug]);

  const activeScheme = useMemo(
    () => resolveActiveScheme(viewerTheme, previewScheme, defaultScheme),
    [viewerTheme, previewScheme, defaultScheme],
  );

  // Without a saved theme the store inherits the platform MD3 tokens. Vars are
  // emitted only for a saved theme, a staff preview scheme, or an editor draft.
  const hasThemePreview =
    storefrontTheme !== undefined ||
    previewScheme !== undefined ||
    JSON.stringify(editableTheme) !== JSON.stringify(baseTheme);

  const themeVars = useMemo(
    () =>
      hasThemePreview
        ? (buildStorefrontThemeVars(editableTheme, activeScheme) as CSSProperties &
            Record<string, string>)
        : undefined,
    [hasThemePreview, editableTheme, activeScheme],
  );

  const handlePreviewSchemeChange = useCallback(
    (scheme: StorefrontColorScheme | undefined) => {
      setPreviewScheme(scheme);
      if (scheme) {
        setViewerTheme(scheme);
        try {
          localStorage.setItem(`storefront-preview-scheme-${slug}`, scheme);
        } catch {
          // Safari private mode — no-op.
        }
      }
    },
    [setViewerTheme, slug],
  );

  // Platform routes (dashboard, settings, chat, …) must not inherit storefront
  // variables or paint the merchant's store background.
  if (!isPublicRoute) {
    return <div style={{ display: 'contents' }}>{children}</div>;
  }

  return (
    <div data-storefront-theme="" className={styles.shell} style={themeVars}>
      {children}
      {!isAdminView && (
        <ThemeToggle currentScheme={activeScheme} onToggle={handleViewerThemeToggle} />
      )}
      <StorefrontEditor
        business={{ id: businessId, slug }}
        storefrontTheme={editableTheme}
        onThemeChange={setEditableTheme}
        onPreviewSchemeChange={handlePreviewSchemeChange}
        detectedColorScheme={activeScheme}
        currentScheme={previewScheme}
        defaultScheme={defaultScheme}
      />
    </div>
  );
}
