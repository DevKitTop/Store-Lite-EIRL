export type ViewerScheme = 'light' | 'dark';

const COOKIE_PREFIX = 'storefront-theme-';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
export const STOREFRONT_VIEWER_THEME_EVENT = 'storefront-viewer-theme-change';

export function viewerSchemeCookieName(slug: string): string {
  return `${COOKIE_PREFIX}${slug}`;
}

export function viewerSchemeLegacyStorageKey(slug: string): string {
  return `${COOKIE_PREFIX}${slug}`;
}

export function parseViewerScheme(value: string | null | undefined): ViewerScheme | null {
  return value === 'light' || value === 'dark' ? value : null;
}

export interface ResolveViewerSchemeInput {
  cookieValue?: string | null;
  legacyValue?: string | null;
  defaultScheme: ViewerScheme;
}

/**
 * Resolution order: visitor cookie > legacy localStorage value > store default.
 * The OS `prefers-color-scheme` preference is intentionally not consulted (D4).
 */
export function resolveViewerScheme({
  cookieValue,
  legacyValue,
  defaultScheme,
}: ResolveViewerSchemeInput): ViewerScheme {
  return parseViewerScheme(cookieValue) ?? parseViewerScheme(legacyValue) ?? defaultScheme;
}

export function readViewerSchemeCookie(slug: string): ViewerScheme | null {
  if (typeof document === 'undefined') return null;

  const name = `${viewerSchemeCookieName(slug)}=`;
  const entry = document.cookie.split('; ').find((item) => item.startsWith(name));

  return parseViewerScheme(entry?.slice(name.length));
}

export function writeViewerSchemeCookie(slug: string, scheme: ViewerScheme): void {
  if (typeof document === 'undefined') return;

  document.cookie = `${viewerSchemeCookieName(slug)}=${scheme}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`;
}

/**
 * Used by the navbar/global theme control to forward its resolved scheme to the
 * active storefront. The cookie survives navigation; the event updates an
 * already-mounted shell without a reload.
 */
export function requestStorefrontThemeSync(slug: string, scheme: ViewerScheme): void {
  writeViewerSchemeCookie(slug, scheme);
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent(STOREFRONT_VIEWER_THEME_EVENT, {
      detail: { slug, scheme },
    }),
  );
}

export function readLegacyViewerScheme(slug: string): ViewerScheme | null {
  try {
    return parseViewerScheme(localStorage.getItem(viewerSchemeLegacyStorageKey(slug)));
  } catch {
    return null;
  }
}
