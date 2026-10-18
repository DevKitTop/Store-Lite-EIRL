// =====================================================
// SAFE JSON-LD — serialiser for <script type="application/ld+json">
// =====================================================
// Description: `JSON.stringify` leaves `<` and `>` untouched, so a value
//   containing `</script>` closes the script element early and the rest of the
//   payload executes as JavaScript. Storefront JSON-LD graphs carry
//   seller-controlled data (business name, product name), so this is a stored
//   XSS against the BUYER viewing the storefront.
//
//   Escaping those characters as JSON `\uXXXX` sequences keeps the output
//   valid JSON while making a breakout structurally impossible. The payload
//   decodes to the exact original strings, so schema.org consumers are
//   unaffected. Mirrors what Next.js does for its own inline JSON payloads.
// =====================================================

/**
 * Serialises any JSON-LD payload so it is safe to inject via
 * `dangerouslySetInnerHTML` into a `<script type="application/ld+json">`
 * element.
 *
 * @param data - the JSON-LD graph (any serialisable value)
 * @returns a JSON string with `<`, `>`, `&`, U+2028 and U+2029 escaped
 */
export function toSafeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
