/**
 * CSS value safety for seller-supplied storefront payloads.
 *
 * Storefront theme values come from client input, are persisted as JSONB, and
 * are later serialised into a `<style>` block that BUYERS receive. A value
 * holding `</style>`, a nested rule (`{`/`}`), an at-rule (`@`), or a remote
 * fetch (`url(...)`) can escape its declaration and escalate CSS injection into
 * stored XSS. This module is the single allowlist primitive used by both the
 * normalizer (read + write) and the style-tag serializer.
 */

/** Hard cap for a single CSS value. Catalog gradients top out around 670 chars. */
export const MAX_CSS_VALUE_LENGTH = 800;

/** `patternId` is a catalog slug, never free-form CSS. */
const PATTERN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Custom properties only: `--storefront-primary`, `--storefront-bg-image`. */
const CUSTOM_PROPERTY_RE = /^--[a-z0-9-]{1,64}$/i;

const FORBIDDEN_FRAGMENTS: readonly RegExp[] = [
  /[;{}<>@\\]/,
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001F\u007F]/,
  /url\s*\(/i,
  /expression\s*\(/i,
  /javascript\s*:/i,
  /-moz-binding/i,
  /!important/i,
];

/**
 * Returns the trimmed value when it is safe to serialise, otherwise `undefined`.
 * Callers drop the declaration entirely; they never try to repair it.
 */
export function sanitizeCssValue(
  value: unknown,
  maxLength = MAX_CSS_VALUE_LENGTH,
): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return undefined;
  if (FORBIDDEN_FRAGMENTS.some((pattern) => pattern.test(trimmed))) return undefined;

  return trimmed;
}

/** Returns the trimmed catalog id when slug-shaped, otherwise `undefined`. */
export function sanitizePatternId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  return PATTERN_ID_RE.test(trimmed) ? trimmed : undefined;
}

/** Declarations are emitted only for custom properties; anything else is dropped. */
export function isSafeCssDeclaration(property: string): boolean {
  return CUSTOM_PROPERTY_RE.test(property);
}
