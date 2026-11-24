import { parseViewerScheme, type ViewerScheme } from './viewerScheme';

export interface ResolveStorefrontDefaultSchemeInput {
  cookieValue?: string | null;
  storedScheme?: string | null;
}

/**
 * Single server-side source for the storefront default scheme.
 *
 * Resolution order: valid visitor cookie > valid stored store scheme > light.
 * The OS `prefers-color-scheme` preference is intentionally not consulted.
 */
export function resolveStorefrontDefaultScheme({
  cookieValue,
  storedScheme,
}: ResolveStorefrontDefaultSchemeInput): ViewerScheme {
  return parseViewerScheme(cookieValue) ?? parseViewerScheme(storedScheme) ?? 'light';
}
